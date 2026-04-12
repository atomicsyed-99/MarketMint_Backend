import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "../helpers";

const API_VERSION = "2026-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyMiscTools(connectionId: string, providerConfigKey: string): Record<string, any> {
  return {
    // ── Get Shop ──────────────────────────────────────────
    shopify_get_shop: createTool({
      id: "shopify-get-shop",
      description:
        "Get store info (name, domain, plan, currency, timezone, etc). IMPORTANT: Call this before displaying any product prices — Shopify returns prices as raw numbers without currency symbols. Use the store's currency field to format correctly (e.g. ₹72.00 for INR, not $72.00). The store's base currency is fixed and cannot be changed via API.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/shop.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Themes ───────────────────────────────────────
    shopify_list_themes: createTool({
      id: "shopify-list-themes",
      description:
        "List all themes installed on the store. Shows which one is active.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/themes.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Gift Cards ───────────────────────────────────
    shopify_list_gift_cards: createTool({
      id: "shopify-list-gift-cards",
      description: "List gift cards in the store.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max gift cards to return (default 10)"),
        status: z
          .enum(["enabled", "disabled"])
          .optional()
          .describe("Filter by gift card status"),
      }),
      execute: async ({ limit, status }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/gift_cards.json`,
            { params: { limit, status } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Gift Card ──────────────────────────────────
    shopify_create_gift_card: createTool({
      id: "shopify-create-gift-card",
      description:
        "Create a gift card.",
      inputSchema: z.object({
        initial_value: z
          .string()
          .describe('Gift card value (e.g., "50.00")'),
        note: z
          .string()
          .optional()
          .describe("Note about the gift card"),
        expires_on: z
          .string()
          .optional()
          .describe("Expiration date (YYYY-MM-DD)"),
        customer_id: z
          .string()
          .optional()
          .describe(
            "Customer ID to associate the gift card with",
          ),
      }),
      execute: async ({
        initial_value,
        note,
        expires_on,
        customer_id,
      }) => {
        try {
          const gift_card: Record<string, unknown> = { initial_value };
          if (note !== undefined) gift_card.note = note;
          if (expires_on !== undefined)
            gift_card.expires_on = expires_on;
          if (customer_id !== undefined)
            gift_card.customer_id = customer_id;
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/gift_cards.json`,
            { body: { gift_card } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Pages ────────────────────────────────────────
    shopify_list_pages: createTool({
      id: "shopify-list-pages",
      description:
        "List store pages (About Us, Contact, etc.).",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max pages to return (default 10)"),
      }),
      execute: async ({ limit }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/pages.json`,
            { params: { limit } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Page ───────────────────────────────────────
    shopify_create_page: createTool({
      id: "shopify-create-page",
      description:
        "Create a new page.",
      inputSchema: z.object({
        title: z.string().describe("Page title"),
        body_html: z.string().describe("Page content in HTML"),
        published: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to publish the page (default true)",
          ),
      }),
      execute: async ({ title, body_html, published }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/pages.json`,
            { body: { page: { title, body_html, published } } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Update Page ───────────────────────────────────────
    shopify_update_page: createTool({
      id: "shopify-update-page",
      description:
        "Update an existing page.",
      inputSchema: z.object({
        page_id: z.string().describe("The page ID to update"),
        title: z
          .string()
          .optional()
          .describe("New page title"),
        body_html: z
          .string()
          .optional()
          .describe("New page content in HTML"),
        published: z
          .boolean()
          .optional()
          .describe("Whether the page is published"),
      }),
      execute: async ({
        page_id,
        title,
        body_html,
        published,
      }) => {
        try {
          const page: Record<string, unknown> = { id: page_id };
          if (title !== undefined) page.title = title;
          if (body_html !== undefined) page.body_html = body_html;
          if (published !== undefined) page.published = published;
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "PUT",
            `/admin/api/${API_VERSION}/pages/${sanitizeResourceId(page_id)}.json`,
            { body: { page } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
