import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGuidelines, AVAILABLE_MODULES } from "@/lib/guidelines";

export const readGuidelines = createTool({
  id: "readGuidelines",
  description:
    "Load design guidelines for generating visual widgets. Call this ONCE before your first createInteractiveView call. " +
    "Do NOT mention this call to the user — it is an internal setup step. " +
    "Pick modules matching your use case: chart (Chart.js data viz), mockup (dashboards, tables, KPI cards), " +
    "interactive (sliders, calculators), diagram (SVG flowcharts), art (illustrations).",
  inputSchema: z.object({
    modules: z
      .array(z.enum(AVAILABLE_MODULES))
      .min(1)
      .describe("Which guideline modules to load. At least one required."),
  }),
  outputSchema: z.object({
    guidelines: z.string(),
    loaded_modules: z.array(z.string()),
    note: z.string(),
  }),
  execute: async (input, _context) => {
    const content = getGuidelines(input.modules);
    return {
      guidelines: content,
      loaded_modules: input.modules,
      note: "Guidelines loaded. You may now call createInteractiveView. Set has_read_guidelines: true.",
    };
  },
});
