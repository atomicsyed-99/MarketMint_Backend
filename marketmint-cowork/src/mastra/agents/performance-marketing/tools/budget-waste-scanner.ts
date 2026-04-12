import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { emitUtility } from "@/mastra/tools/emit-utility";

export const budgetWasteScanner = createTool({
  id: "budget_waste_scanner",
  description:
    "Identify campaigns and ad sets wasting budget — high spend with low ROAS, " +
    "low conversion rate, or negligible click volume. Returns ranked list of " +
    "underperformers with estimated recoverable spend.",
  inputSchema: z.object({
    minDailySpend: z
      .number()
      .optional()
      .default(10)
      .describe("Only flag campaigns spending more than this per day (default $10)"),
    maxRoas: z
      .number()
      .optional()
      .default(1)
      .describe("Flag campaigns with ROAS below this threshold (default 1.0)"),
  }),
  outputSchema: z.object({
    wastefulCampaigns: z.array(
      z.object({
        name: z.string(),
        platform: z.string(),
        dailySpend: z.number(),
        roas: z.number(),
        ctr: z.number(),
        recommendation: z.string(),
      }),
    ),
    totalDailyWaste: z.number(),
    totalMonthlyWaste: z.number(),
  }),
  execute: async (_input, context) => {
    const utilityId = crypto.randomUUID();
    emitUtility(context, {
      id: utilityId, name: "budget_waste_scanner", title: "Budget Waste Scanner",
      category: "connector", status: "running", description: "Scanning for budget waste...",
    });

    try {
      // TODO: Implement using connector tools
      const result = {
        wastefulCampaigns: [],
        totalDailyWaste: 0,
        totalMonthlyWaste: 0,
      };

      emitUtility(context, {
        id: utilityId, name: "budget_waste_scanner", title: "Budget Waste Scanner",
        category: "connector", status: "completed", description: "Budget scan complete",
      });
      return result;
    } catch (err) {
      emitUtility(context, {
        id: utilityId, name: "budget_waste_scanner", title: "Budget Waste Scanner",
        category: "connector", status: "failed", description: "Budget waste scan failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
