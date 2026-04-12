import type { Context } from "hono";
import { Mastra } from "@mastra/core";
import {
  CreateAgentJobBodySchema,
  UpdateAgentJobBodySchema,
  ListAgentJobsQuerySchema,
  CreateAgentJobByAIBodySchema,
} from "@/schemas/agent-jobs";
import * as jobService from "@/services/agent-jobs";
import { NotFoundError, ForbiddenError } from "@/services/agent-jobs";
import { createLogger } from "@/lib/logger";
import { getInternalUserIdByClerkUserId } from "@/db/queries/users";
import { explainAgentJobNotCreated } from "@/lib/agent-job-ai-create-explain";
import {
  AgentJobErrorCode,
  isConnectorMissingError,
  isDuplicateJobError,
} from "@/lib/agent-job-errors";
import {
  jsonAgentJobError,
  userNotFoundResponse,
  workspaceRequiredResponse,
} from "@/lib/agent-job-http-response";

const log = createLogger("agent-jobs");

/** Same scope as chat + connectors Nango `end_user_id` (see chat.ts, connectors.ts). */
function getWorkspaceId(c: Context): string | null {
  const user = c.get("authUser");
  return user?.orgId ?? user?.id ?? null;
}

export async function createJobByAIHandler(c: Context) {
  try {
    const user = c.get("authUser");
    const internalUserId = await getInternalUserIdByClerkUserId(user.id);
    if (!internalUserId) return userNotFoundResponse(c);
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return workspaceRequiredResponse(c);

    const jobId = c.req.query("jobId") ?? crypto.randomUUID();

    const raw = await c.req.json().catch(() => ({}));
    const parsed = CreateAgentJobByAIBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonAgentJobError(c, 400, {
        code: AgentJobErrorCode.VALIDATION_ERROR,
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const mastra = c.get("mastra") as Mastra;
    const generateResult = await jobService.createJobByAI(
      mastra,
      workspaceId,
      internalUserId,
      jobId,
      user.email,
      parsed.data,
    );

    try {
      const job = await jobService.getJob(jobId, workspaceId);
      return c.json(job, 200);
    } catch (getErr) {
      if (getErr instanceof NotFoundError) {
        const explained = await explainAgentJobNotCreated(generateResult);
        log.warn(
          { jobId, code: explained.code, error: explained.error, hasDetail: Boolean(explained.detail) },
          "createJobByAI: no job row after generate; returning assistant/tool explanation",
        );
        return jsonAgentJobError(c, 422, {
          code: explained.code,
          error: explained.error,
          ...(explained.detail !== undefined ? { detail: explained.detail } : {}),
          ...(explained.connectors !== undefined
            ? { connectors: explained.connectors }
            : {}),
          ...(explained.agentIds !== undefined ? { agentIds: explained.agentIds } : {}),
        });
      }
      throw getErr;
    }
  } catch (err) {
    if (err instanceof NotFoundError) {
      log.warn({ err: err.message }, "createJobByAI: not found");
      return jsonAgentJobError(c, 404, {
        code: AgentJobErrorCode.NOT_FOUND,
        error: err.message,
      });
    }
    if (err instanceof ForbiddenError) {
      log.warn({ err: err.message }, "createJobByAI: forbidden");
      return jsonAgentJobError(c, 403, {
        code: AgentJobErrorCode.FORBIDDEN,
        error: err.message,
      });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error({ err, message }, "createJobByAI failed");
    return jsonAgentJobError(c, 500, {
      code: AgentJobErrorCode.INTERNAL_ERROR,
      error: message,
    });
  }
}

export async function createJobHandler(c: Context) {
  try {
    const user = c.get("authUser");
    const internalUserId = await getInternalUserIdByClerkUserId(user.id);
    if (!internalUserId) return userNotFoundResponse(c);
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return workspaceRequiredResponse(c);

    const jobId = c.req.query("jobId") ?? crypto.randomUUID();

    const raw = await c.req.json().catch(() => ({}));
    const parsed = CreateAgentJobBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonAgentJobError(c, 400, {
        code: AgentJobErrorCode.VALIDATION_ERROR,
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const job = await jobService.createJob(workspaceId, internalUserId, jobId, parsed.data);
    return c.json(job, 200);
  } catch (err) {
    if (isConnectorMissingError(err)) {
      return jsonAgentJobError(c, 422, {
        code: err.code,
        error: err.message,
        connectors: err.connectors,
        agentIds: err.agentIds,
      });
    }
    if (isDuplicateJobError(err)) {
      return jsonAgentJobError(c, 409, {
        code: err.code,
        error: err.message,
      });
    }
    if (err instanceof NotFoundError) {
      log.warn({ err: err.message }, "createJob: not found");
      return jsonAgentJobError(c, 404, {
        code: AgentJobErrorCode.NOT_FOUND,
        error: err.message,
      });
    }
    if (err instanceof ForbiddenError) {
      log.warn({ err: err.message }, "createJob: forbidden");
      return jsonAgentJobError(c, 403, {
        code: AgentJobErrorCode.FORBIDDEN,
        error: err.message,
      });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error({ err, message }, "createJob failed");
    return jsonAgentJobError(c, 500, {
      code: AgentJobErrorCode.INTERNAL_ERROR,
      error: message,
    });
  }
}

export async function listJobsHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const parsed = ListAgentJobsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid query params", details: parsed.error.issues }, 400);
    }

    const jobs = await jobService.listJobs(workspaceId, parsed.data);
    return c.json(jobs, 200);
  } catch (err) {
    log.error({ err }, "listJobs failed");
    return c.json({ error: "Failed to list jobs" }, 500);
  }
}

export async function getJobHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const jobId = c.req.param("jobId");
    if (!jobId) return c.json({ error: "Job ID required" }, 400);

    const job = await jobService.getJob(jobId, workspaceId);
    return c.json(job, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "getJob failed");
    return c.json({ error: "Failed to get job" }, 500);
  }
}

export async function updateJobHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const jobId = c.req.param("jobId");
    if (!jobId) return c.json({ error: "Job ID required" }, 400);

    const raw = await c.req.json().catch(() => ({}));
    const parsed = UpdateAgentJobBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }

    const updated = await jobService.updateJob(jobId, workspaceId, parsed.data);
    return c.json(updated, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "updateJob failed");
    return c.json({ error: "Failed to update job" }, 500);
  }
}

export async function deleteJobHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const jobId = c.req.param("jobId");
    if (!jobId) return c.json({ error: "Job ID required" }, 400);

    await jobService.deleteJob(jobId, workspaceId);
    return c.json({ success: true }, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "deleteJob failed");
    return c.json({ error: "Failed to delete job" }, 500);
  }
}
