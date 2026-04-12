import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import {
  agentJobInsights,
  type NewAgentJobInsight,
} from "../schema/agent-job-insights";

export async function createInsight(data: NewAgentJobInsight) {
  const [insight] = await db
    .insert(agentJobInsights)
    .values(data)
    .returning();
  return insight;
}

export async function createInsights(data: NewAgentJobInsight[]) {
  if (data.length === 0) return [];
  return db.insert(agentJobInsights).values(data).returning();
}

export async function listInsightsByWorkspace(
  workspaceId: string,
  opts?: {
    includeDismissed?: boolean;
    severity?: string;
    limit?: number;
    offset?: number;
  },
) {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const conditions = [eq(agentJobInsights.workspaceId, workspaceId)];
  if (!opts?.includeDismissed) {
    conditions.push(eq(agentJobInsights.dismissed, false));
  }
  if (opts?.severity) {
    conditions.push(
      eq(
        agentJobInsights.severity,
        opts.severity as (typeof agentJobInsights.severity.enumValues)[number],
      ),
    );
  }
  return db
    .select()
    .from(agentJobInsights)
    .where(and(...conditions))
    .orderBy(desc(agentJobInsights.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function dismissInsight(id: string, userId: string) {
  const now = new Date();
  const [updated] = await db
    .update(agentJobInsights)
    .set({
      dismissed: true,
      dismissedByUserId: userId,
      dismissedAt: now,
    })
    .where(eq(agentJobInsights.id, id))
    .returning();
  return updated ?? null;
}

export async function getInsightsByRunId(runId: string) {
  return db
    .select()
    .from(agentJobInsights)
    .where(eq(agentJobInsights.runId, runId))
    .orderBy(desc(agentJobInsights.createdAt));
}
