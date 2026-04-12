import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "../helpers";

const API_VERSION = "2026-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyDraftOrderTools(connectionId: string, providerConfigKey: string): Record<string, any> {
  return {
    // ── List Draft Orders ─────────────────────────────────
    shopify_list_draft_orders: createTool({
      id: "shopify-list-draft-orders",
      description: "List draft orders (quotes/invoices).",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max draft orders to return (default 10)"),
        status: z
          .enum(["open", "invoice_sent", "completed"])
          .optional()
          .describe("Filter by draft order status"),
      }),
      execute: async ({ limit, status }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/draft_orders.json`,
            { params: { limit, status } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Get Draft Order ───────────────────────────────────
    shopify_get_draft_order: createTool({
      id: "shopify-get-draft-order",
      description: "Get a draft order by ID.",
      inputSchema: z.object({
        draft_order_id: z.string().describe("The draft order ID"),
      }),
      execute: async ({ draft_order_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/draft_orders/${sanitizeResourceId(draft_order_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Draft Order ────────────────────────────────
    shopify_create_draft_order: createTool({
      id: "shopify-create-draft-order",
      description:
        "Create a draft order.",
      inputSchema: z.object({
        line_items: z
          .array(
            z.object({
              variant_id: z
                .string()
                .optional()
                .describe("Variant ID (use this or title+price)"),
              title: z
                .string()
                .optional()
                .describe("Custom line item title"),
              price: z
                .string()
                .optional()
                .describe("Custom line item price"),
              quantity: z.number().describe("Quantity"),
            }),
          )
          .describe("Line items for the draft order"),
        customer: z
          .object({
            id: z.string().optional().describe("Customer ID"),
            email: z
              .string()
              .optional()
              .describe("Customer email"),
          })
          .optional()
          .describe("Customer to associate with the order"),
        note: z
          .string()
          .optional()
          .describe("Note on the draft order"),
        tags: z
          .string()
          .optional()
          .describe("Comma-separated tags"),
        shipping_line: z
          .object({
            title: z.string().describe("Shipping method title"),
            price: z.string().describe("Shipping price"),
          })
          .optional()
          .describe("Shipping line"),
      }),
      execute: async (params) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/draft_orders.json`,
            { body: { draft_order: params } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Complete Draft Order ──────────────────────────────
    shopify_complete_draft_order: createTool({
      id: "shopify-complete-draft-order",
      description:
        "Complete a draft order (convert to real order).",
      inputSchema: z.object({
        draft_order_id: z.string().describe("The draft order ID"),
        payment_pending: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Set true if payment will be collected later (default false)",
          ),
      }),
      execute: async ({ draft_order_id, payment_pending }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "PUT",
            `/admin/api/${API_VERSION}/draft_orders/${sanitizeResourceId(draft_order_id)}/complete.json`,
            { params: { payment_pending } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Send Draft Order Invoice ──────────────────────────
    shopify_send_draft_order_invoice: createTool({
      id: "shopify-send-draft-order-invoice",
      description:
        "Send invoice email for a draft order.",
      inputSchema: z.object({
        draft_order_id: z.string().describe("The draft order ID"),
        to: z
          .string()
          .optional()
          .describe("Recipient email address"),
        subject: z
          .string()
          .optional()
          .describe("Email subject"),
        custom_message: z
          .string()
          .optional()
          .describe("Custom message in the email"),
      }),
      execute: async ({ draft_order_id, ...invoice }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/draft_orders/${sanitizeResourceId(draft_order_id)}/send_invoice.json`,
            { body: { draft_order_invoice: invoice } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Delete Draft Order ────────────────────────────────
    shopify_delete_draft_order: createTool({
      id: "shopify-delete-draft-order",
      description:
        "Delete a draft order.",
      inputSchema: z.object({
        draft_order_id: z
          .string()
          .describe("The draft order ID to delete"),
      }),
      execute: async ({ draft_order_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "DELETE",
            `/admin/api/${API_VERSION}/draft_orders/${sanitizeResourceId(draft_order_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
