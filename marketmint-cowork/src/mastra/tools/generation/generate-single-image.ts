import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateOneImage } from "@/lib/gemini-image-gen";
import { extractRequestContext } from "@/lib/artifact-upload";
import { notifyPythonStoreGeneratedAssets } from "@/lib/call-python-assets-credits";
import { createLogger } from "@/lib/logger";
import { captureException } from "@/lib/sentry";

const log = createLogger("generate-single-image");

export const generateSingleImage = createTool({
  id: "generateSingleImage",
  description:
    "Generate a single image based on a concise user prompt. Use when only one output is required.",
  inputSchema: z.object({
    user_prompt: z.string().describe("Prompt describing the desired image"),
    aspect_ratio: z
      .enum(["1:1", "16:9", "9:16", "4:3", "3:4"])
      .optional()
      .default("1:1"),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    image_url: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cardId = crypto.randomUUID();
    const genId = crypto.randomUUID();
    const rcMeta = extractRequestContext(context);

    await context?.writer?.custom({
      type: "data-agent-utility",
      data: {
        id: cardId,
        name: "generateSingleImage",
        status: "running",
        category: "generation",
        title: "Single Image Generation",
        steps: [{ id: "generate", label: `Generating one image (${input.aspect_ratio})`, status: "running" }],
      },
    });

    try {
      const result = await generateOneImage({
        prompt: input.user_prompt,
        aspectRatio: input.aspect_ratio,
        tag: "single",
        generationId: genId,
      });

      await context?.writer?.custom({
        type: "data-image",
        data: { url: result.url, id: genId, tag: "single" },
      });

      await context?.writer?.custom({
        type: "data-agent-utility",
        data: {
          id: cardId,
          name: "generateSingleImage",
          status: "completed",
          category: "generation",
          title: "Single Image Generation",
          steps: [{ id: "generate", label: "Generation complete", status: "completed" }],
        },
      });

      await notifyPythonStoreGeneratedAssets({
        chatId: rcMeta.chatId,
        messageId: rcMeta.messageId,
        workspaceId: rcMeta.workspaceId,
        toolName: "generateSingleImage",
        assetData: [{ url: result.url, id: genId, type: "image" }],
        creditDeduction: { serviceName: "image_gen", quantity: 1 },
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
        image_url: result.url,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log.error({ err: e, userId: rcMeta.userId, prompt: input.user_prompt, aspectRatio: input.aspect_ratio }, "image generation failed");
      captureException(e, {
        userId: rcMeta.userId,
        tool: "generateSingleImage",
        chatId: rcMeta.chatId,
        workspaceId: rcMeta.workspaceId,
        prompt: input.user_prompt,
        aspectRatio: input.aspect_ratio,
      });
      await context?.writer?.custom({
        type: "data-agent-utility",
        data: {
          id: cardId,
          name: "generateSingleImage",
          status: "completed",
          category: "generation",
          title: "Single Image Generation",
          steps: [{ id: "generate", label: "Generation failed", status: "failed", error: err }],
        },
      });
      return { status: "error" as const, error: err };
    }
  },
});
