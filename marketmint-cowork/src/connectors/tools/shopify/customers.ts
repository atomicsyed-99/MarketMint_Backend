import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "../helpers";

const API_VERSION = "2026-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyCustomerTools(connectionId: string, providerConfigKey: string): Record<string, any> {
  return {
    // ── List Customers ────────────────────────────────────
    shopify_list_customers: createTool({
      id: "shopify-list-customers",
      description: "List customers from the Shopify store.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max customers to return"),
      }),
      execute: async ({ limit }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/customers.json`,
            { params: { limit } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Search Customers ──────────────────────────────────
    shopify_search_customers: createTool({
      id: "shopify-search-customers",
      description: "Search customers by query (name, email, etc).",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search query (e.g., email, name)"),
      }),
      execute: async ({ query }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/customers/search.json`,
            { params: { query } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Customer ───────────────────────────────────
    shopify_create_customer: createTool({
      id: "shopify-create-customer",
      description:
        "Create a new customer.",
      inputSchema: z.object({
        first_name: z
          .string()
          .optional()
          .describe("Customer first name"),
        last_name: z
          .string()
          .optional()
          .describe("Customer last name"),
        email: z
          .string()
          .optional()
          .describe("Customer email"),
        phone: z
          .string()
          .optional()
          .describe("Customer phone number"),
        tags: z
          .string()
          .optional()
          .describe("Comma-separated tags"),
        note: z
          .string()
          .optional()
          .describe("Note about the customer"),
        accepts_marketing: z
          .boolean()
          .optional()
          .describe("Whether customer accepts marketing"),
      }),
      execute: async (params) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/customers.json`,
            { body: { customer: params } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Update Customer ───────────────────────────────────
    shopify_update_customer: createTool({
      id: "shopify-update-customer",
      description:
        "Update an existing customer.",
      inputSchema: z.object({
        customer_id: z
          .string()
          .describe("The Shopify customer ID"),
        first_name: z
          .string()
          .optional()
          .describe("Customer first name"),
        last_name: z
          .string()
          .optional()
          .describe("Customer last name"),
        email: z
          .string()
          .optional()
          .describe("Customer email"),
        phone: z
          .string()
          .optional()
          .describe("Customer phone number"),
        tags: z
          .string()
          .optional()
          .describe("Comma-separated tags"),
        note: z
          .string()
          .optional()
          .describe("Note about the customer"),
        accepts_marketing: z
          .boolean()
          .optional()
          .describe("Whether customer accepts marketing"),
      }),
      execute: async ({ customer_id, ...updates }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "PUT",
            `/admin/api/${API_VERSION}/customers/${sanitizeResourceId(customer_id)}.json`,
            {
              body: {
                customer: { id: customer_id, ...updates },
              },
            },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Get Customer ──────────────────────────────────────
    shopify_get_customer: createTool({
      id: "shopify-get-customer",
      description: "Get a single customer by ID.",
      inputSchema: z.object({
        customer_id: z
          .string()
          .describe("The Shopify customer ID"),
      }),
      execute: async ({ customer_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/customers/${sanitizeResourceId(customer_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Count Customers ───────────────────────────────────
    shopify_count_customers: createTool({
      id: "shopify-count-customers",
      description: "Get a count of customers.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/customers/count.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
