import type { Context } from "hono";
import {
    AgentJobRunCardSchema,
  CreateAgentJobRunBodySchema,
  ListRunsByJobQuerySchema,
  ListRunsByWorkspaceQuerySchema,
} from "@/schemas/agent-job-runs";
import * as runService from "@/services/agent-job-runs";
import { NotFoundError, ForbiddenError } from "@/services/agent-jobs";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent-job-runs");

function getWorkspaceId(c: Context): string | null {
  const user = c.get("authUser");
  return user?.orgId ?? user?.id ?? null;
}

export async function createRunHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const jobId = c.req.param("jobId");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = CreateAgentJobRunBodySchema.safeParse({ ...raw, jobId });
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }

    if (!jobId) return c.json({ error: "Job ID required" }, 400);

    const run = await runService.triggerRun(jobId, workspaceId, parsed.data);
    return c.json(run, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "createRun failed");
    return c.json({ error: "Failed to create run" }, 500);
  }
}

export async function listRunsByJobHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const jobId = c.req.param("jobId");
    if (!jobId) return c.json({ error: "Job ID required" }, 400);

    const parsed = ListRunsByJobQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid query params", details: parsed.error.issues }, 400);
    }

    const runs = await runService.listRunsByJob(jobId, workspaceId, parsed.data);
    return c.json(runs, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "listRunsByJob failed");
    return c.json({ error: "Failed to list runs" }, 500);
  }
}

export async function listRunsHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const parsed = ListRunsByWorkspaceQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid query params", details: parsed.error.issues }, 400);
    }

    const runs = await runService.listRuns(workspaceId, parsed.data);
    const data = runs.map(run => AgentJobRunCardSchema.parse(run));
    return c.json(data, 200);
  } catch (err) {
    log.error({ err }, "listRuns failed");
    return c.json({ error: "Failed to list runs" }, 500);
  }
}

export async function getRunHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const runId = c.req.param("runId");
    if (!runId) return c.json({ error: "Run ID required" }, 400);

    const run = await runService.getRun(runId, workspaceId);
    return c.json(run, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "getRun failed");
    return c.json({ error: "Failed to get run" }, 500);
  }
}

export async function getRunDetailsHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const runId = c.req.param("runId");
    if (!runId) return c.json({ error: "Run ID required" }, 400);

    const run = await runService.getRunDetails(runId, workspaceId);
    return c.json(run, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);

    log.error({ err }, "getRunDetails failed");

    return c.json({ error: "Failed to get run details" }, 500);
  }
}


export async function getRunWithJobHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const runId = c.req.param("runId");
    if (!runId) return c.json({ error: "Run ID required" }, 400);

    const run = await runService.getRunWithJobById(runId, workspaceId);
    return c.json(run, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "getRunWithJob failed");
    return c.json({ error: "Failed to get run with job" }, 500);
  }
}

export async function tryInCoworkHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const runId = c.req.param("runId");
    if (!runId) return c.json({ error: "Run ID required" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const result = await runService.buildTryInCoworkPrompt(runId, workspaceId, body.customPrompt);
    return c.json(result, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);

    log.error({ err }, "tryInCowork failed");
    
    return c.json({ error: "Failed to build try-in-cowork prompt" }, 500);
  }
}