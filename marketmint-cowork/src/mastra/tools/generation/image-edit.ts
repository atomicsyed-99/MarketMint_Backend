import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getPromptContent } from "@/lib/langsmith-prompts";
import { generateOneImage } from "@/lib/gemini-image-gen";
import { extractRequestContext } from "@/lib/artifact-upload";
import { notifyPythonStoreGeneratedAssets } from "@/lib/call-python-assets-credits";
import { generateText } from "ai";
import { getDirectGoogleModel } from "@/lib/ai-gateway";
import { createLogger } from "@/lib/logger";
import { captureException } from "@/lib/sentry";
import {
  extractAllChatAttachmentUrls,
  groundDeepWithChatAttachments,
} from "@/lib/ground-chat-attachment-urls";
import { readAttachmentsFromRequestContext } from "@/lib/direct-image-gen-chat-context";

const log = createLogger("image-edit");

export const imageEdit = createTool({
  id: "imageEdit",
  description:
    "Edit an existing image (e.g. background change, minor tweaks) based on user instructions. Pass the image URL and natural language edit instructions.",
  inputSchema: z.object({
    original_image_url: z.string().url().describe("The image to edit"),
    edit_instructions: z.string().describe("Natural language description of the desired edit"),
    aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional().default("1:1"),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    edited_image_url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cardId = crypto.randomUUID();
    const editedId = crypto.randomUUID();
    const rcMeta = extractRequestContext(context);

    const emit = (data: Record<string, unknown>) => {
      context?.writer?.custom({
        type: "data-agent-utility",
        id: cardId,
        data: {
          id: cardId,
          name: "imageEdit",
          status: "running",
          title: "Image Edit",
          category: "generation",
          ...data,
        },
      });
    };

    emit({ steps: [{ id: "edit", label: "Analyzing edit request", status: "running" }] });

    const chatAtt = extractAllChatAttachmentUrls(
      readAttachmentsFromRequestContext(context?.requestContext),
    );
    let originalImageUrl: string = input.original_image_url;
    if (chatAtt.length > 0) {
      const g = groundDeepWithChatAttachments(
        { original_image_url: originalImageUrl },
        chatAtt,
      ) as { original_image_url: string };
      originalImageUrl = g.original_image_url || input.original_image_url;
    }

    let systemPrompt: string;
    try {
      systemPrompt = await getPromptContent("workflows-image-edit");
    } catch {
      systemPrompt = `You are an image edit instruction refiner. Given a user's edit request and the original image context, output a single concise, high-quality edit instruction ready for an image generation model. Preserve subjects, composition, and realism. Output JSON: { "edit_instruction": "your instruction" }.`;
    }

    let model;
    try {
      model = getDirectGoogleModel("gemini-2.0-flash");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI Gateway not configured for image edit.";
      emit({ steps: [{ id: "edit", label: "Edit failed", status: "failed" }] });
      return { status: "error" as const, error: msg };
    }

    const imageRes = await fetch(originalImageUrl);
    const imageBuf = await imageRes.arrayBuffer();
    const { text: editText } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: systemPrompt + "\n\nUser edit request: " + input.edit_instructions + "\n\nOriginal image to be edited (provided as image)." },
            { type: "image", image: Buffer.from(imageBuf), mediaType: "image/jpeg" },
          ],
        },
      ],
    });
    let editInstruction = input.edit_instructions;
    try {
      const parsed = JSON.parse(editText) as { edit_instruction?: string };
      if (parsed.edit_instruction) editInstruction = parsed.edit_instruction;
    } catch {
      // use user text as fallback
    }

    emit({ steps: [{ id: "edit", label: "Editing image", status: "running" }] });

    try {
      const result = await generateOneImage({
        prompt: editInstruction,
        assetUrls: [originalImageUrl],
        aspectRatio: input.aspect_ratio ?? "1:1",
        tag: "edited",
        generationId: editedId,
      });

      context?.writer?.custom({
        type: "data-image",
        id: editedId,
        data: { url: result.url, id: editedId, tag: "edited" },
      });

      emit({ steps: [{ id: "edit", label: "Edit complete", status: "completed" }] });

      await notifyPythonStoreGeneratedAssets({
        chatId: rcMeta.chatId,
        messageId: rcMeta.messageId,
        workspaceId: rcMeta.workspaceId,
        toolName: "imageEdit",
        assetData: [{ url: result.url, id: editedId, type: "image" }],
        creditDeduction: { serviceName: "edit_image", quantity: 1 },
        userEmail: rcMeta.userEmail,
        userId: rcMeta.userId,
        userAccessToken: rcMeta.userAccessToken,
        executionSource: rcMeta.executionSource,
        jobId: rcMeta.jobId,
        runId: rcMeta.runId,
        jobName: rcMeta.jobName,
      });

      return {
        status: "success" as const,
        edited_image_url: result.url,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log.error({ err: e, userId: rcMeta.userId, editInstructions: input.edit_instructions, originalUrl: originalImageUrl }, "image edit failed");
      captureException(e, {
        userId: rcMeta.userId,
        tool: "imageEdit",
        chatId: rcMeta.chatId,
        workspaceId: rcMeta.workspaceId,
        editInstructions: input.edit_instructions,
        originalUrl: originalImageUrl,
        aspectRatio: input.aspect_ratio,
      });
      emit({ steps: [{ id: "edit", label: "Edit failed", status: "failed", error: err }] });
      return { status: "error" as const, error: err };
    }
  },
});
