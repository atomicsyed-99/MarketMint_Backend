import type { ToolSearchProcessor } from "@mastra/core/processors";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  invalidateConnectionsCache,
  getUserConnections,
} from "@/connectors/nango/connections";
import {
  invalidateProcessorCache,
  injectToolsIntoProcessor,
} from "@/connectors/processor-cache";
import { getConnectorById } from "@/connectors/registry";
import { createLogger } from "@/lib/logger";
import {
  valueFromRequestContext,
  workspaceIdFromRequestContext,
} from "@/lib/request-context-workspace";

const log = createLogger("refresh-connections");

export const refreshConnections = createTool({
  id: "refreshConnections",
  description:
    "Refresh the available connector tools after a user connects or disconnects a service. Call this after receiving a user_action_response with connected=true, so that new connector tools become available in this chat session immediately.",
  inputSchema: z.object({
    workspace_id: z.string().describe("The workspace ID to refresh connections for"),
  }),
  execute: async (input, context) => {
    const workspaceId =
      input.workspace_id ||
      workspaceIdFromRequestContext(context?.requestContext) ||
      "";

    if (!workspaceId) {
      return { success: false, message: "No workspace ID available" };
    }

    // Invalidate caches so future requests rebuild from scratch
    invalidateConnectionsCache(workspaceId);
    invalidateProcessorCache(workspaceId);

    const orchestratorNoInject = valueFromRequestContext(
      context?.requestContext,
      "__orchestratorConnectorToolsDisabled",
    );

    // Inject new tools into the live processor for THIS stream (specialists only —
    // supervisor keeps an empty ToolSearchProcessor so connector APIs stay on sub-agents).
    const processor = valueFromRequestContext(
      context?.requestContext,
      "__connectorProcessor",
    );
    if (processor && !orchestratorNoInject) {
      try {
        const connections = await getUserConnections(workspaceId);
        const added = injectToolsIntoProcessor(
          processor as ToolSearchProcessor,
          connections,
        );

        if (added > 0) {
          // Build capability summary for the agent
          const connectedKeys = Object.keys(connections).filter(
            (k) => connections[k],
          );
          const connectorNames = connectedKeys
            .map((k) => getConnectorById(k)?.name)
            .filter(Boolean);

          return {
            success: true,
            message:
              `${added} new connector tools loaded and available NOW. ` +
              `Connected services: ${connectorNames.join(", ")}. ` +
              `Use search_tools to discover the available tools, then load_tool to use them. ` +
              `Do NOT ask the user to send another message — the tools are already live.`,
          };
        }
      } catch (e) {
        log.warn({ err: e }, "failed to inject tools mid-stream");
        // Fall through to cache-only invalidation
      }
    }

    if (orchestratorNoInject) {
      return {
        success: true,
        message:
          "Connection state refreshed. Delegate to the right specialist for data from connected services — the supervisor does not load connector execution tools in this chat.",
      };
    }

    return {
      success: true,
      message:
        "Connection caches cleared. New connector tools are available. Use search_tools to find them.",
    };
  },
});
