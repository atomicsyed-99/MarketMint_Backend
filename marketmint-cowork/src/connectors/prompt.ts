import type { Connections } from "./types";
import { getConnectorById } from "./registry";

// Re-export capabilities so existing imports keep working
export {
  SHOPIFY_CAPABILITIES,
  META_ADS_CAPABILITIES,
  GOOGLE_ADS_CAPABILITIES,
  GOOGLE_ANALYTICS_CAPABILITIES,
  GOOGLE_SHEETS_CAPABILITIES,
  KLAVIYO_CAPABILITIES,
  SLACK_CAPABILITIES,
  POSTHOG_CAPABILITIES,
} from "./capabilities";

// ---------------------------------------------------------------------------
// Dynamic system prompt builder
// ---------------------------------------------------------------------------

export function buildConnectorSystemPrompt(connections: Connections): string {
  const connectedProviders = Object.keys(connections).filter(
    (k) => connections[k],
  );
  if (connectedProviders.length === 0) return "";

  const connectors = connectedProviders
    .map((key) => getConnectorById(key))
    .filter((c): c is NonNullable<typeof c> => c != null);

  if (connectors.length === 0) return "";

  const connectorNames = connectors.map((c) => c.name).join(", ");
  const capabilitySections = connectors.map((c) => c.capabilities).join("\n\n");

  return `## Connected Services

Currently connected: ${connectorNames}

You have access to \`search_tools\` and \`load_tool\` meta-tools for discovering and loading connector tools:
1. Call \`search_tools\` with keywords matching the user's intent (e.g. "shopify products", "meta ads campaigns", "klaviyo lists")
2. Review the search results to find the right tool
3. Call \`load_tool\` with the exact tool name to make it available
4. Then call the loaded tool normally

For READ operations (list, get, reports): execute immediately after loading.
For WRITE operations (create, update, delete): these affect the user's live/production environment. Before executing, ensure all required fields are covered — proactively ask for anything missing and suggest sensible defaults where possible. Always confirm the full action with the user before making changes.

If the user asks about a service that is not connected, tell them to connect it first from the integrations panel.

${capabilitySections}`;
}

/**
 * Supervisor chat: user may have integrations connected, but this agent does not
 * load connector execution tools — only specialists do. Still useful so the model
 * knows what to delegate and can use list/showConnect/refresh UX tools honestly.
 */
export function buildOrchestratorConnectorContextPrompt(
  connections: Connections,
): string {
  const connectedProviders = Object.keys(connections).filter(
    (k) => connections[k],
  );
  if (connectedProviders.length === 0) return "";

  const connectors = connectedProviders
    .map((key) => getConnectorById(key))
    .filter((c): c is NonNullable<typeof c> => c != null);

  if (connectors.length === 0) return "";

  const connectorNames = connectors.map((c) => c.name).join(", ");
  const capabilitySections = connectors.map((c) => c.capabilities).join("\n\n");

  return `## Connected Services (context for delegation — you do not call connector APIs)

The workspace has these integrations connected: ${connectorNames}

**You do not** have connector data tools in this chat (no \`search_tools\` / \`load_tool\` for Meta, GA, Shopify, etc.). For any request that needs live data from a connected service, **delegate** to the appropriate specialist (Performance Marketing for ads/analytics, Shopify Store Manager for store/catalog, Email & CRM for Klaviyo, etc.).

You **may** still use \`showConnectBanner\`, \`listConnectedIntegrations\`, and \`refreshConnections\` for connection UX.

${capabilitySections}`;
}
