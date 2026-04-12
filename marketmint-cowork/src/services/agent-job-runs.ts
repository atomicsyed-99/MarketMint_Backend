import {
  createJobRun,
  getJobRunById,
  listRunsByJob as dbListRunsByJob,
  listRunsByWorkspace,
  getJobRunWithJobById,
  getLatestRunWithJobByJobId as dbGetLatestRunWithJobByJobId,
  getJobRunDetails,
} from "@/db/queries/agent-job-runs";
import { getJobById } from "@/db/queries/agent-jobs";
import { NotFoundError, ForbiddenError } from "./agent-jobs";
import type { CreateAgentJobRunBody, ListRunsByWorkspaceOrderBy } from "@/schemas/agent-job-runs";
import { getAgentJobChatByJobIdAndRunId } from "@/db/queries/agent-job-chats";

async function getJobOrThrow(jobId: string, workspaceId: string) {
  const job = await getJobById(jobId);
  if (!job) throw new NotFoundError("Job not found");
  if (job.workspaceId !== workspaceId) throw new ForbiddenError("Job belongs to another workspace");
  return job;
}

async function getRunOrThrow(runId: string, workspaceId: string) {
  const run = await getJobRunById(runId);
  if (!run) throw new NotFoundError("Run not found");
  if (run.workspaceId !== workspaceId) throw new ForbiddenError("Run belongs to another workspace");
  return run;
}

async function getRunWithJobOrThrow(runId: string, workspaceId: string) {
  const run = await getJobRunWithJobById(runId);
  if (!run) throw new NotFoundError("Run not found");
  if (run.workspaceId !== workspaceId) throw new ForbiddenError("Run belongs to another workspace");
  return run;
}

export async function triggerRun(
  jobId: string,
  workspaceId: string,
  body: CreateAgentJobRunBody,
) {
  const job = await getJobOrThrow(jobId, workspaceId);

  return createJobRun({
    jobId: job.id,
    workspaceId,
    name: body.name ?? "Manual Run",
    description: body.description,
    agentIds: job.agentIds ?? [],
    runType: body.runType ?? "manual",
    status: "pending",
    prompt: body.prompt ?? job.prompt,
    startedAt: new Date(),
  });
}

export async function getRun(runId: string, workspaceId: string) {
  return getRunOrThrow(runId, workspaceId);
}

export async function getRunWithJobById(runId: string, workspaceId: string) {
  return getRunWithJobOrThrow(runId, workspaceId);
}

export async function getRunDetails(runId: string, workspaceId: string) {
  const run = await getJobRunDetails(runId);
  if (!run) throw new NotFoundError("Run not found");
  if (run.workspaceId !== workspaceId) throw new ForbiddenError("Run belongs to another workspace");
  return run;
}

export async function getLatestRunWithJobByJobId(jobId: string, workspaceId: string) {
  const run = await dbGetLatestRunWithJobByJobId(jobId);
  if (!run) throw new NotFoundError("Run not found");
  
  if (run.workspaceId !== workspaceId) throw new ForbiddenError("Run belongs to another workspace");
  return run;
}

export async function listRunsByJob(
  jobId: string,
  workspaceId: string,
  opts?: { limit?: number; offset?: number },
) {
  await getJobOrThrow(jobId, workspaceId);
  return dbListRunsByJob(jobId, opts);
}

export async function listRuns(
  workspaceId: string,
  opts?: { status?: string; limit?: number; offset?: number; order?: "asc" | "desc"; orderBy?: ListRunsByWorkspaceOrderBy; agentIds?: string[] },
) {
  return listRunsByWorkspace(workspaceId, opts);
}

export async function buildTryInCoworkPrompt(
  runId: string,
  workspaceId: string,
  customPrompt?: string,
) {
  const run = await getRunDetails(runId, workspaceId);

  const agentJobChat = await getAgentJobChatByJobIdAndRunId(run.jobId, run.id);
  if (agentJobChat) {
    return { agentJobRunId: run.id, content: null, chatId: agentJobChat.chatId };
  }

  const job = run.job;
  const insights = run.insights ?? [];

  const lines: string[] = [
    `${job.name}`,
    "",
    job.description || "",
    "",
    `Schedule: ${job.schedule} (${job.timezone ?? "UTC"})`,
    "",
    "Latest Run Details",
    "",
    run.summary ? `Summary:\n${run.summary}` : "",
  ];
  
  if (insights.length > 0) {
    lines.push("", "Insights:", "");
    for (const insight of insights) {
      lines.push(`[${insight.severity}] ${insight.title}: ${insight.detail}`);
    }
  }
  
  if (customPrompt) {
    lines.push("", "--------------------------------", "", customPrompt);
  }
  
  const content = lines
    .filter((l) => l !== undefined && l !== "")
    .join("\n")
    .trim();
  
  return { agentJobRunId: run.id, content, chatId: null };
}