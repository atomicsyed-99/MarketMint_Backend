import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractMessagesText } from "../utils";

const JUDGE_INSTRUCTIONS = `You are a GEO (Generative Engine Optimization) evaluator assessing whether an AI GEO Optimizer provides specific, data-driven responses about LLM search visibility rather than vague or generic advice.`;

export const geoPrecisionScorer = createScorer({
  id: "sage-geo-precision",
  description:
    "Evaluates whether Sage gives precise GEO data — references specific prompts/queries, " +
    "named LLM providers, citation status details, and actionable next steps.",
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
    description: "Analyze the response for GEO precision and specificity",
    outputSchema: z.object({
      referencesSpecificPrompts: z
        .boolean()
        .describe(
          "Response references specific search prompts or queries (e.g. 'best running shoes for flat feet')",
        ),
      promptExamples: z
        .array(z.string())
        .describe("Examples of specific prompts/queries referenced"),
      namesProviders: z
        .boolean()
        .describe(
          "Response names specific LLM providers (ChatGPT, Perplexity, Gemini, Claude, Copilot)",
        ),
      providerNames: z
        .array(z.string())
        .describe("List of LLM provider names found"),
      hasCitationDetails: z
        .boolean()
        .describe(
          "Response includes specific citation status details (cited/not cited, position, competitor mentions)",
        ),
      hasActionableNextStep: z
        .boolean()
        .describe(
          "Response includes a concrete actionable next step (generate content, add prompt to tracking, schedule monitoring, run audit)",
        ),
    }),
    createPrompt: ({ results }) => {
      const { responseText } = results.preprocessStepResult;
      return `Analyze the following GEO Optimizer agent response for GEO data precision.

Check for:
1. Specific search prompts or queries referenced (actual query text a user might type into an LLM)
2. Named LLM providers (ChatGPT, Perplexity, Gemini, Claude, Copilot, Bing Chat)
3. Citation status details (cited/not cited, position in response, competitor brands appearing, frequency)
4. Actionable next steps (generate optimized content, add a prompt to monitoring, schedule a re-audit, create SEO-friendly FAQ)

If the agent is executing a tool call (GEO audit, prompt extraction), evaluate the parameters and any accompanying explanation for specificity.

Response to analyze:
${responseText}`;
    },
  })
  .generateScore(({ results }) => {
    const a = results.analyzeStepResult;
    const criteria = [
      a.referencesSpecificPrompts,
      a.namesProviders,
      a.hasCitationDetails,
      a.hasActionableNextStep,
    ];
    return criteria.filter(Boolean).length / criteria.length;
  })
  .generateReason(({ results, score }) => {
    const a = results.analyzeStepResult;
    const parts: string[] = [];

    if (a.referencesSpecificPrompts) {
      parts.push(`Prompts referenced: ${a.promptExamples.slice(0, 2).join(", ")}`);
    } else {
      parts.push("No specific prompts/queries referenced");
    }
    if (a.namesProviders) {
      parts.push(`Providers: ${a.providerNames.slice(0, 3).join(", ")}`);
    } else {
      parts.push("No named LLM providers");
    }
    if (!a.hasCitationDetails) parts.push("No citation status details");
    if (a.hasActionableNextStep) {
      parts.push("Includes actionable next step");
    } else {
      parts.push("No actionable next step");
    }

    return `Score: ${score.toFixed(2)}. ${parts.join(". ")}.`;
  });
