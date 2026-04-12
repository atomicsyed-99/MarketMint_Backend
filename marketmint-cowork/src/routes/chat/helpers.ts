import { env } from "@/env";
import { fetchWithTimeout } from "@/lib/fetch";
import { getOpenAIModel } from "@/lib/ai-gateway";
import { generateText } from "ai";

const MAX_TEXT_PARTS = 20;
const MAX_TEXT_LENGTH = 8000;

/**
 * Assert that the user has enough credits to proceed.
 */
export async function assertHasEnoughCredits(
  accessToken: string,
): Promise<void> {
  const creditsBase =
    env.CREDITS_BACKEND_BASE_URL ?? env.BACKEND_BASE_URL ?? "";
  if (!creditsBase) {
    throw new Error(
      "Credits backend is not configured (CREDITS_BACKEND_BASE_URL/BACKEND_BASE_URL).",
    );
  }
  const resp = await fetchWithTimeout(
    `${creditsBase.replace(/\/$/, "")}/credits/balance`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Credits balance check failed (${resp.status}): ${t}`);
  }
  const body = (await resp.json().catch(() => ({}))) as {
    total_credits?: number;
  };
  if (Number(body.total_credits ?? 0) <= 0) {
    const err = new Error("Insufficient credits");
    (err as any).status = 402;
    throw err;
  }
}

/**
 * Build the dynamic brand memory block for the system prompt.
 */
export function buildBrandMemoryBlock(isBrandMemorySelected: boolean): string {
  const brandMemoryStatus = isBrandMemorySelected
    ? "## **BRAND MEMORY**: The user wants to use brand memory for their generations and other activities where brand information is required."
    : "## **BRAND MEMORY**: The user does not want to use brand memory for their generations and other activities by default. If the user asks to use brand memory or the task clearly needs their brand context, proceed with brand-aligned tools; **image generation applies saved workspace brand memory inside \`directImageGen\`** when a workspace id is present — there is no separate “brand report” tool to call first.";

  if (isBrandMemorySelected) {
    const firstBlock =
      "## **USER WANTS TO USE BRAND MEMORY** (read this first)\n" +
      "The user has brand memory enabled. For **image and on-brand visual generation**, tools such as **directImageGen** load saved workspace brand memory automatically (server-side). You do **not** need a preliminary brand-analysis tool call before delegating or generating. " +
      "Use skill/skill_search when the workflow requires it. For narrative questions about “what is my brand,” answer from context and connected data honestly, or suggest they confirm details in brand settings — do not invent a full dossier from the store name alone.\n\n";
    return (
      firstBlock +
      brandMemoryStatus +
      "\n\nDo not claim that brand memory was skipped for generation unless a tool explicitly failed; **directImageGen** applies workspace memory when available."
    );
  }
  return brandMemoryStatus;
}

/**
 * Extract text content from raw content or incoming messages.
 */
export function extractContent(
  rawContent: any[] | undefined,
  incomingMessages: any[] | undefined,
): Array<{ type: string; text: string }> {
  const deriveContentFromMessages = (messages: any[]): any[] => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role !== "user") continue;
      if (Array.isArray(m.parts)) {
        const parts = m.parts
          .filter((p: any) => p?.type === "text" && typeof p.text === "string")
          .map((p: any) => ({ type: "text", text: p.text }));
        if (parts.length) return parts;
      }
      if (typeof m.content === "string" && m.content.trim()) {
        return [{ type: "text", text: m.content }];
      }
    }
    return [];
  };

  return (
    Array.isArray(rawContent)
      ? rawContent
      : Array.isArray(incomingMessages)
        ? deriveContentFromMessages(incomingMessages)
        : []
  )
    .filter((p) => p?.type === "text" && typeof p?.text === "string")
    .slice(0, MAX_TEXT_PARTS)
    .map((p) => ({
      type: "text",
      text: String(p.text).slice(0, MAX_TEXT_LENGTH),
    }));
}

/** Parsed `<hidden>workflow_id=..., template_id=...</hidden>` (parity with marketmint-pro-backend state parsing). */
export type ParsedHiddenTemplatePayload = {
  workflow_id?: string;
  use_case_id?: string;
  template_id?: string;
  /** LangSmith / template prompt id (`selected_template_prompt_id` or legacy `prompt_id`). */
  selected_template_prompt_id?: string;
  category_id?: string;
};

const HIDDEN_SENTINEL = new Set(["undefined", "null", ""]);

function normalizeHiddenValue(v: string | undefined): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  if (!t || HIDDEN_SENTINEL.has(t)) return undefined;
  return t;
}

/**
 * Parse comma-separated `k=v` pairs inside the first `<hidden>...</hidden>` block.
 * Frontend may send `prompt_id=` as an alias for `selected_template_prompt_id`.
 */
export function parseHiddenTemplatePayloadFromText(
  text: string,
): ParsedHiddenTemplatePayload {
  if (!text || !text.includes("<hidden>")) return {};
  try {
    const start = text.indexOf("<hidden>") + "<hidden>".length;
    const end = text.indexOf("</hidden>");
    if (end < 0 || end <= start) return {};
    const hidden = text.slice(start, end).trim();
    const parsed: Record<string, string> = {};
    for (const raw of hidden.split(",")) {
      const part = raw.trim();
      if (!part.includes("=")) continue;
      const eq = part.indexOf("=");
      const key = part.slice(0, eq).trim();
      const val = part.slice(eq + 1).trim();
      if (key) parsed[key] = val;
    }
    const prompt =
      normalizeHiddenValue(parsed.selected_template_prompt_id) ??
      normalizeHiddenValue(parsed.prompt_id);
    return {
      workflow_id: normalizeHiddenValue(parsed.workflow_id),
      use_case_id: normalizeHiddenValue(parsed.use_case_id),
      template_id: normalizeHiddenValue(parsed.template_id),
      selected_template_prompt_id: prompt,
      category_id: normalizeHiddenValue(parsed.category_id),
    };
  } catch {
    return {};
  }
}

/**
 * Join text from `content` + latest user `messages` so `<hidden>` is found.
 */
export function collectUserTextForHiddenPayload(
  rawContent: any[] | undefined,
  incomingMessages: any[] | undefined,
): string {
  const chunks: string[] = [];
  if (Array.isArray(rawContent)) {
    for (const p of rawContent) {
      if (p && typeof p === "object" && p.type === "text" && typeof p.text === "string") {
        chunks.push(p.text);
      }
    }
  }
  if (Array.isArray(incomingMessages)) {
    for (let i = incomingMessages.length - 1; i >= 0; i--) {
      const m = incomingMessages[i];
      if (!m || typeof m !== "object") continue;
      if (String((m as { role?: string }).role ?? "").toLowerCase() !== "user") {
        continue;
      }
      const parts = (m as { parts?: unknown }).parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: string }).type === "text" &&
            typeof (part as { text?: string }).text === "string"
          ) {
            chunks.push((part as { text: string }).text);
          }
        }
      }
      break;
    }
  }
  return chunks.join("\n");
}

/**
 * Product image for template-video: first attachment where `is_template_image` is not true; else first URL (matches Python `marketmint_agent_v2`).
 */
export function deriveProductImageUrlFromTemplateAttachments(
  attachments: Record<string, unknown>[],
): string | undefined {
  if (!Array.isArray(attachments) || attachments.length === 0) return undefined;
  let fallback: string | undefined;
  for (const a of attachments) {
    if (!a || typeof a !== "object") continue;
    const url =
      typeof (a as { url?: unknown }).url === "string"
        ? (a as { url: string }).url.trim()
        : "";
    if (!url) continue;
    if (fallback === undefined) fallback = url;
    if ((a as { is_template_image?: unknown }).is_template_image !== true) {
      return url;
    }
  }
  return fallback;
}

/**
 * Generate a chat title from the user's first message.
 * Uses OpenAI GPT-4o-mini if available, otherwise falls back to truncation.
 */
export async function generateChatTitle(userText: string): Promise<string> {
  if (env.OPENAI_API_KEY) {
    try {
      const { text } = await generateText({
        model: getOpenAIModel("gpt-4o-mini"),
        temperature: 0,
        system: "Generate a concise chat title (max 8 words) for this conversation starter. Return plain text only.",
        prompt: userText,
      });
      const title = text.trim();
      if (title) return title.slice(0, 120);
    } catch {
      // fall through to fallback
    }
  }
  // Fallback: truncate user text
  const cleaned = userText.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim();
  if (!cleaned) return "New Chat";
  const words = cleaned.split(" ").slice(0, 8);
  const title = words.join(" ").trim();
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

/**
 * Resolve a URL from a message part (file, image, or multimodal content item).
 * AI SDK / useChat often sends uploads as `type: "image"` + `image`, not `type: "file"` + `url`.
 */
/** Pathname extension → video; used because clients sometimes mislabel `.mov` as image/png. */
const VIDEO_PATH_RE = /\.(mov|mp4|webm|m4v|avi|mkv)(\?|#|$)/i;

export function isVideoFileUrl(url: string): boolean {
  try {
    return VIDEO_PATH_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isVideoAttachmentRecord(
  url: string,
  byUrl: ReadonlyMap<string, Record<string, unknown>>,
): boolean {
  const a = byUrl.get(url);
  const t = a?.type;
  return (
    t === "video" ||
    (typeof t === "string" && t.startsWith("video/"))
  );
}

/**
 * Incoming `messages` may include `file` parts pointing at video URLs with wrong `mediaType`
 * (e.g. image/png for `.mov`). Anthropic only supports image/*, PDF, and plain text as file
 * parts; sending video as image fails the request. Replace those parts with a short text line;
 * URLs remain in ASSET CATALOG / enriched attachments.
 */
export function normalizeIncomingMessagesForAgent(
  messages: any[],
  enrichedAttachments: Record<string, unknown>[],
): any[] {
  const byUrl = new Map<string, Record<string, unknown>>();
  for (const a of enrichedAttachments) {
    if (a && typeof (a as { url?: string }).url === "string") {
      byUrl.set((a as { url: string }).url, a as Record<string, unknown>);
    }
  }

  const mapParts = (parts: any[] | undefined): any[] | undefined => {
    if (!Array.isArray(parts)) return parts;
    return parts.flatMap((part: any) => {
      if (part?.type !== "file" || typeof part.url !== "string") {
        return [part];
      }
      const url = part.url;
      if (!isVideoFileUrl(url) && !isVideoAttachmentRecord(url, byUrl)) {
        return [part];
      }
      return [
        {
          type: "text",
          text: `(Video: ${url} — see ASSET CATALOG for type and description.)`,
        },
      ];
    });
  };

  return messages.map((m) => {
    if (!m || typeof m !== "object") return m;
    const next: any = { ...m };
    if (Array.isArray(next.parts)) next.parts = mapParts(next.parts);
    if (Array.isArray(next.content)) next.content = mapParts(next.content);
    return next;
  });
}

function attachmentUrlFromPart(part: any): string | null {
  if (!part || typeof part !== "object") return null;
  if (part.type === "file" && typeof part.url === "string") {
    return part.url;
  }
  if (part.type === "image") {
    const img = part.image;
    if (typeof img === "string") return img;
    if (img instanceof URL) return img.href;
    if (img && typeof img === "object" && typeof (img as { url?: string }).url === "string") {
      return (img as { url: string }).url;
    }
  }
  return null;
}

function collectUserMessagePartArrays(message: any): any[][] {
  const out: any[][] = [];
  if (Array.isArray(message?.parts)) out.push(message.parts);
  if (Array.isArray(message?.content)) out.push(message.content);
  return out;
}

function partsHaveExtractableUrl(parts: any[] | undefined): boolean {
  if (!Array.isArray(parts)) return false;
  return parts.some((p) => attachmentUrlFromPart(p) != null);
}

/**
 * Include message for attachment extraction: explicit user (any case), or missing role when
 * parts/content carry file/image URLs (optimistic clients often omit role on the latest message).
 */
function isUserMessageForAttachments(m: any): boolean {
  const r = m?.role;
  if (r === undefined || r === null || r === "") {
    return (
      partsHaveExtractableUrl(m?.parts) || partsHaveExtractableUrl(m?.content)
    );
  }
  return String(r).toLowerCase() === "user";
}

/**
 * Extract attachments from incoming messages (file + image parts on `parts` or `content`).
 */
export function extractAttachmentsFromMessages(messages: any[]): any[] {
  const extracted: any[] = [];
  for (const m of messages) {
    if (!isUserMessageForAttachments(m)) continue;
    for (const parts of collectUserMessagePartArrays(m)) {
      for (const part of parts) {
        const url = attachmentUrlFromPart(part);
        if (!url) continue;
        if (isVideoFileUrl(url)) {
          extracted.push({ type: "video", url });
          continue;
        }
        const mediaType =
          typeof part.mediaType === "string"
            ? part.mediaType
            : part.type === "image"
              ? "image/jpeg"
              : "application/octet-stream";
        extracted.push({ type: mediaType, url });
      }
    }
  }
  return extracted;
}

/**
 * Same extraction for top-level `content` on the request body (when not using `messages`).
 */
export function extractAttachmentsFromContentArray(content: any[] | undefined): any[] {
  if (!Array.isArray(content)) return [];
  const extracted: any[] = [];
  for (const part of content) {
    const url = attachmentUrlFromPart(part);
    if (!url) continue;
    if (isVideoFileUrl(url)) {
      extracted.push({ type: "video", url });
      continue;
    }
    extracted.push({
      type:
        typeof part?.mediaType === "string"
          ? part.mediaType
          : "image/jpeg",
      url,
    });
  }
  return extracted;
}
