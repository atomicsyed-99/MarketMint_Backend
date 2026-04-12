import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getBrandMemories } from "@/lib/brand-memories";
import { generateGrokVideo } from "@/lib/grok-video";
import { uploadToS3, refreshSignedUrl } from "@/lib/s3";
import { extractRequestContext } from "@/lib/artifact-upload";
import {
  stringFromRequestContext,
  valueFromRequestContext,
  workspaceIdFromRequestContext,
} from "@/lib/request-context-workspace";
import { notifyPythonStoreGeneratedAssets } from "@/lib/call-python-assets-credits";
import { createLogger } from "@/lib/logger";
import {
  extractAllChatAttachmentUrls,
  groundDeepWithChatAttachments,
} from "@/lib/ground-chat-attachment-urls";
import { readAttachmentsFromRequestContext } from "@/lib/direct-image-gen-chat-context";

const log = createLogger("video-single-shot");

function buildVideoPrompt(userRequest: string, brandContent: unknown): string {
  if (brandContent && typeof brandContent === "object") {
    return `Brand context (use for style, tone, and visual consistency):\n${JSON.stringify(brandContent)}\n\nUser request: ${userRequest}`;
  }
  return userRequest;
}

export const generateVideoSingleShot = createTool({
  id: "generateVideoSingleShot",
  description:
    "Generate a single video using Grok Imagine Video: user request, optional attached images, and brand memory. Duration 1-15 seconds, aspect ratio (e.g. 16:9, 9:16), resolution 480p/720p. Use for quick single-video requests (e.g. 'make a 10s product ad').",
  inputSchema: z.object({
    user_request: z.string().describe("Brief describing the desired video"),
    attachment_urls: z.array(z.string().url()).optional(),
    duration: z.number().int().min(1).max(15).optional().default(5),
    aspect_ratio: z.string().optional().default("16:9"),
    resolution: z.string().optional().default("480p"),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    video_url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cardId = crypto.randomUUID();
    const writer = context?.writer;
    const reqCtx = context?.requestContext;
    const userId = stringFromRequestContext(reqCtx, "userId");
    const workspaceIdForMem = workspaceIdFromRequestContext(reqCtx) || undefined;

    if (!userId) {
      return { status: "error" as const, error: "user_id required for single-shot video (brand memory)" };
    }

    const useBrandMemory = valueFromRequestContext(reqCtx, "directGenBm") !== false;
    let brandContent: unknown = null;
    let brandMemoryApplied = false;
    if (useBrandMemory) {
      try {
        const list = await getBrandMemories(userId, workspaceIdForMem);
        if (list.length > 0 && list[0].content) {
          brandContent = list[0].content;
          brandMemoryApplied = true;
        }
      } catch {
        // ignore
      }
    }

    const emit = (data: Record<string, unknown>) => {
      writer?.custom({
        type: "data-agent-utility",
        id: cardId,
        data: { name: "generateVideoSingleShot", ...data },
      });
    };

    emit({
      status: "running",
      title: "Video Generation",
      category: "generation",
      description: "Creating your video",
      steps: useBrandMemory
        ? [
            {
              id: "brand_memory",
              title: "Applying brand memory",
              status: "running",
            },
          ]
        : [],
    });

    const prompt = buildVideoPrompt(input.user_request, brandContent);
    const chatAtt = extractAllChatAttachmentUrls(
      readAttachmentsFromRequestContext(reqCtx),
    );
    let attachmentUrls = [...(input.attachment_urls ?? [])];
    if (chatAtt.length > 0) {
      attachmentUrls = groundDeepWithChatAttachments(
        attachmentUrls,
        chatAtt,
      ) as string[];
    }
    let primaryUrl = attachmentUrls[0];
    if (!primaryUrl && chatAtt.length > 0) {
      primaryUrl = chatAtt[0];
    }

    const result = await generateGrokVideo({
      prompt,
      image_url: primaryUrl,
      duration: input.duration ?? 5,
      aspect_ratio: input.aspect_ratio ?? "16:9",
      resolution: input.resolution ?? "480p",
      timeoutMs: 10 * 60 * 1000,
    });

    if ("error" in result) {
      emit({
        status: "failed",
        title: "Video Generation",
        category: "generation",
        description: result.error,
        error: result.error,
        steps: useBrandMemory
          ? [
              {
                id: "brand_memory",
                title: "Applying brand memory",
                status: "failed",
                error: result.error,
              },
            ]
          : [],
      });
      return { status: "error" as const, error: result.error };
    }

    let videoUrl = result.video_url;
    try {
      const videoRes = await fetch(videoUrl);
      if (videoRes.ok) {
        const buf = Buffer.from(await videoRes.arrayBuffer());
        const key = await uploadToS3(buf, `${crypto.randomUUID()}.mp4`, "video/mp4");
        videoUrl = await refreshSignedUrl(key);
      }
    } catch (e) {
      log.warn({ err: e }, "S3 upload failed, using temp URL");
    }

    const videoId = crypto.randomUUID();
    emit({
      status: "completed",
      title: "Video Generation",
      category: "generation",
      description: "Video ready",
      steps: useBrandMemory
        ? [
            {
              id: "brand_memory",
              title: "Applying brand memory",
              status: brandMemoryApplied ? "completed" : "skipped",
              ...(brandMemoryApplied
                ? {}
                : { description: "No brand memory rows for this workspace" }),
            },
          ]
        : [],
      output: { video_url: videoUrl },
    });

    writer?.custom({
      type: "data-video",
      id: videoId,
      data: {
        url: videoUrl,
        label: "Single-shot Video",
        status: "completed",
        aspectRatio: input.aspect_ratio ?? "16:9",
        enableEdit: false,
      },
    });

    const durationVal = input.duration ?? 5;
    const singleShotUnits = Math.max(1, Math.ceil(durationVal / 5));

    const rc = extractRequestContext(context);
    await notifyPythonStoreGeneratedAssets({
      chatId: rc.chatId,
      messageId: rc.messageId,
      workspaceId: rc.workspaceId,
      toolName: "generateVideoSingleShot",
      assetData: [{ url: videoUrl, id: videoId, type: "video" }],
      creditDeduction: { serviceName: "single_shot_video_gen", quantity: singleShotUnits },
      userEmail: rc.userEmail,
      userId: rc.userId,
      userAccessToken: rc.userAccessToken,
      executionSource: rc.executionSource,
      jobId: rc.jobId,
      runId: rc.runId,
      jobName: rc.jobName,
    });

    return { status: "success" as const, video_url: videoUrl };
  },
});
