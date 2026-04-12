import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { extractMessagesText } from "../utils";

const JUDGE_INSTRUCTIONS = `You are an AI system boundary evaluator. You check whether an AI agent stays within its designated domain responsibilities and does not encroach on other agents' domains.`;

export const scopeAdherenceScorer = createScorer({
  id: "don-scope-adherence",
  description:
    "Evaluates whether Don stays within the performance marketing domain and " +
    "does not attempt creative generation, store management, or email/CRM tasks.",
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
    description:
      "Check if the response contains scope violations outside performance marketing",
    outputSchema: z.object({
      isInScope: z
        .boolean()
        .describe(
          "True if the response stays within performance marketing scope",
        ),
      violations: z.array(
        z.object({
          domain: z.enum([
            "creative_generation",
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
          "If an out-of-scope request was made, the agent correctly suggests delegating to the appropriate agent rather than attempting the task itself",
        ),
    }),
    createPrompt: ({ results }) => {
      const { responseText, inputText } = results.preprocessStepResult;
      return `Evaluate whether this Performance Marketing agent response stays within its designated scope.

The agent's domain is STRICTLY:
- Ad performance analysis (Meta Ads, Google Ads, TikTok Ads)
- Creative fatigue detection
- Budget waste identification
- Marketing metrics tracking (ROAS, CAC, CTR, CPC, CPM)
- Campaign recommendations (pause, scale, reallocate)
- Performance reports and dashboards

The agent should NOT attempt to:
- Create images, videos, or ad creatives (that's the orchestrator's domain)
- Manage Shopify store, inventory, products, or collections (that's the Store Manager's domain)
- Manage email marketing, Klaviyo flows, or CRM segments (that's the Email & CRM Manager's domain)
- Generate content or creative assets

If the user asks for something out-of-scope, the agent SHOULD suggest delegating to the right agent rather than attempting it.

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

    const majorViolations = a.violations.filter(
      (v) => v.severity === "major",
    ).length;
    if (majorViolations > 0) return 0;

    if (a.delegatesCorrectly) return 0.75;
    return 0.25;
  })
  .generateReason(({ results, score }) => {
    const a = results.analyzeStepResult;

    if (a.isInScope) {
      return `Score: ${score.toFixed(2)}. Response stays within performance marketing scope.`;
    }

    const violationSummary = a.violations
      .map((v) => `${v.severity} ${v.domain}: ${v.description}`)
      .join("; ");

    const delegation = a.delegatesCorrectly
      ? "Agent correctly suggests delegation"
      : "Agent does not suggest delegation to appropriate agent";

    return `Score: ${score.toFixed(2)}. Scope violations: ${violationSummary}. ${delegation}.`;
  });