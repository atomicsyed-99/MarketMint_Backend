import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createGeoPrompt } from "@/db/queries/geo-prompts";
import { emitUtility } from "@/mastra/tools/emit-utility";
import { getWorkspaceId, isBrandMemoryEnabled, normalizePromptCategory } from "./shared";

export const addGeoPrompt = createTool({
  id: "addGeoPrompt",
  description: "Add a manual GEO tracking prompt for this workspace.",
  inputSchema: z.object({
    promptText: z.string().min(6).describe("Prompt text to track."),
    category: z.string().optional().describe("Optional category label."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    prompt: z
      .object({
        id: z.string(),
        promptText: z.string(),
        category: z.string().nullable(),
      })
      .optional(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const utilityId = `geo_add_prompt_${crypto.randomUUID().slice(0, 8)}`;
    const requestContext = context?.requestContext;
    const workspaceId = getWorkspaceId(requestContext);
    const enabled = isBrandMemoryEnabled(requestContext);

    if (!enabled) {
      return {
        success: false,
        message: "Please enable the Brand Memory toggle in the chatbox first before adding GEO prompts.",
        error: "Brand memory toggle is off",
      };
    }
    if (!workspaceId) {
      return {
        success: false,
        message: "Missing workspace context.",
        error: "Missing workspace context",
      };
    }

    emitUtility(context, {
      id: utilityId,
      name: "addGeoPrompt",
      title: "Add GEO Prompt",
      category: "workflow",
      status: "running",
      description: "Saving prompt...",
    });

    try {
      const row = await createGeoPrompt({
        workspaceId,
        promptText: input.promptText.trim(),
        category: normalizePromptCategory(input.category),
        source: "manual",
        isActive: true,
      });

      if (!row) {
        return {
          success: false,
          message: "Could not save the prompt.",
          error: "Insert failed",
        };
      }

      emitUtility(context, {
        id: utilityId,
        name: "addGeoPrompt",
        title: "Add GEO Prompt",
        category: "workflow",
        status: "completed",
        description: "Prompt saved.",
      });

      return {
        success: true,
        prompt: {
          id: row.id,
          promptText: row.promptText,
          category: row.category ?? null,
        },
        message: "Prompt saved for GEO tracking.",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      emitUtility(context, {
        id: utilityId,
        name: "addGeoPrompt",
        title: "Add GEO Prompt",
        category: "workflow",
        status: "failed",
        description: "Failed to save prompt.",
        error: msg,
      });
      return {
        success: false,
        message: "Failed to add GEO prompt.",
        error: msg,
      };
    }
  },
});
