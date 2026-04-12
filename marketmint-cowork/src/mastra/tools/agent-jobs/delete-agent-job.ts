import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as jobService from "../../../services/agent-jobs";

const outputSchema = z.object({
  success: z.boolean(),
  jobId: z.string().optional(),
  error: z.string().optional(),
});

export const deleteAgentJobTool = createTool({
  id: "deleteAgentJob",
  description:
    "Permanently delete a scheduled agent job by UUID. Removes the Trigger.dev schedule and DB row. Confirm destructive intent when the user asked to remove/delete/cancel the job (not just disable — use updateAgentJob with enabled: false to pause).",
  inputSchema: z.object({
    jobId: z.string().uuid().describe("UUID of the job to delete"),
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
      return {
        success: false,
        error: "Missing workspace in request context",
      };
    }

    try {
      await jobService.deleteJob(input.jobId, workspaceId);
      return { success: true, jobId: input.jobId };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  },
});
