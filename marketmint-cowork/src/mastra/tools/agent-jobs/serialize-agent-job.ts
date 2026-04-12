import type { AgentJob } from "@/db/schema/agent-jobs";

/** JSON-safe job shape for tools (matches API-style fields). */
export function serializeAgentJobForTool(
  job: AgentJob,
  opts?: { truncatePromptAt?: number },
) {
  const max = opts?.truncatePromptAt;
  const prompt =
    max != null && job.prompt.length > max
      ? `${job.prompt.slice(0, max)}…`
      : job.prompt;

  return {
    id: job.id,
    name: job.name,
    description: job.description,
    prompt,
    agentIds: job.agentIds,
    schedule: job.schedule,
    timezone: job.timezone,
    enabled: job.enabled,
    connectorRequirements: job.connectorRequirements ?? [],
    notifyOnComplete: job.notifyOnComplete,
    notifyOnFailure: job.notifyOnFailure,
    notificationChannels: job.notificationChannels ?? [],
    metadata: job.metadata ?? {},
    lastRunAt: job.lastRunAt?.toISOString() ?? null,
    nextRunAt: job.nextRunAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
