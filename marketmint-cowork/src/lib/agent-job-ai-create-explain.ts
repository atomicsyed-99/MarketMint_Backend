/**
 * Build a client-facing message when POST /agent-jobs/ai ran the job manager but no DB row was created.
 * Uses createAgentJob tool outcomes and assistant text from Mastra `agent.generate()` output.
 */

import { AgentJobErrorCode } from "@/lib/agent-job-errors";
import type { UnmetConnectorDetail } from "@/lib/agent-job-connector-requirements";

const CREATE_TOOL = "createAgentJob";

export type ExplainAgentJobNotCreatedResult = {
  code: string;
  error: string;
  detail?: string;
  connectors?: UnmetConnectorDetail[];
  agentIds?: string[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

async function unwrapMaybePromise(v: unknown): Promise<unknown> {
  if (v !== null && typeof v === "object" && typeof (v as { then?: unknown }).then === "function") {
    return await (v as Promise<unknown>);
  }
  return v;
}

type ToolResultEntry = {
  toolName: string;
  result: unknown;
  isError?: boolean;
};

function pushFromToolResultsArray(tr: unknown, out: ToolResultEntry[]) {
  if (!Array.isArray(tr)) return;
  for (const item of tr) {
    if (!isRecord(item)) continue;
    const payload = isRecord(item.payload) ? item.payload : item;
    const toolName = String(payload.toolName ?? item.toolName ?? "");
    if (!toolName) continue;
    const result = payload.result ?? item.result;
    const isError = Boolean(payload.isError ?? item.isError);
    out.push({ toolName, result, isError });
  }
}

function collectToolResults(result: Record<string, unknown>): ToolResultEntry[] {
  const out: ToolResultEntry[] = [];
  pushFromToolResultsArray(result.toolResults, out);
  const steps = result.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (isRecord(step)) pushFromToolResultsArray(step.toolResults, out);
    }
  }
  return out;
}

function parseStructuredCreateFailure(result: unknown): {
  message?: string;
  code?: string;
  connectors?: UnmetConnectorDetail[];
  agentIds?: string[];
} {
  if (!isRecord(result)) return {};
  if (result.success !== false) return {};
  const message =
    typeof result.error === "string" && result.error.trim() ? result.error.trim() : undefined;
  const code = typeof result.code === "string" ? result.code : undefined;
  const connectors = Array.isArray(result.connectors)
    ? (result.connectors as UnmetConnectorDetail[])
    : undefined;
  const agentIds = Array.isArray(result.agentIds)
    ? (result.agentIds as string[]).filter((x): x is string => typeof x === "string")
    : undefined;
  return { message, code, connectors, agentIds };
}

function messageFromCreateAgentJobResult(
  result: unknown,
  isError?: boolean,
): string | undefined {
  if (isError) {
    if (typeof result === "string" && result.trim()) return result.trim();
    if (isRecord(result) && typeof result.message === "string") return result.message;
    return "createAgentJob failed.";
  }
  const structured = parseStructuredCreateFailure(result);
  if (structured.message) return structured.message;
  if (!isRecord(result)) return undefined;
  if (result.success === false && typeof result.error === "string" && result.error.trim()) {
    return result.error.trim();
  }
  return undefined;
}

function topLevelErrorMessage(result: Record<string, unknown>): string | undefined {
  const err = result.error;
  if (!err) return undefined;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  return undefined;
}

/**
 * @returns Structured fields for JSON body when no job row was created after AI generate.
 */
export async function explainAgentJobNotCreated(
  generateResultRaw: unknown,
): Promise<ExplainAgentJobNotCreatedResult> {
  const generateResultUnknown = await unwrapMaybePromise(generateResultRaw);
  if (!isRecord(generateResultUnknown)) {
    return {
      code: AgentJobErrorCode.JOB_NOT_CREATED,
      error:
        "No scheduled job was created. The assistant did not persist a job—try rephrasing as a concrete recurring Marketmint task.",
    };
  }

  const generateResult = generateResultUnknown;
  const toolRows = collectToolResults(generateResult);
  const createRows = toolRows.filter(
    (r) => r.toolName === CREATE_TOOL || r.toolName.endsWith(CREATE_TOOL),
  );

  for (let i = createRows.length - 1; i >= 0; i--) {
    const row = createRows[i];
    const structured = parseStructuredCreateFailure(row.result);
    if (structured.code === AgentJobErrorCode.CONNECTOR_MISSING && structured.connectors?.length) {
      const text =
        typeof generateResult.text === "string" ? generateResult.text.trim() : "";
      const msg =
        structured.message ??
        `Missing required connections. Connect these integrations in Marketmint before creating this job.`;
      return {
        code: AgentJobErrorCode.CONNECTOR_MISSING,
        error: msg,
        connectors: structured.connectors,
        agentIds: structured.agentIds,
        ...(text && text !== msg ? { detail: text } : {}),
      };
    }

    const fromTool = messageFromCreateAgentJobResult(row.result, row.isError);
    if (fromTool) {
      const text =
        typeof generateResult.text === "string" ? generateResult.text.trim() : "";
      const code = row.isError
        ? AgentJobErrorCode.AI_TOOL_CREATE_FAILED
        : AgentJobErrorCode.JOB_NOT_CREATED;
      return text && text !== fromTool
        ? { code, error: fromTool, detail: text }
        : { code, error: fromTool };
    }
  }

  const suspended =
    generateResult.finishReason === "suspended" ||
    (typeof generateResult.finishReason === "string" &&
      String(generateResult.finishReason).includes("suspend"));
  if (suspended) {
    return {
      code: AgentJobErrorCode.AI_RUN_SUSPENDED,
      error:
        "Job creation could not complete because the assistant run suspended (e.g. approval flow). Scheduled job setup does not support that path.",
    };
  }

  const topErr = topLevelErrorMessage(generateResult);
  if (topErr) {
    return { code: AgentJobErrorCode.AI_GENERATION_ERROR, error: topErr };
  }

  const text =
    typeof generateResult.text === "string" ? generateResult.text.trim() : "";
  if (text) {
    return {
      code: AgentJobErrorCode.ASSISTANT_COMPLETED_NO_JOB,
      error:
        "No scheduled job was created. The assistant completed without saving a job—see detail for what it said.",
      detail: text,
    };
  }

  return {
    code: AgentJobErrorCode.NO_TOOL_CALL_OR_MESSAGE,
    error:
      "No scheduled job was created. The assistant did not call createAgentJob, or the run produced no message. Describe a recurring ecommerce or content task (schedule + what should run).",
  };
}
