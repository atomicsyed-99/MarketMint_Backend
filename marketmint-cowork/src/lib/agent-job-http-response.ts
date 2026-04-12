import type { Context } from "hono";
import { AgentJobErrorCode } from "@/lib/agent-job-errors";
import type { UnmetConnectorDetail } from "@/lib/agent-job-connector-requirements";

export type AgentJobErrorBody = {
  code: string;
  error: string;
  detail?: string;
  connectors?: UnmetConnectorDetail[];
  agentIds?: string[];
  details?: unknown;
};

type AgentJobErrorHttpStatus = 400 | 403 | 404 | 409 | 422 | 500;

export function jsonAgentJobError(
  c: Context,
  status: AgentJobErrorHttpStatus,
  body: AgentJobErrorBody,
) {
  return c.json(body, status);
}

export function userNotFoundResponse(c: Context) {
  return jsonAgentJobError(c, 404, {
    code: AgentJobErrorCode.USER_NOT_FOUND,
    error: "User not found",
  });
}

export function workspaceRequiredResponse(c: Context) {
  return jsonAgentJobError(c, 422, {
    code: AgentJobErrorCode.WORKSPACE_REQUIRED,
    error: "Workspace required",
  });
}
