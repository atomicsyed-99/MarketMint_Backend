import {
  listInsightsByWorkspace,
  dismissInsight as dbDismissInsight,
  getInsightsByRunId,
  createInsight as dbCreateInsight,
  createInsights as dbCreateInsights,
} from "@/db/queries/agent-job-insights";
import { getJobRunById } from "@/db/queries/agent-job-runs";
import { NotFoundError, ForbiddenError } from "./agent-jobs";
import { CreateAgentJobInsightBody } from "@/schemas/agent-job-insights";

export async function createInsight(workspaceId: string, body: CreateAgentJobInsightBody) {
  const insight = await dbCreateInsight({
    ...body,
    workspaceId,
  });
  return insight;
}

export async function createInsights(workspaceId: string, body: CreateAgentJobInsightBody[]) {
  const insights = await dbCreateInsights(body.map((b) => ({
    ...b,
    workspaceId,
  })));
  return insights;
}

export async function listInsights(
  workspaceId: string,
  opts?: {
    includeDismissed?: boolean;
    severity?: string;
    limit?: number;
    offset?: number;
  },
) {
  return listInsightsByWorkspace(workspaceId, opts);
}

export async function dismissInsight(
  insightId: string,
  workspaceId: string,
  userId: string,
) {
  const result = await dbDismissInsight(insightId, userId);
  if (!result) throw new NotFoundError("Insight not found");
  if (result.workspaceId !== workspaceId) {
    throw new ForbiddenError("Insight belongs to another workspace");
  }
  return result;
}

export async function getRunInsights(runId: string, workspaceId: string) {
  const run = await getJobRunById(runId);
  if (!run) throw new NotFoundError("Run not found");
  if (run.workspaceId !== workspaceId) {
    throw new ForbiddenError("Run belongs to another workspace");
  }
  return getInsightsByRunId(runId);
}
