import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const cronExpression = z
  .string()
  .min(1)
  .describe("Cron expression defining the job schedule (e.g. '0 9 * * 1' for every Monday 9 AM)");

const ianaTimezone = z
  .string()
  .default("UTC")
  .describe("IANA timezone for the cron schedule (e.g. 'America/New_York')");

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateAgentJobBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .describe("Human-readable name for the job"),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("Optional longer description of what the job does"),
  agentIds: z
    .array(z.string().min(1))
    .min(1)
    .describe("Sub-agent IDs to run this job with"),
  prompt: z
    .string()
    .min(1)
    .describe("Prompt template sent to the agent on each run"),
  schedule: cronExpression,
  timezone: ianaTimezone,
  enabled: z
    .boolean()
    .default(true)
    .describe("Whether the job is active and will be triggered on schedule"),
  connectorRequirements: z
    .array(z.string())
    .default([])
    .describe("Provider config keys the job needs (e.g. 'shopify', 'klaviyo'). Validated before each run."),
  notifyOnComplete: z
    .boolean()
    .default(true)
    .describe("Send a notification when the job completes successfully"),
  notifyOnFailure: z
    .boolean()
    .default(true)
    .describe("Send a notification when the job fails"),
  notificationChannels: z
    .array(z.enum(["email", "slack", "sms"]))
    .default(["email"])
    .describe("Channels to send notifications to"),
  metadata: z.record(z.string(), z.any()).optional().describe("Metadata to store with the job"),
});

export type CreateAgentJobBody = z.infer<typeof CreateAgentJobBodySchema>;

export const CreateAgentJobByAIBodySchema = z.object({
  name: z.string().min(1).describe("Human-readable name for the job"),
  description: z.string().max(500).optional().describe("Optional longer description of what the job does"),
  prompt: z.string().min(1).describe("Prompt template sent to the AI to create the job"),
  schedule: cronExpression,
  timezone: ianaTimezone,
  notifyOnComplete: z.boolean().default(true).describe("Send a notification when the job completes successfully"),
  notifyOnFailure: z.boolean().default(true).describe("Send a notification when the job fails"),
  notificationChannels: z.array(z.enum(["email", "slack", "sms"])).default(["email"]).describe("Channels to send notifications to"),
  metadata: z.record(z.string(), z.any()).optional().describe("Metadata to store with the job"),
});

export type CreateAgentJobByAIBody = z.infer<typeof CreateAgentJobByAIBodySchema>;

// ---------------------------------------------------------------------------
// Update (partial of create, all optional)
// ---------------------------------------------------------------------------

export const UpdateAgentJobBodySchema = CreateAgentJobBodySchema.partial().extend({
  lastRunAt: z.coerce.date().nullable().optional(),
  nextRunAt: z.coerce.date().nullable().optional(),
});

export type UpdateAgentJobBody = z.infer<typeof UpdateAgentJobBodySchema>;

// ---------------------------------------------------------------------------
// Query params for listing
// ---------------------------------------------------------------------------

export const ListAgentJobsQuerySchema = z.object({
  enabledOnly: z
    .coerce.boolean()
    .optional()
    .describe("When true, only return enabled jobs"),
});

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const AgentJobSchema = z.object({
  id: z.string().uuid().describe("Unique job identifier"),
  workspaceId: z.string().describe("Workspace that owns this job"),
  createdByUserId: z.string().describe("User who created the job"),
  triggerScheduleId: z
    .string()
    .nullable()
    .describe("Trigger.dev schedule ID used for updates and deletes"),
  name: z.string().describe("Human-readable job name"),
  description: z.string().nullable().describe("Optional job description"),
  agentIds: z
    .array(z.string())
    .describe("Sub-agent IDs assigned to this job"),
  prompt: z.string().describe("Prompt template for each run"),
  schedule: cronExpression,
  timezone: ianaTimezone,
  enabled: z.boolean().describe("Whether the job is active"),
  connectorRequirements: z
    .array(z.string())
    .nullable()
    .describe("Required connector provider config keys"),
  notifyOnComplete: z.boolean().describe("Notify on successful completion"),
  notifyOnFailure: z.boolean().describe("Notify on failure"),
  notificationChannels: z
    .array(z.enum(["email", "slack", "sms"]))
    .describe("Channels to send notifications to"),
  metadata: z.record(z.string(), z.any()).optional().describe("Metadata to store with the job"),
  lastRunAt: z
    .string()
    .datetime()
    .nullable()
    .describe("Timestamp of the most recent run"),
  nextRunAt: z
    .string()
    .datetime()
    .nullable()
    .describe("Computed next scheduled run time"),
  createdAt: z.string().datetime().describe("When the job was created"),
  updatedAt: z.string().datetime().describe("When the job was last modified"),
});

export type AgentJobResponse = z.infer<typeof AgentJobSchema>;
