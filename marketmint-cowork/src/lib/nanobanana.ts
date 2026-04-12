/**
 * Image generation for the Marketmint agent.
 * Uses Gemini via Cloudflare AI Gateway. The name is kept for compatibility with the tool.
 */

import { generateIntelligentImages as geminiGenerate } from "./gemini-image-gen";

export async function generateIntelligentImages(params: {
  prompt: string;
  brandContext?: string;
  assetUrls?: string[];
  referenceImages?: string[];
  numVariations: number;
  aspectRatio: string;
}) {
  return geminiGenerate({
    prompt: params.prompt,
    brandContext: params.brandContext,
    assetUrls: params.assetUrls,
    referenceImages: params.referenceImages,
    numVariations: params.numVariations,
    aspectRatio: params.aspectRatio,
  });
}
