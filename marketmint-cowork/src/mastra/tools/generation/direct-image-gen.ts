import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getBrandMemories } from "@/lib/brand-memories";
import {
  analyseBrandMemoryForNb2,
  normalizeNb2BrandAcknowledgement,
} from "@/lib/brand-memory-nb2-analysis";
import { runNb2BrandImageVariations } from "@/lib/nb2-brand-image-variations";
import { refreshSignedUrl, refreshSignedUrlFromUrl } from "@/lib/s3";
import { extractRequestContext } from "@/lib/artifact-upload";
import { notifyPythonStoreGeneratedAssets } from "@/lib/call-python-assets-credits";
import { createLogger } from "@/lib/logger";
import { captureException } from "@/lib/sentry";
import {
  extractChatImageAttachmentUrls,
  MAX_DIRECT_IMAGE_VARIATIONS,
  mergeAttachmentUrlsIntoDirectGenInputs,
  normalizeDirectImageMultiBatch,
  readAttachmentsFromRequestContext,
  resolveDirectImageNumVariations,
} from "@/lib/direct-image-gen-chat-context";
import { groundDeepWithChatAttachments } from "@/lib/ground-chat-attachment-urls";
import {
  stringFromRequestContext,
  workspaceIdFromRequestContext,
} from "@/lib/request-context-workspace";

const log = createLogger("direct-image-gen");

/** Matches scripts/nb2-brand-debug.ts: always fetch workspace brand memory + NB2 GPT when possible. Toggle/flags ignored for now. */
const ALWAYS_RUN_BRAND_MEMORY_PIPELINE = true;

export const directImageGen = createTool({
  id: "directImageGen",
  description:
    "Generate image variations: loads workspace brand memory (same HTTP API as nb2-brand-debug), runs NB2 GPT to pick character/scene URLs and rephrase the prompt, then one Gemini image call per variation. Brand pipeline runs every time when workspace id is available in context.",
  inputSchema: z.object({
    user_prompt: z.string().describe("The prompt describing what to generate"),
    asset_urls: z.array(z.string()).optional().default([]),
    reference_images: z.array(z.string()).optional().default([]),
    acknowledgement: z.string().optional().default(""),
    num_variations: z
      .number()
      .int()
      .min(1)
      .max(MAX_DIRECT_IMAGE_VARIATIONS)
      .optional()
      .describe(
        "How many images to generate. If the user prompt states a count, that wins; otherwise default is 4. Omit when unsure.",
      ),
    aspect_ratio: z
      .enum(["1:1", "16:9", "9:16", "4:3", "3:4"])
      .optional()
      .default("1:1"),
    should_use_brand_memory: z
      .boolean()
      .optional()
      .default(false)
      .describe("Ignored for now — brand memory pipeline always runs when workspace is available."),
    task_group_id: z.string().optional().describe("Plan ID from displayPlan for multi-batch progress tracking"),
    batch_index: z.number().optional().describe("1-indexed batch number within the task group"),
    total_batches: z.number().optional().describe("Total number of batches planned in the task group"),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    images: z
      .array(z.object({ url: z.string(), id: z.string(), tag: z.string() }))
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const {
      taskGroupId,
      batchIndex,
      totalBatches,
    } = normalizeDirectImageMultiBatch({
      task_group_id: input.task_group_id,
      batch_index: input.batch_index,
      total_batches: input.total_batches,
    });
    if ((input.total_batches ?? 1) > 1 && totalBatches === 1) {
      log.info(
        { task_group_id: input.task_group_id },
        "directImageGen: multi-batch ignored without displayPlan task_group_id",
      );
    }
    const isFinalBatch = batchIndex >= totalBatches;
    const cardId = taskGroupId ?? crypto.randomUUID();
    const startedAt = Date.now();
    const rc = context?.requestContext;
    const userId = stringFromRequestContext(rc, "userId");
    const workspaceIdForMem = workspaceIdFromRequestContext(rc) || undefined;

    let finalAssetUrls = [...(input.asset_urls ?? [])];
    let referenceImages = [...(input.reference_images ?? [])];
    let brandMemoryStepInfo: { id: string; title: string; status: string; description?: string } | undefined;
    let brandMemoryStructured: unknown | null = null;
    let nb2Precomputed: Awaited<ReturnType<typeof analyseBrandMemoryForNb2>> | undefined;
    let brandMemoryStepAdded = false;

    const writer = context?.writer?.custom?.bind(context.writer) as
      | ((msg: unknown) => void | Promise<void>)
      | undefined;

    try {
      let numVariations = resolveDirectImageNumVariations(
        input.num_variations,
        input.user_prompt,
      );
      if (numVariations === 0) numVariations = 1;

      const attachmentImageUrls = extractChatImageAttachmentUrls(
        readAttachmentsFromRequestContext(rc),
      );
      const mergedInputs = mergeAttachmentUrlsIntoDirectGenInputs({
        assetUrls: finalAssetUrls,
        referenceImages,
        attachmentImageUrls,
      });
      finalAssetUrls = mergedInputs.assetUrls;
      referenceImages = mergedInputs.referenceImages;

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

      if (writer) {
        await writer({
          type: "data-agent-utility",
          id: cardId,
          data: {
            name: "directImageGen",
            title: "Image Generation",
            status: "running",
            category: "generation",
            description:
              attachmentImageUrls.length > 0
                ? `Invoking creative generation (${attachmentImageUrls.length} reference image URL(s) from chat applied)`
                : "Invoking creative generation",
            steps: [],
            chat_attachment_urls_applied: attachmentImageUrls,
          },
        });
      }

      // Same as scripts/nb2-brand-debug.ts: GET …/workspace/{id}/brand-memories → NB2 GPT → merge URLs → NB2 image.
      if (ALWAYS_RUN_BRAND_MEMORY_PIPELINE && workspaceIdForMem) {
        if (writer) {
          await writer({
            type: "data-agent-utility",
            id: cardId,
            data: {
              name: "directImageGen",
              title: "Image Generation",
              category: "generation",
              status: "running",
              description: "Invoking creative generation",
              steps: [
                { id: "brand_memory", title: "Applying brand memory", status: "running" },
              ],
            },
          });
          brandMemoryStepAdded = true;
        }

        try {
          const memories = await getBrandMemories(userId ?? "", workspaceIdForMem);
          if (memories.length === 0) {
            log.warn(
              { workspaceId: workspaceIdForMem },
              "directImageGen: brand memory API returned no rows",
            );
          }
          if (memories.length > 0) {
            const first = memories[0];
            let parsed: unknown = first?.content ?? null;
            if (typeof parsed === "string") {
              try {
                parsed = JSON.parse(parsed);
              } catch {
                parsed = { raw: parsed };
              }
            }
            brandMemoryStructured = parsed;
            if (brandMemoryStructured) {
              nb2Precomputed = await analyseBrandMemoryForNb2(
                brandMemoryStructured,
                input.user_prompt,
              );
              const ack = normalizeNb2BrandAcknowledgement(
                nb2Precomputed.acknowledgement ?? "",
                brandMemoryStructured,
              );
              nb2Precomputed = { ...nb2Precomputed, acknowledgement: ack };
              brandMemoryStepInfo = {
                id: "brand_memory",
                title: "Applying brand memory",
                status: "completed",
                description: ack || "Brand memory applied successfully",
              };
              log.info(
                {
                  rephrasedDiffersFromInput:
                    nb2Precomputed.rephrased_user_query.trim() !==
                    input.user_prompt.trim(),
                  rephrasedLen: nb2Precomputed.rephrased_user_query.length,
                  logoAssets: nb2Precomputed.logo_asset_urls.length,
                  characterAssets: nb2Precomputed.character_asset_urls.length,
                  sceneAssets: nb2Precomputed.scene_asset_urls.length,
                },
                "directImageGen NB2 brand analysis applied",
              );
            }
          }
        } catch (e) {
          log.warn({ err: e }, "brand memory fetch/analyze failed");
          if (brandMemoryStepAdded && writer) {
            await writer({
              type: "data-agent-utility",
              id: cardId,
              data: {
                name: "directImageGen",
                title: "Image Generation",
                category: "generation",
                status: "running",
                description: "Invoking creative generation",
                steps: [
                  {
                    id: "brand_memory",
                    title: "Applying brand memory",
                    status: "failed",
                    error: String(e),
                  },
                ],
              },
            });
          }
        }

        if (brandMemoryStepAdded && writer && !brandMemoryStepInfo) {
          await writer({
            type: "data-agent-utility",
            id: cardId,
            data: {
              name: "directImageGen",
              title: "Image Generation",
              category: "generation",
              status: "running",
              description: "Invoking creative generation",
              steps: [
                {
                  id: "brand_memory",
                  title: "Applying brand memory",
                  status: "skipped",
                  description: "No brand memory rows or empty content for this workspace",
                },
              ],
            },
          });
        }

        if (writer && brandMemoryStepInfo) {
          await writer({
            type: "data-agent-utility",
            id: cardId,
            data: {
              name: "directImageGen",
              title: "Image Generation",
              category: "generation",
              status: "running",
              description: "Invoking creative generation",
              steps: [brandMemoryStepInfo],
            },
          });
        }
      } else if (ALWAYS_RUN_BRAND_MEMORY_PIPELINE && !workspaceIdForMem) {
        log.warn(
          {},
          "directImageGen: requestContext missing workspaceId — cannot call brand memory API (same as debug script requirement)",
        );
      }

      const workflowResult = await runNb2BrandImageVariations({
        userPrompt: input.user_prompt,
        aspectRatio: input.aspect_ratio ?? "1:1",
        numVariations,
        assetUrls: finalAssetUrls,
        referenceImages,
        useBrandMemory: true,
        brandMemoryStructured,
        precomputedAnalysis: nb2Precomputed ?? null,
        masterCardId: cardId,
        writer,
      });

      const images: { url: string; id: string; tag: string }[] = [];
      for (const r of workflowResult.results) {
        if (!("url" in r) || !r.url) continue;
        const url = r.url;
        const id = r.id ?? crypto.randomUUID();
        const tag = r.tag ?? "generated";
        const refreshedUrl = url.startsWith("http")
          ? await refreshSignedUrlFromUrl(url).catch(() => url)
          : await refreshSignedUrl(url).catch(() => url);
        images.push({ url: refreshedUrl, id, tag });
      }

      const anySuccess = images.length > 0;

      if (taskGroupId && writer) {
        const batchDesc = isFinalBatch
          ? `All images generated (batch ${batchIndex} of ${totalBatches})`
          : `Batch ${batchIndex} of ${totalBatches} done (${images.length} images)`;
        await writer({
          type: "data-agent-utility",
          id: cardId,
          data: {
            name: "directImageGen",
            title: "Image Generation",
            status: isFinalBatch ? "completed" : "running",
            category: "generation",
            description: batchDesc,
            duration_ms: isFinalBatch ? Date.now() - startedAt : undefined,
          },
        });
      }

      if (!anySuccess) {
        const errorMsg = workflowResult.error ?? "NB2 image generation failed";
        log.error({ userId, prompt: input.user_prompt, numVariations, aspectRatio: input.aspect_ratio ?? "1:1", workflowError: errorMsg }, "all image variations failed");
        captureException(new Error(errorMsg), {
          userId,
          tool: "directImageGen",
          chatId: stringFromRequestContext(rc, "chatId"),
          workspaceId: workspaceIdForMem,
          prompt: input.user_prompt,
          numVariations,
          aspectRatio: input.aspect_ratio ?? "1:1",
          assetUrls: finalAssetUrls,
          workflowError: workflowResult,
        });
        return {
          status: "error" as const,
          error: errorMsg,
        };
      }

      log.info({ userId, prompt: input.user_prompt, numVariations, aspectRatio: input.aspect_ratio ?? "1:1", imageCount: images.length }, "image generation succeeded");

      if (images.length > 0) {
        const rcMeta = extractRequestContext(context);
        await notifyPythonStoreGeneratedAssets({
          chatId: rcMeta.chatId,
          messageId: rcMeta.messageId,
          workspaceId: rcMeta.workspaceId,
          toolName: "directImageGen",
          assetData: images.map((i) => ({ url: i.url, id: i.id, type: "image" })),
          creditDeduction: {
            serviceName: "image_gen",
            quantity: images.length,
          },
          userEmail: rcMeta.userEmail,
          userId: rcMeta.userId,
          userAccessToken: rcMeta.userAccessToken,
          executionSource: rcMeta.executionSource,
          jobId: rcMeta.jobId,
          runId: rcMeta.runId,
          jobName: rcMeta.jobName,
          taskGroupId: taskGroupId,
          batchIndex,
          totalBatches,
        });
      }

      return {
        status: "success" as const,
        images,
      };
    } catch (e: any) {
      const message =
        e?.message ?? "Image generation failed, please try again.";

      log.error({ err: e, userId, prompt: input.user_prompt, numVariations: input.num_variations ?? 3, aspectRatio: input.aspect_ratio ?? "1:1" }, "image generation failed");
      captureException(e, {
        userId,
        tool: "directImageGen",
        chatId: stringFromRequestContext(rc, "chatId"),
        workspaceId: workspaceIdForMem,
        prompt: input.user_prompt,
        numVariations: input.num_variations ?? 3,
        aspectRatio: input.aspect_ratio ?? "1:1",
        assetUrls: finalAssetUrls,
        referenceImages,
      });

      await context?.writer?.custom?.({
        type: "data-error",
        data: {
          message:
            "Image generation is currently experiencing issues. Please try again later.",
          detail: message,
          code: "GENERATION_FAILED",
          severity: "warning",
        },
      });

      await context?.writer?.custom?.({
        type: "data-agent-utility",
        id: cardId,
        data: {
          name: "directImageGen",
          category: "generation",
          status: "failed",
          title: "Image Generation",
          description: message,
          duration_ms: Date.now() - startedAt,
          steps: [
            {
              id: "brand_memory",
              title: "Applying brand memory",
              status: brandMemoryStepInfo ? "completed" : "skipped",
            },
            {
              id: "generate",
              title: "Generating images",
              status: "failed",
            },
          ],
          error: message,
        },
      });

      return {
        status: "error" as const,
        error: message,
      };
    }
  },
});
