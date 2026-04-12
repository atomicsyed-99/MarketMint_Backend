import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getEnabledConnectors } from "@/connectors/registry";
import {
  setRequestContextValue,
  valueFromRequestContext,
} from "@/lib/request-context-workspace";

// Evaluated at import time — registry is static config, safe to cache
const connectors = getEnabledConnectors();
const providerIds = connectors.map((c) => c.id).join(", ");
const providerNames = connectors.map((c) => `"${c.id}" → ${c.name}`).join(", ");

export const showConnectBanner = createTool({
  id: "showConnectBanner",
  description: `Show a connector banner in the UI prompting the user to connect an external service. Supported providers: ${providerIds}. Call when the user asks about a service that is not connected.`,
  inputSchema: z.object({
    provider_id: z
      .string()
      .describe(`Provider identifier. Available: ${providerIds}`),
    provider_name: z
      .string()
      .describe(`Human-readable name. Mapping: ${providerNames}`),
    description: z
      .string()
      .optional()
      .describe("Custom description for the banner."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    // Code-level guard: only one connect banner per response.
    // Parallel tool calls in a single LLM step bypass prompt rules,
    // so we enforce at the tool level via a request-context flag.
    const reqCtx = context?.requestContext;
    if (valueFromRequestContext(reqCtx, "__connectBannerSent")) {
      return {
        ok: false,
        message: `A connect banner was already sent in this response. Wait for the user to complete that connection first. After they connect, call refreshConnections, then prompt for ${input.provider_name}.`,
      };
    }
    setRequestContextValue(reqCtx, "__connectBannerSent", true);

    context?.writer?.custom({
      type: "data-user-action",
      data: {
        id: `user-action-${crypto.randomUUID()}`,
        actions: [
          {
            widget: "interactive-card",
            variant: "connector",
            widgetProps: {
              providerId: input.provider_id,
              providerName: input.provider_name,
              status: "disconnected",
              description:
                input.description ??
                `Connect ${input.provider_name} to get started.`,
            },
          },
        ],
      },
    });

    return {
      ok: true,
      message: `${input.provider_name} connect banner sent. STOP and wait for the user to complete this connection before doing anything else. Do NOT send another showConnectBanner until this one is resolved. When you receive a user_action_response with connected=true, call refreshConnections, then proceed with the next service if needed.`,
    };
  },
});
