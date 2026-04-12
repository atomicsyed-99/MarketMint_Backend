import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { downloadReel } from "../video/download-reel";
import { writeReelScript } from "../video/write-reel-script";
import { generateVideoFromReelScripts } from "./generate-from-reel-scripts";

export const recreateReel = createTool({
  id: "recreateReel",
  description:
    "Complete pipeline: download reel, analyze and generate script, generate new video with product images. Use when the user wants to recreate a reel with a new product.",
  inputSchema: z.object({
    reel_url: z.string().url().describe("Instagram reel URL"),
    product_description: z.string().describe("Description of the replacement product"),
    product_images: z.array(z.string().url()).describe("Reference images for the new product"),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    video_url: z.string().optional(),
    error: z.string().optional(),
    script: z.unknown().optional(),
  }),
  execute: async (input, context) => {
    const writer = context?.writer;
    const id = crypto.randomUUID();

    const emit = (status: string, description: string) => {
      writer?.custom({
        type: "data-agent-utility",
        data: {
          id,
          name: "recreateReel",
          title: "Reel Recreation",
          status,
          category: "workflow",
          description,
          web_urls: [{ url: input.reel_url }],
        },
      });
    };

    try {
      emit("running", "Downloading Instagram reel");

      const downloadResult = await downloadReel.execute({ url: input.reel_url }, context);
      const videoUrl = (downloadResult as { video_url?: string }).video_url;
      if (!videoUrl || (downloadResult as { error?: string }).error) {
        const err = (downloadResult as { error?: string }).error ?? "Download failed";
        emit("failed", err);
        return { status: "error" as const, error: err };
      }

      emit("running", "Reel downloaded");

      emit("running", "Analyzing reel and generating script");
      const scriptResult = await writeReelScript.execute(
        {
          url: videoUrl,
          product_description: input.product_description,
          product_images: input.product_images,
        },
        context
      );
      const segments = (scriptResult as { segments?: Array<{ scene_description?: string }> }).segments;
      const scriptStrs = segments?.map((s) => s.scene_description ?? "") ?? [];
      if ((scriptResult as { error?: string }).error) {
        emit("failed", (scriptResult as { error: string }).error);
        return {
          status: "error" as const,
          error: (scriptResult as { error: string }).error,
          script: scriptResult,
        };
      }

      emit("running", "Generating video from scripts");
      const videoResult = await generateVideoFromReelScripts.execute(
        {
          scripts: scriptStrs,
          reference_images: input.product_images,
        },
        context
      );

      if ((videoResult as { status: string }).status === "error") {
        const err = (videoResult as { error?: string }).error ?? "Video generation failed";
        emit("failed", err);
        return {
          status: "error" as const,
          error: err,
          script: { segments },
        };
      }

      const finalUrl = (videoResult as { video_url?: string }).video_url;
      emit("completed", "Reel recreated successfully");
      return {
        status: "success" as const,
        video_url: finalUrl,
        script: { segments },
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      emit("failed", err);
      return { status: "error" as const, error: err };
    }
  },
});
