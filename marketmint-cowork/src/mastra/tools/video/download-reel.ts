import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ApifyClient } from "apify-client";
import { env } from "@/env";

export const downloadReel = createTool({
  id: "downloadReel",
  description:
    "Download an Instagram reel and return its direct video URL. Call before writing the script for the reel.",
  inputSchema: z.object({
    url: z.string().url().describe("Instagram reel URL"),
  }),
  outputSchema: z.object({
    video_url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const id = crypto.randomUUID();
    const writer = context?.writer;

    const emit = (status: string, description: string, web_urls?: { url: string }[], error?: string) => {
      writer?.custom({
        type: "data-agent-utility",
        data: {
          id,
          name: "downloadReel",
          title: "Reel Download",
          status,
          category: "workflow",
          description,
          ...(web_urls && { web_urls }),
          ...(error && { error }),
        },
      });
    };

    try {
      emit("running", `Downloading reel from ${input.url}`, [{ url: input.url }]);

      const apiKey = env.APIFY_API_KEY;
      if (!apiKey) {
        emit("failed", "APIFY_API_KEY is not set", undefined, "APIFY_API_KEY is not set");
        return { error: "APIFY_API_KEY is not set" };
      }

      const client = new ApifyClient({ token: apiKey });
      const run = await client.actor("apify/instagram-reel-scraper").call({
        username: [input.url],
        resultsLimit: 2,
        includeDownloadedVideo: true,
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems();
      const videoUrl = items[0] && (items[0] as { downloadedVideo?: string }).downloadedVideo;

      if (!videoUrl) {
        emit("failed", "Reel download failed", [{ url: input.url }], "No video URL in Apify result");
        return { error: "No video URL in Apify result" };
      }

      emit("completed", "Reel downloaded successfully", [{ url: videoUrl }]);
      return { video_url: videoUrl };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      emit("failed", "Reel download failed", [{ url: input.url }], err);
      return { error: err };
    }
  },
});
