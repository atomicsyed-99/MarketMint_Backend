import { buildScopedConnectorTools } from "../shared/build-scoped-tools";
import { auditKlaviyoFlows } from "./tools/audit-klaviyo-flows";
import { flowPerformanceMonitor } from "./tools/flow-performance-monitor";
import { generateCampaignCopy } from "./tools/generate-campaign-copy";
import { segmentHealthCheck } from "./tools/segment-health-check";
import { deliverContent } from "@/mastra/tools/artifacts/deliver-content";
import { createInteractiveView } from "@/mastra/tools/artifacts/create-interactive-view";
import type { Connections } from "@/connectors/types";

const domainTools = {
  auditKlaviyoFlows,
  flowPerformanceMonitor,
  generateCampaignCopy,
  segmentHealthCheck,
  deliverContent,
  createInteractiveView,
};

/**
 * Build the full tool set for the Email & CRM Manager agent.
 * Combines 6 domain tools + scoped Klaviyo connector tools.
 */
export function buildEmailCrmTools(requestContext: any): Record<string, any> {
  const connections = requestContext?.get?.("__connections") as
    | Connections
    | undefined;

  const connectorTools = buildScopedConnectorTools(
    "email-crm-manager",
    connections,
  );

  return { ...domainTools, ...connectorTools };
}
