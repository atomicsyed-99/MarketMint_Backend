/**
 * NB2 path: brand memory (HTTP API) → GPT picks character/scene URLs + rephrased prompt →
 * one Gemini image call per variation (generateOneImage / Nanobanana-style).
 * No Creative Director / Flash JSON variation layer.
 */

import { env } from "@/env";
import { generateOneImage } from "@/lib/gemini-image-gen";
import {
  analyseBrandMemoryForNb2,
  type BrandMemoryNb2Analysis,
  userRequestsNoBrandVisualRefs,
} from "@/lib/brand-memory-nb2-analysis";
import { dedupeUrls } from "@/lib/direct-image-gen-chat-context";
import { refreshSignedUrlFromUrl } from "@/lib/s3";
import { createLogger } from "@/lib/logger";
import { captureException } from "@/lib/sentry";

const log = createLogger("nb2-brand-image-variations");

export type Nb2StreamWriter = (msg: {
  type: string;
  id?: string;
  data?: unknown;
}) => void | Promise<void>;

export type RunNb2BrandImageVariationsParams = {
  userPrompt: string;
  aspectRatio: string;
  numVariations: number;
  /** Already-merged asset + attachment URLs (brand picks appended by caller when using BM). */
  assetUrls: string[];
  referenceImages: string[];
  useBrandMemory: boolean;
  /** First row JSON from getBrandMemories; null skips analysis. */
  brandMemoryStructured: unknown | null;
  /** When set (e.g. after SSE ack), skips a second OpenAI call inside the runner. */
  precomputedAnalysis?: BrandMemoryNb2Analysis | null;
  masterCardId?: string;
  writer?: Nb2StreamWriter;
};

export type Nb2ImageResult = { url: string; id: string; tag: string };

export type RunNb2BrandImageVariationsResult = {
  results: Array<Nb2ImageResult | { error: string; id: string; tag: string }>;
  /** Prompt sent to each NB2 call (same base + optional variation suffix). */
  prompts_used: string[];
  rephrased_prompt: string;
  logo_asset_urls: string[];
  character_asset_urls: string[];
  scene_asset_urls: string[];
  acknowledgement: string;
  nb2_image_model: string;
  error?: string;
};

async function refreshUrlMaybe(url: string): Promise<string> {
  if (/marketmint\.ai|s3\.amazonaws\.com|\.s3\./.test(url)) {
    return refreshSignedUrlFromUrl(url).catch(() => url);
  }
  return url;
}

/**
 * Build per-variation prompts: same brand-heavy base, light composition diversity.
 */
/** Exported for unit tests — each string is one NB2 `generateOneImage` prompt. */
export function buildVariationPrompts(basePrompt: string, numVariations: number): string[] {
  if (numVariations <= 1) return [basePrompt.trim()];
  const out: string[] = [];
  const angles = [
    "hero framing, eye-level, balanced composition",
    "slight three-quarter angle, more dynamic depth",
    "wider establishing shot with negative space for copy",
    "tighter crop on subject, shallow depth of field",
    "top-down or angled overhead (only if it fits the subject)",
    "asymmetric layout, rule-of-thirds subject placement",
    "centered symmetrical composition, bold and minimal",
    "lifestyle context shot with environmental storytelling",
  ];
  for (let i = 0; i < numVariations; i++) {
    const hint = angles[i % angles.length];
    out.push(
      `${basePrompt.trim()}\n\n[Variation ${i + 1} of ${numVariations}] Keep brand fidelity identical. Composition/lighting: ${hint}.`,
    );
  }
  return out;
}

export async function runNb2BrandImageVariations(
  params: RunNb2BrandImageVariationsParams,
): Promise<RunNb2BrandImageVariationsResult> {
  const {
    userPrompt,
    aspectRatio,
    numVariations,
    assetUrls: inputAssetUrls,
    referenceImages: inputRefImages,
    useBrandMemory,
    brandMemoryStructured,
    precomputedAnalysis,
    masterCardId,
    writer,
  } = params;

  const nb2Model = env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";

  let rephrased = userPrompt.trim();
  let logoUrls: string[] = [];
  let characterUrls: string[] = [];
  let sceneUrls: string[] = [];
  let acknowledgement = "";

  if (useBrandMemory) {
    const analysis =
      precomputedAnalysis ??
      (brandMemoryStructured
        ? await analyseBrandMemoryForNb2(brandMemoryStructured, userPrompt)
        : null);
    if (analysis) {
      rephrased = analysis.rephrased_user_query.trim() || rephrased;
      logoUrls = analysis.logo_asset_urls ?? [];
      characterUrls = analysis.character_asset_urls;
      sceneUrls = analysis.scene_asset_urls;
      acknowledgement = analysis.acknowledgement ?? "";
    }
  }

  const referenceImages = dedupeUrls([...inputRefImages]);
  const refreshedRefs = await Promise.all(referenceImages.map(refreshUrlMaybe));

  /** Each variation: user assets + exactly one logo + one character + one scene (rotating pools). */
  const buildAssetUrlsForVariation = (variationIndex: number): string[] => {
    const base = [...inputAssetUrls];
    if (
      !useBrandMemory ||
      userRequestsNoBrandVisualRefs(userPrompt) ||
      !brandMemoryStructured
    ) {
      return dedupeUrls(base);
    }
    if (logoUrls[0]) base.push(logoUrls[0]);
    if (characterUrls.length) {
      base.push(characterUrls[variationIndex % characterUrls.length]);
    }
    if (sceneUrls.length) {
      base.push(sceneUrls[variationIndex % sceneUrls.length]);
    }
    return dedupeUrls(base);
  };

  const prompts = buildVariationPrompts(rephrased, Math.max(1, numVariations));
  log.info(
    {
      numVariations: prompts.length,
      refCount: refreshedRefs.length,
      promptLen: rephrased.length,
      logoCount: logoUrls.length,
      characterPool: characterUrls.length,
      scenePool: sceneUrls.length,
      brandRefsOptOut: userRequestsNoBrandVisualRefs(userPrompt),
    },
    "NB2: starting parallel generateOneImage calls",
  );

  if (writer && masterCardId) {
    await writer({
      type: "data-agent-utility",
      id: masterCardId,
      data: {
        name: "directImageGen",
        status: "running",
        title: "Image Generation",
        category: "generation",
        description: `NB2 (${nb2Model}): generating ${prompts.length} image(s)`,
        steps: prompts.map((_, i) => ({
          id: `nb2_${i}`,
          title: `Image ${i + 1} of ${prompts.length}`,
          status: "pending" as const,
        })),
      },
    });
  }

  const runOne = async (i: number, prompt: string) => {
    const generationId = crypto.randomUUID();
    const tag = `nb2_${i}`;
    if (writer && masterCardId) {
      await writer({
        type: "data-agent-utility",
        id: masterCardId,
        data: {
          name: "directImageGen",
          status: "running",
          title: "Image Generation",
          category: "generation",
          description: `NB2: generating ${i + 1} of ${prompts.length}`,
          steps: prompts.map((_, j) => ({
            id: `nb2_${j}`,
            title: `Image ${j + 1} of ${prompts.length}`,
            status:
              j < i ? "completed" : j === i ? "running" : ("pending" as const),
          })),
        },
      });
    }
    if (writer) {
      await writer({
        type: "data-image",
        id: generationId,
        data: { url: "", label: `Image ${i + 1}` },
      });
    }
    try {
      const variationAssets = await Promise.all(
        buildAssetUrlsForVariation(i).map(refreshUrlMaybe),
      );
      const result = await generateOneImage({
        prompt,
        assetUrls: variationAssets,
        referenceUrls: refreshedRefs,
        aspectRatio,
        tag,
        generationId,
      });
      if (writer) {
        await writer({
          type: "data-image",
          id: result.id,
          data: { url: result.url, label: `Image ${i + 1}` },
        });
      }
      if (writer && masterCardId) {
        await writer({
          type: "data-agent-utility",
          id: masterCardId,
          data: {
            name: "directImageGen",
            status: "running",
            title: "Image Generation",
            category: "generation",
            steps: prompts.map((_, j) => ({
              id: `nb2_${j}`,
              title: `Image ${j + 1} of ${prompts.length}`,
              status: j <= i ? "completed" : "pending",
            })),
          },
        });
      }
      return { url: result.url, id: result.id, tag: result.tag };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      captureException(e instanceof Error ? e : new Error(msg), {
        stage: "nb2_generateOneImage",
        variationIndex: i,
      });
      if (writer) {
        await writer({
          type: "data-image",
          id: generationId,
          data: {
            url: "",
            label: `Image ${i + 1}`,
            error: msg,
            status: "failed",
          },
        });
      }
      return { error: msg, id: generationId, tag };
    }
  };

  const settled = await Promise.all(
    prompts.map((p, i) => runOne(i, p)),
  );

  const ok = settled.filter((r): r is Nb2ImageResult => "url" in r && !!r.url);
  const errors = settled.filter((r) => "error" in r && r.error);

  if (writer && masterCardId) {
    await writer({
      type: "data-agent-utility",
      id: masterCardId,
      data: {
        name: "directImageGen",
        status: ok.length ? "completed" : "failed",
        title: "Image Generation",
        category: "generation",
        description:
          ok.length === prompts.length
            ? `NB2: ${ok.length} image(s) generated`
            : `${ok.length}/${prompts.length} succeeded`,
        steps: prompts.map((_, j) => ({
          id: `nb2_${j}`,
          title: `Image ${j + 1} of ${prompts.length}`,
          status: settled[j] && "url" in settled[j] && settled[j].url ? "completed" : "failed",
        })),
      },
    });
  }

  return {
    results: settled as RunNb2BrandImageVariationsResult["results"],
    prompts_used: prompts,
    rephrased_prompt: rephrased,
    logo_asset_urls: logoUrls,
    character_asset_urls: characterUrls,
    scene_asset_urls: sceneUrls,
    acknowledgement,
    nb2_image_model: nb2Model,
    ...(errors.length === settled.length && errors.length > 0
      ? { error: errors.map((e) => ("error" in e ? e.error : "")).join("; ") }
      : {}),
  };
}
