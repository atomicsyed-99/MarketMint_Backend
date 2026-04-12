import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "../helpers";

const API_VERSION = "2026-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyInventoryTools(connectionId: string, providerConfigKey: string): Record<string, any> {
  return {
    // ── Get Inventory Levels ──────────────────────────────
    shopify_get_inventory_levels: createTool({
      id: "shopify-get-inventory-levels",
      description:
        "Get inventory levels for a specific inventory item across all locations.",
      inputSchema: z.object({
        inventory_item_ids: z
          .string()
          .describe("Comma-separated inventory item IDs"),
      }),
      execute: async ({ inventory_item_ids }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/inventory_levels.json`,
            { params: { inventory_item_ids } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Adjust Inventory ──────────────────────────────────
    shopify_adjust_inventory: createTool({
      id: "shopify-adjust-inventory",
      description:
        "Adjust inventory quantity for an item at a location.",
      inputSchema: z.object({
        inventory_item_id: z
          .string()
          .describe(
            "The inventory item ID (from variant.inventory_item_id)",
          ),
        location_id: z.string().describe("The location ID"),
        available_adjustment: z
          .number()
          .describe(
            "Amount to adjust by (positive to add, negative to subtract)",
          ),
      }),
      execute: async ({
        inventory_item_id,
        location_id,
        available_adjustment,
      }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/inventory_levels/adjust.json`,
            { body: { inventory_item_id, location_id, available_adjustment } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── List Locations ────────────────────────────────────
    shopify_list_locations: createTool({
      id: "shopify-list-locations",
      description:
        "List all store locations (for inventory management).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/locations.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Set Inventory Level ───────────────────────────────
    shopify_set_inventory_level: createTool({
      id: "shopify-set-inventory-level",
      description:
        "Set inventory to a specific quantity at a location.",
      inputSchema: z.object({
        inventory_item_id: z
          .string()
          .describe("The inventory item ID"),
        location_id: z.string().describe("The location ID"),
        available: z
          .number()
          .describe("The absolute quantity to set"),
      }),
      execute: async ({
        inventory_item_id,
        location_id,
        available,
      }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "POST",
            `/admin/api/${API_VERSION}/inventory_levels/set.json`,
            { body: { inventory_item_id, location_id, available } },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Get Inventory Item ────────────────────────────────
    shopify_get_inventory_item: createTool({
      id: "shopify-get-inventory-item",
      description:
        "Get details of an inventory item (cost, tracking, country of origin).",
      inputSchema: z.object({
        inventory_item_id: z
          .string()
          .describe("The inventory item ID"),
      }),
      execute: async ({ inventory_item_id }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "GET",
            `/admin/api/${API_VERSION}/inventory_items/${sanitizeResourceId(inventory_item_id)}.json`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    // ── Update Inventory Item ─────────────────────────────
    shopify_update_inventory_item: createTool({
      id: "shopify-update-inventory-item",
      description:
        "Update inventory item details (cost, tracking).",
      inputSchema: z.object({
        inventory_item_id: z
          .string()
          .describe("The inventory item ID"),
        cost: z.string().optional().describe("Cost per item"),
        tracked: z
          .boolean()
          .optional()
          .describe("Whether inventory is tracked"),
        country_code_of_origin: z
          .string()
          .optional()
          .describe(
            "Country code of origin (ISO 3166-1 alpha-2)",
          ),
      }),
      execute: async ({ inventory_item_id, ...updates }) => {
        try {
          return await nangoProxy(
            providerConfigKey,
            connectionId,
            "PUT",
            `/admin/api/${API_VERSION}/inventory_items/${sanitizeResourceId(inventory_item_id)}.json`,
            {
              body: {
                inventory_item: {
                  id: inventory_item_id,
                  ...updates,
                },
              },
            },
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
