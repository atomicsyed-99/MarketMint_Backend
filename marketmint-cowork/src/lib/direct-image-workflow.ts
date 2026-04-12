/**
 * Enhanced image generation workflow — full parity with Python app.workflows.direct_image_gen.
 * 1. Creative Director: Gemini analyzes request and produces variation prompts (MarketmintPromptResponse).
 * 2. Concurrent generation: one Gemini image per variation with variation.image_prompt.
 * Uses same models as Python: Gemini 2.5 Flash for analysis, Gemini image model for generation.
 */

import { generateText, type LanguageModel } from "ai";
import { generateOneImage } from "./gemini-image-gen";
import { getDirectGoogleModel } from "./ai-gateway";
import { createLogger } from "./logger";
import { captureException } from "./sentry";

const log = createLogger("direct-image-workflow");

// --- Types matching Python app.workflows.direct_image_gen ---
export interface AssetAnalysis {
  asset_number: number;
  role: string;
  notes: string;
}

export interface UnderstandingSection {
  user_message: string;
  asset_analysis: AssetAnalysis[];
  assumptions: string;
}

export interface VariationItem {
  name: string;
  creative_summary: string;
  user_facing_text: string;
  image_prompt: string;
}

export interface MarketmintPromptResponse {
  understanding: UnderstandingSection;
  user_facing_message: string;
  variations: VariationItem[];
}

// Python: prompt_hub.get("workflows-direct-image-gen") — inline equivalent
const WORKFLOWS_DIRECT_IMAGE_GEN_BASE = `You are the Marketmint image pipeline. Given a user's image generation request and optional asset/reference images, produce a structured response.

Output a JSON object with:
- "understanding": { "user_message": string, "asset_analysis": [{"asset_number": 1, "role": string, "notes": string}], "assumptions": string }
- "user_facing_message": string (brief message for the user about what you're creating)
- "variations": array of { "name": string, "creative_summary": string, "user_facing_text": string, "image_prompt": string }
Each variation's "image_prompt" must be a full, detailed prompt for the image generator (style, composition, lighting, subject). Use the user request and assets to inform each variation.`;

export type StreamWriter = (msg: { type: string; id?: string; data?: unknown }) => void | Promise<void>;

export type AgentUtilityStep = { id: string; title?: string; label?: string; status: string; description?: string; duration_ms?: number; error?: string };

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Creative Director returns per-variation `image_prompt` strings; those are the only prompts
 * passed to Gemini image generation. Brand memory enrichment lives on `userPrompt` before CD
 * runs — CD often generalizes and drops brand specifics, so we re-attach the brief here.
 */
function mergeBrandBriefIntoVariationPrompts(
  response: MarketmintPromptResponse,
  brandBrief: string,
): MarketmintPromptResponse {
  const brief = brandBrief.trim();
  if (!brief) return response;
  const marker = "[On-brand requirements — apply strictly]";
  return {
    ...response,
    variations: response.variations.map((v) => {
      const base = v.image_prompt.trim();
      if (base.includes(marker)) {
        return v;
      }
      return {
        ...v,
        image_prompt: `${base}\n\n${marker}\n${brief}`,
      };
    }),
  };
}

function parseMarketmintPromptResponse(text: string): MarketmintPromptResponse | null {
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) return null;
  try {
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as MarketmintPromptResponse;
    if (!parsed.understanding || !Array.isArray(parsed.variations)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const FALLBACK_RESPONSE = (userPrompt: string): MarketmintPromptResponse => ({
  understanding: {
    user_message: userPrompt,
    asset_analysis: [],
    assumptions: "Fallback due to analysis error",
  },
  user_facing_message: "Analysis failed, generating a basic fallback image.",
  variations: [
    {
      name: "Basic Generation",
      creative_summary: "Fallback generation",
      user_facing_text: "Basic image generation",
      image_prompt: `Create a professional image based on: ${userPrompt}`,
    },
  ],
});

const BRAND_MEMORY_CD_SYSTEM_APPEND = `
CRITICAL (brand memory): The user request may include non-negotiable brand guidelines (palette, logos, typography, characters, scenes). Every variation's "image_prompt" must explicitly reflect those guidelines. Do not replace them with generic stock marketing aesthetics.`;

export interface AnalyzeAndCreateVariationsParams {
  userPrompt: string;
  assetUrls: string[];
  referenceImages: string[];
  numVariations: number;
  writer?: StreamWriter;
  useV2Format?: boolean;
  isMasterCard?: boolean;
  toolId?: string;
  /** When set, tighten Creative Director instructions so it does not wash out brand-specific text before image gen. */
  preserveBrandMemoryConstraints?: boolean;
}

export async function analyzeAndCreateVariations(
  params: AnalyzeAndCreateVariationsParams,
): Promise<{ response: MarketmintPromptResponse; assetUrls: string[]; referenceImages: string[] }> {
  const {
    userPrompt,
    assetUrls,
    referenceImages,
    numVariations,
    writer,
    useV2Format,
    isMasterCard,
    toolId,
    preserveBrandMemoryConstraints,
  } = params;
  let currentAssetUrls = [...assetUrls];
  let currentReferenceImages = [...referenceImages];

  if (!isMasterCard && useV2Format && writer && toolId) {
    await writer({
      type: "data-agent-utility",
      id: toolId,
      data: {
        name: "directImageGen",
        status: "loaded",
        title: "Image Generation",
        category: "generation",
        description: "About to analyze request",
        steps: [{ id: "analysis", title: "Analyzing Request", status: "pending" }],
      },
    });
    await writer({
      type: "data-agent-utility",
      id: toolId,
      data: {
        name: "directImageGen",
        status: "running",
        title: "Image Generation",
        category: "generation",
        description: "Understanding your request and preparing creative variations",
        steps: [{ id: "analysis", title: "Analyzing Request", status: "running" }],
      },
    });
  }

  const systemPrompt = `${WORKFLOWS_DIRECT_IMAGE_GEN_BASE}${preserveBrandMemoryConstraints ? BRAND_MEMORY_CD_SYSTEM_APPEND : ""}

CRITICAL: Generate exactly ${numVariations} creative variations — no more, no less. This parameter takes ABSOLUTE PRIORITY. Even if the request is an edit-style request (e.g., 'change color', 'make brighter'), you MUST still generate exactly ${numVariations} variations when ${numVariations} > 0. Only return empty variations array when ${numVariations} = 0.`;

  const runAnalysis = async (assets: string[], refs: string[]) => {
    const model = getDirectGoogleModel("gemini-2.5-flash");

    type TextPart = { type: "text"; text: string };
    type ImagePart = { type: "image"; image: Buffer; mediaType: "image/jpeg" };
    const contentParts: Array<TextPart | ImagePart> = [];

    contentParts.push({
      type: "text",
      text: systemPrompt +
        "\n\nUser request:\n" +
        userPrompt +
        (assets.length || refs.length
          ? "\n\nThe following images are the asset and reference images (in order)."
          : ""),
    });

    for (const url of [...assets, ...refs]) {
      const bytes = await fetchImageBytes(url);
      if (bytes) {
        contentParts.push({ type: "image", image: Buffer.from(bytes), mediaType: "image/jpeg" });
      }
    }

    const { text } = await generateText({
      model: model as LanguageModel,
      messages: [{ role: "user", content: contentParts }],
      maxOutputTokens: 8192,
    });

    return parseMarketmintPromptResponse(text);
  };

  let response: MarketmintPromptResponse | null = null;
  try {
    response = await runAnalysis(currentAssetUrls, currentReferenceImages);
  } catch (e: any) {
    const errorText = String(e?.message ?? e);
    log.error({ err: e, userPrompt, assetUrls: currentAssetUrls, referenceImages: currentReferenceImages }, "creative director analysis failed");
    captureException(e, { stage: "creative_director_analysis", userPrompt, assetUrls: currentAssetUrls, numVariations });
    const badAssets = currentAssetUrls.filter((u) => u && errorText.includes(u));
    const badRefs = currentReferenceImages.filter((u) => u && errorText.includes(u));
    if ((badAssets.length || badRefs.length) > 0) {
      currentAssetUrls = currentAssetUrls.filter((u) => !badAssets.includes(u));
      currentReferenceImages = currentReferenceImages.filter((u) => !badRefs.includes(u));
      if (currentAssetUrls.length || currentReferenceImages.length) {
        try {
          response = await runAnalysis(currentAssetUrls, currentReferenceImages);
        } catch (retryErr) {
          log.error({ err: retryErr, userPrompt }, "creative director analysis retry also failed");
          response = null;
        }
      }
    }
  }

  const analysisDurationMs = 0; // optional to track
  if (response) {
    if (!isMasterCard && useV2Format && writer && toolId) {
      await writer({
        type: "data-agent-utility",
        id: toolId,
        data: {
          name: "directImageGen",
          status: "completed",
          title: "Image Generation",
        category: "generation",
          description: `Generated ${response.variations.length} creative variations`,
          steps: [{ id: "analysis", title: "Analyzing Request", status: "completed", duration_ms: analysisDurationMs }],
          duration_ms: analysisDurationMs,
          output: { variations_count: response.variations.length },
        },
      });
    }
    return {
      response: {
        ...response,
        variations: response.variations.slice(0, numVariations),
      },
      assetUrls: currentAssetUrls,
      referenceImages: currentReferenceImages,
    };
  }

  if (!isMasterCard && useV2Format && writer && toolId) {
    await writer({
      type: "data-agent-utility",
      id: toolId,
      data: {
        name: "directImageGen",
        status: "failed",
        title: "Image Generation",
        category: "generation",
        description: "Analysis failed, generating a basic fallback image.",
        steps: [{ id: "analysis", title: "Analyzing Request", status: "failed" }],
        error: "Analysis failed",
      },
    });
  }
  return {
    response: FALLBACK_RESPONSE(userPrompt),
    assetUrls: currentAssetUrls,
    referenceImages: currentReferenceImages,
  };
}

export interface GenerateConcurrentImagesParams {
  response: MarketmintPromptResponse;
  assetUrls: string[];
  referenceImages: string[];
  aspectRatio: string;
  writer?: StreamWriter;
  useV2Format?: boolean;
  isMasterCard?: boolean;
  toolId?: string;
  existingSteps?: AgentUtilityStep[];
  /** Wall time when the pipeline started (analysis + generation); used for final duration_ms. */
  pipelineStartedAt?: number;
}

export async function generateConcurrentImages(
  params: GenerateConcurrentImagesParams,
): Promise<{ results: Array<{ url?: string; id?: string; tag?: string; error?: string }> }> {
  const {
    response,
    assetUrls,
    referenceImages,
    aspectRatio,
    writer,
    useV2Format,
    isMasterCard,
    toolId,
    existingSteps,
    pipelineStartedAt,
  } = params;
  const numVariations = response.variations.length;
  const allUrls = [...assetUrls, ...referenceImages];

  const variationSteps: AgentUtilityStep[] = response.variations.map((v, i) => ({
    id: `var_${i}`,
    title: v.name ? `Generating ${i + 1} of ${numVariations} — ${v.name}` : `Generating variation ${i + 1} of ${numVariations}`,
    status: "pending",
  }));
  const steps = isMasterCard && existingSteps?.length ? [...existingSteps, ...variationSteps] : variationSteps;

  // Master card: show all variation steps as running in one update (avoids N duplicate utility events from parallel starts).
  if (isMasterCard) {
    for (const s of variationSteps) {
      s.status = "running";
    }
  }

  if (useV2Format && writer && toolId) {
    await writer({
      type: "data-agent-utility",
      id: toolId,
      data: {
        name: "directImageGen",
        status: isMasterCard ? "running" : "loaded",
        title: "Image Generation",
        category: "generation",
        description: isMasterCard ? "Invoking creative generation" : `About to generate ${numVariations} images`,
        steps,
      },
    });
    if (!isMasterCard) {
      await writer({
        type: "data-agent-utility",
        id: toolId,
        data: {
          name: "directImageGen",
          status: "running",
          title: "Image Generation",
        category: "generation",
          description: `Creating ${numVariations} images`,
          steps,
        },
      });
    }
  }

  const brandMemoryCount = isMasterCard && existingSteps ? existingSteps.length : 0;
  const stepIndices = variationSteps.map((_, i) => brandMemoryCount + i);

  const runOne = async (i: number, imagePrompt: string) => {
    const generationId = crypto.randomUUID();
    const tag = `generated_image_${i}`;
    if (writer) {
      await writer({
        type: "data-image",
        id: generationId,
        data: { url: "", label: `Creative Image ${i + 1}` },
      });
    }
    if (
      useV2Format &&
      writer &&
      toolId &&
      stepIndices[i] !== undefined &&
      !isMasterCard
    ) {
      steps[stepIndices[i]].status = "running";
      await writer({
        type: "data-agent-utility",
        id: toolId,
        data: {
          name: "directImageGen",
          status: "running",
          title: "Image Generation",
        category: "generation",
          description: response.variations[i]?.name ? `Generating ${i + 1} of ${numVariations} — ${response.variations[i].name}` : `Generating variation ${i + 1} of ${numVariations}`,
          steps,
        },
      });
    }
    try {
      const result = await generateOneImage({
        prompt: imagePrompt,
        assetUrls: allUrls,
        referenceUrls: [],
        aspectRatio,
        tag,
        generationId,
      });
      if (writer) {
        await writer({
          type: "data-image",
          id: result.id,
          data: { url: result.url, label: `Creative Image ${i + 1}` },
        });
      }
      if (useV2Format && writer && toolId && stepIndices[i] !== undefined) {
        steps[stepIndices[i]].status = "completed";
        await writer({
          type: "data-agent-utility",
          id: toolId,
          data: {
            name: "directImageGen",
            status: "running",
            title: "Image Generation",
        category: "generation",
            description: isMasterCard ? "Invoking creative generation" : (response.variations[i]?.name ? `${response.variations[i].name} completed` : `Variation ${i + 1} completed`),
            steps,
          },
        });
      }
      return { url: result.url, id: result.id, tag: result.tag };
    } catch (e: any) {
      const errorMsg = String(e?.message ?? e);
      log.error({ err: e, variationIndex: i, imagePrompt, aspectRatio, assetUrls: allUrls }, "image variation generation failed");
      captureException(e, { stage: "image_variation_generation", variationIndex: i, imagePrompt, aspectRatio });
      if (writer) {
        await writer({
          type: "data-image",
          id: generationId,
          data: {
            url: "",
            label: `Creative Image ${i + 1}`,
            error: errorMsg,
            status: "failed",
          },
        });
      }
      if (useV2Format && writer && toolId && stepIndices[i] !== undefined) {
        steps[stepIndices[i]].status = "failed";
        await writer({
          type: "data-agent-utility",
          id: toolId,
          data: { name: "directImageGen", title: "Image Generation", status: "running", category: "generation", description: "", steps },
        });
      }
      return { error: errorMsg, id: generationId, tag };
    }
  };

  const results = await Promise.all(
    response.variations.map((v, i) => runOne(i, v.image_prompt)),
  );

  const successful = results.filter((r) => r.url);
  const failed = results.filter((r) => r.error);
  const durationMs =
    typeof pipelineStartedAt === "number"
      ? Math.max(0, Date.now() - pipelineStartedAt)
      : 0;

  if (useV2Format && writer && toolId) {
    await writer({
      type: "data-agent-utility",
      id: toolId,
      data: {
        name: "directImageGen",
        status: successful.length ? (failed.length ? "completed" : "completed") : "failed",
        title: "Image Generation",
        category: "generation",
        description: successful.length ? `${successful.length} of ${results.length} images generated` : `All ${failed.length} image generations failed`,
        steps,
        duration_ms: durationMs,
        ...(successful.length ? { output: { successful: successful.length, failed: failed.length, total: results.length } } : { error: `All ${failed.length} image generations failed` }),
      },
    });
  }

  return { results };
}

export interface CreateIntelligentImagesParams {
  userPrompt: string;
  assetUrls: string[];
  referenceImages: string[];
  numVariations: number;
  aspectRatio: string;
  isDirectImageGen?: boolean;
  writer?: StreamWriter;
  useV2Format?: boolean;
  masterCardId?: string;
  brandMemoryStepInfo?: AgentUtilityStep;
  /**
   * When `analyseBrandMemory` succeeded in directImageGen, set this to the same string as `userPrompt`
   * so we still merge into CD variations if step metadata is missing. Creative Director alone often drops brand specifics.
   */
  brandMemoryEnforcedBrief?: string;
}

export interface CreateIntelligentImagesResult {
  success: number;
  failed: number;
  total_variations: number;
  results: Array<{ url: string; id?: string; tag?: string }>;
  user_facing_message: string;
  creative_analysis: unknown;
  variation_details: Array<{ name: string; creative_summary: string; user_facing_text: string }>;
  image_prompts: string[];
  direct_prompt: string;
  error?: string;
}

export async function createIntelligentImages(
  params: CreateIntelligentImagesParams,
): Promise<CreateIntelligentImagesResult> {
  const {
    userPrompt,
    assetUrls,
    referenceImages,
    numVariations,
    aspectRatio,
    isDirectImageGen,
    writer,
    useV2Format = true,
    masterCardId,
    brandMemoryStepInfo,
    brandMemoryEnforcedBrief,
  } = params;

  const pipelineStartedAt = Date.now();

  const toolId = masterCardId ?? `au_direct_image_gen_${crypto.randomUUID().slice(0, 8)}`;
  const isMasterCard = !!masterCardId;
  const existingSteps = brandMemoryStepInfo ? [brandMemoryStepInfo] : [];

  let response: MarketmintPromptResponse;

  let generationAssetUrls = [...assetUrls];
  let generationReferenceImages = [...referenceImages];

  if (isDirectImageGen) {
    response = {
      understanding: {
        user_message: userPrompt,
        asset_analysis: [],
        assumptions: "Direct image generation - using exact user prompt for all variations",
      },
      user_facing_message: `Generating ${numVariations} images using your prompt`,
      variations: Array.from({ length: numVariations }, (_, i) => ({
        name: `Variation ${i + 1}`,
        creative_summary: "Direct generation",
        user_facing_text: `Image ${i + 1}`,
        image_prompt: userPrompt,
      })),
    };
  } else {
    const analyzed = await analyzeAndCreateVariations({
      userPrompt,
      assetUrls,
      referenceImages,
      numVariations,
      writer,
      useV2Format,
      isMasterCard,
      toolId,
      preserveBrandMemoryConstraints: !!(
        brandMemoryEnforcedBrief?.trim() ||
        brandMemoryStepInfo?.status === "completed"
      ),
    });
    response = analyzed.response;
    generationAssetUrls = analyzed.assetUrls;
    generationReferenceImages = analyzed.referenceImages;
    if (response.variations.length > numVariations) {
      response = { ...response, variations: response.variations.slice(0, numVariations) };
    }
    if (numVariations === 1 && response.variations.length === 0) {
      response = {
        ...response,
        variations: [
          {
            name: "Variation 1",
            creative_summary: "Direct generation",
            user_facing_text: "Image 1",
            image_prompt: userPrompt,
          },
        ],
      };
    }
  }

  const briefForMerge =
    brandMemoryEnforcedBrief?.trim() ||
    (brandMemoryStepInfo?.status === "completed" ? userPrompt.trim() : "");
  if (!isDirectImageGen && briefForMerge) {
    log.info(
      {
        briefLen: briefForMerge.length,
        source: brandMemoryEnforcedBrief ? "analysis" : "step_metadata",
      },
      "merging brand brief into Creative Director variation prompts for image gen",
    );
    response = mergeBrandBriefIntoVariationPrompts(response, briefForMerge);
  } else if (
    !isDirectImageGen &&
    brandMemoryStepInfo?.status === "completed" &&
    !briefForMerge
  ) {
    log.warn(
      {},
      "brand memory step marked completed but no brief to merge — image prompts may lack brand context",
    );
  }

  const { results } = await generateConcurrentImages({
    response,
    assetUrls: generationAssetUrls,
    referenceImages: generationReferenceImages,
    aspectRatio,
    writer,
    useV2Format,
    isMasterCard,
    toolId,
    existingSteps: existingSteps.length ? existingSteps : undefined,
    pipelineStartedAt,
  });

  const success = results.filter((r) => r.url);
  const fail = results.filter((r) => r.error);

  return {
    success: success.length,
    failed: fail.length,
    total_variations: response.variations.length,
    results: success as Array<{ url: string; id?: string; tag?: string }>,
    user_facing_message: response.user_facing_message,
    creative_analysis: response.understanding,
    variation_details: response.variations.map((v) => ({
      name: v.name,
      creative_summary: v.creative_summary,
      user_facing_text: v.user_facing_text,
    })),
    image_prompts: response.variations.map((v) => v.image_prompt),
    direct_prompt: userPrompt,
    ...(fail.length > 0 && {
      error: fail.map((f) => f.error).join("; "),
    }),
  };
}
