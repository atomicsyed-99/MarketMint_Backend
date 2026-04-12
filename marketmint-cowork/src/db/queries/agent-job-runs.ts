import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  agentJobRuns,
  type NewAgentJobRun,
  type TokenUsage,
} from "../schema/agent-job-runs";
import { ListRunsByWorkspaceOrderBy } from "@/schemas/agent-job-runs";

export async function createJobRun(data: NewAgentJobRun) {
  const [run] = await db.insert(agentJobRuns).values(data).returning();
  return run;
}

export async function createJobRunWithId(id: string, data: NewAgentJobRun) {
  const [run] = await db.insert(agentJobRuns).values({ ...data, id }).returning();
  return run;
}

export async function getJobRunById(id: string) {
  const [run] = await db
    .select()
    .from(agentJobRuns)
    .where(eq(agentJobRuns.id, id));
  return run ?? null;
}

export async function getJobRunWithJobById(id: string) {
  return db.query.agentJobRuns.findFirst({
    where: eq(agentJobRuns.id, id),
    with: {
      job: true,
    },
  });
}

export async function getJobRunDetails(id: string) {
  return db.query.agentJobRuns.findFirst({
    where: eq(agentJobRuns.id, id),
    with: {
      job: true,
      insights: true,
    },
  });
}

export async function getLatestRunWithJobByJobId(jobId: string) {
  return db.query.agentJobRuns.findFirst({
    where: eq(agentJobRuns.jobId, jobId),
    with: {
      job: true,
    },
    orderBy: desc(agentJobRuns.scheduledAt ?? agentJobRuns.createdAt),
  });
}

export async function listRunsByJob(
  jobId: string,
  opts?: { limit?: number; offset?: number },
) {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  return db
    .select()
    .from(agentJobRuns)
    .where(eq(agentJobRuns.jobId, jobId))
    .orderBy(desc(agentJobRuns.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function listRunsByWorkspace(
  workspaceId: string,
  opts?: { status?: string; limit?: number; offset?: number; order?: "asc" | "desc"; orderBy?: ListRunsByWorkspaceOrderBy; agentIds?: string[] },
) {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const conditions = [eq(agentJobRuns.workspaceId, workspaceId)];
  if (opts?.status) {
    conditions.push(
      eq(
        agentJobRuns.status,
        opts.status as (typeof agentJobRuns.status.enumValues)[number],
      ),
    );
  }

  if (opts?.agentIds) {
    conditions.push(
      sql`${agentJobRuns.agentIds} && ${opts.agentIds}`
    )
  }

  return db
    .select()
    .from(agentJobRuns)
    .where(and(...conditions))
    .orderBy(opts?.order === "asc" ? asc(agentJobRuns[opts?.orderBy ?? "createdAt"]) : desc(agentJobRuns[opts?.orderBy ?? "createdAt"]))
    .limit(limit)
    .offset(offset);
}

export async function updateJobRun(
  id: string,
  data: Partial<Omit<NewAgentJobRun, "id" | "createdAt">>,
) {
  const [updated] = await db
    .update(agentJobRuns)
    .set(data)
    .where(eq(agentJobRuns.id, id))
    .returning();
  return updated ?? null;
}

export async function completeJobRun(
  id: string,
  data: {
    summary?: string;
    output?: Record<string, unknown>;
    signals?: string[];
    tokenUsage?: TokenUsage;
    estimatedCostUsd?: string;
    durationMs?: number;
  },
) {
  const now = new Date();
  const [updated] = await db
    .update(agentJobRuns)
    .set({
      status: "completed",
      summary: data.summary,
      output: data.output,
      signals: data.signals,
      tokenUsage: data.tokenUsage,
      estimatedCostUsd: data.estimatedCostUsd,
      durationMs: data.durationMs,
      completedAt: now,
    })
    .where(eq(agentJobRuns.id, id))
    .returning();
  return updated ?? null;
}

export async function failJobRun(
  id: string,
  error: string,
  durationMs?: number,
) {
  const now = new Date();
  const [updated] = await db
    .update(agentJobRuns)
    .set({
      status: "failed",
      error,
      durationMs,
      completedAt: now,
    })
    .where(eq(agentJobRuns.id, id))
    .returning();
  return updated ?? null;
}
