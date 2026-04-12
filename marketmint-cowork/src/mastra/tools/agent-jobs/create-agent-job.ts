import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { CreateAgentJobBodySchema } from "../../../schemas/agent-jobs";
import * as jobService from "../../../services/agent-jobs";
import type { Connections } from "../../../connectors/types";
import { listUnmetConnectorDetails } from "@/lib/agent-job-connector-requirements";
import {
  AgentJobErrorCode,
  ConnectorMissingError,
  DuplicateJobError,
  isConnectorMissingError,
  isDuplicateJobError,
} from "@/lib/agent-job-errors";

const connectorDetailSchema = z.object({
  id: z.string(),
  nangoKey: z.string(),
  name: z.string(),
  requirement: z.string(),
  unlisted: z.boolean().optional(),
});

const outputSchema = z.object({
  success: z.boolean(),
  jobId: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  connectors: z.array(connectorDetailSchema).optional(),
  agentIds: z.array(z.string()).optional(),
});

/**
 * Persists a scheduled job via the same path as POST /cowork/agent-jobs (Trigger schedule + DB row).
 * workspaceId / userId / optional proposedJobId come from requestContext (assist or /agent-jobs/ai), never from the model.
 */
export const createAgentJobTool = createTool({
  id: "createAgentJob",
  description:
    "Create a scheduled agent job. Requires name, prompt, cron schedule, timezone, agentIds (e.g. orchestrator or performance-marketing-manager), and optional connectorRequirements.",
  inputSchema: CreateAgentJobBodySchema,
  outputSchema,
  execute: async (input, context) => {
    const rc = context?.requestContext as
      | { get?: (k: string) => unknown; workspaceId?: string; userId?: string }
      | undefined;
    const workspaceId =
      (typeof rc?.get === "function" ? rc.get("workspaceId") : rc?.workspaceId) as
        | string
        | undefined;
    const userId =
      (typeof rc?.get === "function" ? rc.get("userId") : rc?.userId) as
        | string
        | undefined;
    const proposedJobId =
      typeof rc?.get === "function" ? rc.get("proposedJobId") : undefined;

    if (!workspaceId || !userId) {
      return {
        success: false,
        code: AgentJobErrorCode.REQUEST_CONTEXT_INCOMPLETE,
        error: "Missing workspace or user in request context",
      };
    }

    const jobId =
      typeof proposedJobId === "string" && proposedJobId.length > 0
        ? proposedJobId
        : crypto.randomUUID();
    try {
      const body = CreateAgentJobBodySchema.parse(input);
      const connections = (
        typeof rc?.get === "function" ? rc.get("__connections") : undefined
      ) as Connections | undefined;
      const unmet = listUnmetConnectorDetails(
        body.connectorRequirements ?? [],
        connections ?? {},
      );
      if (unmet.length > 0) {
        const names = unmet.map((c) => c.name).join(", ");
        return {
          success: false,
          code: AgentJobErrorCode.CONNECTOR_MISSING,
          error: `Missing required connections for: ${names}. Connect these integrations in Marketmint before creating this job.`,
          connectors: unmet,
          agentIds: body.agentIds ?? [],
        };
      }
      const job = await jobService.createJob(workspaceId, userId, jobId, body);
      return { success: true, jobId: job.id };
    } catch (e: unknown) {
      if (isConnectorMissingError(e)) {
        return {
          success: false,
          code: e.code,
          error: e.message,
          connectors: e.connectors,
          agentIds: e.agentIds,
        };
      }
      if (isDuplicateJobError(e)) {
        return {
          success: false,
          code: e.code,
          error: e.message,
        };
      }
      const message = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        code: AgentJobErrorCode.INTERNAL_ERROR,
        error: message,
      };
    }
  },
});
