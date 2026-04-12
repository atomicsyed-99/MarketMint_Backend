/**
 * Persistable snapshot of Mastra `agent.generate()` (FullOutput) — JSON-safe fields only.
 */
export function serializeAgentGenerateResult(result: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "text",
    "finishReason",
    "object",
    "usage",
    "totalUsage",
    "warnings",
    "toolCalls",
    "toolResults",
    "steps",
    "files",
    "sources",
    "reasoning",
    "reasoningText",
    "providerMetadata",
    "request",
    "response",
    "messages",
    "rememberedMessages",
    "traceId",
    "spanId",
    "runId",
    "error",
    "tripwire",
  ] as const;

  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (result[k] === undefined) continue;
    const cloned = jsonSafeClone(result[k]);
    if (cloned !== undefined) out[k] = cloned;
  }
  return out;
}

function jsonSafeClone(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value, jsonReplacer));
  } catch {
    if (typeof value === "string") return value.slice(0, 8000);
    return { _unserializable: true, preview: String(value).slice(0, 500) };
  }
}

function jsonReplacer(_key: string, value: unknown) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === "bigint") return Number(value);
  return value;
}
