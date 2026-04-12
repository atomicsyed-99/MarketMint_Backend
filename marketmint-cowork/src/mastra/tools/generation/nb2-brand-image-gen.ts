import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getBrandMemories } from "@/lib/brand-memories";
import {
  analyseBrandMemoryForNb2,
  normalizeNb2BrandAcknowledgement,
} from "@/lib/brand-memory-nb2-analysis";
import { runNb2BrandImageVariations } from "@/lib/nb2-brand-image-variations";
import { refreshSignedUrlFromUrl } from "@/lib/s3";
import { extractRequestContext } from "@/lib/artifact-upload";
import { notifyPythonStoreGeneratedAssets } from "@/lib/call-python-assets-credits";
import { createLogger } from "@/lib/logger";
import {
  extractChatImageAttachmentUrls,
  MAX_DIRECT_IMAGE_VARIATIONS,
  mergeAttachmentUrlsIntoDirectGenInputs,
  readAttachmentsFromRequestContext,
  resolveDirectImageNumVariations,
} from "@/lib/direct-image-gen-chat-context";
import { groundDeepWithChatAttachments } from "@/lib/ground-chat-attachment-urls";
import {
  stringFromRequestContext,
  workspaceIdFromRequestContext,
} from "@/lib/request-context-workspace";

const log = createLogger("nb2-brand-image-gen");

/**
 * NB2-only image path: workspace brand memory (GET …/workspace/{id}/brand-memories + X-API-KEY) →
 * GPT picks character/scene URLs + rephrased prompt → parallel Gemini image (Nanobanana) calls.
 * Same core pipeline as directImageGen; this tool returns prompt/asset debug fields for inspection.
 */
export const nb2BrandImageGen = createTool({
  id: "nb2BrandImageGen",
  description:
    "Generate image variations using brand memory + NB2 (Gemini image): loads saved brand JSON for the workspace, selects character/scene asset URLs for the user query, rephrases the prompt, and runs one image model call per variation. Prefer this over ad-hoc image tools when the user needs on-brand visuals. Returns prompts_used for debugging.",
  inputSchema: z.object({
    user_prompt: z.string(),
    asset_urls: z.array(z.string()).optional().default([]),
    reference_images: z.array(z.string()).optional().default([]),
    num_variations: z
      .number()
      .int()
      .min(1)
      .max(MAX_DIRECT_IMAGE_VARIATIONS)
      .optional(),
    aspect_ratio: z
      .enum(["1:1", "16:9", "9:16", "4:3", "3:4"])
      .optional()
      .default("1:1"),
    should_use_brand_memory: z
      .boolean()
      .optional()
      .default(false)
      .describe("Ignored — brand pipeline always runs when workspace is available."),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    images: z
      .array(z.object({ url: z.string(), id: z.string(), tag: z.string() }))
      .optional(),
    error: z.string().optional(),
    rephrased_prompt: z.string().optional(),
    prompts_used: z.array(z.string()).optional(),
    logo_asset_urls: z.array(z.string()).optional(),
    character_asset_urls: z.array(z.string()).optional(),
    scene_asset_urls: z.array(z.string()).optional(),
    acknowledgement: z.string().optional(),
    nb2_image_model: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cardId = crypto.randomUUID();
    const rc = context?.requestContext;
    const userId = stringFromRequestContext(rc, "userId");
    const workspaceIdForMem = workspaceIdFromRequestContext(rc) || undefined;
    let numVariations = resolveDirectImageNumVariations(
      input.num_variations,
      input.user_prompt,
    );
    if (numVariations === 0) numVariations = 1;

    let finalAssetUrls = [...(input.asset_urls ?? [])];
    let referenceImages = [...(input.reference_images ?? [])];
    const attachmentImageUrls = extractChatImageAttachmentUrls(
      readAttachmentsFromRequestContext(rc),
    );
    const merged = mergeAttachmentUrlsIntoDirectGenInputs({
      assetUrls: finalAssetUrls,
      referenceImages,
      attachmentImageUrls,
    });
    finalAssetUrls = merged.assetUrls;
    referenceImages = merged.referenceImages;

    if (attachmentImageUrls.length > 0) {
      const g = groundDeepWithChatAttachments(
        { asset_urls: finalAssetUrls, reference_images: referenceImages },
        attachmentImageUrls,
      ) as {
        asset_urls: string[];
        reference_images: string[];
      };
      finalAssetUrls = g.asset_urls;
      referenceImages = g.reference_images;
    }

    const writer = context?.writer?.custom?.bind(context.writer) as
      | ((msg: unknown) => void | Promise<void>)
      | undefined;

    let brandMemoryStructured: unknown | null = null;
    let precomputed:
      | Awaited<ReturnType<typeof analyseBrandMemoryForNb2>>
      | undefined;

    if (workspaceIdForMem) {
      try {
        const memories = await getBrandMemories(userId ?? "", workspaceIdForMem);
        if (memories.length > 0) {
          let raw = memories[0]?.content ?? null;
          if (typeof raw === "string") {
            try {
              raw = JSON.parse(raw);
            } catch {
              raw = { raw };
            }
          }
          brandMemoryStructured = raw;
          if (brandMemoryStructured) {
            const nb2Analysis = await analyseBrandMemoryForNb2(
              brandMemoryStructured,
              input.user_prompt,
            );
            precomputed = {
              ...nb2Analysis,
              acknowledgement: normalizeNb2BrandAcknowledgement(
                nb2Analysis.acknowledgement,
                brandMemoryStructured,
              ),
            };
          }
        }
      } catch (e) {
        log.warn({ err: e }, "nb2BrandImageGen: brand memory fetch/analysis failed");
      }
    }

    const nb2 = await runNb2BrandImageVariations({
      userPrompt: input.user_prompt,
      aspectRatio: input.aspect_ratio ?? "1:1",
      numVariations,
      assetUrls: finalAssetUrls,
      referenceImages,
      useBrandMemory: true,
      brandMemoryStructured,
      precomputedAnalysis: precomputed ?? null,
      masterCardId: cardId,
      writer,
    });

    const images: { url: string; id: string; tag: string }[] = [];
    for (const r of nb2.results) {
      if ("url" in r && r.url) {
        const url = r.url.startsWith("http")
          ? await refreshSignedUrlFromUrl(r.url).catch(() => r.url)
          : r.url;
        images.push({ url, id: r.id, tag: r.tag });
      }
    }

    if (images.length === 0) {
      return {
        status: "error" as const,
        error: nb2.error ?? "No images generated",
        rephrased_prompt: nb2.rephrased_prompt,
        prompts_used: nb2.prompts_used,
        logo_asset_urls: nb2.logo_asset_urls,
        character_asset_urls: nb2.character_asset_urls,
        scene_asset_urls: nb2.scene_asset_urls,
        acknowledgement: nb2.acknowledgement,
        nb2_image_model: nb2.nb2_image_model,
      };
    }

    const rcMeta = extractRequestContext(context);
    await notifyPythonStoreGeneratedAssets({
      chatId: rcMeta.chatId,
      messageId: rcMeta.messageId,
      workspaceId: rcMeta.workspaceId,
      toolName: "nb2BrandImageGen",
      assetData: images.map((i) => ({ url: i.url, id: i.id, type: "image" })),
      creditDeduction: { serviceName: "image_gen", quantity: images.length },
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
      images,
      rephrased_prompt: nb2.rephrased_prompt,
      prompts_used: nb2.prompts_used,
      logo_asset_urls: nb2.logo_asset_urls,
      character_asset_urls: nb2.character_asset_urls,
      scene_asset_urls: nb2.scene_asset_urls,
      acknowledgement: nb2.acknowledgement,
      nb2_image_model: nb2.nb2_image_model,
    };
  },
});
