import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "../helpers";

const API_VERSION = "2026-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyCollectionTools(connectionId: string, providerConfigKey: string): Record<string, any> {
  return {
    // ── List Collections ──────────────────────────────────
    shopify_list_collections: createTool({
      id: "shopify-list-collections",
      description:
        "List custom collections (manual product groupings).",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max collections to return"),
      }),
      execute: async ({ limit }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/custom_collections.json`,
            { params: { limit } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Smart Collections ────────────────────────────
    shopify_list_smart_collections: createTool({
      id: "shopify-list-smart-collections",
      description:
        "List smart collections (automated product groupings based on rules).",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max collections to return"),
      }),
      execute: async ({ limit }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/smart_collections.json`,
            { params: { limit } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Create Collection ─────────────────────────────────
    shopify_create_collection: createTool({
      id: "shopify-create-collection",
      description:
        "Create a custom collection.",
      inputSchema: z.object({
        title: z.string().describe("Collection title"),
        body_html: z
          .string()
          .optional()
          .describe("Collection description in HTML"),
        published: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to publish the collection (default true)",
          ),
        sort_order: z
          .enum([
            "alpha-asc",
            "alpha-desc",
            "best-selling",
            "created",
            "created-desc",
            "manual",
            "price-asc",
            "price-desc",
          ])
          .optional()
          .describe("Sort order for products in the collection"),
      }),
      execute: async ({ published, ...params }) => {
        try {
          const custom_collection: Record<string, unknown> = {
            ...params,
          };
          if (published !== false) {
            custom_collection.published_at = new Date().toISOString();
          } else {
            custom_collection.published_at = null;
          }
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/custom_collections.json`,
            { body: { custom_collection } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Update Collection ─────────────────────────────────
    shopify_update_collection: createTool({
      id: "shopify-update-collection",
      description:
        "Update a custom collection.",
      inputSchema: z.object({
        collection_id: z
          .string()
          .describe("The collection ID to update"),
        title: z
          .string()
          .optional()
          .describe("New collection title"),
        body_html: z
          .string()
          .optional()
          .describe("New collection description in HTML"),
        sort_order: z
          .enum([
            "alpha-asc",
            "alpha-desc",
            "best-selling",
            "created",
            "created-desc",
            "manual",
            "price-asc",
            "price-desc",
          ])
          .optional()
          .describe("Sort order for products"),
        published: z
          .boolean()
          .optional()
          .describe("Whether the collection is published"),
      }),
      execute: async ({ collection_id, published, ...updates }) => {
        try {
          const custom_collection: Record<string, unknown> = {
            id: collection_id,
            ...updates,
          };
          if (published === true) {
            custom_collection.published_at = new Date().toISOString();
          } else if (published === false) {
            custom_collection.published_at = null;
          }
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "PUT",
            `/admin/api/${API_VERSION}/custom_collections/${sanitizeResourceId(collection_id)}.json`,
            { body: { custom_collection } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Delete Collection ─────────────────────────────────
    shopify_delete_collection: createTool({
      id: "shopify-delete-collection",
      description:
        "Delete a custom collection.",
      inputSchema: z.object({
        collection_id: z
          .string()
          .describe("The collection ID to delete"),
      }),
      execute: async ({ collection_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "DELETE",
            `/admin/api/${API_VERSION}/custom_collections/${sanitizeResourceId(collection_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Add Product to Collection ─────────────────────────
    shopify_add_product_to_collection: createTool({
      id: "shopify-add-product-to-collection",
      description:
        "Add a product to a custom collection.",
      inputSchema: z.object({
        product_id: z.string().describe("The Shopify product ID"),
        collection_id: z.string().describe("The collection ID"),
      }),
      execute: async ({ product_id, collection_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/collects.json`,
            { body: { collect: { product_id, collection_id } } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Remove Product from Collection ────────────────────
    shopify_remove_product_from_collection: createTool({
      id: "shopify-remove-product-from-collection",
      description:
        "Remove a product from a collection. Note: requires the collect relationship ID, not the product or collection ID.",
      inputSchema: z.object({
        collect_id: z
          .string()
          .describe(
            "The collect relationship ID (use shopify_list_collects to find it)",
          ),
      }),
      execute: async ({ collect_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "DELETE",
            `/admin/api/${API_VERSION}/collects/${sanitizeResourceId(collect_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Collects ─────────────────────────────────────
    shopify_list_collects: createTool({
      id: "shopify-list-collects",
      description:
        "List product-collection relationships. Use this to find which products are in a collection or which collections a product belongs to.",
      inputSchema: z.object({
        collection_id: z
          .string()
          .optional()
          .describe("Filter by collection ID"),
        product_id: z
          .string()
          .optional()
          .describe("Filter by product ID"),
        limit: z
          .number()
          .optional()
          .default(50)
          .describe("Max results to return (default 50)"),
      }),
      execute: async ({ collection_id, product_id, limit }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/collects.json`,
            { params: { collection_id, product_id, limit } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
