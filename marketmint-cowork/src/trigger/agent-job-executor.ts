import { ExecuteAgentJobRunBody } from "@/routes/internal/agent-job-runs";
import { schedules } from "@trigger.dev/sdk/v3";
import { getInternalApiUrl, getApiKey } from "./internal-client";

const MAX_DURATION_SECONDS = 600;
const MACHINE_TYPE = "small-2x";

async function executeAgentJobRun(payload: ExecuteAgentJobRunBody) {
  const url = getInternalApiUrl(`/cowork/internal/agent-job-runs/execute`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": getApiKey(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw new Error(`Failed to execute agent job run: ${response.statusText}`);
  return response.json();
}



export const agentJobExecutor = schedules.task({
  id: "agent-job-executor",
  maxDuration: MAX_DURATION_SECONDS,
  machine: MACHINE_TYPE,
  queue: {
    name: "agent-job-executor",
  },
  retry: {
    maxAttempts: 0
  },
  run: async (payload, { ctx }) => {
    if (!payload.externalId) throw new Error("externalId is required");

    const [workspaceId, jobId] = payload.externalId.split(":");
    if (!workspaceId || !jobId) throw new Error("Invalid externalId");

    const result = await executeAgentJobRun({
      jobId,
      workspaceId,
      triggerRunId: ctx.run.id,
      nextRunAt: payload.upcoming[0] ?? null,
    });

    return result;
  },
});