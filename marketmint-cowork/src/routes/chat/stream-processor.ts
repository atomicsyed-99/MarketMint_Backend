import { createOrUpdateMessage } from "@/db/queries/messages";
import { registerStream, unregisterStream } from "@/lib/shutdown";
import { getAgentConfigByKey } from "@/services/agent-configs";
import { NotFoundError } from "@/services/agent-jobs";
import { normalizeAgentId } from "@/lib/normalize-agent-id";
import {
  type ArtifactStreamState,
  processArtifactDelta,
} from "./artifact-delta-parser";
import {
  TOOL_LIFECYCLE_EVENT_TYPES,
  agentConfigKeyForToolEvent,
  loadSerializedAgentConfigCached,
} from "@/lib/tool-call-agent-context";

/**
 * Snapshot of the workspace's agent_configs row captured at event time and
 * attached to every persisted/forwarded `tool-agent` part. All fields are
 * optional — historical parts written before enrichment must still parse.
 */
interface AgentDisplayInfo {
  displayName: string | null;
  avatarSrc: string | null;
  avatarColor: string | null;
}

const EMPTY_AGENT_DISPLAY: AgentDisplayInfo = {
  displayName: null,
  avatarSrc: null,
  avatarColor: null,
};

/** No `agent_configs` row is seeded for this key; show a stable label in `tool-agent` streams. */
const AGENTS_JOB_MANAGER_CONFIG_KEY = "agents-job-manager";
const AGENTS_JOB_MANAGER_DISPLAY: AgentDisplayInfo = {
  displayName: "Job Manager Agent",
  avatarSrc: null,
  avatarColor: null,
};

/**
 * Shared mutable state passed between the stream processor and the chat route's
 * onFinish callback so the final text part gets the correct seq value.
 */
export interface StreamState {
  seq: number;
  /** Set to true when a structured `suggestions` event is persisted. */
  hasSuggestions?: boolean;
  /** Set to true when text-end events persist individual text parts. */
  hasStreamedText?: boolean;
}

function normalizeEventType(type: unknown): string {
  if (typeof type !== "string") return "";
  return type.startsWith("data-") ? type.slice("data-".length) : type;
}

const STACK_TRACE_RE = /Error.*at.*\(.+:\d+:\d+\)/;
const SENSITIVE_RE = /postgres:\/\/|redis:\/\/|mysql:\/\/|mongodb:\/\/|eyJ[A-Za-z0-9]/;

function sanitizeErrorText(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "An error occurred";
  if (raw.length > 200 || STACK_TRACE_RE.test(raw) || SENSITIVE_RE.test(raw)) {
    return "Tool execution failed";
  }
  return raw;
}

/**
 * Remove markdown image embeds from sub-agent text so the same assets are not
 * shown twice (structured data-image parts + inline ![alt](url) in tool-agent).
 */
function stripMarkdownImageEmbeds(text: string): string {
  if (!text || typeof text !== "string") return text;
  let t = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function extractThinkingFromText(rawText: string): {
  cleanedText: string;
  reasoningText: string;
} {
  if (!rawText || typeof rawText !== "string") {
    return { cleanedText: "", reasoningText: "" };
  }

  const re = /<thinking>([\s\S]*?)<\/thinking>/gi;
  const reasoningChunks: string[] = [];
  let cleaned = rawText.replace(re, (_m, inner: string) => {
    if (inner && inner.trim()) reasoningChunks.push(inner.trim());
    return "";
  });

  // Streaming: model often sends `<thinking>...` without `</thinking>` yet — do not leak tags into main text.
  const openMatch = cleaned.match(/<thinking>/i);
  if (openMatch && openMatch.index !== undefined) {
    const start = openMatch.index + openMatch[0].length;
    const unclosed = cleaned.slice(start);
    if (unclosed.trim()) reasoningChunks.push(unclosed.trim());
    cleaned = cleaned.slice(0, openMatch.index);
  }

  return {
    cleanedText: cleaned.trim(),
    reasoningText: reasoningChunks.join("\n\n").trim(),
  };
}

/** Strip `<thinking>` and markdown image embeds from sub-agent payloads. */
function stripToolAgentThinkingFromPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (normalizeEventType(payload?.type) !== "tool-agent") return payload;
  const data = payload.data;
  if (!data || typeof data !== "object" || data === null) return payload;
  const d = data as Record<string, unknown>;
  if (typeof d.text !== "string") return payload;
  const { cleanedText } = extractThinkingFromText(d.text);
  const textOut = stripMarkdownImageEmbeds(cleanedText);
  if (textOut === d.text) return payload;
  return { ...payload, data: { ...d, text: textOut } };
}

interface SseFrameParse {
  lines: string[];
  dataLineIndices: number[];
  payload: Record<string, unknown>;
}

/**
 * Parse a complete SSE frame (between `\n\n` boundaries). Returns `null`
 * for framing-only events ([DONE], no data lines, or malformed JSON) —
 * callers forward the raw frame unchanged in that case.
 */
function parseSseFrame(rawEvent: string): SseFrameParse | null {
  const lines = rawEvent.split("\n");
  const dataLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("data:")) dataLineIndices.push(i);
  }
  if (dataLineIndices.length === 0) return null;
  const payloadText = dataLineIndices
    .map((i) => lines[i].slice(5).trimStart())
    .join("\n");
  if (payloadText === "[DONE]") return null;
  try {
    return {
      lines,
      dataLineIndices,
      payload: JSON.parse(payloadText) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/** Replace a parsed frame's data lines with a new JSON-stringified payload. */
function rewriteSseFrame(
  parsed: SseFrameParse,
  newPayload: Record<string, unknown>,
): string {
  const { lines, dataLineIndices } = parsed;
  const newDataLine = `data: ${JSON.stringify(newPayload)}`;
  const first = dataLineIndices[0];
  const last = dataLineIndices[dataLineIndices.length - 1];
  return [
    ...lines.slice(0, first),
    newDataLine,
    ...lines.slice(last + 1),
  ].join("\n");
}

/** Strip `<thinking>` from sub-agent SSE frames. No-op on non-tool-agent. */
function stripToolAgentThinkingFromSseFrame(rawEvent: string): string {
  const parsed = parseSseFrame(rawEvent);
  if (!parsed) return rawEvent;
  const next = stripToolAgentThinkingFromPayload(parsed.payload);
  if (next === parsed.payload) return rawEvent;
  return rewriteSseFrame(parsed, next);
}

/**
 * Inject `displayName`/`avatarSrc`/`avatarColor` into the `data` of a
 * `tool-agent` SSE frame. No-op on any other frame type.
 */
/** Mastra / AI SDK delegation tools use the `agent-*` prefix (e.g. agent-performanceMarketingAgent). */
function isAgentDelegationToolName(toolName: string | undefined): boolean {
  return typeof toolName === "string" && toolName.startsWith("agent-");
}

function isInternalUtilityData(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  if (data.internal === true) return true;
  return data.name === "updateWorkingMemory";
}

type DelegationFrame = { toolCallId: string; configKey: string };

type DelegationMeta = {
  startSeq: number;
  startTime: number;
  toolName: string;
};

/**
 * Workspace agent display metadata at delegation scope-open must **not** be merged onto
 * `tool-input-available` chunks — the AI SDK validates protocol parts strictly and rejects
 * unknown keys (`agent`, etc.). Emit a separate `data-delegation-agent-meta` DataUIPart instead.
 */
async function buildDelegationAgentMetaEvent(
  payload: Record<string, unknown>,
  resolveAgentDisplay: (rawAgentId: unknown) => Promise<AgentDisplayInfo>,
  workspaceId: string | undefined,
): Promise<Record<string, unknown> | null> {
  const toolName = payload?.toolName as string | undefined;
  const toolCallId = payload?.toolCallId as string | undefined;
  if (
    !isAgentDelegationToolName(toolName) ||
    !workspaceId ||
    typeof toolCallId !== "string"
  ) {
    return null;
  }
  const rawId =
    typeof toolName === "string" && toolName.startsWith("agent-")
      ? toolName.slice("agent-".length)
      : toolName;
  const display = await resolveAgentDisplay(rawId);
  const configKey = normalizeAgentId(toolName as string);
  return {
    type: "data-delegation-agent-meta",
    id: `delegation-meta-${toolCallId}`,
    data: {
      toolCallId,
      toolName,
      agent: {
        configKey,
        displayName: display.displayName,
        avatarSrc: display.avatarSrc,
        avatarColor: display.avatarColor,
      },
    },
  };
}

/** Live SSE: delegation closed (mirrors persisted `agent-delegation-end` for the FE stream). */
function buildDelegationAgentEndSsePayload(opts: {
  toolCallId: string;
  toolName: string | undefined;
  displayForTool: AgentDisplayInfo;
  configKey: string;
  ok: boolean;
  errorMessage?: string;
  durationMs?: number;
  startSeq?: number;
}): Record<string, unknown> {
  return {
    type: "data-delegation-agent-end",
    id: `delegation-end-${opts.toolCallId}`,
    data: {
      toolCallId: opts.toolCallId,
      toolName: opts.toolName,
      phase: "finish",
      ok: opts.ok,
      ...(opts.errorMessage ? { error: opts.errorMessage } : {}),
      ...(opts.durationMs !== undefined ? { duration_ms: opts.durationMs } : {}),
      ...(opts.startSeq !== undefined ? { startSeq: opts.startSeq } : {}),
      ...(opts.configKey
        ? {
            agent: {
              configKey: opts.configKey,
              displayName: opts.displayForTool.displayName,
              avatarSrc: opts.displayForTool.avatarSrc,
              avatarColor: opts.displayForTool.avatarColor,
            },
          }
        : {}),
    },
  };
}

async function enrichToolAgentFrameWithDisplay(
  rawEvent: string,
  resolveAgentDisplay: (rawAgentId: unknown) => Promise<AgentDisplayInfo>,
): Promise<string> {
  const parsed = parseSseFrame(rawEvent);
  if (!parsed) return rawEvent;
  if (normalizeEventType(parsed.payload?.type) !== "tool-agent") return rawEvent;
  const data = parsed.payload.data as Record<string, unknown> | undefined;
  if (!data) return rawEvent;
  const display = await resolveAgentDisplay(data.id);
  const rawText = typeof data.text === "string" ? data.text : "";
  const { cleanedText } = extractThinkingFromText(rawText);
  const textOut = stripMarkdownImageEmbeds(cleanedText);
  return rewriteSseFrame(parsed, {
    ...parsed.payload,
    data: {
      ...data,
      text: textOut,
      displayName: display.displayName,
      avatarSrc: display.avatarSrc,
      avatarColor: display.avatarColor,
    },
  });
}

type ToolAgentForwardState = {
  reasoningStarted: boolean;
  lastEmittedReasoning: string;
  reasoningEnded: boolean;
};

/**
 * Sub-agents stream thinking inside `data-tool-agent` as `<thinking>...</thinking>` in `data.text`
 * (not as `reasoning-delta`). Emit AI-SDK-style reasoning events so the UI matches the orchestrator,
 * and forward a cleaned `data.text` without thinking tags.
 */
function buildToolAgentForwardEvents(
  obj: Record<string, unknown>,
  stateByStreamId: Map<string, ToolAgentForwardState>,
): { events: Record<string, unknown>[]; payload: Record<string, unknown> } {
  const events: Record<string, unknown>[] = [];
  const streamId = String(obj.id ?? "");
  const data = obj.data as Record<string, unknown> | undefined;
  if (!data || typeof data.text !== "string") {
    return { events, payload: obj };
  }
  const rawText = data.text;
  const { cleanedText, reasoningText } = extractThinkingFromText(rawText);
  const reasoningId = `sub-${streamId}`;

  let st = stateByStreamId.get(streamId);
  if (!st) {
    st = { reasoningStarted: false, lastEmittedReasoning: "", reasoningEnded: false };
    stateByStreamId.set(streamId, st);
  }

  if (!st.reasoningEnded && reasoningText.length > st.lastEmittedReasoning.length) {
    const delta = reasoningText.slice(st.lastEmittedReasoning.length);
    if (delta) {
      if (!st.reasoningStarted) {
        events.push({ type: "reasoning-start", id: reasoningId });
        st.reasoningStarted = true;
      }
      events.push({ type: "reasoning-delta", id: reasoningId, delta });
      st.lastEmittedReasoning = reasoningText;
    }
  }

  const closedThinking = rawText.includes("</thinking>");
  const visibleOnly =
    cleanedText.trim().length > 0 && !rawText.includes("<thinking>");
  if (st.reasoningStarted && !st.reasoningEnded && (closedThinking || visibleOnly)) {
    events.push({ type: "reasoning-end", id: reasoningId });
    st.reasoningEnded = true;
  }

  if (cleanedText === rawText) {
    return { events, payload: obj };
  }
  return { events, payload: { ...obj, data: { ...data, text: cleanedText } } };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Events that are ONLY streamed to the client but never written to content[].
 * tool-output-available is handled separately (→ tool-invocation + toolCalls).
 */
const SKIP_FOR_CONTENT = new Set([
  "start",
  "finish-step",
  "tool-input-start",
  "tool-input-delta",
  "tool-input-available",
  "tool-output-available",
  "tool-call",
  "tool-result",
]);

/**
 * Custom-emitted event types that should be persisted to content[].
 * These are the user-visible parts rendered by the frontend.
 */
const PERSIST_EVENT_TYPES = new Set([
  "agent-utility",
  "agent-task",
  "agent-task-progress-indicator",
  "progress-indicator",
  "user-action",
  "action",
  "suggestions",
  "greeting",
  "markdown-doc",
  "html",
  "error",
  "batch-media",
  "refine-request",
  "refine-processing",
  "batch-processing",
  "interrupt",
  "artifact",
  "markdown",
  "image",
  "video",
  "final_video_output",
  "link-attachments",
  "tool-call-approval",
  // Removed: "agent-start", "agent-start-indicator", "task-progress", "loop" (confirmed dead — zero emission)
  // Removed: agent-activation persisted via dedicated inline code (now deleted — handled natively by AI SDK)
]);


async function persistContentPart(
  responseMessageId: string,
  chatId: string,
  part: Record<string, unknown>,
) {
  await createOrUpdateMessage(responseMessageId, {
    chatId,
    role: "ai",
    agent: "none",
    content: [part as any],
  } as any);
}

async function persistToolCallsColumn(
  responseMessageId: string,
  chatId: string,
  toolInvocation: Record<string, unknown>,
) {
  await createOrUpdateMessage(responseMessageId, {
    chatId,
    role: "ai",
    agent: "none",
    toolCalls: [toolInvocation],
  } as any);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Wraps the raw Mastra SSE stream with event parsing, attachment extraction,
 * and message persistence. Returns a ReadableStream for the HTTP response.
 *
 * Most events are forwarded unchanged.
 * DB writes are selective:
 * - Custom events from writer.custom() → content[]
 * - Tool completions → tool-invocation in content[] + toolCalls column
 * - Reasoning (merged) → content[]
 * - Deltas, lifecycle markers, tool-input chunks → skipped
 *
 * See docs/stream-storage-architecture.md for full details.
 */
export function wrapStreamWithPersistence(
  stream: ReadableStream<any>,
  responseMessageId: string,
  chatId: string,
  onAbort: () => void,
  onBeforeClose?: (enqueue: (event: Record<string, unknown>) => void) => Promise<void>,
  streamState?: StreamState,
  workspaceId?: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const startFrame = `data: ${JSON.stringify({
    type: "data-start",
    data: { backendMessageId: responseMessageId, chatId },
  })}\n\n`;

  let streamController: ReadableStreamDefaultController | null = null;
  return new ReadableStream({
    async start(controller) {
      // --- Shared state ---
      let seq = streamState?.seq ?? 0;
      const syncSeq = () => { if (streamState) streamState.seq = seq; };

      streamController = controller;
      registerStream(controller);
      let sseBuffer = "";
      let forwardBuffer = "";
      const textDecoder = new TextDecoder();

      // Reasoning accumulation
      const reasoningById = new Map<string, string>();

      // Text part accumulation — persists each text block at text-end
      // so intermediate text between tool calls survives page reload.
      const textById = new Map<string, string>();

      // Deferred approval chunks — injected AFTER forward loop to ensure
      // the ToolUIPart exists before the approval-request references it.
      const deferredApprovalChunks: Array<Record<string, unknown>> = [];
      /** Queued in processSseBuffer when a delegation completes; flushed after forwarding `tool-output-*`. */
      const delegationEndSseQueue: Record<string, unknown>[] = [];

      // Artifact tracking (tool call tracking removed — AI SDK handles lifecycle natively)
      const artifactLinks = new Map<string, string>(); // toolCallId → artifactId

      // Tool name tracking — tool-input-start carries toolName, tool-output-available doesn't
      const toolNameByCallId = new Map<string, string>();
      /** Wall-clock start for generic tool duration (B13). */
      const toolStartTimeByCallId = new Map<string, number>();
      /** Sub-agent delegation: reserve seq at input-available, persist startSeq on completion (B8/B9). */
      const delegationMetaByCallId = new Map<string, DelegationMeta>();
      /** Open delegations for tagging agent-utility parts with agent_id (B7). */
      const delegationFrameStack: DelegationFrame[] = [];
      /**
       * Emit once per assistant message so the FE can show orchestrator (Aria) as active
       * before the first specialist `agent-*` delegation (handoff line is still orchestrator text).
       */
      let orchestratorScopeMetaEmitted = false;

      // Attachment deduplication
      const persistedAttachmentsByUrl = new Map<string, Record<string, unknown>>();
      const contentImageIdByUrl = new Map<string, string>();

      const toolAgentReasoningByStreamId = new Map<string, ToolAgentForwardState>();

      // Tool-agent dedup: Mastra re-emits the FULL agent state on every tick.
      // Track last persisted/forwarded text per agentId to avoid redundant writes.
      const toolAgentLastPersistedText = new Map<string, string>();
      /** Latest cleaned text per delegation scope (toolCallId when in agent delegation, else agent id). */
      const toolAgentAccumulatedText = new Map<
        string,
        { text: string; agentId: string }
      >();
      /** First persisted seq for a sub-agent reply — reused on finish so intro sorts before images. */
      const toolAgentPinnedSeq = new Map<string, number>();
      /** Whether we already wrote an early tool-agent preview (before finishReason). */
      const toolAgentPreviewSaved = new Map<string, boolean>();

      // Per-stream cache keyed by raw agentId. Stores the in-flight
      // Promise (not the resolved value) so concurrent misses share a
      // single lookup — prevents the race where two `tool-agent` events
      // for the same agent issue duplicate Redis calls before either
      // writes back.
      const agentDisplayCache = new Map<string, Promise<AgentDisplayInfo>>();
      const resolveAgentDisplay = (
        rawAgentId: unknown,
      ): Promise<AgentDisplayInfo> => {
        if (typeof rawAgentId !== "string" || !rawAgentId)
          return Promise.resolve(EMPTY_AGENT_DISPLAY);
        if (!workspaceId) return Promise.resolve(EMPTY_AGENT_DISPLAY);
        const cached = agentDisplayCache.get(rawAgentId);
        if (cached) return cached;

        const pending = (async (): Promise<AgentDisplayInfo> => {
          try {
            const key = normalizeAgentId(rawAgentId);
            if (!key) return EMPTY_AGENT_DISPLAY;
            if (key === AGENTS_JOB_MANAGER_CONFIG_KEY) {
              return AGENTS_JOB_MANAGER_DISPLAY;
            }
            const config = await getAgentConfigByKey(workspaceId, key);
            if (!config) return EMPTY_AGENT_DISPLAY;
            return {
              displayName: config.name ?? null,
              avatarSrc: config.avatarSrc ?? null,
              avatarColor: config.avatarColor ?? null,
            };
          } catch (err) {
            // NotFound is expected for non-configurable agents
            // (brand-analyzer, finisher, etc.). Other
            // errors (Redis/DB down) must not break the stream —
            // frontend has a client-side fallback resolver.
            if (!(err instanceof NotFoundError)) {
              console.error(
                "[stream] Failed to resolve agent config for tool-agent",
                { rawAgentId, err },
              );
            }
            return EMPTY_AGENT_DISPLAY;
          }
        })();
        agentDisplayCache.set(rawAgentId, pending);
        return pending;
      };

      /** First main-thread `reasoning-start` or `text-start` → FE can label orchestrator (Aria) before specialists. */
      const maybeEmitOrchestratorScopeMeta = async (
        evtType: string,
      ): Promise<void> => {
        if (orchestratorScopeMetaEmitted) return;
        if (!workspaceId?.trim()) return;
        if (evtType !== "reasoning-start" && evtType !== "text-start") return;
        orchestratorScopeMetaEmitted = true;
        const display = await resolveAgentDisplay("orchestrator");
        const ev: Record<string, unknown> = {
          type: "data-orchestrator-agent-meta",
          id: `orchestrator-scope-${responseMessageId}`,
          data: {
            phase: "scope_open",
            backendMessageId: responseMessageId,
            agent: {
              configKey: "orchestrator",
              displayName: display.displayName ?? "Aria",
              avatarSrc: display.avatarSrc,
              avatarColor: display.avatarColor,
            },
          },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      const toolCallAgentConfigCache = new Map<
        string,
        Promise<Record<string, unknown> | null>
      >();

      /**
       * Emits `data-tool-call-context` after each tool lifecycle chunk so the FE
       * can bind full `agent_configs` + `toolCallId` without mutating AI SDK parts.
       */
      const enqueueToolCallContextCompanion = async (
        rawPayload: Record<string, unknown>,
      ): Promise<void> => {
        if (!workspaceId?.trim()) return;
        const evt = normalizeEventType(rawPayload?.type);
        if (!TOOL_LIFECYCLE_EVENT_TYPES.has(evt)) return;
        const toolCallId = rawPayload.toolCallId ?? rawPayload.id;
        if (typeof toolCallId !== "string") return;
        const toolName =
          (typeof rawPayload.toolName === "string"
            ? rawPayload.toolName
            : undefined) ?? toolNameByCallId.get(toolCallId);
        const configKey = agentConfigKeyForToolEvent(
          toolName,
          delegationFrameStack,
        );
        const agent = await loadSerializedAgentConfigCached(
          workspaceId.trim(),
          configKey,
          toolCallAgentConfigCache,
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "data-tool-call-context",
              id: `tool-call-context-${toolCallId}`,
              data: {
                toolCallId,
                toolName: toolName ?? null,
                configKey,
                agent,
              },
            })}\n\n`,
          ),
        );
      };

      /**
       * `data-agent-utility` rows are separate from AI SDK tool-* chunks (search/brand
       * pills, skill progress, etc.). Emit full `agent_configs` for the current scope
       * so the FE can join by utility part id without mutating the utility part.
       */
      const enqueueAgentUtilityContextCompanion = async (
        rawPayload: Record<string, unknown>,
      ): Promise<void> => {
        if (!workspaceId?.trim()) return;
        const evt = normalizeEventType(rawPayload?.type);
        if (evt !== "agent-utility") return;
        const data = rawPayload.data;
        if (!data || typeof data !== "object" || data === null) return;
        const d = data as Record<string, unknown>;
        if (isInternalUtilityData(d)) return;
        const partId =
          (typeof rawPayload.id === "string" && rawPayload.id.length > 0
            ? rawPayload.id
            : undefined) ??
          (typeof d.id === "string" && d.id.length > 0 ? d.id : undefined);
        if (typeof partId !== "string") return;
        const configKey = agentConfigKeyForToolEvent(
          undefined,
          delegationFrameStack,
        );
        const agent = await loadSerializedAgentConfigCached(
          workspaceId.trim(),
          configKey,
          toolCallAgentConfigCache,
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "data-agent-utility-context",
              id: `agent-utility-context-${partId}`,
              data: {
                utilityPartId: partId,
                configKey,
                agent,
              },
            })}\n\n`,
          ),
        );
      };

      /**
       * When an agent-utility event fires inside an `agent-*` delegation, attach
       * scope keys plus a stable `agentDisplay` blob (displayName, avatars) for the FE.
       */
      const enrichUtilityDataForDelegation = async (
        baseData: Record<string, unknown>,
        scopeKey: string,
      ): Promise<Record<string, unknown>> => {
        const display = await resolveAgentDisplay(scopeKey);
        return {
          ...baseData,
          agent_id: scopeKey,
          scopeAgentConfigKey: scopeKey,
          agentDisplay: {
            configKey: scopeKey,
            displayName: display.displayName,
            avatarSrc: display.avatarSrc,
            avatarColor: display.avatarColor,
          },
        };
      };

      // -----------------------------------------------------------------
      // Attachment helpers (unchanged from previous implementation)
      // -----------------------------------------------------------------

      const upsertAttachment = (attachment: Record<string, unknown> | null) => {
        if (!attachment) return;
        const url = typeof attachment.url === "string" ? attachment.url : "";
        if (!url) return;
        const canonicalContentId = contentImageIdByUrl.get(url);
        if (canonicalContentId) {
          attachment = { ...attachment, id: canonicalContentId };
        }
        const existing = persistedAttachmentsByUrl.get(url);
        if (!existing) {
          persistedAttachmentsByUrl.set(url, attachment);
          return;
        }
        const stableId =
          (typeof existing.id === "string" && existing.id.length > 0
            ? existing.id
            : undefined) ??
          (typeof attachment.id === "string" && attachment.id.length > 0
            ? attachment.id
            : undefined) ??
          crypto.randomUUID();
        persistedAttachmentsByUrl.set(url, { ...existing, ...attachment, id: stableId });
      };

      const extractAttachmentFromEvent = (
        type: string,
        data: Record<string, unknown>,
        fallbackId?: string,
      ): Record<string, unknown> | null => {
        const urlCandidates = [data.url, data.video_url, data.videoUrl, data.final_video_url];
        const url = urlCandidates.find((v) => typeof v === "string" && v.length > 0);
        if (typeof url !== "string") return null;
        return {
          id:
            (typeof data.id === "string" ? data.id : undefined) ??
            (typeof data.asset_id === "string" ? data.asset_id : undefined) ??
            (typeof fallbackId === "string" && fallbackId.length > 0
              ? fallbackId
              : undefined) ??
            crypto.randomUUID(),
          type: type === "image" ? "image" : "video",
          url,
          tag:
            (typeof data.tag === "string" ? data.tag : undefined) ??
            (type === "image" ? "generated" : "generated-video"),
          metadata:
            typeof data.metadata === "object" && data.metadata !== null
              ? data.metadata
              : undefined,
        };
      };

      // Tool IDs are now canonical camelCase — no normalization needed.

      // Track tools that need early loading skeletons.
      // Maps tool name → artifact kind + default title for the loading state.
      const SKELETON_TOOLS: Record<string, { kind: string; title: string }> = {
        "createInteractiveView": { kind: "html", title: "Building visualization..." },
        "deliverContent": { kind: "markdown", title: "Preparing content..." },
        "generatePresentation": { kind: "presentation", title: "Building presentation..." },
        "generatePdf": { kind: "pdf", title: "Generating PDF..." },
      };
      const emittedSkeletons = new Map<string, string>(); // toolCallId → toolName

      // ── Artifact content streaming ──────────────────────────────────
      // Tools whose content field should be streamed token-by-token to the frontend.
      // Maps tool name → the JSON key that holds the streamable content.
      const STREAMABLE_CONTENT_FIELDS: Record<string, string> = {
        "createInteractiveView": "widget_code",
        "deliverContent": "content",
      };

      const artifactStreams = new Map<string, ArtifactStreamState>();

      const injectLoadingSkeleton = (
        toolCallId: string,
        toolName: string,
        ctrl: ReadableStreamDefaultController<Uint8Array>,
      ) => {
        if (emittedSkeletons.has(toolCallId)) return;
        const config = SKELETON_TOOLS[toolName];
        if (!config) return;
        emittedSkeletons.set(toolCallId, toolName);
        const artifactId = `artifact_${toolCallId}`;
        const skeletonEvent = {
          type: "data-artifact",
          id: artifactId,
          data: {
            id: artifactId,
            kind: config.kind,
            status: "loading",
            title: config.title,
            description: `Generating ${config.kind} artifact — this may take a moment`,
          },
        };
        // Standard SSE format — AI SDK routes data-* typed chunks to message.parts[]
        // as DataUIPart. AI SDK deduplicates by {type, id}, so the tool's
        // writer.custom() loading emission will update this part in-place.
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(skeletonEvent)}\n\n`));
      };

      // -----------------------------------------------------------------
      // SSE event processing
      // -----------------------------------------------------------------

      const processSseBuffer = async () => {
        let boundary = sseBuffer.indexOf("\n\n");
        while (boundary !== -1) {
          const rawEvent = sseBuffer.slice(0, boundary);
          sseBuffer = sseBuffer.slice(boundary + 2);

          // handleChatStream returns JS objects (not serialized SSE text), so
          // tool lifecycle events arrive as data: lines processed below (section 2).
          const lines = rawEvent.split("\n");

          const dataLines = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length === 0) {
            boundary = sseBuffer.indexOf("\n\n");
            continue;
          }

          const payloadText = dataLines.join("\n");
          if (payloadText === "[DONE]") {
            boundary = sseBuffer.indexOf("\n\n");
            continue;
          }

          let payload: any;
          try {
            payload = JSON.parse(payloadText);
          } catch {
            boundary = sseBuffer.indexOf("\n\n");
            continue;
          }

          // NOTE: Skeleton injection and artifact streaming are now handled above
          // in the AI SDK protocol line parser (b:/c:/9:/e: prefixes).
          // The data: line processing below handles Mastra's custom events
          // (data-artifact, data-agent-utility, etc.) which use the data: format.

          // Clean up artifact stream state when any tool completes (via data: events)
          const eventType = normalizeEventType(payload?.type);
          const eventId = payload?.id ?? crypto.randomUUID();
          const eventData = payload?.data ?? payload;

          // =============================================================
          // 1. Skeleton injection for createInteractiveView (stream-only, not persisted)
          // =============================================================
          if (
            (payload?.type === "tool-output-available" || payload?.type === "tool-output-error") &&
            typeof payload?.toolCallId === "string"
          ) {
            artifactStreams.delete(payload.toolCallId);

            // Clean up orphaned skeleton — emit failed if tool errored
            if (emittedSkeletons.has(payload.toolCallId)) {
              const output = payload?.output ?? payload?.error;
              const isError = payload?.type === "tool-output-error" ||
                (output && typeof output === "object" && output.ok === false);
              if (isError) {
                const failedId = `artifact_${payload.toolCallId}`;
                const skeletonToolName = emittedSkeletons.get(payload.toolCallId);
                const skeletonKind = skeletonToolName ? (SKELETON_TOOLS[skeletonToolName]?.kind ?? "html") : "html";
                const rawErrorMsg = typeof output === "object"
                  ? (output?.error ?? output?.message)
                  : undefined;
                const failEvent = {
                  type: "data-artifact",
                  id: failedId,
                  data: {
                    id: failedId,
                    kind: skeletonKind,
                    status: "failed",
                    title: "Generation failed",
                    description: sanitizeErrorText(rawErrorMsg),
                  },
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(failEvent)}\n\n`));
              }
              emittedSkeletons.delete(payload.toolCallId);
            }
          }

          // =============================================================
          // 2. Tool lifecycle — skeleton injection + artifact content streaming
          // handleChatStream returns JS objects (not serialized b:/c:/9: text),
          // so tool events arrive here as data: lines with type field.
          // The b:/c:/9: handlers above are kept as legacy fallback only.
          // =============================================================
          if (eventType === "tool-input-start") {
            const tId = payload?.toolCallId ?? payload?.id;
            const tName = payload?.toolName;
            if (typeof tId === "string") {
              toolStartTimeByCallId.set(tId, Date.now());
            }
            if (typeof tId === "string" && typeof tName === "string") {
              toolNameByCallId.set(tId, tName);
              if (tName in SKELETON_TOOLS) {
                injectLoadingSkeleton(tId, tName, controller);
              }
              if (tName in STREAMABLE_CONTENT_FIELDS) {
                const artifactId = `artifact_${tId}`;
                artifactStreams.set(tId, {
                  toolCallId: tId,
                  toolName: tName,
                  artifactId,
                  targetField: STREAMABLE_CONTENT_FIELDS[tName],
                  accumulated: "",
                  fieldStartIndex: -1,
                  scannedRawOffset: 0,
                  inString: false,
                  escaped: false,
                });
              }
            }
          }
          if (eventType === "tool-input-delta") {
            const tId = payload?.toolCallId ?? payload?.id;
            const tDelta = payload?.inputTextDelta ?? payload?.delta ?? payload?.argsTextDelta;
            if (
              typeof tId === "string" &&
              typeof tDelta === "string" &&
              artifactStreams.has(tId)
            ) {
              const state = artifactStreams.get(tId)!;
              const contentDelta = processArtifactDelta(state, tDelta);
              if (contentDelta !== null) {
                const deltaEvent = {
                  type: "data-artifact-delta",
                  id: state.artifactId,
                  // transient: only triggers onData for ref-based buffering,
                  // does NOT go into message.parts[] (avoids re-render churn)
                  transient: true,
                  data: {
                    id: state.artifactId,
                    delta: contentDelta,
                  },
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(deltaEvent)}\n\n`));
              }
            }
          }
          if (eventType === "tool-input-available") {
            const tId = payload?.toolCallId ?? payload?.id;
            const tName =
              (payload?.toolName as string | undefined) ??
              (typeof tId === "string" ? toolNameByCallId.get(tId) : undefined);
            if (typeof tId === "string") {
              artifactStreams.delete(tId);
              if (!toolStartTimeByCallId.has(tId)) {
                toolStartTimeByCallId.set(tId, Date.now());
              }
            }
            if (
              typeof tId === "string" &&
              isAgentDelegationToolName(tName) &&
              workspaceId
            ) {
              const configKey = normalizeAgentId(tName!);
              delegationFrameStack.push({ toolCallId: tId, configKey });
              const startSeq = seq++;
              syncSeq();
              delegationMetaByCallId.set(tId, {
                startSeq,
                startTime: Date.now(),
                toolName: tName!,
              });
              const rawIdForDisplay = tName!.startsWith("agent-")
                ? tName!.slice("agent-".length)
                : tName!;
              try {
                const displayStart = await resolveAgentDisplay(rawIdForDisplay);
                await persistContentPart(responseMessageId, chatId, {
                  type: "agent-delegation-start",
                  id: `delegation-start-${tId}`,
                  seq: startSeq,
                  data: {
                    toolCallId: tId,
                    toolName: tName,
                    phase: "start",
                    agent: {
                      configKey,
                      displayName: displayStart.displayName,
                      avatarSrc: displayStart.avatarSrc,
                      avatarColor: displayStart.avatarColor,
                    },
                  },
                });
              } catch (err) {
                console.error(
                  `[stream] Failed to persist agent-delegation-start (${tId}):`,
                  err,
                );
              }
            }
          }

          // ── Text part persistence (preserves intermediate text) ────────
          // During streaming, the AI produces multiple text blocks separated
          // by tool calls. Accumulate deltas and persist each block at
          // text-end so the conversational flow survives page reload.
          if (eventType === "text-start") {
            const textId = payload?.id ?? eventId;
            textById.set(textId, "");
          }
          if (eventType === "text-delta") {
            const textId = payload?.id ?? eventId;
            const delta = payload?.delta ?? payload?.text ?? "";
            if (typeof delta === "string") {
              // Defensive: initialize if text-start was missed (protocol edge case)
              if (!textById.has(textId)) textById.set(textId, "");
              textById.set(textId, (textById.get(textId) ?? "") + delta);
            }
          }
          if (eventType === "text-end") {
            const textId = payload?.id ?? eventId;
            const fullText = textById.get(textId) ?? "";
            if (fullText?.trim()) {
              await persistContentPart(responseMessageId, chatId, {
                type: "text",
                id: textId,
                seq: seq++,
                text: fullText,
              });
              syncSeq();
              if (streamState) streamState.hasStreamedText = true;
            }
            textById.delete(textId);
          }

          // ── Tool approval: Mastra DataUIPart → native protocol chunk ──
          // Mastra emits data-tool-call-approval (DataUIPart), but AI SDK
          // needs tool-approval-request (protocol chunk) to transition the
          // ToolUIPart to approval-requested state. Persist + defer injection.
          if (eventType === "tool-call-approval") {
            const toolCallId = (eventData as Record<string, unknown>)?.toolCallId ?? payload?.id;
            const approvalId = `approval_${toolCallId}`;
            if (typeof toolCallId === "string") {
              await persistContentPart(responseMessageId, chatId, {
                type: "tool-call-approval",
                id: approvalId,
                seq: seq++,
                data: eventData,
              });
              syncSeq();
              // Defer: must arrive AFTER forwarded event so ToolUIPart exists
              deferredApprovalChunks.push({
                type: "tool-approval-request",
                toolCallId,
                approvalId,
              });
            }
          }

          // =============================================================
          // 3. Agent delegation detection
          // Agent activation is also represented natively via AI SDK tool-invocation parts.
          // We persist explicit agent-delegation-start / agent-delegation-end content parts
          // (same seq timeline as toolCalls) so reload can bracket sub-agent output.
          // =============================================================

          // Handle tool-agent events (sub-agent progressive text).
          // Mastra re-emits the FULL agent state on every streaming tick — same
          // text repeated 40+ times. We persist once early (preview) so reload
          // order matches "intro before images", then merge the final text on
          // finishReason using the same part id + pinned seq.
          if (eventType === "tool-agent") {
            const agentData = eventData as any;
            const agentId = agentData?.id;
            const text = agentData?.text;
            const finishReason = agentData?.finishReason;
            const { cleanedText } = extractThinkingFromText(
              typeof text === "string" ? text : "",
            );
            const displayText = stripMarkdownImageEmbeds(cleanedText);

            // Scope tool-agent persistence by delegation toolCallId so multiple
            // invocations of the same sub-agent in one assistant message get
            // distinct content part ids (mergeContentById replaces by id in place).
            const delegTop =
              delegationFrameStack.length > 0
                ? delegationFrameStack[delegationFrameStack.length - 1]
                : undefined;
            const delegToolCallId =
              delegTop && typeof delegTop.toolCallId === "string"
                ? delegTop.toolCallId
                : undefined;
            const toolAgentScopeKey =
              delegToolCallId ??
              (typeof agentId === "string" && agentId.length > 0 ? agentId : "");
            const toolAgentContentPartId = `tool-agent-${toolAgentScopeKey}`;

            // Do not persist sub-agent <thinking> as main-thread reasoning parts — reload
            // would attribute it to the parent (see chat attribution brief B11).

            // Track accumulated text for fallback persistence on stream death.
            if (toolAgentScopeKey && cleanedText && typeof agentId === "string") {
              toolAgentAccumulatedText.set(toolAgentScopeKey, {
                text: cleanedText,
                agentId,
              });
            }

            const hasFinishReason = !!finishReason;

            // One early persist (first non-empty visible text, no finish yet) pins seq
            // so merged content sorts before later image / utility parts.
            if (
              toolAgentScopeKey &&
              agentId &&
              displayText &&
              !hasFinishReason &&
              !toolAgentPreviewSaved.get(toolAgentScopeKey)
            ) {
              toolAgentPreviewSaved.set(toolAgentScopeKey, true);
              const pinSeq = seq++;
              syncSeq();
              toolAgentPinnedSeq.set(toolAgentScopeKey, pinSeq);
              const display = await resolveAgentDisplay(agentId);
              try {
                await persistContentPart(responseMessageId, chatId, {
                  type: "tool-agent",
                  id: toolAgentContentPartId,
                  seq: pinSeq,
                  data: {
                    id: agentId,
                    displayName: display.displayName,
                    avatarSrc: display.avatarSrc,
                    avatarColor: display.avatarColor,
                    text: displayText,
                  },
                });
                syncSeq();
              } catch (err) {
                console.error(`[stream] Failed to persist tool-agent preview:`, err);
              }
            }

            if (toolAgentScopeKey && agentId && displayText && hasFinishReason) {
              const display = await resolveAgentDisplay(agentId);
              const pinned = toolAgentPinnedSeq.get(toolAgentScopeKey);
              let partSeq: number;
              if (pinned !== undefined) {
                partSeq = pinned;
              } else {
                partSeq = seq++;
                syncSeq();
              }
              try {
                await persistContentPart(responseMessageId, chatId, {
                  type: "tool-agent",
                  id: toolAgentContentPartId,
                  seq: partSeq,
                  data: {
                    id: agentId,
                    displayName: display.displayName,
                    avatarSrc: display.avatarSrc,
                    avatarColor: display.avatarColor,
                    text: displayText,
                    finishReason,
                  },
                });
                toolAgentLastPersistedText.set(toolAgentScopeKey, displayText);
                toolAgentAccumulatedText.delete(toolAgentScopeKey);
                toolAgentPinnedSeq.delete(toolAgentScopeKey);
                toolAgentPreviewSaved.delete(toolAgentScopeKey);
              } catch (err) {
                console.error(`[stream] Failed to persist tool-agent:`, err);
              }
              syncSeq();
            }
          }

          // =============================================================
          // 3. Reasoning accumulation (unchanged logic, with seq)
          // =============================================================
          if (eventType === "reasoning-start") {
            reasoningById.set(eventId, "");
          } else if (eventType === "reasoning-delta") {
            reasoningById.set(
              eventId,
              `${reasoningById.get(eventId) ?? ""}${payload?.delta ?? ""}`,
            );
          } else if (eventType === "reasoning-end") {
            const fullReasoning = reasoningById.get(eventId) ?? "";
            if (fullReasoning.trim()) {
              await persistContentPart(responseMessageId, chatId, {
                type: "reasoning",
                id: eventId,
                seq: seq++,
                text: fullReasoning,
              });
              syncSeq();
            }

          // =============================================================
          // 4. Step tracking — persist step-start for multi-step agents
          // =============================================================
          } else if (eventType === "start-step") {
            // Step markers are not rendered by the frontend (SKIP_TYPES in
            // history-hydrator, returns null in part-renderer). Skip persistence
            // to avoid wasted DB writes — seq is still incremented to preserve
            // correct ordering of surrounding content.
            seq++;
            syncSeq();

          // =============================================================
          // 5. Tool call lifecycle — minimal persistence only
          // AI SDK handles tool state natively (input-streaming → output-available).
          // We only persist completed tool calls to the toolCalls DB column.
          // tool-output-error shares delegation cleanup + persistence with available.
          // =============================================================
          } else if (
            eventType === "tool-output-available" ||
            eventType === "tool-output-error"
          ) {
            const isToolError = eventType === "tool-output-error";
            const toolCallId = payload?.toolCallId ?? eventData?.toolCallId;
            const toolName = payload?.toolName ?? eventData?.toolName
              ?? (toolCallId ? toolNameByCallId.get(toolCallId) : undefined);
            if (toolCallId && typeof toolCallId === "string") {
              const tStart = toolStartTimeByCallId.get(toolCallId);
              const durationMs =
                typeof tStart === "number"
                  ? Math.max(0, Date.now() - tStart)
                  : undefined;
              toolStartTimeByCallId.delete(toolCallId);

              if (toolName === "updateWorkingMemory") {
                toolNameByCallId.delete(toolCallId);
                boundary = sseBuffer.indexOf("\n\n");
                continue;
              }

              const meta = delegationMetaByCallId.get(toolCallId);
              const endSeq = seq++;
              syncSeq();

              if (meta) {
                delegationMetaByCallId.delete(toolCallId);
                if (delegationFrameStack.length) {
                  const top = delegationFrameStack[delegationFrameStack.length - 1];
                  if (top.toolCallId === toolCallId) {
                    delegationFrameStack.pop();
                  } else {
                    const ix = delegationFrameStack.findIndex(
                      (f) => f.toolCallId === toolCallId,
                    );
                    if (ix >= 0) delegationFrameStack.splice(ix, 1);
                  }
                }
              }

              const sortSeq = meta?.startSeq ?? endSeq;
              const resolvedToolName = toolName ?? meta?.toolName;
              const isDelegationCompletion = !!meta;
              const displayForTool = isDelegationCompletion
                ? await resolveAgentDisplay(
                    typeof resolvedToolName === "string" &&
                      resolvedToolName.startsWith("agent-")
                      ? resolvedToolName.slice("agent-".length)
                      : resolvedToolName,
                  )
                : EMPTY_AGENT_DISPLAY;
              const configKey =
                typeof resolvedToolName === "string" && isDelegationCompletion
                  ? normalizeAgentId(resolvedToolName)
                  : "";

              const configKeyForTool = agentConfigKeyForToolEvent(
                typeof resolvedToolName === "string"
                  ? resolvedToolName
                  : undefined,
                delegationFrameStack,
              );
              const agentSnapshot = workspaceId
                ? await loadSerializedAgentConfigCached(
                    workspaceId,
                    configKeyForTool,
                    toolCallAgentConfigCache,
                  )
                : null;

              const toolInvocation: Record<string, unknown> = {
                state: (isToolError ? "error" : "result") as "error" | "result",
                toolCallId,
                toolName: toolName ?? "unknown",
                configKey: configKeyForTool,
                agent: agentSnapshot,
                args: payload?.input ?? eventData?.input,
                result: isToolError
                  ? (payload?.error ?? eventData?.error)
                  : (payload?.output ?? eventData?.output),
                seq: sortSeq,
                endSeq,
                ...(meta
                  ? {
                      startSeq: meta.startSeq,
                      startedAtMs: meta.startTime,
                    }
                  : {}),
                ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
                ...(isDelegationCompletion && configKey
                  ? {
                      agent_id: configKey,
                      /** Avatar/display when full `agent` row is unavailable; prefer `agent` when set. */
                      agentDisplay: {
                        configKey,
                        displayName: displayForTool.displayName,
                        avatarSrc: displayForTool.avatarSrc,
                        avatarColor: displayForTool.avatarColor,
                      },
                    }
                  : {}),
              };
              if (isDelegationCompletion && meta) {
                const errRaw = isToolError
                  ? (payload?.error ?? eventData?.error)
                  : undefined;
                const errorMessage =
                  isToolError && errRaw !== undefined
                    ? sanitizeErrorText(
                        typeof errRaw === "string"
                          ? errRaw
                          : errRaw &&
                              typeof errRaw === "object" &&
                              "message" in errRaw &&
                              typeof (errRaw as { message?: unknown }).message ===
                                "string"
                            ? (errRaw as { message: string }).message
                            : undefined,
                      )
                    : undefined;
                try {
                  await persistContentPart(responseMessageId, chatId, {
                    type: "agent-delegation-end",
                    id: `delegation-end-${toolCallId}`,
                    seq: endSeq,
                    data: {
                      toolCallId,
                      toolName: resolvedToolName,
                      phase: "finish",
                      ok: !isToolError,
                      ...(errorMessage ? { error: errorMessage } : {}),
                      ...(configKey
                        ? {
                            agent: {
                              configKey,
                              displayName: displayForTool.displayName,
                              avatarSrc: displayForTool.avatarSrc,
                              avatarColor: displayForTool.avatarColor,
                            },
                          }
                        : {}),
                      startSeq: meta.startSeq,
                      ...(durationMs !== undefined
                        ? { duration_ms: durationMs }
                        : {}),
                    },
                  });
                } catch (err) {
                  console.error(
                    `[stream] Failed to persist agent-delegation-end (${toolCallId}):`,
                    err,
                  );
                }
                if (workspaceId) {
                  delegationEndSseQueue.push(
                    buildDelegationAgentEndSsePayload({
                      toolCallId,
                      toolName: resolvedToolName,
                      displayForTool,
                      configKey,
                      ok: !isToolError,
                      errorMessage,
                      durationMs,
                      startSeq: meta.startSeq,
                    }),
                  );
                }
              }
              persistToolCallsColumn(responseMessageId, chatId, toolInvocation)
                .catch((err) =>
                  console.error(`[stream] Failed to persist toolCalls:`, err),
                );
              toolNameByCallId.delete(toolCallId);
            }
            // tool-input-start and tool-input-available no longer tracked

          // =============================================================
          // 6. Skip events that are streaming-only
          // =============================================================
          } else if (SKIP_FOR_CONTENT.has(eventType)) {
            // Already handled above or intentionally skipped

          // =============================================================
          // 7. Media events (image/video) — persist + update attachments
          // =============================================================
          } else if (
            eventType === "image" ||
            eventType === "video" ||
            eventType === "final_video_output"
          ) {
            const mediaAttachment = extractAttachmentFromEvent(
              eventType,
              eventData as Record<string, unknown>,
              eventId,
            );
            if (eventType === "image") {
              const imageUrl =
                typeof (eventData as Record<string, unknown>).url === "string"
                  ? ((eventData as Record<string, unknown>).url as string)
                  : "";
              if (imageUrl) {
                contentImageIdByUrl.set(imageUrl, eventId);
              }
            }
            upsertAttachment(mediaAttachment);
            await createOrUpdateMessage(responseMessageId, {
              chatId,
              role: "ai",
              agent: "none",
              attachments: Array.from(persistedAttachmentsByUrl.values()) as any,
              content: [{ type: eventType, id: eventId, seq: seq++, data: eventData }],
            } as any);
            syncSeq();

          // =============================================================
          // 8. Link-attachments event
          // =============================================================
          } else if (eventType === "link-attachments") {
            const nextAttachments = Array.isArray(eventData) ? eventData : [];
            for (const attachment of nextAttachments) {
              if (attachment && typeof attachment === "object") {
                upsertAttachment(attachment as Record<string, unknown>);
              }
            }
            await createOrUpdateMessage(responseMessageId, {
              chatId,
              role: "ai",
              agent: "none",
              attachments: Array.from(persistedAttachmentsByUrl.values()) as any,
              content: [
                { type: "link-attachments", id: eventId, seq: seq++, data: nextAttachments },
              ],
            } as any);
            syncSeq();

          // =============================================================
          // 9. Artifact events — only persist completed, not loading
          // =============================================================
          } else if (eventType === "artifact") {
            const artifactId = eventData?.id ?? eventId;
            const artifactStatus = eventData?.status ?? eventData?.data?.status;

            // Link artifact to its tool call
            if (typeof artifactId === "string" && artifactId.startsWith("artifact_")) {
              const linkedToolCallId = artifactId.replace("artifact_", "");
              artifactLinks.set(linkedToolCallId, artifactId);
            }

            // Only persist completed artifacts (not loading skeletons)
            if (artifactStatus === "completed") {
              await persistContentPart(responseMessageId, chatId, {
                type: "artifact",
                id: artifactId,
                seq: seq++,
                data: eventData,
              });
              syncSeq();
            }

          // =============================================================
          // 10. All other custom events (agent-utility, suggestions, etc.)
          // =============================================================
          } else if (PERSIST_EVENT_TYPES.has(eventType)) {
            const baseData =
              typeof eventData === "object" && eventData !== null
                ? (eventData as Record<string, unknown>)
                : {};
            if (
              eventType === "agent-utility" &&
              isInternalUtilityData(baseData)
            ) {
              boundary = sseBuffer.indexOf("\n\n");
              continue;
            }
            let mergedData: Record<string, unknown> = { ...baseData };
            if (eventType === "agent-utility" && delegationFrameStack.length > 0) {
              const scopeKey =
                delegationFrameStack[delegationFrameStack.length - 1].configKey;
              mergedData = await enrichUtilityDataForDelegation(
                mergedData,
                scopeKey,
              );
            }
            if (eventType === "agent-utility" && workspaceId?.trim()) {
              const uk = agentConfigKeyForToolEvent(
                undefined,
                delegationFrameStack,
              );
              mergedData = {
                ...mergedData,
                configKey: uk,
                agent: await loadSerializedAgentConfigCached(
                  workspaceId.trim(),
                  uk,
                  toolCallAgentConfigCache,
                ),
              };
            }
            const stableUtilityPartId =
              eventType === "agent-utility" &&
              typeof mergedData.id === "string" &&
              mergedData.id.length > 0
                ? mergedData.id
                : eventId;
            await persistContentPart(responseMessageId, chatId, {
              type: eventType,
              id: stableUtilityPartId,
              seq: seq++,
              data: mergedData,
            });
            syncSeq();
            if (eventType === "suggestions" && streamState) {
              streamState.hasSuggestions = true;
            }
          }

          boundary = sseBuffer.indexOf("\n\n");
        }
      };

      // -----------------------------------------------------------------
      // Stream reader loop
      // -----------------------------------------------------------------

      const captureStreamEvent = async (value: unknown) => {
        const text =
          typeof value === "string"
            ? value
            : value instanceof Uint8Array
              ? new TextDecoder().decode(value)
              : `data: ${JSON.stringify(value)}\n\n`;
        sseBuffer += text;
        await processSseBuffer();
      };

      controller.enqueue(encoder.encode(startFrame));
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await captureStreamEvent(value);
          // Forward to client with `<thinking>` stripped from data-tool-agent payloads
          if (typeof value === "string") {
            forwardBuffer += value;
          } else if (value instanceof Uint8Array) {
            forwardBuffer += textDecoder.decode(value);
          } else {
            const obj = value as Record<string, unknown>;
            if (normalizeEventType(obj?.type) === "tool-agent") {
              const { events: reasoningEvents, payload } = buildToolAgentForwardEvents(
                obj,
                toolAgentReasoningByStreamId,
              );
              // Only forward reasoning events (deltas) — these are already deduped
              for (const ev of reasoningEvents) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(ev)}\n\n`),
                );
              }
              // Only forward the data-tool-agent payload on finishReason (sub-agent
              // completion). During execution, reasoning events are forwarded above
              // so the user sees thinking bubbles + utility pills. Deferring the
              // text payload prevents the AI SDK from creating the data-tool-agent
              // part early in message.parts[] — which would put summary text BEFORE
              // utility pills in the render order.
              const agentData = (obj.data as Record<string, unknown> | undefined);
              const hasFinish = !!agentData?.finishReason;
              if (hasFinish) {
                const rawAgentId = agentData?.id;
                const display = await resolveAgentDisplay(rawAgentId);
                const baseData = payload.data as Record<string, unknown> | undefined;
                const rawT = typeof baseData?.text === "string" ? baseData.text : "";
                const textForClient = stripMarkdownImageEmbeds(
                  extractThinkingFromText(rawT).cleanedText,
                );
                const enrichedPayload = {
                  ...payload,
                  data: {
                    ...(payload.data as Record<string, unknown> | undefined),
                    displayName: display.displayName,
                    avatarSrc: display.avatarSrc,
                    avatarColor: display.avatarColor,
                    text: textForClient,
                  },
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(enrichedPayload)}\n\n`),
                );
              }
            } else {
              const evtType = normalizeEventType(obj?.type);

              if (evtType === "agent-utility") {
                const rawD = obj.data as Record<string, unknown> | undefined;
                if (isInternalUtilityData(rawD)) {
                  continue;
                }
              }

              await maybeEmitOrchestratorScopeMeta(evtType);

              let forwardObj: Record<string, unknown> = obj;
              if (evtType === "agent-utility") {
                const rawD = obj.data as Record<string, unknown> | undefined;
                if (rawD && delegationFrameStack.length > 0) {
                  const scopeKey =
                    delegationFrameStack[delegationFrameStack.length - 1]
                      .configKey;
                  forwardObj = {
                    ...obj,
                    data: await enrichUtilityDataForDelegation(rawD, scopeKey),
                  };
                }
              }

              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(forwardObj)}\n\n`),
              );
              await enqueueToolCallContextCompanion(forwardObj);
              await enqueueAgentUtilityContextCompanion(forwardObj);
              if (evtType === "tool-input-available" && workspaceId) {
                const meta = await buildDelegationAgentMetaEvent(
                  obj,
                  resolveAgentDisplay,
                  workspaceId,
                );
                if (meta) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(meta)}\n\n`),
                  );
                }
              }
            }
            const forwardValueType = normalizeEventType(
              (value as Record<string, unknown>)?.type,
            );
            if (
              (forwardValueType === "tool-output-available" ||
                forwardValueType === "tool-output-error") &&
              delegationEndSseQueue.length > 0
            ) {
              for (const ev of delegationEndSseQueue) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(ev)}\n\n`),
                );
              }
              delegationEndSseQueue.length = 0;
            }
            // Flush deferred approval chunks after forwarding the original event
            for (const chunk of deferredApprovalChunks) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
            deferredApprovalChunks.length = 0;
            continue;
          }
          let boundary = forwardBuffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = forwardBuffer.slice(0, boundary);
            forwardBuffer = forwardBuffer.slice(boundary + 2);
            // Gate tool-agent frames in the SSE text path — matches the
            // JS object path behavior. Only forward when finishReason is
            // present; suppress progressive text to prevent early part
            // creation in message.parts[].
            if (frame.includes('"tool-agent"') && !frame.includes('"finishReason"')) {
              boundary = forwardBuffer.indexOf("\n\n");
              continue;
            }
            const transformedFrame = stripToolAgentThinkingFromSseFrame(frame);
            // Inject display info for finished tool-agent frames so the live
            // SSE render shows the workspace-custom name/avatar immediately.
            const enrichedFrame = await enrichToolAgentFrameWithDisplay(
              transformedFrame,
              resolveAgentDisplay,
            );
            const parsedForMeta = parseSseFrame(enrichedFrame);
            const frameEvtTypeEarly =
              parsedForMeta &&
              normalizeEventType(parsedForMeta.payload?.type);
            if (frameEvtTypeEarly) {
              await maybeEmitOrchestratorScopeMeta(frameEvtTypeEarly);
            }
            const delegationMeta =
              parsedForMeta &&
              normalizeEventType(parsedForMeta.payload?.type) ===
                "tool-input-available"
                ? await buildDelegationAgentMetaEvent(
                    parsedForMeta.payload,
                    resolveAgentDisplay,
                    workspaceId,
                  )
                : null;
            controller.enqueue(encoder.encode(enrichedFrame + "\n\n"));
            if (parsedForMeta) {
              await enqueueToolCallContextCompanion(parsedForMeta.payload);
              await enqueueAgentUtilityContextCompanion(parsedForMeta.payload);
            }
            if (delegationMeta) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(delegationMeta)}\n\n`,
                ),
              );
            }
            if (
              (frameEvtTypeEarly === "tool-output-available" ||
                frameEvtTypeEarly === "tool-output-error") &&
              delegationEndSseQueue.length > 0
            ) {
              for (const ev of delegationEndSseQueue) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(ev)}\n\n`),
                );
              }
              delegationEndSseQueue.length = 0;
            }
            boundary = forwardBuffer.indexOf("\n\n");
          }
          // Flush deferred approval chunks after forwarding the original frames
          for (const chunk of deferredApprovalChunks) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          deferredApprovalChunks.length = 0;
        }
        if (forwardBuffer.length > 0) {
          controller.enqueue(encoder.encode(forwardBuffer));
        }

        // Tool call flush no longer needed — AI SDK handles tool lifecycle natively.
        // Partial tool calls are represented by output-error state on the frontend.

        if (onBeforeClose) {
          try {
            await onBeforeClose((event) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            });
          } catch {
            // onBeforeClose errors should never break the stream
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      } finally {
        // Fallback: persist any tool-agent text that was accumulated during
        // execution but never persisted (stream died before finishReason).
        // This prevents data loss at the cost of potentially wrong seq order
        // (text before utilities) — acceptable since partial summaries are
        // better than lost summaries.
        for (const [scopeKey, entry] of toolAgentAccumulatedText) {
          const { text, agentId: aid } = entry;
          if (!toolAgentLastPersistedText.has(scopeKey) && text.trim()) {
            // Reuse the in-flight cache if it's already resolved. Await
            // is cheap because the promise has typically settled by now;
            // if not, we're at stream-death and extra latency is fine.
            const pending = agentDisplayCache.get(aid);
            const display = pending ? await pending : EMPTY_AGENT_DISPLAY;
            const displayText = stripMarkdownImageEmbeds(
              extractThinkingFromText(text).cleanedText,
            );
            if (!displayText.trim()) continue;
            const pinned = toolAgentPinnedSeq.get(scopeKey);
            const partSeq = pinned !== undefined ? pinned : seq++;
            try {
              await persistContentPart(responseMessageId, chatId, {
                type: "tool-agent",
                id: `tool-agent-${scopeKey}`,
                seq: partSeq,
                data: {
                  id: aid,
                  displayName: display.displayName,
                  avatarSrc: display.avatarSrc,
                  avatarColor: display.avatarColor,
                  text: displayText,
                },
              });
            } catch {
              // Best-effort — stream is already closing
            }
          }
        }
        unregisterStream(controller);
        reader.releaseLock();
      }
    },
    cancel() {
      if (streamController) unregisterStream(streamController);
      onAbort();
    },
  });
}
