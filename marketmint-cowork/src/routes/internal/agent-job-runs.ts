import type { Context } from "hono";
import { z } from "zod";
import { Mastra } from "@mastra/core";

import { getLatestRunWithJobByJobId } from "@/services/agent-job-runs";
import {
  getJob,
  scheduleNextRun,
  updateJob,
  NotFoundError,
  ForbiddenError,
} from "@/services/agent-jobs";
import { updateJobRun } from "@/db/queries/agent-job-runs";
import type { TokenUsage } from "@/db/schema/agent-job-runs";
import { createInsights } from "@/services/agent-job-insights";
import { executeAgentJobRunById } from "@/lib/execute-agent";
import { sendAgentJobNotification } from "@/services/notifications";
import { sendAgentJobSlackNotification } from "@/services/slack";
import { getInternalUserIdByClerkUserId, getUserEmailByUserId } from "@/db/queries/users";
import {
  fallbackJobRunSummaryFromDump,
  generateInsightsFromJobRunDump,
  generateJobRunSummaryFromDump,
} from "@/lib/agent-job-run-insights-llm";
import { storeJobRunAssetsFromDump } from "@/lib/agent-job-run-store-assets";
import { deductCreditsForConversation } from "@/lib/call-python-assets-credits";
import { aggregatedOutputTokensFromAgentFinish } from "@/lib/conversation-output-tokens";
import { createLogger } from "@/lib/logger";
import { AGENT_JOB_TOKEN_SLACK_ALERT_THRESHOLD } from "@/constants";

const log = createLogger("internal-agent-job-runs");

function totalUsageToTokenUsage(u: unknown): TokenUsage | undefined {
  if (!u || typeof u !== "object") return undefined;
  const o = u as Record<string, number>;
  const promptTokens = Number(o.promptTokens ?? o.inputTokens ?? 0);
  const completionTokens = Number(o.completionTokens ?? o.outputTokens ?? 0);
  const totalTokens = Number(o.totalTokens ?? promptTokens + completionTokens);
  return { promptTokens, completionTokens, totalTokens };
}

export const ExecuteAgentJobRunBodySchema = z.object({
  jobId: z.string(),
  workspaceId: z.string(),
  triggerRunId: z.string(),
  nextRunAt: z.coerce.date().nullable(),
});

export type ExecuteAgentJobRunBody = z.infer<typeof ExecuteAgentJobRunBodySchema>;

export async function executeAgentJobRunHandler(c: Context) {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = ExecuteAgentJobRunBodySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);

  let runId: string | undefined;
  const runStartedAt = new Date();
  let userEmail: string | undefined;
  let jobName: string | undefined;
  let slackChannel: string | undefined;
  let nextJobCreated: boolean = false;

  const { jobId, workspaceId, triggerRunId, nextRunAt } = parsed.data;
  try {
    const job = await getJob(jobId, workspaceId);

    const run = await getLatestRunWithJobByJobId(jobId, workspaceId);

    if (run.status === "running") return c.json({ error: "Run is already running" }, 400);

    if (run.status === "completed") return c.json(run, 200);

    runId = run.id;

    userEmail = await getUserEmailByUserId(job.createdByUserId);
    jobName = job.name;

    await updateJob(jobId, workspaceId, {
      lastRunAt: runStartedAt,
    });

    if(nextRunAt) {
      await scheduleNextRun(jobId, workspaceId, new Date(nextRunAt));
      nextJobCreated = true;
    }

    await updateJobRun(run.id, {
      status: "running",
      startedAt: runStartedAt,
      triggerRunId: triggerRunId,
    });
    const mastra = c.get("mastra") as Mastra;
    const { dumped, targetAgentId } = await executeAgentJobRunById(mastra, job.id);

    await storeJobRunAssetsFromDump({
      dumped,
      workspaceId,
      userId: job.createdByUserId,
      userEmail: userEmail ?? "",
      jobId: job.id,
      runId: run.id,
      jobName: job.name,
    });

    const outputTok = aggregatedOutputTokensFromAgentFinish(dumped);
    if (outputTok > 0) {
      const creditResult = await deductCreditsForConversation({
        userId: (await getInternalUserIdByClerkUserId(job.createdByUserId)) ?? job.createdByUserId,
        workspaceId,
        totalTokens: outputTok,
      });
      if (!creditResult.success) {
        log.warn(
          { jobId, workspaceId, runId, outputTok, message: creditResult.message },
          "agent job conversation credits deduction did not succeed",
        );
      }
    }

    const [summaryLlm, insightRows] = await Promise.all([
      generateJobRunSummaryFromDump(dumped),
      generateInsightsFromJobRunDump(dumped, targetAgentId),
    ]);
    const summaryText = summaryLlm ?? fallbackJobRunSummaryFromDump(dumped);

    if (insightRows.length > 0) {
      await createInsights(
        workspaceId,
        insightRows.map((row) => ({
          ...row,
          runId,
          agentId: row.agentId ?? job.agentIds?.[0] ?? targetAgentId,
        })),
      );
    }

    const runCompletedAt = new Date();
    const durationMs = runCompletedAt.getTime() - runStartedAt.getTime();

    await updateJobRun(runId, {
      status: "completed",
      output: dumped,
      summary: summaryText,
      signals: [],
      tokenUsage: totalUsageToTokenUsage(dumped.totalUsage),
      durationMs: durationMs,
      triggerRunId: triggerRunId,
      completedAt: runCompletedAt,
    });
    
    if(userEmail) {
      await sendAgentJobNotification(
        userEmail,
        workspaceId,
        runId,
        `Agent job - ${jobName} completed`,
        `Agent job - ${jobName} completed\n Click here to view the results`,
        [],
      );
    }

    slackChannel = job.notificationChannels?.includes("slack") ? (job.metadata?.slackChannel as string | undefined) : undefined;
    if (slackChannel) {
      await sendAgentJobSlackNotification(workspaceId, slackChannel, {
        jobName: jobName ?? "Agent Job",
        agentJobRunId: runId,
        status: "completed",
        summary: summaryText,
      }).catch((err) => log.warn({ err }, "Slack notification failed (non-blocking)"));

      const tokenUsage = totalUsageToTokenUsage(dumped.totalUsage);
      const totalTokens = tokenUsage?.totalTokens ?? 0;
      if (totalTokens > AGENT_JOB_TOKEN_SLACK_ALERT_THRESHOLD) {
        await sendAgentJobSlackNotification(workspaceId, slackChannel, {
          jobName: jobName ?? "Agent Job",
          agentJobRunId: runId,
          status: "token_warning",
          summary: `This run used ${totalTokens.toLocaleString()} total tokens (alert threshold: ${AGENT_JOB_TOKEN_SLACK_ALERT_THRESHOLD.toLocaleString()}). Consider reviewing or narrowing the scheduled prompt.`,
        }).catch((err) =>
          log.warn({ err }, "Slack token-usage alert failed (non-blocking)"),
        );
      }
    }

    return c.json(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (!runId) {
      if (err instanceof NotFoundError) {
        log.warn(
          { jobId, workspaceId, error: err.message },
          "executeAgentJobRun: job or run not found before execution",
        );
        return c.json({ error: err.message }, 404);
      }
      if (err instanceof ForbiddenError) {
        log.warn({ jobId, workspaceId, error: err.message }, "executeAgentJobRun: forbidden");
        return c.json({ error: err.message }, 403);
      }
      log.error({ err, jobId, workspaceId, message }, "executeAgentJobRun failed before run started");
      return c.json({ error: message }, 500);
    }

    await updateJobRun(runId, {
      status: "failed",
      error: message,
      triggerRunId: triggerRunId,
      durationMs: Date.now() - runStartedAt.getTime(),
    });

    if(userEmail) {
      await sendAgentJobNotification(
        userEmail,
        workspaceId,
        runId,
        `Agent job - ${jobName} failed`,
        `Agent job - ${jobName} failed\n Click here to view the results`,
        [],
      );
    }

    if (slackChannel) {
      await sendAgentJobSlackNotification(workspaceId, slackChannel, {
        jobName: jobName ?? "Agent Job",
        agentJobRunId: runId!,
        status: "failed",
        summary: message,
      }).catch((e) => log.warn({ err: e }, "Slack failure notification failed (non-blocking)"));
    }

    log.error({ err, jobId, workspaceId, runId, message }, "executeAgentJobRun failed");

    if(nextRunAt && !nextJobCreated) {
      await scheduleNextRun(jobId, workspaceId, new Date(nextRunAt));
    }

    return c.json({ error: message }, 500);
  }
}