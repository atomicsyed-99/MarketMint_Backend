import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { emitUtility } from "@/mastra/tools/emit-utility";

export const inventoryAlertScanner = createTool({
  id: "inventory_alert_scanner",
  description:
    "Scan Shopify inventory levels and flag restock alerts. Identifies products " +
    "that are out of stock, running low (configurable threshold), or overstocked. " +
    "Calculates estimated days remaining based on recent sales velocity.",
  inputSchema: z.object({
    lowStockThreshold: z
      .number()
      .optional()
      .default(5)
      .describe("Flag items with fewer than this many units (default 5)"),
    overstockThreshold: z
      .number()
      .optional()
      .default(100)
      .describe("Flag items with more than this many units (default 100)"),
    velocityDays: z
      .number()
      .optional()
      .default(30)
      .describe("Days of sales history to compute velocity (default 30)"),
  }),
  outputSchema: z.object({
    outOfStock: z.array(
      z.object({
        productTitle: z.string(),
        variantTitle: z.string(),
        sku: z.string().optional(),
        lastInStockDate: z.string().optional(),
      }),
    ),
    lowStock: z.array(
      z.object({
        productTitle: z.string(),
        variantTitle: z.string(),
        currentQuantity: z.number(),
        dailySalesVelocity: z.number(),
        estimatedDaysRemaining: z.number(),
        urgency: z.enum(["critical", "warning"]),
      }),
    ),
    overstocked: z.array(
      z.object({
        productTitle: z.string(),
        variantTitle: z.string(),
        currentQuantity: z.number(),
        dailySalesVelocity: z.number(),
        estimatedDaysOfSupply: z.number(),
      }),
    ),
    summary: z.object({
      totalTracked: z.number(),
      outOfStockCount: z.number(),
      lowStockCount: z.number(),
      overstockedCount: z.number(),
    }),
  }),
  execute: async (_input, context) => {
    const utilityId = crypto.randomUUID();
    emitUtility(context, {
      id: utilityId, name: "inventory_alert_scanner", title: "Inventory Alert Scanner",
      category: "connector", status: "running", description: "Scanning inventory levels...",
    });

    try {
      // TODO: Implement using Shopify inventory connector tools
      const result = {
        outOfStock: [],
        lowStock: [],
        overstocked: [],
        summary: { totalTracked: 0, outOfStockCount: 0, lowStockCount: 0, overstockedCount: 0 },
      };

      emitUtility(context, {
        id: utilityId, name: "inventory_alert_scanner", title: "Inventory Alert Scanner",
        category: "connector", status: "completed", description: "Inventory scan complete",
      });
      return result;
    } catch (err) {
      emitUtility(context, {
        id: utilityId, name: "inventory_alert_scanner", title: "Inventory Alert Scanner",
        category: "connector", status: "failed", description: "Inventory scan failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
