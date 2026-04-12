import { buildScopedConnectorTools } from "../shared/build-scoped-tools";
import { analyzeAdPerformance } from "./tools/analyze-ad-performance";
import { detectFatigue } from "./tools/detect-fatigue";
import { budgetWasteScanner } from "./tools/budget-waste-scanner";
import { generatePerformanceReport } from "./tools/generate-performance-report";
import { deliverContent } from "@/mastra/tools/artifacts/deliver-content";
import { createInteractiveView } from "@/mastra/tools/artifacts/create-interactive-view";
import type { Connections } from "@/connectors/types";

const domainTools = {
  analyzeAdPerformance,
  detectFatigue,
  budgetWasteScanner,
  generatePerformanceReport,
  deliverContent,
  createInteractiveView,
};

/**
 * Build the full tool set for the Performance Marketing agent.
 * Combines 6 domain tools + scoped connector tools (Meta, Google, GA4, Sheets, PostHog — all read-only).
 */
export function buildPerfMarketingTools(requestContext: any): Record<string, any> {
  const connections = requestContext?.get?.("__connections") as
    | Connections
    | undefined;

  const connectorTools = buildScopedConnectorTools(
    "performance-marketing-manager",
    connections,
  );

  return { ...domainTools, ...connectorTools };
}
