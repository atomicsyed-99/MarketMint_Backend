import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getPromptContent } from "@/lib/langsmith-prompts";

export const fetchTemplatePrompt = createTool({
  id: "fetchTemplatePrompt",
  description:
    "Fetch the text content of a template prompt from LangSmith by its id/name. Call when the user message or payload contains a non-null selected_template_prompt_id; use that value as the template_prompt_id argument. Returns the prompt text for workflow_inputs or directImageGen.",
  inputSchema: z.object({
    template_prompt_id: z.string().describe("The ID/name of the template prompt (e.g. workflows-image-edit)"),
  }),
  outputSchema: z.object({
    template_prompt_id: z.string(),
    title: z.string().optional(),
    prompt: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cardId = crypto.randomUUID();
    const emit = async (status: "running" | "completed" | "failed", description: string) => {
      await context?.writer?.custom?.({
        type: "data-agent-utility",
        data: {
          id: cardId,
          name: "fetchTemplatePrompt",
          status,
          title: "Template Prompt Lookup",
          category: "planning",
          description,
        },
      });
    };

    const id = (input.template_prompt_id ?? "").trim();
    if (!id || id === "null" || id === "undefined") {
      await emit("completed", "No template prompt id provided");
      return { template_prompt_id: id || input.template_prompt_id, title: "", prompt: "" };
    }
    await emit("running", "Fetching template prompt");
    try {
      const prompt = await getPromptContent(id);
      await emit("completed", "Template prompt fetched");
      return {
        template_prompt_id: id,
        title: "",
        prompt: prompt || "",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await emit("failed", "Failed to fetch template prompt");
      return {
        template_prompt_id: id,
        title: "",
        prompt: `(Failed to fetch template prompt ${id}: ${msg})`,
      };
    }
  },
});
