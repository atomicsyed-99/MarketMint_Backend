import { generateText, Output } from "ai";
import { z } from "zod";
import { env } from "@/env";
import { getOpenAIModel } from "@/lib/ai-gateway";
import { createLogger } from "@/lib/logger";
import type { CreateAgentJobInsightBody } from "@/schemas/agent-job-insights";
import {
  InsightSeveritySchema,
  InsightTypeSchema,
} from "@/schemas/agent-job-insights";

const log = createLogger("agent-job-run-insights-llm");

/** Shared JSON budget for summary + insights LLM calls (full `output` in DB is unchanged). */
const MAX_PROMPT_CHARS = 28_000;

const SUMMARY_HARD_MAX = 500;
const SUMMARY_TARGET_MIN = 250;
const SUMMARY_TARGET_MAX = 300;

/**
 * OpenAI structured `response_format` rejects optional fields inside nested objects.
 * Use nullable fields + required keys on the parent row instead of .optional() nesting.
 */
const insightMetricStructuredSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  direction: z.string().nullable().describe("Trend direction or null if not applicable"),
});

const relatedEntityStructuredSchema = z.object({
  type: z.string(),
  id: z.string(),
  name: z.string(),
});

const insightRowStructuredSchema = z.object({
  insightType: InsightTypeSchema,
  severity: InsightSeveritySchema,
  title: z.string().min(1).max(200),
  detail: z
    .string()
    .min(1)
    .max(6000)
    .describe(
      "Long, actionable body: include concrete names, SKUs, handles, URLs, counts, and lists from tool results when present—do not omit specifics.",
    ),
  metric: insightMetricStructuredSchema.nullable(),
  relatedEntity: relatedEntityStructuredSchema.nullable(),
  agentId: z.string().nullable(),
});

/** Exported for tests — must stay compatible with OpenAI structured outputs. */
export const insightsLlmOutputSchema = z.object({
  insights: z.array(insightRowStructuredSchema).max(12),
});

export type InsightRowFromLlm = z.infer<typeof insightRowStructuredSchema>;

function normalizeInsightForDb(row: InsightRowFromLlm): Omit<CreateAgentJobInsightBody, "runId"> {
  const out: Omit<CreateAgentJobInsightBody, "runId"> = {
    insightType: row.insightType,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
  };
  if (row.metric != null) {
    out.metric = {
      name: row.metric.name,
      value: row.metric.value,
      unit: row.metric.unit,
      ...(row.metric.direction != null && row.metric.direction !== ""
        ? { direction: row.metric.direction }
        : {}),
    };
  }
  if (row.relatedEntity != null) {
    out.relatedEntity = row.relatedEntity;
  }
  if (row.agentId != null && row.agentId !== "") {
    out.agentId = row.agentId;
  }
  return out;
}

const jobRunSummarySchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(SUMMARY_HARD_MAX)
    .describe(
      `One short merchant-facing line or two. Target ${SUMMARY_TARGET_MIN}-${SUMMARY_TARGET_MAX} characters; never more than ${SUMMARY_HARD_MAX}.`,
    ),
});

/**
 * LLM: short run summary for list views. Independent of full `output` JSON stored on the run.
 */
export async function generateJobRunSummaryFromDump(
  dumped: Record<string, unknown>,
): Promise<string | null> {
  if (!env.OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set; skipping summary LLM");
    return null;
  }

  let payload = JSON.stringify(dumped);
  if (payload.length > MAX_PROMPT_CHARS) {
    payload = payload.slice(0, MAX_PROMPT_CHARS) + "\n...[truncated]";
  }

  try {
    const { output } = await generateText({
      model: getOpenAIModel("gpt-4o-mini"),
      temperature: 0.25,
      output: Output.object({ schema: jobRunSummarySchema }),
      system: [
        "Write exactly one plain-text summary of what this scheduled job run accomplished (or clearly failed to deliver, if errors appear in the data).",
        `Target length ${SUMMARY_TARGET_MIN}–${SUMMARY_TARGET_MAX} characters; never more than ${SUMMARY_HARD_MAX} characters.`,
        "No markdown, bullets, or quotes. No model names or JSON jargon.",
        "Focus on concrete outcomes (e.g. report generated, N images, key audit finding)—not hypothetical next steps from a narrative plan.",
      ].join("\n"),
      prompt: `Scheduled job run JSON:\n${payload}`,
    });
    let s = output.summary.trim().replace(/\s+/g, " ");
    if (s.length > SUMMARY_HARD_MAX) {
      s = `${s.slice(0, SUMMARY_HARD_MAX - 3)}...`;
    }
    return s;
  } catch (e) {
    log.warn({ err: e }, "job run summary LLM failed");
    return null;
  }
}

/** Fallback when summary LLM is off or fails — does not affect stored `output`. */
export function fallbackJobRunSummaryFromDump(dumped: Record<string, unknown>): string {
  const raw =
    typeof dumped.text === "string" && dumped.text.length > 0
      ? dumped.text
      : JSON.stringify(dumped.object ?? {});
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SUMMARY_HARD_MAX) return collapsed;
  return `${collapsed.slice(0, SUMMARY_HARD_MAX - 3)}...`;
}

const SYSTEM = `You turn a completed scheduled agent job run (JSON) into detailed, actionable merchant insights.

Context: the scheduler finished this run without crashing. Help the merchant act on what actually happened — not on hypothetical plans.

Critical — plans vs reality:
- Long **text** may include **displayPlan** bullets or suggested next steps. That is NOT proof of unfinished work unless **toolResults** / **steps** show failed tools, errors, or suspension.
- Do not claim "pending steps" or "incomplete execution" from narrative alone.

Detail depth (required):
- **detail** must be substantive (multiple sentences when needed). Include **specifics from the dump**: product titles, SKUs, handles, campaign names, metric values, URLs, line items — especially when the title states a count (e.g. "11 products priced at 0" → list each product name/handle/SKU you can find in tool outputs; if the dump only has partial list, say what is known and what is truncated).
- Prefer splitting into separate insights over one vague card.
- Each insight should answer: what happened, why it matters, what to do next (actionable).

Operational metrics (exclude):
- Do **not** create insights about LLM/API **token usage**, costs, prompt/completion counts, or model resource consumption — those are operational, not merchant-facing product insights.

Quality:
- Return 0–12 insights; avoid duplicates.
- insightType: finding|trend|correlation|anomaly; severity: critical|warning|info.
- **title**: short headline. **detail**: rich, specific, actionable (up to ~6000 chars if the data warrants it).
- For metric: null when N/A; else name, value, unit, direction (string or null).
- For relatedEntity: null when N/A; else type, id, name for one primary entity (extras go in detail).
- For agentId: null when unknown.
- Be faithful to the run data; do not invent SKUs, names, or metrics not grounded in the JSON.`;

/**
 * Second-pass LLM: structured insights for DB insert (runId added by caller).
 */
export async function generateInsightsFromJobRunDump(
  dumped: Record<string, unknown>,
  agentIdHint: string | undefined,
): Promise<Array<Omit<CreateAgentJobInsightBody, "runId">>> {
  if (!env.OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set; skipping insight generation");
    return [];
  }

  let payload = JSON.stringify(dumped);
  if (payload.length > MAX_PROMPT_CHARS) {
    payload = payload.slice(0, MAX_PROMPT_CHARS) + "\n...[truncated]";
  }

  try {
    const { output } = await generateText({
      model: getOpenAIModel("gpt-4o-mini"),
      temperature: 0.2,
      output: Output.object({ schema: insightsLlmOutputSchema }),
      system: SYSTEM,
      prompt: [
        "Run facts (trust these over imaginative reading of assistant prose):",
        JSON.stringify({
          schedulerStatus: "completed_ok",
          meaning:
            "The worker finished without throwing; assistant 'text' may still contain hypothetical multi-step plans that were not executed as separate tasks.",
        }),
        "",
        `Target agent id (hint): ${agentIdHint ?? "unknown"}`,
        "",
        "Scheduled job run JSON:",
        payload,
      ].join("\n"),
    });
    return output.insights
      .filter((row) => !looksLikeTokenOperationalInsight(row))
      .map(normalizeInsightForDb);
  } catch (e) {
    log.warn({ err: e }, "insight generation failed");
    return [];
  }
}

/** Drop rows that still mention token usage after prompt exclusions. */
function looksLikeTokenOperationalInsight(row: InsightRowFromLlm): boolean {
  const t = `${row.title} ${row.detail}`.toLowerCase();
  const metricName = row.metric?.name?.toLowerCase() ?? "";
  if (metricName.includes("token")) return true;
  if (
    /\b(token|tokens)\b/.test(t) &&
    /\b(usage|consumed|prompt|completion|llm|input|output)\b/.test(t)
  ) {
    return true;
  }
  return false;
}
