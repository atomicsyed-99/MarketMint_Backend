import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateText } from "ai";
import { getDirectGoogleModel, getOpenAIModel } from "@/lib/ai-gateway";
import { getBrandMemories } from "@/lib/brand-memories";
import { createGeoPrompt, getGeoPromptById } from "@/db/queries/geo-prompts";
import { createGeoContent } from "@/db/queries/geo-content";
import { deliverContent } from "@/mastra/tools/artifacts/deliver-content";
import { emitUtility } from "@/mastra/tools/emit-utility";
import {
  getUserEmail,
  getUserId,
  getWorkspaceId,
  isBrandMemoryEnabled,
  normalizePromptCategory,
} from "./shared";

function getBrandName(memory: Record<string, unknown>): string {
  return String(memory.brand_name ?? memory.name ?? memory.brandName ?? "this brand");
}

async function generateGeoMarkdown(args: {
  promptText: string;
  brandMemory: Record<string, unknown>;
}) {
  const brandName = getBrandName(args.brandMemory);
  const systemPrompt = [
    "You write GEO-optimized content for LLM citation visibility.",
    "Output markdown only.",
    "Structure: title, summary, key facts, FAQ, and a short citation-ready answer.",
    "Use specific and verifiable language.",
  ].join("\n");
  const userPrompt = [
    `Brand: ${brandName}`,
    `Target user query: ${args.promptText}`,
    `Brand memory JSON: ${JSON.stringify(args.brandMemory).slice(0, 14000)}`,
    "",
    "Generate a reusable markdown content draft that helps this brand rank in LLM answers for the query.",
  ].join("\n");

  try {
    const { text } = await generateText({
      model: getDirectGoogleModel("gemini-2.5-flash"),
      system: systemPrompt,
      prompt: userPrompt,
    });
    if (text.trim()) return text.trim();
  } catch {}

  try {
    const { text } = await generateText({
      model: getOpenAIModel("gpt-4o-mini"),
      system: systemPrompt,
      prompt: userPrompt,
    });
    if (text.trim()) return text.trim();
  } catch {}

  return [
    `# ${brandName}: GEO content draft`,
    "",
    `## Target query`,
    args.promptText,
    "",
    "## Quick answer",
    `${brandName} can be a strong option depending on the user's priorities. Include verifiable product details, support information, and trust signals in published content so LLMs can cite reliable sources.`,
    "",
    "## Key facts to publish",
    "- Product/service overview with clear differentiation",
    "- Warranty, safety, and policy information",
    "- Customer proof and transparent pricing/value positioning",
    "",
    "## FAQ",
    `- Is ${brandName} reliable?`,
    `- What warranty does ${brandName} offer?`,
    `- How does ${brandName} compare with alternatives?`,
  ].join("\n");
}

export const generateGeoContent = createTool({
  id: "generateGeoContent",
  description:
    "Generate GEO-optimized markdown content for a tracked prompt and deliver it as an artifact.",
  inputSchema: z
    .object({
      promptId: z.string().uuid().optional(),
      promptText: z.string().optional(),
      category: z.string().optional(),
    })
    .refine((v) => !!v.promptId || !!v.promptText, {
      message: "Either promptId or promptText is required",
    }),
  outputSchema: z.object({
    success: z.boolean(),
    contentId: z.string().nullable(),
    promptId: z.string().nullable(),
    markdown: z.string().nullable(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const utilityId = `geo_content_${crypto.randomUUID().slice(0, 8)}`;
    const requestContext = context?.requestContext;
    const workspaceId = getWorkspaceId(requestContext);
    const userId = getUserId(requestContext);
    const email = getUserEmail(requestContext);
    const enabled = isBrandMemoryEnabled(requestContext);

    const emptyReturn = {
      success: false as const,
      contentId: null,
      promptId: null,
      markdown: null,
    };

    emitUtility(context, {
      id: utilityId,
      name: "generateGeoContent",
      title: "Generate GEO Content",
      category: "generation",
      status: "running",
      description: "Preparing content generation inputs...",
    });

    if (!enabled) {
      return {
        ...emptyReturn,
        message: "Please enable the Brand Memory toggle in the chatbox first before generating GEO content.",
        error: "Brand memory toggle is off",
      };
    }
    if (!workspaceId || !userId) {
      return {
        ...emptyReturn,
        message: "Missing workspace/user context.",
        error: "Missing workspace/user context",
      };
    }

    try {
      let promptRow = input.promptId ? await getGeoPromptById(input.promptId) : null;
      if (!promptRow && input.promptText) {
        promptRow = await createGeoPrompt({
          workspaceId,
          promptText: input.promptText.trim(),
          category: normalizePromptCategory(input.category),
          source: "manual",
          isActive: true,
        });
      }
      if (!promptRow) {
        return {
          ...emptyReturn,
          message: "Prompt not found.",
          error: "Prompt not found",
        };
      }

      emitUtility(context, {
        id: utilityId,
        name: "generateGeoContent",
        title: "Generate GEO Content",
        category: "generation",
        status: "running",
        description: `Generating markdown for "${promptRow.promptText.slice(0, 50)}…"`,
      });

      const memories = await getBrandMemories(userId, workspaceId);
      const brandMemory = (memories[0]?.content ?? null) as Record<string, unknown> | null;
      if (!brandMemory) {
        return {
          ...emptyReturn,
          promptId: promptRow.id,
          message: "No brand memory found. Refresh brand memory and retry.",
          error: "No brand memory found",
        };
      }

      const markdown = await generateGeoMarkdown({
        promptText: promptRow.promptText,
        brandMemory,
      });

      if (typeof deliverContent.execute === "function") {
        await deliverContent.execute(
          {
            title: `GEO Content - ${promptRow.promptText.slice(0, 70)}`,
            content: markdown,
            kind: "markdown",
            display: "artifact",
          },
          context as any,
        );
      }

      const created = await createGeoContent({
        workspaceId,
        promptId: promptRow.id,
        contentMarkdown: markdown,
        contentPdfUrl: null,
        metadata: {
          generatedBy: "generateGeoContent",
          promptText: promptRow.promptText,
          model: "auto",
        },
      });

      emitUtility(context, {
        id: utilityId,
        name: "generateGeoContent",
        title: "Generate GEO Content",
        category: "generation",
        status: "completed",
        description: "Content generated and delivered as a markdown artifact.",
      });

      return {
        success: true,
        contentId: created.id,
        promptId: promptRow.id,
        markdown,
        message: "GEO content generated and delivered as a markdown artifact.",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      emitUtility(context, {
        id: utilityId,
        name: "generateGeoContent",
        title: "Generate GEO Content",
        category: "generation",
        status: "failed",
        description: "Failed to generate GEO content.",
        error: msg,
      });
      return {
        ...emptyReturn,
        message: "Failed to generate GEO content.",
        error: msg,
      };
    }
  },
});
