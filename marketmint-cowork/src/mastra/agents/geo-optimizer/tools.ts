import { buildScopedConnectorTools } from "../shared/build-scoped-tools";
import type { Connections } from "@/connectors/types";
import { deliverContent, generatePdf } from "@/mastra/tools";
import {
  addGeoPrompt,
  checkGeoOnboardingStatus,
  extractGeoPrompts,
  generateGeoContent,
  getGeoPrompts,
  runGeoAudit,
} from "@/mastra/tools/geo";

const domainTools = {
  checkGeoOnboardingStatus,
  extractGeoPrompts,
  addGeoPrompt,
  getGeoPrompts,
  runGeoAudit,
  generateGeoContent,
  deliverContent,
  generatePdf,
};

export function buildGeoOptimizerTools(requestContext: any): Record<string, any> {
  const connections = requestContext?.get?.("__connections") as
    | Connections
    | undefined;

  const connectorTools = buildScopedConnectorTools("geo-optimizer", connections);
  return { ...domainTools, ...connectorTools };
}
