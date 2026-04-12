import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { emitUtility } from "@/mastra/tools/emit-utility";

/**
 * Computes aggregated store health signals from Shopify data.
 * This tool is a high-level diagnostic that the Store Manager agent
 * calls to get an overview before drilling into specifics.
 */
export const computeStoreSignals = createTool({
  id: "compute_store_signals",
  description:
    "Compute aggregated store health signals from connected Shopify data. " +
    "Returns metrics on product catalog completeness, inventory health, " +
    "order trends, and collection coverage. Use this as a first step " +
    "when auditing a store or answering questions about store health.",
  inputSchema: z.object({
    includeInventory: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include inventory level analysis"),
    includeOrders: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include recent order trend analysis"),
    dayRange: z
      .number()
      .optional()
      .default(30)
      .describe("Number of days to analyze for trends (default 30)"),
  }),
  outputSchema: z.object({
    catalog: z.object({
      totalProducts: z.number(),
      activeProducts: z.number(),
      draftProducts: z.number(),
      productsWithoutImages: z.number(),
      productsWithoutDescription: z.number(),
      avgVariantsPerProduct: z.number(),
      completenessScore: z
        .number()
        .describe("0-100 score based on image, description, and variant completeness"),
    }),
    inventory: z
      .object({
        totalTracked: z.number(),
        outOfStock: z.number(),
        lowStock: z.number().describe("Items with fewer than 5 units"),
        overstocked: z.number().describe("Items with more than 100 units"),
      })
      .optional(),
    orders: z
      .object({
        totalOrders: z.number(),
        totalRevenue: z.number(),
        avgOrderValue: z.number(),
        fulfillmentRate: z.number().describe("Percentage of orders fulfilled"),
      })
      .optional(),
    collections: z.object({
      totalCollections: z.number(),
      emptyCollections: z.number(),
      productsNotInCollection: z.number(),
    }),
    signals: z.array(
      z.object({
        type: z.enum(["critical", "warning", "info"]),
        message: z.string(),
      }),
    ),
  }),
  execute: async (_input, context) => {
    // TODO: Implement using Shopify connector tools from requestContext
    // For Phase 1, this returns a structured placeholder that demonstrates the contract.
    // The actual implementation will call Shopify APIs via connector tools.
    const utilityId = crypto.randomUUID();
    emitUtility(context, {
      id: utilityId, name: "compute_store_signals", title: "Store Health Signals",
      category: "connector", status: "running", description: "Analyzing store health signals...",
    });

    try {
      // Placeholder — will be replaced with real Shopify API calls
      const result = {
        catalog: {
          totalProducts: 0,
          activeProducts: 0,
          draftProducts: 0,
          productsWithoutImages: 0,
          productsWithoutDescription: 0,
          avgVariantsPerProduct: 0,
          completenessScore: 0,
        },
        inventory: {
          totalTracked: 0,
          outOfStock: 0,
          lowStock: 0,
          overstocked: 0,
        },
        orders: {
          totalOrders: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
          fulfillmentRate: 0,
        },
        collections: {
          totalCollections: 0,
          emptyCollections: 0,
          productsNotInCollection: 0,
        },
        signals: [
          {
            type: "info" as const,
            message: "Store signals tool is connected — awaiting Shopify data integration.",
          },
        ],
      };

      emitUtility(context, {
        id: utilityId, name: "compute_store_signals", title: "Store Health Signals",
        category: "connector", status: "completed", description: "Store health signals computed",
      });
      return result;
    } catch (err) {
      emitUtility(context, {
        id: utilityId, name: "compute_store_signals", title: "Store Health Signals",
        category: "connector", status: "failed", description: "Store health signal computation failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
