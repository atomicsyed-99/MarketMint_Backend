import { createTrajectoryScorerCode } from "@mastra/evals/scorers/prebuilt";

/**
 * Live trajectory scorer for the Don (Performance Marketing) agent.
 *
 * Runs asynchronously on each agent interaction (sampling-controlled) and
 * evaluates tool-call efficiency, blacklisted tool usage, and failure patterns.
 *
 * Dimensions evaluated in live mode:
 *   - Efficiency: stays within 10-step budget, no redundant calls
 *   - Blacklist: flags use of out-of-scope tools (creative, store, email)
 *   - Tool failures: detects tools that error during execution
 *
 * Results are stored in `mastra_scorers` and viewable in Studio.
 */
export const donTrajectoryScorer = createTrajectoryScorerCode({
  defaults: {
    ordering: "relaxed",
    allowRepeatedSteps: true,
    noRedundantCalls: true,
    maxSteps: 10,
    blacklistedTools: [
      "generate_image",
      "generate_video",
      "manage_inventory",
      "manage_products",
      "send_email",
      "manage_klaviyo_flows",
    ],
  },
  weights: {
    accuracy: 0.5,
    efficiency: 0.2,
    toolFailures: 0.2,
    blacklist: 0.1,
  },
});