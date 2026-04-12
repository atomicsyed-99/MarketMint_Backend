import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getUserConnections } from "@/connectors/nango/connections";
import { getEnabledConnectors } from "@/connectors/registry";
import { workspaceIdFromRequestContext } from "@/lib/request-context-workspace";

export const listConnectedIntegrations = createTool({
  id: "listConnectedIntegrations",
  description:
    "Check which external services the user has connected and which are available to connect. Call this when the user asks about their integrations, connected accounts, or available services. Returns both connected and available providers.",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const workspaceId = workspaceIdFromRequestContext(context?.requestContext);

    const connections = await getUserConnections(workspaceId);
    const connectedKeys = Object.keys(connections).filter((k) => connections[k]);

    const allConnectors = getEnabledConnectors();

    const connected = allConnectors
      .filter((c) => connectedKeys.includes(c.providerConfigKey))
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        providerConfigKey: c.providerConfigKey,
      }));

    const available = allConnectors
      .filter((c) => !connectedKeys.includes(c.providerConfigKey))
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
      }));

    return {
      connected,
      available,
      message: connected.length > 0
        ? `Connected: ${connected.map((c) => c.name).join(", ")}. Available to connect: ${available.map((c) => c.name).join(", ")}.`
        : `No integrations connected yet. Available: ${available.map((c) => c.name).join(", ")}. Use showConnectBanner to prompt the user to connect any of these.`,
    };
  },
});
