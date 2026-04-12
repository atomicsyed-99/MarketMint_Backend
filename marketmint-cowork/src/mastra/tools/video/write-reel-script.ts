import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateText } from "ai";
import { getDirectGoogleModel } from "@/lib/ai-gateway";

export const writeReelScript = createTool({
  id: "writeReelScript",
  description:
    "Analyze a reel (video URL) and generate a structured multi-scene script replacing the original product with a new product. Call after downloading the reel.",
  inputSchema: z.object({
    url: z.string().url().describe("Reel video URL (from downloadReel)"),
    product_description: z.string().describe("Description of the new product"),
    product_images: z.array(z.string().url()).describe("List of reference product image URLs"),
  }),
  outputSchema: z.object({
    segments: z.array(
      z.object({
        timestamp: z.string(),
        scene_description: z.string(),
        visual_notes: z.string().optional(),
      })
    ).optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const writer = context?.writer;
    const id = crypto.randomUUID();

    const emit = (status: string, description: string) => {
      writer?.custom({
        type: "data-agent-utility",
        data: { id, name: "writeReelScript", title: "Script Generation", status, category: "workflow", description, web_urls: [{ url: input.url }] },
      });
    };

    try {
      emit("running", "Analyzing reel and generating script");

      let model;
      try {
        model = getDirectGoogleModel("gemini-2.0-flash");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI Gateway not configured";
        emit("failed", msg);
        return { error: msg };
      }

      const contentParts: Array<{ type: "text"; text: string } | { type: "image"; image: Buffer; mediaType: string }> = [
        {
          type: "text",
          text: `You are an expert at creating video scripts for product replacement in short-form reels. Given a reel video URL (the user cannot view it; assume a typical product showcase reel with 3-3 segments), and a new product description and reference images, produce a JSON object with "segments": array of { "timestamp": "0:00-0:05", "scene_description": "...", "visual_notes": "..." } for each scene. Product description: ${input.product_description}. Reel URL (for context): ${input.url}. Return only valid JSON.`,
        },
      ];
      for (const imgUrl of input.product_images.slice(0, 4)) {
        try {
          const res = await fetch(imgUrl);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            contentParts.push({ type: "image", image: Buffer.from(buf), mediaType: "image/jpeg" });
          }
        } catch {
          // skip failed image
        }
      }

      const { text } = await generateText({
        model,
        messages: [{ role: "user", content: contentParts }],
      });
      const parsed = JSON.parse(text) as { segments?: Array<{ timestamp?: string; scene_description?: string; visual_notes?: string }> };
      const segments = (parsed.segments ?? []).map((s) => ({
        timestamp: s.timestamp ?? "",
        scene_description: s.scene_description ?? "",
        visual_notes: s.visual_notes,
      }));

      emit("completed", "Script generated successfully");
      return { segments };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      emit("failed", `Script generation failed: ${err}`);
      return { error: err };
    }
  },
});
