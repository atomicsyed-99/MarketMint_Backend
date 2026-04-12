import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as jobService from "@/services/agent-jobs";
import { serializeAgentJobForTool } from "./serialize-agent-job";

const outputSchema = z.object({
  success: z.boolean(),
  jobs: z.array(z.any()).optional(),
  error: z.string().optional(),
});

export const listAgentJobsTool = createTool({
  id: "listAgentJobs",
  description:
    "List scheduled agent jobs for this workspace. Use to find a job by name/description, show all jobs, or before getAgentJob when the user did not give a UUID.",
  inputSchema: z.object({
    enabledOnly: z
      .boolean()
      .optional()
      .describe("If true, only return enabled jobs"),
  }),
  outputSchema,
  execute: async (input, context) => {
    const rc = context?.requestContext as
      | { get?: (k: string) => unknown; workspaceId?: string }
      | undefined;
    const workspaceId =
      (typeof rc?.get === "function" ? rc.get("workspaceId") : rc?.workspaceId) as
        | string
        | undefined;

    if (!workspaceId) {
      return { success: false, error: "Missing workspace in request context" };
    }

    try {
      const rows = await jobService.listJobs(workspaceId, {
        enabledOnly: input.enabledOnly,
      });
      const jobs = rows.map((j) =>
        serializeAgentJobForTool(j, { truncatePromptAt: 400 }),
      );
      return { success: true, jobs };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  },
});
