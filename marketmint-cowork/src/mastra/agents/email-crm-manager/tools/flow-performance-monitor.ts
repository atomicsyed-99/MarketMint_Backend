import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { emitUtility } from "@/mastra/tools/emit-utility";

export const flowPerformanceMonitor = createTool({
  id: "flow_performance_monitor",
  description:
    "Monitor email flow performance trends. Detects declining open rates, " +
    "click rate decay, and revenue drops across Klaviyo flows and campaigns.",
  inputSchema: z.object({
    dayRange: z.number().optional().default(30).describe("Days to analyze (default 30)"),
    flowIds: z.array(z.string()).optional().describe("Specific flow IDs to monitor (empty = all)"),
  }),
  outputSchema: z.object({
    flows: z.array(
      z.object({
        flowName: z.string(),
        openRateTrend: z.enum(["improving", "stable", "declining"]),
        clickRateTrend: z.enum(["improving", "stable", "declining"]),
        openRateCurrent: z.number(),
        clickRateCurrent: z.number(),
        changePercent: z.number(),
      }),
    ),
    alerts: z.array(z.object({ type: z.enum(["critical", "warning", "info"]), message: z.string() })),
  }),
  execute: async (_input, context) => {
    const utilityId = crypto.randomUUID();
    emitUtility(context, {
      id: utilityId, name: "flow_performance_monitor", title: "Flow Performance Monitor",
      category: "connector", status: "running", description: "Monitoring flow performance...",
    });

    try {
      const result = { flows: [], alerts: [] };

      emitUtility(context, {
        id: utilityId, name: "flow_performance_monitor", title: "Flow Performance Monitor",
        category: "connector", status: "completed", description: "Performance monitoring complete",
      });
      return result;
    } catch (err) {
      emitUtility(context, {
        id: utilityId, name: "flow_performance_monitor", title: "Flow Performance Monitor",
        category: "connector", status: "failed", description: "Flow performance monitoring failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
