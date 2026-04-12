import type { UnmetConnectorDetail } from "@/lib/agent-job-connector-requirements";

/** Stable API codes for agent job creation (HTTP + tool). */
export const AgentJobErrorCode = {
  CONNECTOR_MISSING: "CONNECTOR_MISSING",
  JOB_ALREADY_EXISTS: "JOB_ALREADY_EXISTS",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  WORKSPACE_REQUIRED: "WORKSPACE_REQUIRED",
  REQUEST_CONTEXT_INCOMPLETE: "REQUEST_CONTEXT_INCOMPLETE",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  /** AI path: no row persisted; see `detail` / tool result */
  JOB_NOT_CREATED: "JOB_NOT_CREATED",
  AI_TOOL_CREATE_FAILED: "AI_TOOL_CREATE_FAILED",
  AI_RUN_SUSPENDED: "AI_RUN_SUSPENDED",
  AI_GENERATION_ERROR: "AI_GENERATION_ERROR",
  ASSISTANT_COMPLETED_NO_JOB: "ASSISTANT_COMPLETED_NO_JOB",
  NO_TOOL_CALL_OR_MESSAGE: "NO_TOOL_CALL_OR_MESSAGE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type AgentJobErrorCodeType =
  (typeof AgentJobErrorCode)[keyof typeof AgentJobErrorCode];

export class ConnectorMissingError extends Error {
  readonly code = AgentJobErrorCode.CONNECTOR_MISSING;

  constructor(
    message: string,
    public readonly connectors: UnmetConnectorDetail[],
    public readonly agentIds: string[],
  ) {
    super(message);
    this.name = "ConnectorMissingError";
  }
}

export class DuplicateJobError extends Error {
  readonly code = AgentJobErrorCode.JOB_ALREADY_EXISTS;

  constructor(message = "Job already exists") {
    super(message);
    this.name = "DuplicateJobError";
  }
}

export function isConnectorMissingError(e: unknown): e is ConnectorMissingError {
  return e instanceof ConnectorMissingError;
}

export function isDuplicateJobError(e: unknown): e is DuplicateJobError {
  return e instanceof DuplicateJobError;
}
