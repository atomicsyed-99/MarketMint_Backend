import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractMessagesText } from "../utils";

const JUDGE_INSTRUCTIONS = `You are an email marketing and CRM analytics evaluator assessing whether an AI Email & CRM Manager provides specific, data-backed email and CRM metrics rather than vague assessments.`;

export const emailMetricSpecificityScorer = createScorer({
  id: "elara-email-metric-specificity",
  description:
    "Evaluates whether Elara uses specific email/CRM metrics with numbers — " +
    "open rate, click rate, RPR, benchmarks, and named flows/campaigns.",
  type: "agent",
  judge: {
    model: "openai/gpt-4o-mini",
    instructions: JUDGE_INSTRUCTIONS,
  },
})
  .preprocess(({ run }) => ({
    responseText: extractMessagesText(run.output),
    inputText: extractMessagesText(run.input),
  }))
  .analyze({
    description: "Analyze the response for email/CRM metric specificity",
    outputSchema: z.object({
      hasNamedMetrics: z
        .boolean()
        .describe(
          "Response references named email/CRM metrics (open rate, click rate, RPR, bounce rate, unsubscribe rate, deliverability, conversion rate)",
        ),
      namedMetrics: z
        .array(z.string())
        .describe("List of specific metric names found"),
      hasNumericalValues: z
        .boolean()
        .describe(
          "Metric mentions include actual numbers (percentages, counts, revenue figures)",
        ),
      numericalExamples: z
        .array(z.string())
        .describe("Examples of numerical values found (e.g. '42%', '$2.50 RPR')"),
      hasBenchmarks: z
        .boolean()
        .describe(
          "Response includes benchmarks or comparisons ('42% vs industry avg 50-60%', 'up from 30% last month')",
        ),
      namesFlowsOrCampaigns: z
        .boolean()
        .describe(
          "Response references specific flow or campaign names (e.g. 'Welcome Series', 'Post-Purchase Flow')",
        ),
    }),
    createPrompt: ({ results }) => {
      const { responseText } = results.preprocessStepResult;
      return `Analyze the following Email & CRM Manager agent response for email/CRM metric specificity.

Check for:
1. Named email/CRM metrics (open rate, click rate, revenue per recipient, bounce rate, unsubscribe rate, deliverability, conversion rate, list growth rate, spam complaint rate)
2. Actual numerical values with those metrics (percentages, dollar amounts, counts)
3. Benchmarks or comparisons (vs industry average, vs previous period, vs goal)
4. Named flows or campaigns (Welcome Series, Abandoned Cart, Post-Purchase, Browse Abandonment, etc.)

If the agent is executing a tool call (flow audit, segment check), evaluate the parameters and any accompanying explanation for specificity.

Response to analyze:
${responseText}`;
    },
  })
  .generateScore(({ results }) => {
    const a = results.analyzeStepResult;
    const criteria = [
      a.hasNamedMetrics,
      a.hasNumericalValues,
      a.hasBenchmarks,
      a.namesFlowsOrCampaigns,
    ];
    return criteria.filter(Boolean).length / criteria.length;
  })
  .generateReason(({ results, score }) => {
    const a = results.analyzeStepResult;
    const parts: string[] = [];

    if (a.hasNamedMetrics) {
      parts.push(`Metrics referenced: ${a.namedMetrics.slice(0, 3).join(", ")}`);
    } else {
      parts.push("No named email/CRM metrics");
    }
    if (a.hasNumericalValues) {
      parts.push(`Numerical values: ${a.numericalExamples.slice(0, 2).join(", ")}`);
    } else {
      parts.push("No numerical values");
    }
    if (!a.hasBenchmarks) parts.push("No benchmarks or comparisons");
    if (a.namesFlowsOrCampaigns) {
      parts.push("References specific flows/campaigns");
    } else {
      parts.push("No named flows/campaigns");
    }

    return `Score: ${score.toFixed(2)}. ${parts.join(". ")}.`;
  });
