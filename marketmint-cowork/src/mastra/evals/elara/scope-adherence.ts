import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractMessagesText } from "../utils";

const JUDGE_INSTRUCTIONS = `You are an AI system boundary evaluator. You check whether an AI agent stays within its designated domain responsibilities and does not encroach on other agents' domains.`;

export const elaraScopeAdherenceScorer = createScorer({
  id: "elara-scope-adherence",
  description:
    "Evaluates whether Elara stays within the email/CRM domain and does not attempt " +
    "creative generation, ad analytics, store management, or GEO tasks.",
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
    description: "Check if the response contains scope violations outside email/CRM",
    outputSchema: z.object({
      isInScope: z
        .boolean()
        .describe("True if the response stays within the email/CRM domain"),
      violations: z.array(
        z.object({
          domain: z.enum([
            "creative_generation",
            "ad_analytics",
            "store_management",
            "geo_optimization",
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
      return `Evaluate whether this Email & CRM Manager agent response stays within its designated scope.

The agent's domain is STRICTLY:
- Klaviyo email flows (welcome series, abandoned cart, post-purchase, winback, browse abandonment)
- Email campaign creation and management
- Audience segmentation and list health
- Email copy and subject line optimization
- CRM automation and customer lifecycle
- Email deliverability and compliance
- Flow performance monitoring and auditing

The agent should NOT attempt to:
- Generate images, videos, or visual creatives (that's the orchestrator's domain)
- Analyze ad performance, ROAS, or manage ad budgets (that's the Performance Marketing Manager's domain)
- Manage Shopify store, inventory, products, or collections (that's the Store Manager's domain)
- Run GEO audits, citation analysis, or optimize for LLM search (that's the GEO Optimizer's domain)

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
      return `Score: ${score.toFixed(2)}. Response stays within email/CRM domain scope.`;
    }

    const violationSummary = a.violations
      .map((v) => `${v.severity} ${v.domain}: ${v.description}`)
      .join("; ");

    const delegation = a.delegatesCorrectly
      ? "Agent correctly suggests delegation"
      : "Agent does not suggest delegation to appropriate agent";

    return `Score: ${score.toFixed(2)}. Scope violations: ${violationSummary}. ${delegation}.`;
  });
