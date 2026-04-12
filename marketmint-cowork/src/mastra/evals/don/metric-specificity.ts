import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractMessagesText } from "../utils";

const JUDGE_INSTRUCTIONS = `You are a performance marketing analyst evaluating whether an AI assistant's response contains specific, quantitative metrics rather than vague qualitative statements. You assess responses from a Performance Marketing Manager agent.`;

export const metricSpecificityScorer = createScorer({
  id: "don-metric-specificity",
  description:
    "Evaluates whether Don's responses contain specific metrics (ROAS, CTR, CPC, etc.) " +
    "with actual numerical values and deltas, not vague qualitative statements.",
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
    description: "Analyze the response for metric specificity",
    outputSchema: z.object({
      hasNamedMetrics: z
        .boolean()
        .describe(
          "Response contains at least one named metric (ROAS, CTR, CPC, CPM, CAC, CPA, AOV, etc.)",
        ),
      namedMetrics: z
        .array(z.string())
        .describe("List of named metrics found"),
      hasNumericalValues: z
        .boolean()
        .describe(
          "Metric mentions include actual numerical values, not just qualitative terms like 'good' or 'increasing'",
        ),
      numericalExamples: z
        .array(z.string())
        .describe("Examples of numerical values found (e.g. '3.2', '23%')"),
      hasDeltasOrComparisons: z
        .boolean()
        .describe(
          "Includes deltas, percentage changes, or before/after comparisons where context warrants them",
        ),
      hasTimeContext: z
        .boolean()
        .describe(
          "Includes time context such as 'last 7 days', 'week-over-week', 'month-to-date'",
        ),
    }),
    createPrompt: ({ results }) => {
      const { responseText } = results.preprocessStepResult;
      return `Analyze the following Performance Marketing agent response for metric specificity.

Check for:
1. Named metrics (ROAS, CTR, CPC, CPM, CAC, CPA, AOV, CVR, etc.)
2. Actual numerical values attached to those metrics (not just "good" or "improving")
3. Deltas or comparisons (e.g. "dropped 23% from 3.2 to 2.5", "+15% week-over-week")
4. Time context (e.g. "last 7 days", "week-over-week", "month-to-date")

If the user's question doesn't naturally require metrics (e.g. a greeting or off-topic question), still evaluate what's present.

Response to analyze:
${responseText}`;
    },
  })
  .generateScore(({ results }) => {
    const a = results.analyzeStepResult;
    const criteria = [
      a.hasNamedMetrics,
      a.hasNumericalValues,
      a.hasDeltasOrComparisons,
      a.hasTimeContext,
    ];
    return criteria.filter(Boolean).length / criteria.length;
  })
  .generateReason(({ results, score }) => {
    const a = results.analyzeStepResult;
    const parts: string[] = [];

    if (a.hasNamedMetrics) {
      parts.push(`Metrics found: ${a.namedMetrics.join(", ")}`);
    } else {
      parts.push("No named metrics found");
    }
    if (a.hasNumericalValues) {
      parts.push(
        `Numerical values present (e.g. ${a.numericalExamples.slice(0, 3).join(", ")})`,
      );
    } else {
      parts.push("Missing concrete numerical values");
    }
    if (!a.hasDeltasOrComparisons) parts.push("No deltas or comparisons");
    if (!a.hasTimeContext) parts.push("No time context");

    return `Score: ${score.toFixed(2)}. ${parts.join(". ")}.`;
  });