/**
 * Image generation using Gemini through Cloudflare AI Gateway (or direct fallback).
 * Uses Vercel AI SDK's generateText() with providerOptions for image config.
 */

import { generateText, type LanguageModel } from "ai";
import { createLogger } from "@/lib/logger";
import { uploadToS3, refreshSignedUrl } from "./s3";
import { getImageGenModel } from "./ai-gateway";

const log = createLogger("gemini-image-gen");

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

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
 * Generate a single image with Gemini via Cloudflare AI Gateway.
 * Returns S3 key and metadata; caller can use refreshSignedUrl(key) for a URL.
 */
export async function generateOneImage(params: {
  prompt: string;
  assetUrls?: string[];
  referenceUrls?: string[];
  aspectRatio: string;
  tag: string;
  generationId: string;
}): Promise<{
  url: string;
  id: string;
  tag: string;
  s3Key: string;
  metadata?: unknown;
}> {
  const model = getImageGenModel();

  // Build content parts: images first, then prompt text (matching trigger-workflows pattern)
  type TextPart = { type: "text"; text: string };
  type ImagePart = { type: "image"; image: Buffer; mediaType: "image/jpeg" };
  const contentParts: Array<TextPart | ImagePart> = [];

  const refUrls = [
    ...(params.assetUrls ?? []),
    ...(params.referenceUrls ?? []),
  ];
  let fetchFailed = 0;
  for (const url of refUrls) {
    const bytes = await fetchImageBytes(url);
    if (bytes) {
      contentParts.push({ type: "image", image: Buffer.from(bytes), mediaType: "image/jpeg" });
    } else {
      fetchFailed++;
      log.warn(
        {
          tag: params.tag,
          generationId: params.generationId,
          urlSample: url.length > 160 ? `${url.slice(0, 160)}…` : url,
        },
        "generateOneImage: reference image URL did not load (skipped)",
      );
    }
  }
  if (fetchFailed > 0) {
    log.warn(
      {
        tag: params.tag,
        loaded: contentParts.length,
        failed: fetchFailed,
        total: refUrls.length,
      },
      "generateOneImage: some reference URLs failed to fetch",
    );
  }

  contentParts.push({ type: "text", text: params.prompt.trim() });

  // Retry loop: mirror Python's robustness with retries on transient failures.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { files } = await generateText({
        model: model as LanguageModel,
        messages: [
          {
            role: "user",
            content: contentParts,
          },
        ],
        maxOutputTokens: 8192,
        maxRetries: 1,
        providerOptions: {
          google: {
            imageConfig: {
              aspectRatio: params.aspectRatio,
            },
            safetySettings: [
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
            ],
          },
        },
      });

      const generated = files?.find((f) => f.mediaType.startsWith("image/"));
      if (!generated?.uint8Array) {
        throw new Error("No image in Gemini response");
      }

      const imageBuffer = Buffer.from(generated.uint8Array);
      const mime = generated.mediaType || "image/jpeg";
      const ext = mime === "image/png" ? "png" : "jpg";
      const filename = `${params.generationId}.${ext}`;
      const key = await uploadToS3(imageBuffer, filename, mime);
      const url = await refreshSignedUrl(key);
      return {
        url,
        id: params.generationId,
        tag: params.tag,
        s3Key: key,
      };
    } catch (err) {
      lastError = err;
      if (attempt === 3) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Unknown error from Gemini image generation";
        throw new Error(`Image generation failed after 3 attempts: ${message}`);
      }
      // Brief backoff between attempts
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  // Unreachable, satisfies type system
  throw lastError instanceof Error
    ? lastError
    : new Error("Image generation failed after retries");
}

export type GenerateIntelligentImagesParams = {
  prompt: string;
  brandContext?: string;
  assetUrls?: string[];
  referenceImages?: string[];
  numVariations: number;
  aspectRatio: string;
};

export type GeneratedImage = {
  url: string;
  id: string;
  tag: string;
  s3Key: string;
  metadata?: unknown;
};

/**
 * Generate multiple image variations using Gemini via Cloudflare AI Gateway.
 */
export async function generateIntelligentImages(
  params: GenerateIntelligentImagesParams,
): Promise<{ images: GeneratedImage[] }> {
  const numVariations = Math.max(1, Math.min(params.numVariations, 4));
  const promptWithBrand =
    params.brandContext?.trim()
      ? `${params.brandContext}\n\n---\n\n${params.prompt}`
      : params.prompt;

  const tasks = Array.from({ length: numVariations }, (_, i) => {
    const generationId = crypto.randomUUID();
    const tag = `generated_image_${i}`;
    return generateOneImage({
      prompt: promptWithBrand,
      assetUrls: params.assetUrls,
      referenceUrls: params.referenceImages,
      aspectRatio: params.aspectRatio,
      tag,
      generationId,
    });
  });

  const images = await Promise.all(tasks);
  return { images };
}
