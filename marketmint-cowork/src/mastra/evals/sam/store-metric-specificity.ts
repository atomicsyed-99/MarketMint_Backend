import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractMessagesText } from "../utils";

const JUDGE_INSTRUCTIONS = `You are a Shopify store operations evaluator assessing whether an AI Store Manager provides specific, data-backed store metrics and findings rather than vague or generic advice. You evaluate responses from a Shopify Store Manager agent.`;

export const storeMetricSpecificityScorer = createScorer({
  id: "sam-store-metric-specificity",
  description:
    "Evaluates whether Sam uses specific store metrics with numbers — inventory counts, " +
    "catalog health scores, SEO completeness, conversion rates, and product-level data.",
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
    description: "Analyze the response for store metric specificity",
    outputSchema: z.object({
      hasNamedMetrics: z
        .boolean()
        .describe(
          "Response references named store metrics (inventory count, catalog health score, " +
          "SEO score, conversion rate, product count, out-of-stock count, average order value, page speed)",
        ),
      namedMetrics: z
        .array(z.string())
        .describe("List of specific store metric names found"),
      hasNumericalValues: z
        .boolean()
        .describe(
          "Metric mentions include actual numbers (counts, percentages, scores, dollar amounts)",
        ),
      numericalExamples: z
        .array(z.string())
        .describe("Examples of numerical values found (e.g. '142 products', '87% completeness', '3 out-of-stock')"),
      hasSeverityGrouping: z
        .boolean()
        .describe(
          "Findings are grouped or labeled by severity/priority (critical, warning, info, high/medium/low)",
        ),
      referencesSpecificProducts: z
        .boolean()
        .describe(
          "Response references specific products, collections, or pages by name rather than speaking generically",
        ),
    }),
    createPrompt: ({ results }) => {
      const { responseText } = results.preprocessStepResult;
      return `Analyze the following Shopify Store Manager agent response for store metric specificity.

Check for:
1. Named store metrics (inventory levels, catalog health score, SEO completeness score, conversion rate, product count, out-of-stock count, average order value, page speed, broken links, missing images/descriptions)
2. Actual numerical values attached to those metrics (counts, percentages, scores, dollar amounts — not just "some" or "a few")
3. Severity grouping of findings (critical/warning/info, high/medium/low priority)
4. References to specific products, collections, or pages by name (not just "some products" or "your catalog")

If the agent is executing a tool call (store audit, inventory scan, catalog health), evaluate the parameters and any accompanying explanation for specificity.

Response to analyze:
${responseText}`;
    },
  })
  .generateScore(({ results }) => {
    const a = results.analyzeStepResult;
    const criteria = [
      a.hasNamedMetrics,
      a.hasNumericalValues,
      a.hasSeverityGrouping,
      a.referencesSpecificProducts,
    ];
    return criteria.filter(Boolean).length / criteria.length;
  })
  .generateReason(({ results, score }) => {
    const a = results.analyzeStepResult;
    const parts: string[] = [];

    if (a.hasNamedMetrics) {
      parts.push(`Metrics referenced: ${a.namedMetrics.slice(0, 3).join(", ")}`);
    } else {
      parts.push("No named store metrics");
    }
    if (a.hasNumericalValues) {
      parts.push(`Numerical values: ${a.numericalExamples.slice(0, 2).join(", ")}`);
    } else {
      parts.push("No numerical values");
    }
    if (!a.hasSeverityGrouping) parts.push("No severity grouping");
    if (a.referencesSpecificProducts) {
      parts.push("References specific products/collections");
    } else {
      parts.push("No specific product/collection references");
    }

    return `Score: ${score.toFixed(2)}. ${parts.join(". ")}.`;
  });
