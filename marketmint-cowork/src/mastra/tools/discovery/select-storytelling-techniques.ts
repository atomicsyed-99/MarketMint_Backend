import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { env } from "@/env";

const BACKEND_BASE = env.BACKEND_BASE_URL ?? "";

export const selectStorytellingTechniques = createTool({
  id: "select_storytelling_techniques",
  description:
    "Select 4 storytelling techniques (T01–T30) that best fit the brand, product, brief, and channels. Use for Creative Director skill when generating directions D5–D8.",
  inputSchema: z.object({
    brand_summary: z.string().describe("Short summary of the brand (tone, archetype, audience, visual style)"),
    product_summary: z.string().describe("What the product is, who it's for, key benefits and category"),
    campaign_context: z.string().describe("Brief text, objective, funnel stage if known, any constraints"),
    channels: z.array(z.string()).describe("List of channels (e.g. instagram_feed, website_hero, pdp)"),
  }),
  outputSchema: z.object({
    techniques: z.array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        category: z.string().optional(),
        why_selected: z.string().optional(),
        visual_signature: z.string().optional(),
        prompt_modifier: z.string().optional(),
      }),
    ),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cardId = crypto.randomUUID();
    const emit = async (status: "running" | "completed" | "failed", description: string) => {
      await context?.writer?.custom?.({
        type: "data-agent-utility",
        data: {
          id: cardId,
          name: "select_storytelling_techniques",
          status,
          title: "Storytelling Technique Selection",
          category: "planning",
          description,
        },
      });
    };

    await emit("running", "Selecting best-fit storytelling techniques");
    if (!BACKEND_BASE) {
      await emit("completed", "Storytelling service not configured");
      return { techniques: [] };
    }
    try {
      const res = await fetch(
        `${BACKEND_BASE.replace(/\/$/, "")}/internal/mastra/select-storytelling-techniques`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brand_summary: input.brand_summary,
            product_summary: input.product_summary,
            campaign_context: input.campaign_context,
            channels: input.channels,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        await emit("failed", "Storytelling technique selection failed");
        return { techniques: [], error: text.slice(0, 200) };
      }
      const data = (await res.json()) as { techniques?: unknown[]; error?: string };
      await emit("completed", "Storytelling techniques selected");
      return {
        techniques: Array.isArray(data.techniques) ? data.techniques : [],
        error: data.error,
      };
    } catch (e: any) {
      return {
        techniques: [],
        error: e?.message ?? "Failed to select storytelling techniques",
      };
    }
  },
});
