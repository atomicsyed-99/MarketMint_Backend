import type { Context } from "hono";
import { ListInsightsQuerySchema } from "@/schemas/agent-job-insights";
import * as insightService from "@/services/agent-job-insights";
import { NotFoundError, ForbiddenError } from "@/services/agent-jobs";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent-job-insights");

function getWorkspaceId(c: Context): string | null {
  const user = c.get("authUser");
  return user?.orgId ?? user?.id ?? null;
}

export async function listInsightsHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const parsed = ListInsightsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid query params", details: parsed.error.issues }, 400);
    }

    const insights = await insightService.listInsights(workspaceId, parsed.data);
    return c.json(insights, 200);
  } catch (err) {
    log.error({ err }, "listInsights failed");
    return c.json({ error: "Failed to list insights" }, 500);
  }
}

export async function dismissInsightHandler(c: Context) {
  try {
    const user = c.get("authUser");
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const insightId = c.req.param("insightId");
    if (!insightId) return c.json({ error: "Insight ID required" }, 400);

    const insight = await insightService.dismissInsight(insightId, workspaceId, user.id);
    return c.json(insight, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "dismissInsight failed");
    return c.json({ error: "Failed to dismiss insight" }, 500);
  }
}

export async function getRunInsightsHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const runId = c.req.param("runId");
    if (!runId) return c.json({ error: "Run ID required" }, 400);

    const insights = await insightService.getRunInsights(runId, workspaceId);
    return c.json(insights, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "getRunInsights failed");
    return c.json({ error: "Failed to get run insights" }, 500);
  }
}
