import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { extractRequestContext } from "@/lib/artifact-upload";
import {
  extractAllChatAttachmentUrls,
  groundDeepWithChatAttachments,
} from "@/lib/ground-chat-attachment-urls";
import { readAttachmentsFromRequestContext } from "@/lib/direct-image-gen-chat-context";
import {
  deductTemplateVideoCredits,
  notifyPythonStoreGeneratedAssets,
} from "@/lib/call-python-assets-credits";
import { env } from "@/env";
import { stringFromRequestContext } from "@/lib/request-context-workspace";

const VIDEO_COPILOT_SERVICE_URL = env.VIDEO_COPILOT_SERVICE_URL ?? "";
const VIDEO_COPILOT_SERVICE_AUTH_KEY = env.VIDEO_COPILOT_SERVICE_AUTH_KEY?.trim() ?? "";
const VIDEO_COPILOT_TIMEOUT_SECONDS = env.VIDEO_COPILOT_TIMEOUT_SECONDS ?? 1200;

export const singleStepVideoGenerator = createTool({
  id: "singleStepVideoGenerator",
  description:
    "Generate a full video from a template and a product image in one step. Provide template_id (UUID from template service) and product_image_url (real https URL from the attachment). Optional: user_text (creative direction), orientation ('1:1' | '9:16' | '16:9'), music_url. Do not list these fields in the assistant message—pass them only in this tool call.",
  inputSchema: z.object({
    template_id: z
      .string()
      .optional()
      .describe(
        "Template UUID from the template service; optional if the request hidden payload already set template_id (server injects templateIdFromPayload).",
      ),
    product_image_url: z
      .string()
      .url()
      .optional()
      .describe(
        "Product image URL; optional if attachments include a non–template image (server injects productImageUrlFromTemplate).",
      ),
    user_text: z.string().optional().describe("Optional copy or script to include"),
    orientation: z.enum(["1:1", "9:16", "16:9"]).optional().default("1:1"),
    music_url: z.string().url().optional(),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    video_url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cardId = crypto.randomUUID();
    const writer = context?.writer;

    if (!VIDEO_COPILOT_SERVICE_URL) {
      return {
        status: "error" as const,
        error: "VIDEO_COPILOT_SERVICE_URL is not set; cannot call template video pipeline.",
      };
    }

    const emit = (data: Record<string, unknown>) => {
      writer?.custom({
        type: "data-agent-utility",
        data: { id: cardId, name: "singleStepVideoGenerator", ...data },
      });
    };

    emit({
      status: "running",
      title: "Template Video",
      category: "generation",
      description: "Running template-to-video pipeline",
      steps: [
        {
          id: "template_video",
          title: "Template video pipeline",
          status: "running",
          description: "Fetch template, adapt prompts, generate images and clips, stitch.",
        },
      ],
    });

    const reqCtx = context?.requestContext;
    const templateId = (
      input.template_id?.trim() ||
      stringFromRequestContext(reqCtx, "templateIdFromPayload") ||
      ""
    ).trim();
    if (!templateId) {
      return {
        status: "error" as const,
        error:
          "template_id is required (pass it or include template_id in the message <hidden> block).",
      };
    }

    let productImageUrl = (
      input.product_image_url?.trim() ||
      stringFromRequestContext(reqCtx, "productImageUrlFromTemplate") ||
      ""
    ).trim();
    if (!productImageUrl) {
      return {
        status: "error" as const,
        error:
          "product_image_url is required (pass it or attach a product image; template reference media is skipped).",
      };
    }

    const chatAtt = extractAllChatAttachmentUrls(
      readAttachmentsFromRequestContext(context?.requestContext),
    );
    if (chatAtt.length > 0) {
      productImageUrl = (
        groundDeepWithChatAttachments(
          { product_image_url: productImageUrl, music_url: input.music_url },
          chatAtt,
        ) as { product_image_url: string; music_url?: string }
      ).product_image_url;
    }

    try {
      const url = `${VIDEO_COPILOT_SERVICE_URL.replace(/\/$/, "")}/v2/template-video`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), VIDEO_COPILOT_TIMEOUT_SECONDS * 1000);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (VIDEO_COPILOT_SERVICE_AUTH_KEY) {
        headers["X-API-Key"] = VIDEO_COPILOT_SERVICE_AUTH_KEY;
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          template_id: templateId,
          product_image_url: productImageUrl,
          user_text: input.user_text ?? null,
          orientation: input.orientation ?? "1:1",
          music_url: input.music_url ?? null,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const result = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        final_video_url?: string;
        template_name?: string;
        error?: string;
      };

      if (res.status !== 200) {
        const err = result.error ?? `HTTP ${res.status}`;
        emit({
          status: "failed",
          title: "Template Video",
      category: "generation",
          description: err,
          steps: [{ id: "template_video", title: "Template video pipeline", status: "failed", error: err }],
        });
        return { status: "error" as const, error: err };
      }

      const success = result.success === true;
      const video_url = result.final_video_url;

      if (!success || !video_url) {
        const err = result.error ?? "Pipeline did not return a video URL.";
        emit({
          status: "failed",
          title: "Template Video",
      category: "generation",
          description: err,
          steps: [{ id: "template_video", title: "Template video pipeline", status: "failed", error: err }],
        });
        return { status: "error" as const, error: err, video_url: undefined };
      }

      const videoId = crypto.randomUUID();
      emit({
        status: "completed",
        title: "Template Video",
      category: "generation",
        description: "Video ready",
        steps: [
          {
            id: "template_video",
            title: "Template video pipeline",
            status: "completed",
            description: "Video ready",
            output: { video_url, template_name: result.template_name },
          },
        ],
      });

      writer?.custom({
        type: "data-video",
        data: {
          id: videoId,
          url: video_url,
          label: "Template Video",
          status: "completed",
          aspectRatio: input.orientation ?? "1:1",
          enableEdit: false,
        },
      });

      const rc = extractRequestContext(context);
      await notifyPythonStoreGeneratedAssets({
        chatId: rc.chatId,
        messageId: rc.messageId,
        workspaceId: rc.workspaceId,
        toolName: "singleStepVideoGenerator",
        assetData: [{ url: video_url, id: videoId, type: "video" }],
        userEmail: rc.userEmail,
        userId: rc.userId,
        userAccessToken: rc.userAccessToken,
        executionSource: rc.executionSource,
        jobId: rc.jobId,
        runId: rc.runId,
        jobName: rc.jobName,
      });

      if (rc.userEmail?.trim() && rc.workspaceId?.trim() && rc.chatId?.trim()) {
        await deductTemplateVideoCredits({
          email: rc.userEmail,
          workspaceId: rc.workspaceId,
          templateId: templateId,
          chatId: rc.chatId,
          idempotencyKey: `${rc.messageId ?? ""}:singleStepVideoGenerator:${templateId}`,
          userAccessToken: rc.userAccessToken,
        });
      }

      return { status: "success" as const, video_url };
    } catch (e) {
      const base = e instanceof Error ? e.message : String(e);
      const cause =
        e instanceof Error && "cause" in e && e.cause instanceof Error
          ? ` (${e.cause.message})`
          : "";
      const err = `${base}${cause}`;
      emit({
        status: "failed",
        title: "Template Video",
      category: "generation",
        description: err,
        error: err,
        steps: [{ id: "template_video", title: "Template video pipeline", status: "failed", error: err }],
      });
      return { status: "error" as const, error: err };
    }
  },
});
