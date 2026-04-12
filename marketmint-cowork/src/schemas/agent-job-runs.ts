import { z } from "zod";
import { AgentJobSchema } from "./agent-jobs";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const AgentJobRunTypeSchema = z
  .enum(["scheduled", "manual", "retry"])
  .describe("How the run was initiated");

export const AgentJobRunStatusSchema = z
  .enum(["pending", "running", "completed", "failed", "skipped", "cancelled"])
  .describe("Current lifecycle status of the run");

// ---------------------------------------------------------------------------
// Nested objects
// ---------------------------------------------------------------------------

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().describe("Tokens consumed by the prompt"),
  completionTokens: z.number().int().nonnegative().describe("Tokens generated in the completion"),
  totalTokens: z.number().int().nonnegative().describe("Total tokens (prompt + completion)"),
});

// ---------------------------------------------------------------------------
// Create (for manual / retry triggers)
// ---------------------------------------------------------------------------

export const CreateAgentJobRunBodySchema = z.object({
  jobId: z
    .string()
    .uuid()
    .describe("ID of the parent agent_job"),
  runType: AgentJobRunTypeSchema.default("manual"),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Name of the run"),
  description: z
    .string()
    .optional()
    .describe("Description of the run"),
  prompt: z
    .string()
    .min(1)
    .optional()
    .describe("Override prompt for this run. Falls back to the job's prompt if omitted."),
});

export type CreateAgentJobRunBody = z.infer<typeof CreateAgentJobRunBodySchema>;

// ---------------------------------------------------------------------------
// Query params for listing
// ---------------------------------------------------------------------------

export const ListRunsByJobQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50)
    .describe("Maximum number of runs to return"),
  offset: z.coerce.number().int().nonnegative().default(0)
    .describe("Number of runs to skip (for pagination)"),
});

export enum ListRunsByWorkspaceOrderBy {
  createdAt = "createdAt",
  scheduledAt = "scheduledAt",
  startedAt = "startedAt",
  completedAt = "completedAt",
}

export const ListRunsByWorkspaceQuerySchema = z.object({
  status: AgentJobRunStatusSchema.optional()
    .describe("Filter runs by status"),
  limit: z.coerce.number().int().positive().max(100).default(50)
    .describe("Maximum number of runs to return"),
  offset: z.coerce.number().int().nonnegative().default(0)
    .describe("Number of runs to skip (for pagination)"),
  orderBy: z.enum(ListRunsByWorkspaceOrderBy).optional().default(ListRunsByWorkspaceOrderBy.createdAt),
  order: z.enum(["asc", "desc"]).optional().default("desc")
    .describe("Order by created_at"),
  agentIds: z.array(z.string()).optional()
    .describe("Filter runs by agent IDs"),
});

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const AgentJobRunSchema = z.object({
  id: z.string().uuid().describe("Unique run identifier"),
  jobId: z.string().uuid().describe("Parent job ID"),
  workspaceId: z.string().describe("Workspace that owns this run"),
  agentIds: z.array(z.string()).describe("Agent IDs that executed (or will execute) this run"),
  runType: AgentJobRunTypeSchema,
  name: z.string().describe("Name of the run"),
  description: z
  .string()
  .nullable()
  .describe("Description of the run"),
  status: AgentJobRunStatusSchema,
  prompt: z.string().describe("Prompt snapshot used for this run"),
  summary: z
    .string()
    .nullable()
    .describe("LLM-generated summary of the run output"),
  output: z
    .record(z.string(), z.unknown())
    .describe("Full agent response including text and tool results"),
  signals: z
    .array(z.string())
    .nullable()
    .describe("Extracted signals from the run (e.g. 'fatigue_detected')"),
  tokenUsage: TokenUsageSchema.nullable()
    .describe("Token consumption breakdown"),
  estimatedCostUsd: z
    .string()
    .nullable()
    .describe("Estimated LLM cost for this run in USD"),
  errorCode: z
    .string()
    .nullable()
    .describe("Error code if the run failed"),
  error: z
    .string()
    .nullable()
    .describe("Error message if the run failed"),
  durationMs: z
    .number()
    .int()
    .nullable()
    .describe("Wall-clock duration of the run in milliseconds"),
  triggerRunId: z
    .string()
    .nullable()
    .describe("Trigger.dev run ID for distributed tracing"),
  scheduledAt: z
    .coerce.date()
    .nullable()
    .describe("When the run was originally scheduled to execute"),
  startedAt: z
    .coerce.date()
    .nullable()
    .describe("When the agent started processing"),
  completedAt: z
    .coerce.date()
    .nullable()
    .describe("When the run finished (success or failure)"),
  createdAt: z.coerce.date().describe("When the run record was created"),
});

export type AgentJobRunResponse = z.infer<typeof AgentJobRunSchema>;

export const AgentJobRunWithJobSchema = AgentJobRunSchema.extend({
  job: AgentJobSchema,
});

export type AgentJobRunWithJobResponse = z.infer<typeof AgentJobRunWithJobSchema>;

export const UpdateAgentJobRunBodySchema = AgentJobRunSchema.omit({
  id: true,
  jobId: true,
  workspaceId: true,
  agentIds: true,
  runType: true,
  createdAt: true,
}).partial();

export type UpdateAgentJobRunBody = z.infer<typeof UpdateAgentJobRunBodySchema>;

export const AgentJobRunStructuredOutputSchema = z.object({
  // need to change this entire schema to have the raw generate output dump from the agent.
  output: z.record(z.string(), z.unknown()).describe("Full agent response including text and tool results"),
});

export const AgentJobRunCardSchema = AgentJobRunSchema.pick({
  id: true,
  jobId: true,
  workspaceId: true,
  agentIds: true,
  name: true,
  description: true,
  createdAt: true,
  scheduledAt: true,
  completedAt: true,
  durationMs: true,
});