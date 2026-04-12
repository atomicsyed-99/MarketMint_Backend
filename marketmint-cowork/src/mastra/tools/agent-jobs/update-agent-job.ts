import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { UpdateAgentJobBodySchema } from "../../../schemas/agent-jobs";
import * as jobService from "../../../services/agent-jobs";
import type { Connections } from "../../../connectors/types";
import { missingConnectorConnections } from "@/lib/agent-job-connector-requirements";

const outputSchema = z.object({
  success: z.boolean(),
  jobId: z.string().optional(),
  error: z.string().optional(),
});

/** Same as PATCH /cowork/agent-jobs/:jobId — no lastRunAt/nextRunAt (scheduler-managed). */
const UpdateAgentJobToolInputSchema = UpdateAgentJobBodySchema.omit({
  lastRunAt: true,
  nextRunAt: true,
}).extend({
  jobId: z.string().uuid().describe("UUID of the job to update"),
});

export const updateAgentJobTool = createTool({
  id: "updateAgentJob",
  description:
    "Update an existing scheduled job (partial fields). Requires jobId; include only fields to change (name, prompt, schedule, timezone, enabled, agentIds, connectorRequirements, notifications, metadata, etc.).",
  inputSchema: UpdateAgentJobToolInputSchema,
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

    const { jobId, ...patch } = UpdateAgentJobToolInputSchema.parse(input);
    const body = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Record<string, unknown>;

    if (Object.keys(body).length === 0) {
      return {
        success: false,
        error: "No fields to update — pass at least one field besides jobId",
      };
    }

    const connections = (
      typeof rc?.get === "function" ? rc.get("__connections") : undefined
    ) as Connections | undefined;
    const reqs = body.connectorRequirements;
    if (Array.isArray(reqs)) {
      const missing = missingConnectorConnections(reqs, connections ?? {});
      if (missing.length > 0) {
        return {
          success: false,
          error: `Missing required connections for: ${missing.join(", ")}. Connect these integrations in Marketmint before updating this job.`,
        };
      }
    }

    try {
      await jobService.updateJob(jobId, workspaceId, body as any);
      return { success: true, jobId };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  },
});
