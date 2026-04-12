import { createTrajectoryScorerCode } from "@mastra/evals/scorers/prebuilt";

/**
 * Live trajectory scorer for Sam (Shopify Store Manager).
 *
 * Evaluates tool-call efficiency, blacklisted tool usage, and failure patterns.
 * Max steps is 12 since store audits can chain multiple data-fetching tools.
 */
export const samTrajectoryScorer = createTrajectoryScorerCode({
  defaults: {
    ordering: "relaxed",
    allowRepeatedSteps: true,
    noRedundantCalls: true,
    maxSteps: 12,
    blacklistedTools: [
      "directImageGen",
      "generateVideoSingleShot",
      "execute_workflow",
      "analyze_ad_performance",
      "detect_fatigue",
      "budget_waste_scanner",
      "generate_performance_report",
      "audit_klaviyo_flows",
      "flow_performance_monitor",
      "generate_campaign_copy",
      "segment_health_check",
      "runGeoAudit",
      "extractGeoPrompts",
      "generateGeoContent",
      "checkGeoOnboardingStatus",
    ],
  },
  weights: {
    accuracy: 0.4,
    efficiency: 0.3,
    toolFailures: 0.2,
    blacklist: 0.1,
  },
});
