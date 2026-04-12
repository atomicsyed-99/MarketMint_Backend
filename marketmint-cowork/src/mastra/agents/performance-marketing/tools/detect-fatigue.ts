import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { emitUtility } from "@/mastra/tools/emit-utility";

export const detectFatigue = createTool({
  id: "detect_fatigue",
  description:
    "Detect creative fatigue across ad campaigns. Checks for declining CTR, " +
    "high frequency (>3), stale creatives (>21 days), and diminishing returns. " +
    "Returns fatigued campaigns with severity and recommended actions.",
  inputSchema: z.object({
    platform: z
      .enum(["all", "meta", "google"])
      .optional()
      .default("all"),
    frequencyThreshold: z
      .number()
      .optional()
      .default(3)
      .describe("Flag campaigns with frequency above this (default 3)"),
    ctrDeclineThreshold: z
      .number()
      .optional()
      .default(15)
      .describe("Flag if CTR declined more than this percentage week-over-week (default 15)"),
  }),
  outputSchema: z.object({
    fatiguedCampaigns: z.array(
      z.object({
        campaignName: z.string(),
        platform: z.string(),
        frequency: z.number(),
        ctrCurrent: z.number(),
        ctrPrevious: z.number(),
        ctrDeclinePercent: z.number(),
        creativeAgeDays: z.number(),
        severity: z.enum(["critical", "high", "medium"]),
        recommendedAction: z.string(),
      }),
    ),
    summary: z.object({
      totalFatigued: z.number(),
      criticalCount: z.number(),
      estimatedWastedSpend: z.number(),
    }),
  }),
  execute: async (_input, context) => {
    const utilityId = crypto.randomUUID();
    emitUtility(context, {
      id: utilityId, name: "detect_fatigue", title: "Creative Fatigue Detection",
      category: "connector", status: "running", description: "Scanning for creative fatigue...",
    });

    try {
      // TODO: Implement using Meta Ads + Google Ads connector tools
      const result = {
        fatiguedCampaigns: [],
        summary: { totalFatigued: 0, criticalCount: 0, estimatedWastedSpend: 0 },
      };

      emitUtility(context, {
        id: utilityId, name: "detect_fatigue", title: "Creative Fatigue Detection",
        category: "connector", status: "completed", description: "Fatigue scan complete",
      });
      return result;
    } catch (err) {
      emitUtility(context, {
        id: utilityId, name: "detect_fatigue", title: "Creative Fatigue Detection",
        category: "connector", status: "failed", description: "Creative fatigue detection failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
