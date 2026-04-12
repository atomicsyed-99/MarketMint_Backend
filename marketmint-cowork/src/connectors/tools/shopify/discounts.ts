import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "../helpers";

const API_VERSION = "2026-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyDiscountTools(connectionId: string, providerConfigKey: string): Record<string, any> {
  return {
    // ── Create Price Rule ─────────────────────────────────
    shopify_create_price_rule: createTool({
      id: "shopify-create-price-rule",
      description:
        "Create a price rule (percentage, fixed amount, or free shipping discount).",
      inputSchema: z.object({
        title: z.string().describe("Price rule title"),
        target_type: z
          .enum(["line_item", "shipping_line"])
          .describe("What the rule applies to"),
        target_selection: z
          .enum(["all", "entitled"])
          .describe("Which items the rule applies to"),
        allocation_method: z
          .enum(["across", "each"])
          .describe("How the discount is allocated"),
        value_type: z
          .enum(["percentage", "fixed_amount"])
          .describe("Type of discount value"),
        value: z
          .string()
          .describe('Discount value (negative, e.g. "-10.0")'),
        customer_selection: z
          .enum(["all", "prerequisite"])
          .describe("Which customers qualify"),
        starts_at: z
          .string()
          .optional()
          .describe("Start date (ISO 8601)"),
        ends_at: z
          .string()
          .optional()
          .describe("End date (ISO 8601)"),
        usage_limit: z
          .number()
          .optional()
          .describe("Max number of times the rule can be used"),
      }),
      execute: async (params) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/price_rules.json`,
            { body: { price_rule: params } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Discount Code ──────────────────────────────
    shopify_create_discount_code: createTool({
      id: "shopify-create-discount-code",
      description:
        "Create a discount code for a price rule.",
      inputSchema: z.object({
        price_rule_id: z.string().describe("The price rule ID"),
        code: z.string().describe("The discount code string"),
      }),
      execute: async ({ price_rule_id, code }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/price_rules/${sanitizeResourceId(price_rule_id)}/discount_codes.json`,
            { body: { discount_code: { code } } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Price Rules ──────────────────────────────────
    shopify_list_price_rules: createTool({
      id: "shopify-list-price-rules",
      description: "List all price rules.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe(
            "Max number of price rules to return (default 10)",
          ),
      }),
      execute: async ({ limit }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/price_rules.json`,
            { params: { limit } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Delete Price Rule ─────────────────────────────────
    shopify_delete_price_rule: createTool({
      id: "shopify-delete-price-rule",
      description:
        "Delete a price rule.",
      inputSchema: z.object({
        price_rule_id: z
          .string()
          .describe("The price rule ID to delete"),
      }),
      execute: async ({ price_rule_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "DELETE",
            `/admin/api/${API_VERSION}/price_rules/${sanitizeResourceId(price_rule_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
