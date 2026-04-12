import type { Mastra } from "@mastra/core";
import { RequestContext } from "@mastra/core/request-context";
import { schedules } from "@trigger.dev/sdk/v3";
import {
  createJobWithId as dbCreateJobWithId,
  getJobById,
  listJobsByWorkspace,
  updateJob as dbUpdateJob,
  deleteJob as dbDeleteJob,
} from "@/db/queries/agent-jobs";
import type { CreateAgentJobBody, CreateAgentJobByAIBody, UpdateAgentJobBody } from "@/schemas/agent-jobs";
import { getUserConnections } from "@/connectors/nango/connections";
import {
  formatConnectionsForJobManagerPrompt,
  listUnmetConnectorDetails,
} from "../lib/agent-job-connector-requirements";
import {
  ConnectorMissingError,
  DuplicateJobError,
} from "@/lib/agent-job-errors";
import { agentJobExecutor } from "@/trigger/agent-job-executor";
import { createJobRun } from "@/db/queries/agent-job-runs";

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function getJobOrThrow(jobId: string, workspaceId: string) {
  const job = await getJobById(jobId);
  if (!job) throw new NotFoundError("Job not found");
  if (job.workspaceId !== workspaceId) throw new ForbiddenError("Job belongs to another workspace");
  return job;
}

const JOB_MANAGER_AI_API_PREFIX = `You are on the Marketmint **scheduled jobs API** (not general chat). Your only job is to call **createAgentJob** when possible.

CONNECTED INTEGRATIONS FOR THIS WORKSPACE:
`;

const JOB_MANAGER_AI_API_SUFFIX = `

Rules for this API:
- Do NOT route to or simulate the Store Manager or other specialists directly—you only configure **createAgentJob** so those agents run **on the schedule**.
- If the user wants recurring **images / video / copy**, set agentIds to **orchestrator** (or the right specialist) and put the generation instructions in **prompt** for each run.
- Set **connectorRequirements** only when the recurring **prompt** must call an integration API (Shopify catalog, Meta ads, Klaviyo, Google Analytics, etc.). Use **connectorRequirements: []** for everything else—including **HTML, CSV, JSON, markdown, PDF-style reports, or any static/generated file** that does not pull live data from a connected service.
- **Connectors — missing integration:** If the job **must** use a named integration, **always call createAgentJob** with the correct **connectorRequirements** (e.g. meta-ads for Meta ads). Do **not** skip the tool to explain in prose—the server rejects with a structured **missing connector** response the client can render. Do **not** guess that a job “needs” a connector from vague wording; if they did not ask for a specific integration, use **connectorRequirements: []** and proceed.
- **Connectors — offline / creative:** Jobs that do not need live API data use **connectorRequirements: []** and **createAgentJob** as usual—missing integrations do not matter for those.
- **When to refuse (no tool call):** Requests that are not legitimate scheduled Marketmint work—e.g. **profanity or harassment**, **sexual or other NSFW** content, **generic chit-chat** (weather, jokes, unrelated trivia), or anything unrelated to configuring a recurring job—decline briefly and do **not** call createAgentJob.
- **Structured parameters:** When a **STRUCTURED JOB PARAMETERS** block appears below, you MUST pass its **schedule** (cron), **timezone** (IANA), **name**, **description** (if any), **prompt** (per-run template), **notifyOnComplete**, and **notifyOnFailure** **exactly** into **createAgentJob**. The user text may not repeat time or frequency—those values are already chosen in that block. Choose **agentIds** and **connectorRequirements** from the job intent (**connectorRequirements** = which APIs the recurring prompt must call, regardless of current connection status—the tool validates). Do not override the structured schedule or timezone unless they are invalid.
- If there is **no** structured block, infer cron, timezone, name, and schedule from the user's wording; use sensible defaults. No multi-turn questions.

USER TASK (per-run intent; may omit timing if structured fields above list it):
`;

/** Max steps for job manager only (single agent + one tool). */
const CREATE_JOB_BY_AI_MAX_STEPS = 12;

function formatStructuredJobParametersBlock(body: CreateAgentJobByAIBody): string {
  const desc =
    body.description !== undefined && body.description !== ""
      ? body.description
      : "(none)";
  return `STRUCTURED JOB PARAMETERS (from API client — use EXACTLY in createAgentJob for these fields):
- name: ${body.name}
- description: ${desc}
- schedule (cron): ${body.schedule}
- timezone (IANA): ${body.timezone}
- notifyOnComplete: ${body.notifyOnComplete}
- notifyOnFailure: ${body.notifyOnFailure}
- notificationChannels: ${body.notificationChannels.join(", ")}
- metadata: ${JSON.stringify(body.metadata)}
- prompt (template executed on each run): ${body.prompt}`;
}

/**
 * Runs **agentsJobManagerAgent** directly with `generate()` so routing never goes through the
 * main orchestrator (which would otherwise mix immediate chat routing with job setup).
 */
export async function createJobByAI(
  mastra: Mastra,
  workspaceId: string,
  userId: string,
  jobId: string,
  email: string,
  body: CreateAgentJobByAIBody,
) {
  const existingJob = await getJobById(jobId);
  if (existingJob) {
    throw new Error("Job already exists");
  }

  const connections = await getUserConnections(workspaceId);
  const requestContext = new RequestContext();
  requestContext.set("userId", userId);
  requestContext.set("workspaceId", workspaceId);
  requestContext.set("email", email);
  requestContext.set("proposedJobId", jobId);
  requestContext.set("__connections", connections);

  let agent: Awaited<ReturnType<Mastra["getAgent"]>>;
  try {
    agent = await mastra.getAgent("agentsJobManagerAgent" as any);
  } catch {
    throw new Error("agentsJobManagerAgent not registered");
  }

  const nowIso = new Date().toISOString();
  const connectedBlock = formatConnectionsForJobManagerPrompt(connections);
  const structuredBlock = formatStructuredJobParametersBlock(body);
  const prompt = `${JOB_MANAGER_AI_API_PREFIX}Current date and time (ISO UTC): ${nowIso}

${connectedBlock}

${structuredBlock}

${JOB_MANAGER_AI_API_SUFFIX}${body.prompt}`;

  return agent.generate(prompt, {
    requestContext,
    maxSteps: CREATE_JOB_BY_AI_MAX_STEPS,
    memory: {
      thread: { id: `job-ai-${jobId}` },
      resource: workspaceId,
    },
  });
}

export async function createJob(
  workspaceId: string,
  userId: string,
  jobId: string,
  body: CreateAgentJobBody,
) {
  const existingJob = await getJobById(jobId);
  if (existingJob) {
    throw new DuplicateJobError();
  }

  const connectionsForJob = await getUserConnections(workspaceId);
  const unmet = listUnmetConnectorDetails(
    body.connectorRequirements ?? [],
    connectionsForJob,
  );
  if (unmet.length > 0) {
    const names = unmet.map((c) => c.name).join(", ");
    throw new ConnectorMissingError(
      `Missing required connections for: ${names}. Connect these integrations in Marketmint before creating this job.`,
      unmet,
      body.agentIds ?? [],
    );
  }

  const createdSchedule = await schedules.create({
    task: agentJobExecutor.id,
  
    cron: body.schedule,
    
    timezone: body.timezone,
    
    externalId: `${workspaceId}:${jobId}`,
    
    deduplicationKey: `${workspaceId}:${jobId}`,
  });
  
  const createdJob = await dbCreateJobWithId(jobId, {
    workspaceId,
    createdByUserId: userId,
    name: body.name,
    description: body.description,
    agentIds: body.agentIds,
    prompt: body.prompt,
    schedule: body.schedule,
    timezone: body.timezone,
    enabled: body.enabled,
    connectorRequirements: body.connectorRequirements,
    notifyOnComplete: body.notifyOnComplete,
    notifyOnFailure: body.notifyOnFailure,
    notificationChannels: body.notificationChannels,
    metadata: body.metadata,
    triggerScheduleId: createdSchedule.id,
    nextRunAt: createdSchedule.nextRun
  });

  await createJobRun({
    jobId,
    workspaceId,
    agentIds: body.agentIds,
    runType: "scheduled",
    name: createdJob.name,
    description: createdJob.description,
    status: "pending",
    prompt: body.prompt,
    scheduledAt: createdSchedule.nextRun,
  });

  return createdJob;
}


export async function scheduleNextRun(jobId: string, workspaceId: string, nextRunAt: Date) {
  const job = await getJobById(jobId);
  if (!job) throw new NotFoundError("Job not found");
  if (job.workspaceId !== workspaceId) throw new ForbiddenError("Job belongs to another workspace");

  if (!job.enabled) throw new Error("Job is not enabled");

  await dbUpdateJob(jobId, { nextRunAt });

  await createJobRun({
    jobId,
    workspaceId,
    name: job.name,
    description: job.description,
    agentIds: job.agentIds,
    runType: "scheduled",
    status: "pending",
    prompt: job.prompt,
    scheduledAt: nextRunAt,
  });
}

export async function getJob(jobId: string, workspaceId: string) {
  return getJobOrThrow(jobId, workspaceId);
}

export async function listJobs(
  workspaceId: string,
  opts?: { enabledOnly?: boolean },
) {
  return listJobsByWorkspace(workspaceId, opts);
}

async function toggleTriggerSchedule(scheduleId: string | null, enabled: boolean) {
  if(!scheduleId) return;

  if(enabled) {
    await schedules.activate(scheduleId);
  } else {
    await schedules.deactivate(scheduleId);
  }
}

async function updateTriggerSchedule(scheduleId: string | null, schedule: string, timezone: string) {
  if(!scheduleId) return;
  
  await schedules.update(scheduleId, {
    task: agentJobExecutor.id,
    cron: schedule,
    timezone: timezone,
  });
}

export async function updateJob(
  jobId: string,
  workspaceId: string,
  body: UpdateAgentJobBody,
) {
  const existingJob = await getJobOrThrow(jobId, workspaceId);

  const job = await dbUpdateJob(jobId, body);

  if (existingJob.enabled !== job.enabled) {
    await toggleTriggerSchedule(job.triggerScheduleId, job.enabled);
  }

  if (existingJob.schedule !== job.schedule || existingJob.timezone !== job.timezone) {
    await updateTriggerSchedule(job.triggerScheduleId, job.schedule, job.timezone);
  }

  return job;
}

export async function deleteJob(jobId: string, workspaceId: string) {
  const job = await getJobOrThrow(jobId, workspaceId);

  if(job.triggerScheduleId) {
    await schedules.del(job.triggerScheduleId);
  }

  await dbDeleteJob(jobId);
}
