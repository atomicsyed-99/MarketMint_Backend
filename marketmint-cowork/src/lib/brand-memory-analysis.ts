/**
 * Brand memory analysis for direct image generation.
 * Mirrors Python app.ai.utils.direct_image_generation_enhanced.analyse_brand_memory:
 * Uses GPT-4o with structured output to return assets_needed, rephrased_user_query, acknowledgement.
 * Python loads prompt from LangSmith "brand-memory-analysis-prompt"; we use an inline equivalent.
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { getOpenAIModel } from "@/lib/ai-gateway";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("brand-memory-analysis");

const BRAND_MEMORY_ANALYSIS_SYSTEM = `You are given a user query and structured brand memory (name, overview, logos, characters, scenes, poses, palette, fonts, etc.).

Your task:
1. **assets_needed**: List of asset URLs from the brand memory that should be used for this request (e.g. character URLs, scene URLs, logo URLs). Return only URLs that are relevant to the user's image generation request. Return an empty array if none are relevant.
2. **rephrased_user_query**: The user's query rephrased to include instructions on how to apply the brand memory assets (style, colors, characters, scenes) so the image generator can produce on-brand visuals.
3. **acknowledgement**: A short, witty acknowledgement that acknowledges the user's query and mentions what was selected from brand memory (e.g. "Hey! I found a handsome black male model and a beautiful beach scene from your brand memory to cook up some amazing lifestyle visuals for you!"). Keep it concise and friendly.`;

export type BrandMemoryAnalysisResult = {
  assets_needed: string[];
  rephrased_user_query: string;
  acknowledgement: string;
};

/**
 * Analyze brand memory and user query; return assets to use, rephrased prompt, and acknowledgement.
 * Matches Python: analyse_brand_memory(brand_memory_structured, user_query) -> (assets_needed, rephrased_user_query, acknowledgement)
 */
export async function analyseBrandMemory(
  brandMemoryStructured: unknown,
  userQuery: string,
): Promise<BrandMemoryAnalysisResult> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn("OPENAI_API_KEY not set; returning passthrough");
    return {
      assets_needed: [],
      rephrased_user_query: userQuery,
      acknowledgement: "",
    };
  }

  const brandMemoryJson =
    typeof brandMemoryStructured === "string"
      ? brandMemoryStructured
      : JSON.stringify(brandMemoryStructured, null, 2);

  const { output } = await generateText({
    model: getOpenAIModel("gpt-4o"),
    temperature: 0.1,
    output: Output.object({
      schema: z.object({
        assets_needed: z.array(z.string()),
        rephrased_user_query: z.string(),
        acknowledgement: z.string(),
      })
    }),
    system: BRAND_MEMORY_ANALYSIS_SYSTEM,
    prompt: `User query: ${userQuery}\n\nBrand memory: ${brandMemoryJson}`,
  });

  return output;
}
