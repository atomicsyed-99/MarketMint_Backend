import { createTrajectoryScorerCode } from "@mastra/evals/scorers/prebuilt";

/**
 * Live trajectory scorer for Sage (GEO Optimizer).
 *
 * Evaluates tool-call efficiency, blacklisted tool usage, and failure patterns.
 */
export const sageTrajectoryScorer = createTrajectoryScorerCode({
  defaults: {
    ordering: "relaxed",
    allowRepeatedSteps: true,
    noRedundantCalls: true,
    maxSteps: 10,
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
      "compute_store_signals",
      "catalog_health_audit",
      "inventory_alert_scanner",
      "draft_review_response",
    ],
  },
  weights: {
    accuracy: 0.4,
    efficiency: 0.3,
    toolFailures: 0.2,
    blacklist: 0.1,
  },
});
