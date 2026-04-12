import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as jobService from "@/services/agent-jobs";
import { serializeAgentJobForTool } from "./serialize-agent-job";

const outputSchema = z.object({
  success: z.boolean(),
  job: z.any().optional(),
  error: z.string().optional(),
});

export const getAgentJobTool = createTool({
  id: "getAgentJob",
  description:
    "Get full details for one scheduled agent job by its UUID. Use when the user gave a job id or after listAgentJobs identified the correct job.",
  inputSchema: z.object({
    jobId: z.string().uuid().describe("The agent job id"),
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
      const row = await jobService.getJob(input.jobId, workspaceId);
      return {
        success: true,
        job: serializeAgentJobForTool(row),
      };
    } catch (e: unknown) {
      if (
        e instanceof jobService.NotFoundError ||
        e instanceof jobService.ForbiddenError
      ) {
        return { success: false, error: (e as Error).message };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  },
});
