import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateText } from "ai";
import { getDirectGoogleModel, getOpenAIModel } from "@/lib/ai-gateway";
import { getBrandMemories } from "@/lib/brand-memories";
import { createGeoPrompt } from "@/db/queries/geo-prompts";
import { emitUtility } from "@/mastra/tools/emit-utility";
import {
  getUserEmail,
  getUserId,
  getWorkspaceId,
  isBrandMemoryEnabled,
  normalizePromptCategory,
} from "./shared";

const promptRowSchema = z.object({
  prompt: z.string().min(6),
  category: z.string().optional(),
});

function fallbackPromptExtraction(brandName: string): Array<z.infer<typeof promptRowSchema>> {
  return [
    { prompt: `Is ${brandName} the best option in its category?`, category: "comparison" },
    { prompt: `Is ${brandName} safe and reliable?`, category: "trust_safety" },
    { prompt: `What warranty does ${brandName} offer?`, category: "warranty" },
    { prompt: `How does ${brandName} compare with alternatives?`, category: "comparison" },
    { prompt: `What do customers say about ${brandName}?`, category: "social_proof" },
    { prompt: `Is ${brandName} worth the price?`, category: "pricing_value" },
    { prompt: `What are common issues with ${brandName}?`, category: "objections" },
    { prompt: `Where can I buy ${brandName}?`, category: "purchase_intent" },
    { prompt: `Who is ${brandName} best suited for?`, category: "fit_use_case" },
    { prompt: `What are the key benefits of ${brandName}?`, category: "benefits" },
  ];
}

function parsePromptResponse(raw: string): Array<z.infer<typeof promptRowSchema>> {
  const cleaned = raw.trim();
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const json = cleaned.slice(firstBracket, lastBracket + 1);
    const parsed = JSON.parse(json);
    return z.array(promptRowSchema).parse(parsed);
  }
  const lines = cleaned
    .split("\n")
    .map((line) => line.replace(/^\d+[\).\s-]*/, "").trim())
    .filter(Boolean);
  return lines.slice(0, 10).map((line) => ({ prompt: line }));
}

async function generatePromptCandidates(
  brandMemory: Record<string, unknown>,
  additionalContext?: string,
) {
  const brandName = String(
    brandMemory.brand_name ?? brandMemory.name ?? brandMemory.brandName ?? "this brand",
  );
  const prompt = [
    "You are generating GEO tracking prompts.",
    "Return only a JSON array (no prose).",
    "Schema: [{\"prompt\": string, \"category\": string}]",
    "Generate exactly 10 one-line user questions people might ask on ChatGPT/Perplexity/Gemini.",
    "Focus on purchase intent, trust, product quality, comparisons, and objections.",
    "",
    `Brand memory JSON: ${JSON.stringify(brandMemory).slice(0, 14000)}`,
    additionalContext ? `Additional context: ${additionalContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { text } = await generateText({
      model: getDirectGoogleModel("gemini-2.5-flash"),
      prompt,
    });
    return parsePromptResponse(text);
  } catch {
    try {
      const { text } = await generateText({
        model: getOpenAIModel("gpt-4o-mini"),
        prompt,
      });
      return parsePromptResponse(text);
    } catch {
      return fallbackPromptExtraction(brandName);
    }
  }
}

export const extractGeoPrompts = createTool({
  id: "extractGeoPrompts",
  description:
    "Extract GEO tracking prompts from brand memory and persist them for this workspace.",
  inputSchema: z.object({
    additionalContext: z
      .string()
      .optional()
      .describe("Optional user-provided context to influence prompt extraction."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    prompts: z.array(
      z.object({
        id: z.string(),
        prompt: z.string(),
        category: z.string().nullable(),
      }),
    ),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const utilityId = `geo_extract_${crypto.randomUUID().slice(0, 8)}`;
    const requestContext = context?.requestContext;
    const workspaceId = getWorkspaceId(requestContext);
    const userId = getUserId(requestContext);
    const email = getUserEmail(requestContext);
    const enabled = isBrandMemoryEnabled(requestContext);

    emitUtility(context, {
      id: utilityId,
      name: "extractGeoPrompts",
      title: "Extract GEO Prompts",
      category: "workflow",
      status: "running",
      description: "Generating prompt candidates from brand memory...",
    });

    if (!enabled) {
      return {
        success: false,
        prompts: [],
        message:
          "Please enable the Brand Memory toggle in the chatbox first. GEO prompt extraction is blocked until then.",
        error: "Brand memory toggle is off",
      };
    }
    if (!workspaceId || !userId) {
      return {
        success: false,
        prompts: [],
        message: "Missing workspace/user context.",
        error: "Missing workspace/user context",
      };
    }

    try {
      const memories = await getBrandMemories(userId, workspaceId);
      const brandMemory = (memories[0]?.content ?? null) as Record<string, unknown> | null;
      if (!brandMemory) {
        emitUtility(context, {
          id: utilityId,
          name: "extractGeoPrompts",
          title: "Extract GEO Prompts",
          category: "workflow",
          status: "failed",
          description: "No brand memory found.",
          error: "No brand memory found",
        });
        return {
          success: false,
          prompts: [],
          message: "No brand memory found. Please refresh brand memory and try again.",
          error: "No brand memory found",
        };
      }

      const candidates = await generatePromptCandidates(
        brandMemory,
        input.additionalContext,
      );
      const persisted = [];
      for (const item of candidates) {
        const row = await createGeoPrompt({
          workspaceId,
          promptText: item.prompt.trim(),
          category: normalizePromptCategory(item.category),
          source: "auto",
          isActive: true,
        });
        if (row) {
          persisted.push({
            id: row.id,
            prompt: row.promptText,
            category: row.category ?? null,
          });
        }
      }

      emitUtility(context, {
        id: utilityId,
        name: "extractGeoPrompts",
        title: "Extract GEO Prompts",
        category: "workflow",
        status: "completed",
        description: `Saved ${persisted.length} prompts for tracking.`,
      });

      return {
        success: true,
        prompts: persisted,
        message: `Generated and saved ${persisted.length} prompts.`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      emitUtility(context, {
        id: utilityId,
        name: "extractGeoPrompts",
        title: "Extract GEO Prompts",
        category: "workflow",
        status: "failed",
        description: "Prompt extraction failed.",
        error: msg,
      });
      return {
        success: false,
        prompts: [],
        message: "Failed to extract GEO prompts.",
        error: msg,
      };
    }
  },
});
