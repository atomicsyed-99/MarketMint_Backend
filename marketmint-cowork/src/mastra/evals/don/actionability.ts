import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractMessagesText } from "../utils";

const JUDGE_INSTRUCTIONS = `You are a senior marketing strategist evaluating whether an AI assistant provides actionable, concrete recommendations rather than generic advice. You evaluate responses from a Performance Marketing Manager agent.`;

export const actionabilityScorer = createScorer({
  id: "don-actionability",
  description:
    "Evaluates whether Don's recommendations are concrete and actionable — " +
    "naming specific campaigns, providing imperative actions, impact estimates, and severity.",
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
    description: "Analyze the response for actionability of recommendations",
    outputSchema: z.object({
      hasRecommendations: z
        .boolean()
        .describe("Response contains at least one recommendation or action item"),
      recommendationCount: z
        .number()
        .describe("Total number of distinct recommendations found"),
      namesSpecificEntities: z
        .boolean()
        .describe(
          "Recommendations reference specific campaigns, ad sets, creatives, or audiences by name",
        ),
      entityExamples: z
        .array(z.string())
        .describe("Examples of named entities in recommendations"),
      hasImperativeActions: z
        .boolean()
        .describe(
          "Actions are imperative and specific (e.g. 'Pause X', 'Increase budget to $Y', 'Refresh creative for Z')",
        ),
      actionExamples: z
        .array(z.string())
        .describe("Examples of imperative action statements found"),
      hasImpactEstimates: z
        .boolean()
        .describe(
          "Impact or expected outcome is indicated for at least some recommendations",
        ),
      hasPrioritization: z
        .boolean()
        .describe(
          "Recommendations include severity, priority labels, or are ordered by importance",
        ),
    }),
    createPrompt: ({ results }) => {
      const { responseText } = results.preprocessStepResult;
      return `Analyze the following Performance Marketing agent response for actionability.

Check for:
1. Presence of recommendations or action items
2. References to specific campaigns, ad sets, creatives, or audiences by name
3. Imperative, specific actions (e.g. "Pause Campaign X", "Scale budget to $500/day", "Rotate creatives for Summer Sale ad set")
4. Impact estimates or expected outcomes (e.g. "could save $200/day", "expected to improve ROAS by 0.5")
5. Prioritization or severity (e.g. "critical", "high priority", ordered list by urgency)

If the response is purely informational (answering a data query with no recommendation needed), note that recommendations may not apply.

Response to analyze:
${responseText}`;
    },
  })
  .generateScore(({ results }) => {
    const a = results.analyzeStepResult;

    if (!a.hasRecommendations) return 0;

    const criteria = [
      a.namesSpecificEntities,
      a.hasImperativeActions,
      a.hasImpactEstimates,
      a.hasPrioritization,
    ];
    return criteria.filter(Boolean).length / criteria.length;
  })
  .generateReason(({ results, score }) => {
    const a = results.analyzeStepResult;

    if (!a.hasRecommendations) {
      return `Score: ${score.toFixed(2)}. No recommendations found in the response.`;
    }

    const parts: string[] = [
      `${a.recommendationCount} recommendation(s) found`,
    ];

    if (a.namesSpecificEntities) {
      parts.push(
        `Names specific entities (${a.entityExamples.slice(0, 2).join(", ")})`,
      );
    } else {
      parts.push("Recommendations are generic — no specific entities named");
    }
    if (a.hasImperativeActions) {
      parts.push(
        `Imperative actions present (${a.actionExamples.slice(0, 2).join(", ")})`,
      );
    } else {
      parts.push("Actions are vague or missing");
    }
    if (!a.hasImpactEstimates) parts.push("No impact estimates provided");
    if (!a.hasPrioritization) parts.push("No prioritization or severity");

    return `Score: ${score.toFixed(2)}. ${parts.join(". ")}.`;
  });