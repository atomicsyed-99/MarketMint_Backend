import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractMessagesText } from "../utils";

const JUDGE_INSTRUCTIONS = `You are an AI system boundary evaluator. You check whether an AI agent stays within its designated domain responsibilities and does not encroach on other agents' domains.`;

export const sageScopeAdherenceScorer = createScorer({
  id: "sage-scope-adherence",
  description:
    "Evaluates whether Sage stays within the GEO domain and does not attempt " +
    "creative generation, ad analytics, store management, or email/CRM tasks.",
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
    description: "Check if the response contains scope violations outside GEO",
    outputSchema: z.object({
      isInScope: z
        .boolean()
        .describe("True if the response stays within the GEO domain"),
      violations: z.array(
        z.object({
          domain: z.enum([
            "creative_generation",
            "ad_analytics",
            "store_management",
            "email_crm",
            "other",
          ]),
          description: z.string(),
          severity: z.enum(["minor", "major"]),
        }),
      ),
      delegatesCorrectly: z
        .boolean()
        .describe(
          "If an out-of-scope request was made, the agent correctly suggests delegating to the appropriate agent",
        ),
    }),
    createPrompt: ({ results }) => {
      const { responseText, inputText } = results.preprocessStepResult;
      return `Evaluate whether this GEO Optimizer agent response stays within its designated scope.

The agent's domain is STRICTLY:
- GEO (Generative Engine Optimization) prompts and prompt tracking
- Citation audits across LLM providers (ChatGPT, Perplexity, Gemini, etc.)
- GEO content generation (optimized content for LLM search visibility)
- LLM provider monitoring and competitive analysis in AI search
- GEO onboarding flow and setup

The agent should NOT attempt to:
- Generate images, videos, or visual creatives (that's the orchestrator's domain)
- Analyze ad performance, ROAS, CTR trends, or manage ad budgets (that's the Performance Marketing Manager's domain)
- Manage Shopify store, inventory, products, or collections (that's the Store Manager's domain)
- Manage email marketing, Klaviyo flows, or CRM segments (that's the Email & CRM Manager's domain)

If the user asks for something out-of-scope, the agent SHOULD suggest delegating to the right agent.

User input:
${inputText}

Agent response:
${responseText}

Identify any scope violations. A "minor" violation is a brief mention or slight overreach. A "major" violation is the agent actively attempting an out-of-scope task.`;
    },
  })
  .generateScore(({ results }) => {
    const a = results.analyzeStepResult;
    if (a.isInScope) return 1;

    const majorViolations = a.violations.filter((v) => v.severity === "major").length;
    if (majorViolations > 0) return 0;

    if (a.delegatesCorrectly) return 0.75;
    return 0.25;
  })
  .generateReason(({ results, score }) => {
    const a = results.analyzeStepResult;

    if (a.isInScope) {
      return `Score: ${score.toFixed(2)}. Response stays within GEO domain scope.`;
    }

    const violationSummary = a.violations
      .map((v) => `${v.severity} ${v.domain}: ${v.description}`)
      .join("; ");

    const delegation = a.delegatesCorrectly
      ? "Agent correctly suggests delegation"
      : "Agent does not suggest delegation to appropriate agent";

    return `Score: ${score.toFixed(2)}. Scope violations: ${violationSummary}. ${delegation}.`;
  });
