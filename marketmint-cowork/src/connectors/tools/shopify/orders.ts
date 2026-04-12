import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "../helpers";

const API_VERSION = "2026-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyOrderTools(connectionId: string, providerConfigKey: string): Record<string, any> {
  return {
    // ── List Orders ───────────────────────────────────────
    shopify_list_orders: createTool({
      id: "shopify-list-orders",
      description: "List recent orders from the Shopify store.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max orders to return"),
        status: z
          .enum(["open", "closed", "cancelled", "any"])
          .optional()
          .default("any")
          .describe("Order status filter"),
        financial_status: z
          .enum([
            "authorized",
            "pending",
            "paid",
            "partially_paid",
            "refunded",
            "voided",
            "partially_refunded",
            "any",
          ])
          .optional()
          .describe("Payment status filter"),
      }),
      execute: async ({ limit, status, ...filters }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/orders.json`,
            { params: { limit, status, ...filters } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Get Order ─────────────────────────────────────────
    shopify_get_order: createTool({
      id: "shopify-get-order",
      description: "Get details of a specific order by ID.",
      inputSchema: z.object({
        order_id: z.string().describe("The Shopify order ID"),
      }),
      execute: async ({ order_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/orders/${sanitizeResourceId(order_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Count Orders ──────────────────────────────────────
    shopify_count_orders: createTool({
      id: "shopify-count-orders",
      description:
        "Get a count of orders, optionally filtered by status.",
      inputSchema: z.object({
        status: z
          .enum(["open", "closed", "cancelled", "any"])
          .optional()
          .default("any")
          .describe("Order status filter"),
      }),
      execute: async ({ status }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/orders/count.json`,
            { params: { status } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Fulfillment Orders ───────────────────────────
    shopify_list_fulfillment_orders: createTool({
      id: "shopify-list-fulfillment-orders",
      description: "List fulfillment orders for an order.",
      inputSchema: z.object({
        order_id: z.string().describe("The Shopify order ID"),
      }),
      execute: async ({ order_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/orders/${sanitizeResourceId(order_id)}/fulfillment_orders.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Fulfillment ────────────────────────────────
    shopify_create_fulfillment: createTool({
      id: "shopify-create-fulfillment",
      description:
        "Create a fulfillment (mark items as shipped).",
      inputSchema: z.object({
        fulfillment_order_id: z
          .string()
          .describe("The fulfillment order ID"),
        tracking_number: z
          .string()
          .optional()
          .describe("Tracking number"),
        tracking_url: z
          .string()
          .optional()
          .describe("Tracking URL"),
        tracking_company: z
          .string()
          .optional()
          .describe("Tracking company name"),
        notify_customer: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to notify the customer (default true)",
          ),
      }),
      execute: async ({
        fulfillment_order_id,
        tracking_number,
        tracking_url,
        tracking_company,
        notify_customer,
      }) => {
        try {
          const fulfillment: Record<string, unknown> = {
            line_items_by_fulfillment_order: [{ fulfillment_order_id }],
            notify_customer,
          };
          if (tracking_number || tracking_url || tracking_company) {
            fulfillment.tracking_info = {
              number: tracking_number,
              url: tracking_url,
              company: tracking_company,
            };
          }
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/fulfillments.json`,
            { body: { fulfillment } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Cancel Order ──────────────────────────────────────
    shopify_cancel_order: createTool({
      id: "shopify-cancel-order",
      description:
        "Cancel an order.",
      inputSchema: z.object({
        order_id: z.string().describe("The Shopify order ID"),
        reason: z
          .enum(["customer", "fraud", "inventory", "declined", "other"])
          .optional()
          .describe("Cancellation reason"),
        email: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to send cancellation email (default true)",
          ),
        restock: z
          .boolean()
          .optional()
          .default(true)
          .describe("Whether to restock items (default true)"),
      }),
      execute: async ({ order_id, ...params }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/orders/${sanitizeResourceId(order_id)}/cancel.json`,
            { body: params },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Close Order ───────────────────────────────────────
    shopify_close_order: createTool({
      id: "shopify-close-order",
      description:
        "Close an order (mark as completed).",
      inputSchema: z.object({
        order_id: z.string().describe("The Shopify order ID"),
      }),
      execute: async ({ order_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/orders/${sanitizeResourceId(order_id)}/close.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Reopen Order ──────────────────────────────────────
    shopify_reopen_order: createTool({
      id: "shopify-reopen-order",
      description: "Reopen a closed order.",
      inputSchema: z.object({
        order_id: z.string().describe("The Shopify order ID"),
      }),
      execute: async ({ order_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/orders/${sanitizeResourceId(order_id)}/open.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Refund ─────────────────────────────────────
    shopify_create_refund: createTool({
      id: "shopify-create-refund",
      description:
        "Process a refund for an order. WARNING: This sends money back to the customer.",
      inputSchema: z.object({
        order_id: z.string().describe("The Shopify order ID"),
        note: z
          .string()
          .optional()
          .describe("Reason or note for the refund"),
        notify: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to notify the customer (default true)",
          ),
        refund_line_items: z
          .array(
            z.object({
              line_item_id: z
                .string()
                .describe("The line item ID to refund"),
              quantity: z.number().describe("Quantity to refund"),
              restock_type: z
                .enum(["no_restock", "cancel", "return"])
                .optional()
                .describe("How to handle restocking"),
            }),
          )
          .optional()
          .describe("Line items to refund"),
        shipping: z
          .object({
            full_refund: z
              .boolean()
              .optional()
              .describe("Whether to fully refund shipping"),
            amount: z
              .string()
              .optional()
              .describe("Specific shipping refund amount"),
          })
          .optional()
          .describe("Shipping refund details"),
        currency: z
          .string()
          .optional()
          .describe('Currency code (e.g., "USD")'),
      }),
      execute: async ({
        order_id,
        note,
        notify,
        refund_line_items,
        shipping,
        currency,
      }) => {
        try {
          const refund: Record<string, unknown> = {};
          if (note !== undefined) refund.note = note;
          if (notify !== undefined) refund.notify = notify;
          if (refund_line_items !== undefined)
            refund.refund_line_items = refund_line_items;
          if (shipping !== undefined)
            refund.shipping = {
              full_refund: shipping.full_refund,
              amount: shipping.amount,
            };
          if (currency !== undefined) refund.currency = currency;
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/orders/${sanitizeResourceId(order_id)}/refunds.json`,
            { body: { refund } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
