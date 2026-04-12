import type { Mastra } from "@mastra/core";
import { RequestContext } from "@mastra/core/request-context";
import {
  createEmptyConnectorProcessor,
  getOrCreateConnectorProcessor,
} from "@/connectors/build-toolset";
import { buildConnectorSystemPrompt } from "@/connectors/prompt";
import { getUserConnections } from "@/connectors/nango/connections";
import { getLatestRunWithJobByJobId } from "@/db/queries/agent-job-runs";
import {
  resolveJobTargetAgentId,
  mastraRegistryKeyForJobAgentId,
  readOnlyActiveToolNamesForSpecialist,
  type JobExecutableAgentId,
} from "@/lib/agent-job-readonly-tools";
import { serializeAgentGenerateResult } from "@/lib/serialize-agent-generate-output";
import { getUserEmailByUserId } from "@/db/queries/users";
import { instructionsWithSoulMd } from "@/lib/agent-instructions-with-soul";
import { staticPromptForExecutableAgent } from "@/lib/agent-static-prompts";
import {
  filterScheduledOrchestratorToolNames,
  scheduledJobTextLooksLikePlanOnlyDeferral,
  SCHEDULED_JOB_FINAL_SYSTEM_OVERRIDE,
} from "@/lib/scheduled-job-execution";

const SCHEDULED_JOB_SYSTEM = `You are executing a scheduled background job. There is no chat UI.

Rules:
- Do not ask the user questions; use defaults and tools to complete the task.
- Use the appropriate tools (generation, workflows, reports, artifacts) to produce real outputs.
- Connector write operations (e.g. Shopify order changes) are not available; generation and read tools are.`;

function buildRequestContext(params: {
  workspaceId: string;
  userId: string;
  jobId: string;
  runId: string;
  jobName: string;
}) {
  const { workspaceId, userId, jobId, runId, jobName } = params;
  const ctx = new RequestContext();
  ctx.set("userId", userId);
  ctx.set("email", "");
  ctx.set("workspaceId", workspaceId);
  ctx.set("jobId", jobId);
  ctx.set("runId", runId);
  ctx.set("jobName", jobName);
  ctx.set("executionSource", "scheduled_job" as const);
  // Synthetic chat scope so Asset Manager gets referenceType "chat" (same as interactive chat).
  ctx.set("chatId", `scheduled-job:${jobId}`);
  ctx.set("responseMessageId", `scheduled-run:${runId}`);
  return ctx;
}

function pickTargetAgentIdFromRun(
  runAgentIds: string[],
  jobAgentIds: string[],
): string {
  const first = runAgentIds[0] ?? jobAgentIds[0];
  return first ?? "auto";
}

export type ExecuteAgentJobRunResult = {
  /** JSON-safe snapshot of Mastra `generate()` FullOutput */
  dumped: Record<string, unknown>;
  targetAgentId: JobExecutableAgentId;
};

/**
 * Runs read-only agent.generate for a pending run. Caller persists output / insights.
 */
export async function executeAgentJobRunById(
  mastra: Mastra,
  jobId: string,
): Promise<ExecuteAgentJobRunResult> {
  const run = await getLatestRunWithJobByJobId(jobId);
  if (!run) throw new Error("Run not found");

  const workspaceId = run.workspaceId;
  const userId = run.job.createdByUserId;
  const rawAgent = pickTargetAgentIdFromRun(run.agentIds ?? [], run.job.agentIds ?? []);
  const targetAgentId: JobExecutableAgentId = resolveJobTargetAgentId(rawAgent);

  const connections = await getUserConnections(workspaceId);
  const jobOwnerEmail = (await getUserEmailByUserId(userId)) ?? "";
  const requestContext = buildRequestContext({
    workspaceId,
    userId,
    jobId: run.jobId,
    runId: run.id,
    jobName: run.job.name,
  });
  if (jobOwnerEmail) {
    requestContext.set("email", jobOwnerEmail);
  }
  if (targetAgentId === "geo-optimizer") {
    requestContext.set("directGenBm", true);
  }
  requestContext.set("__connections", connections);

  const connectorProcessor =
    getOrCreateConnectorProcessor(workspaceId, connections) ??
    createEmptyConnectorProcessor();
  requestContext.set("__connectorProcessor", connectorProcessor);

  const mastraAgentKey = mastraRegistryKeyForJobAgentId(targetAgentId);

  let agent: Awaited<ReturnType<Mastra["getAgent"]>>;
  try {
    agent = await mastra.getAgent(mastraAgentKey as any);
  } catch {
    throw new Error(`Unknown agent: ${targetAgentId}`);
  }

  let activeTools = readOnlyActiveToolNamesForSpecialist(
    targetAgentId,
    requestContext,
  );

  if (targetAgentId === "orchestrator") {
    activeTools = filterScheduledOrchestratorToolNames(activeTools);
  }

  if (activeTools.length === 0) {
    throw new Error("No tools available for this agent/workspace (check connections).");
  }

  const nowLine = `Current date and time (ISO UTC): ${new Date().toISOString()}`;
  const connectorPrompt = buildConnectorSystemPrompt(connections);
  const staticPrompt = staticPromptForExecutableAgent(targetAgentId);
  const compositeBase = [
    SCHEDULED_JOB_SYSTEM,
    nowLine,
    connectorPrompt,
    staticPrompt,
  ]
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .join("\n\n");

  const system =
    (await instructionsWithSoulMd(
      requestContext,
      targetAgentId,
      compositeBase,
    )) + SCHEDULED_JOB_FINAL_SYSTEM_OVERRIDE;

  const generateOpts: Record<string, unknown> = {
    requestContext,
    maxSteps: 32,
    memory: {
      thread: `job-run-${run.id}`,
      resource: workspaceId,
    },
    system,
    inputProcessors: [connectorProcessor],
    activeTools,
  };

  if (targetAgentId === "orchestrator") {
    generateOpts.delegation = {
      onDelegationStart: async () => ({
        proceed: false,
        rejectionReason:
          "Scheduled read-only runs cannot delegate. Use a specialist agent on the job if you need a specific domain.",
      }),
    };
  }

  try {
    const result: any = await agent.generate(run.prompt, generateOpts as any);

    if (result.finishReason === "suspended") {
      throw new Error(
        "Run suspended (e.g. tool approval). Scheduled jobs cannot resume approval flows.",
      );
    }

    if (result.error) {
      throw new Error(result.error?.message ?? String(result.error));
    }

    const textOut =
      typeof result.text === "string" ? result.text : "";
    if (textOut && scheduledJobTextLooksLikePlanOnlyDeferral(textOut)) {
      throw new Error(
        "Scheduled job stopped with a plan/approval/deferral message instead of completing the task. Adjust the job prompt or agent; interactive plan flows are disabled for cron runs.",
      );
    }

    const dumped = serializeAgentGenerateResult(result as Record<string, unknown>);

    return { dumped, targetAgentId };
  } catch (e: unknown) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}