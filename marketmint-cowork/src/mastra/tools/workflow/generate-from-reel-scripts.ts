import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  extractAllChatAttachmentUrls,
  groundDeepWithChatAttachments,
} from "@/lib/ground-chat-attachment-urls";
import { readAttachmentsFromRequestContext } from "@/lib/direct-image-gen-chat-context";

/**
 * Full implementation would use Google Veo (generate_videos) to generate video per segment and stitch.
 * The Python backend uses genai.models.generate_videos (veo-3.1-generate-preview). The @google/genai
 * Node SDK may not yet expose video generation. This tool returns a clear error so the agent can fall back
 * or the user can use the Python flow.
 */
export const generateVideoFromReelScripts = createTool({
  id: "generateFromReelScripts",
  description:
    "Generate a final stitched vertical video from reel script segments. Each segment is generated sequentially. Requires reference_images (product images) and scripts (list of scene descriptions).",
  inputSchema: z.object({
    scripts: z.array(z.string()).describe("List of script segments (scene descriptions)"),
    reference_images: z.array(z.string().url()).describe("Product reference image URLs"),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    video_url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const writer = context?.writer;
    const id = crypto.randomUUID();

    const emit = (status: string, description: string, error?: string) => {
      writer?.custom({
        type: "data-agent-utility",
        data: {
          id,
          name: "generateFromReelScripts",
          title: "Script-to-Video",
          status,
          category: "workflow",
          description,
          ...(error && { error }),
        },
      });
    };

    const chatAtt = extractAllChatAttachmentUrls(
      readAttachmentsFromRequestContext(context?.requestContext),
    );
    let referenceImages = input.reference_images;
    if (chatAtt.length > 0) {
      referenceImages = groundDeepWithChatAttachments(
        referenceImages,
        chatAtt,
      ) as string[];
    }

    emit(
      "running",
      `Generating video from scripts (${referenceImages.length} reference image(s))`,
    );

    const msg =
      "Video generation from reel scripts (Veo) is not yet implemented in the TypeScript agent. Use the Python backend for full pipeline, or use generateVideoSingleShot for a single video.";
    emit("failed", msg, msg);
    return {
      status: "error" as const,
      error: msg,
    };
  },
});
