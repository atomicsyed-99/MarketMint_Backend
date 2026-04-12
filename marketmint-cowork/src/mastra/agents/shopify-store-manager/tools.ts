import { buildScopedConnectorTools } from "../shared/build-scoped-tools";
import { computeStoreSignals } from "./tools/compute-store-signals";
import { catalogHealthAudit } from "./tools/catalog-health-audit";
import { inventoryAlertScanner } from "./tools/inventory-alert-scanner";
import { draftReviewResponse } from "./tools/draft-review-response";
import { deliverContent } from "@/mastra/tools/artifacts/deliver-content";
import { createInteractiveView } from "@/mastra/tools/artifacts/create-interactive-view";
import { searchShopifyCatalog } from "@/mastra/tools/shopify/search-catalog";
import { checkLinkedShopifyAccount } from "@/mastra/tools/shopify/check-linked-account";
import type { Connections } from "@/connectors/types";

/** Domain-specific tools always available to the Store Manager */
const domainTools = {
  computeStoreSignals,
  catalogHealthAudit,
  inventoryAlertScanner,
  draftReviewResponse,
  searchShopifyCatalog,
  checkLinkedShopifyAccount,
  deliverContent,
  createInteractiveView,
};

/**
 * Build the full tool set for the Shopify Store Manager agent.
 * Combines domain tools + scoped connector tools (Shopify, GA4, Sheets).
 *
 * Called per-request via the Agent's `tools` function.
 */
export function buildStoreManagerTools(requestContext: any): Record<string, any> {
  const connections = requestContext?.get?.("__connections") as
    | Connections
    | undefined;

  const connectorTools = buildScopedConnectorTools(
    "shopify-store-manager",
    connections,
  );

  return { ...domainTools, ...connectorTools };
}
