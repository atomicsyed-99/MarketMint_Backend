import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { env } from "@/env";
import { stringFromRequestContext } from "@/lib/request-context-workspace";

const ACCOUNTS_BASE_URL = env.ACCOUNTS_BASE_URL ?? env.SERVER_URL ?? "https://dev.api.pro.corp.marketmint.ai";

async function fetchIntegrationAccounts(authHeader: string): Promise<Record<string, unknown>> {
  const url = `${ACCOUNTS_BASE_URL.replace(/\/$/, "")}/integrations/accounts`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
  });
  if (res.status !== 200) {
    const text = await res.text();
    return { error: `HTTP ${res.status}`, detail: text.slice(0, 200) };
  }
  return (await res.json()) as Record<string, unknown>;
}

function findConnectedShopify(accounts: Array<Record<string, unknown>>): Record<string, unknown> | null {
  if (!accounts.length) return null;
  for (const acc of accounts) {
    if ((String(acc.provider ?? "").toLowerCase() === "shopify") && (String(acc.status ?? "").toLowerCase() === "connected")) {
      return acc;
    }
  }
  return null;
}

export const checkLinkedShopifyAccount = createTool({
  id: "checkLinkedShopifyAccount",
  description:
    "Check if the user has a linked Shopify account via the legacy integration. Only use when search_tools is NOT available. If search_tools is available, the user's Shopify is already connected via Nango — use search_tools instead.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    has_shopify: z.boolean(),
    shop_domain: z.string().nullable(),
    message: z.string(),
    accounts: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  execute: async (_input, context) => {
    const cardId = crypto.randomUUID();
    const emit = async (status: "running" | "completed" | "failed", description: string) => {
      await context?.writer?.custom?.({
        type: "data-agent-utility",
        data: {
          id: cardId,
          name: "checkLinkedShopifyAccount",
          status,
          title: "Shopify Connection",
          category: "connector",
          description,
        },
      });
    };

    await emit("running", "Checking linked Shopify account");
    const token = stringFromRequestContext(
      context?.requestContext,
      "userAccessToken",
    );
    if (!token || !String(token).trim()) {
      await emit("completed", "No user token available for account lookup");
      return {
        has_shopify: false,
        shop_domain: null,
        message:
          "User token not available. Call showConnectBanner with provider_id='shopify' and provider_name='Shopify' to prompt them to connect.",
        accounts: [],
      };
    }
    let authHeader = String(token).trim();
    if (!authHeader.toLowerCase().startsWith("bearer ")) authHeader = `Bearer ${authHeader}`;

    try {
      const data = await fetchIntegrationAccounts(authHeader);
      if (data.error) {
        return {
          has_shopify: false,
          shop_domain: null,
          message: String(data.detail ?? data.error ?? "Integrations API error"),
          accounts: [],
        };
      }
      const accounts = Array.isArray(data.accounts) ? (data.accounts as Array<Record<string, unknown>>) : [];
      const shopify = findConnectedShopify(accounts);
      if (shopify) {
        const shopDomain = String(shopify.shopDomain ?? shopify.shop_domain ?? "").trim() || null;
        await emit("completed", "Shopify account is connected");
        return {
          has_shopify: true,
          shop_domain: shopDomain,
          message: shopDomain ? `User has a connected Shopify store: ${shopDomain}` : "User has a connected Shopify account.",
          accounts,
        };
      }
      await emit("completed", "No connected Shopify account found");
      return {
        has_shopify: false,
        shop_domain: null,
        message:
          "User has not linked a Shopify account. Call showConnectBanner with provider_id='shopify' and provider_name='Shopify' to prompt them to connect.",
        accounts,
      };
    } catch (e) {
      await emit("failed", "Failed to check linked Shopify account");
      return {
        has_shopify: false,
        shop_domain: null,
        message: `Failed to fetch integration accounts: ${e instanceof Error ? e.message : String(e)}`,
        accounts: [],
      };
    }
  },
});
