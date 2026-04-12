import { getConnectorById } from "@/connectors/registry";
import type { Connections } from "@/connectors/types";
import { wrapToolWithUtility } from "@/connectors/tools/wrap-with-utility";

/**
 * Connector scoping config per sub-agent.
 * Controls which connectors each agent can access and whether write tools are allowed.
 */
interface AgentConnectorConfig {
  /** Connector IDs this agent can access (e.g., "shopify", "meta-ads") */
  connectorIds: string[];
  /** If true, write tools (create/update/delete) are excluded entirely */
  readOnly?: boolean;
  /** Optional filter on individual tool IDs */
  toolFilter?: (toolId: string) => boolean;
}

const AGENT_CONNECTOR_MAP: Record<string, AgentConnectorConfig> = {
  orchestrator: {
    connectorIds: ["meta-marketing-api"],
    readOnly: true,
    toolFilter: (id) => id.includes("insight") || id.includes("creative"),
  },
  "performance-marketing-manager": {
    connectorIds: [
      "meta-ads",
      "google-ads",
      "google-analytics",
      "google-sheets",
      "posthog",
    ],
    readOnly: true,
  },
  "shopify-store-manager": {
    connectorIds: ["shopify", "google-analytics", "google-sheets"],
  },
  "email-crm-manager": {
    connectorIds: ["klaviyo"],
  },
  "geo-optimizer": {
    connectorIds: [],
    readOnly: true,
  },
};

/**
 * Heuristic to classify a tool as a write operation based on its ID.
 * Write tools get `requireApproval: true` so approval propagates up
 * through the supervisor delegation chain to the user.
 *
 * Read/list/count APIs must never match — otherwise Mastra suspends the sub-agent
 * and the parent `agent-*` tool surfaces `data-tool-call-approval` (looks like a "random stop").
 * Do not use the bare substring `draft`: it matches `shopify_list_draft_orders` (read-only list).
 */
export function isWriteTool(toolId: string): boolean {
  if (
    /(?:^|_)list_/i.test(toolId) ||
    /(?:^|_)get_/i.test(toolId) ||
    /(?:^|_)count_/i.test(toolId) ||
    /(?:^|_)fetch_/i.test(toolId) ||
    /(?:^|_)search_/i.test(toolId) ||
    /(?:^|_)retrieve_/i.test(toolId)
  ) {
    return false;
  }
  return /create|update|delete|send|publish|remove|adjust|set_inventory|cancel|close|reopen|complete|upload|add_product|remove_product|append|clear|unsubscribe/i.test(
    toolId,
  );
}

/**
 * Build connector tools scoped to a specific sub-agent.
 *
 * Each sub-agent only sees connectors defined in AGENT_CONNECTOR_MAP.
 * Write tools get `requireApproval: true` for user confirmation.
 * Read-only agents have write tools excluded entirely.
 *
 * @param agentId - The sub-agent's ID (e.g., "shopify-store-manager")
 * @param connections - Active workspace connections from requestContext
 */
export function buildScopedConnectorTools(
  agentId: string,
  connections: Connections | undefined,
): Record<string, any> {
  const config = AGENT_CONNECTOR_MAP[agentId];
  if (!config || !connections) return {};

  const tools: Record<string, any> = {};

  for (const connectorId of config.connectorIds) {
    // Connections are keyed by canonical connector ID after normalization.
    const connector = getConnectorById(connectorId);
    if (!connector || !connector.enabled) continue;

    const connInfo = connections[connectorId];
    if (!connInfo) continue;

    const connectorTools = connector.toolFactory(
      connInfo.connectionId,
      connInfo.apiKeys,
      connInfo.providerConfigKey,
    );

    for (const [toolId, tool] of Object.entries(connectorTools)) {
      // Skip write tools for read-only agents
      if (config.readOnly && isWriteTool(toolId)) continue;
      // Apply optional per-tool filter
      if (config.toolFilter && !config.toolFilter(toolId)) continue;

      // Wrap with utility pills so sub-agent connector tools render in UI
      wrapToolWithUtility(tool, toolId);

      if (isWriteTool(toolId)) {
        // Mark write tools with requireApproval — propagates through supervisor
        tools[toolId] = { ...tool, requireApproval: true };
      } else {
        tools[toolId] = tool;
      }
    }
  }

  return tools;
}