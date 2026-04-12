import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { agentJobs, type NewAgentJob } from "../schema/agent-jobs";

export async function createJob(data: NewAgentJob) {
  const [job] = await db.insert(agentJobs).values(data).returning();
  return job;
}

export async function createJobWithId(id: string, data: NewAgentJob) {
  const [job] = await db.insert(agentJobs).values({ ...data, id }).returning();
  return job;
}

export async function getJobById(id: string) {
  const [job] = await db
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.id, id));
  return job ?? null;
}

export async function listJobsByWorkspace(
  workspaceId: string,
  opts?: { enabledOnly?: boolean },
) {
  const conditions = [eq(agentJobs.workspaceId, workspaceId)];
  if (opts?.enabledOnly) {
    conditions.push(eq(agentJobs.enabled, true));
  }
  return db
    .select()
    .from(agentJobs)
    .where(and(...conditions))
    .orderBy(desc(agentJobs.createdAt));
}

export async function updateJob(
  id: string,
  data: Partial<Omit<NewAgentJob, "id" | "createdAt">>,
) {
  const [updated] = await db
    .update(agentJobs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agentJobs.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteJob(id: string) {
  await db.delete(agentJobs).where(eq(agentJobs.id, id));
}

export async function updateJobRunTimestamps(
  id: string,
  lastRunAt: Date,
  nextRunAt: Date | null,
) {
  const [updated] = await db
    .update(agentJobs)
    .set({ lastRunAt, nextRunAt, updatedAt: new Date() })
    .where(eq(agentJobs.id, id))
    .returning();
  return updated ?? null;
}
