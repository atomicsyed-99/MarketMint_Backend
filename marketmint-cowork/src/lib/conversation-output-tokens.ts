/**
 * Parse output/completion token counts from Mastra/AI SDK usage (nested / provider `raw` shapes).
 */

function outputTokensFromUsageObject(usage: unknown): number {
  if (usage == null || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;

  const fromVal = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
    if (v && typeof v === "object" && v !== null && "total" in v) {
      const t = (v as { total: unknown }).total;
      if (typeof t === "number" && Number.isFinite(t)) return Math.max(0, Math.floor(t));
    }
    return 0;
  };

  let n = fromVal(u.outputTokens);
  if (n > 0) return n;
  n = fromVal(u.completionTokens);
  if (n > 0) return n;
  const raw = u.raw;
  if (raw && typeof raw === "object" && raw !== null) {
    n = fromVal((raw as Record<string, unknown>).outputTokens);
    if (n > 0) return n;
  }
  return 0;
}

/**
 * Full-turn output tokens: prefer `totalUsage`, else sum `steps`, else last-step `usage`.
 */
export function aggregatedOutputTokensFromAgentFinish(finish: {
  totalUsage?: unknown;
  usage?: unknown;
  steps?: Array<{ usage?: unknown }>;
}): number {
  const fromTotal = outputTokensFromUsageObject(finish.totalUsage);
  if (fromTotal > 0) return fromTotal;
  if (Array.isArray(finish.steps) && finish.steps.length > 0) {
    const sum = finish.steps.reduce(
      (acc, step) => acc + outputTokensFromUsageObject(step?.usage),
      0,
    );
    if (sum > 0) return sum;
  }
  return outputTokensFromUsageObject(finish.usage);
}
