import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const InsightTypeSchema = z
  .enum(["finding", "trend", "correlation", "anomaly"])
  .describe("Classification of the insight");

export const InsightSeveritySchema = z
  .enum(["critical", "warning", "info"])
  .describe("Severity level indicating urgency");

// ---------------------------------------------------------------------------
// Nested objects
// ---------------------------------------------------------------------------

export const InsightMetricSchema = z.object({
  name: z.string().describe("Metric name (e.g. 'conversion_rate')"),
  value: z.number().describe("Numeric metric value"),
  unit: z.string().describe("Unit of measurement (e.g. '%', 'USD', 'orders')"),
  direction: z
    .string()
    .optional()
    .describe("Trend direction (e.g. 'up', 'down', 'flat')"),
});

export const RelatedEntitySchema = z.object({
  type: z.string().describe("Entity type (e.g. 'product', 'campaign', 'collection')"),
  id: z.string().describe("Entity identifier"),
  name: z.string().describe("Human-readable entity name"),
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateAgentJobInsightBodySchema = z.object({
  runId: z
    .string()
    .uuid()
    .optional()
    .describe("Run that produced this insight (nullable if created independently)"),
  insightType: InsightTypeSchema,
  severity: InsightSeveritySchema,
  title: z
    .string()
    .min(1)
    .max(200)
    .describe("Short headline for the insight"),
  detail: z
    .string()
    .min(1)
    .describe("Full explanation of the insight with supporting context"),
  metric: InsightMetricSchema.optional()
    .describe("Optional quantitative metric associated with this insight"),
  relatedEntity: RelatedEntitySchema.optional()
    .describe("Optional related business entity (product, campaign, etc.)"),
  agentId: z
    .string()
    .optional()
    .describe("Agent that generated this insight"),
});

export type CreateAgentJobInsightBody = z.infer<typeof CreateAgentJobInsightBodySchema>;

// ---------------------------------------------------------------------------
// Query params for listing
// ---------------------------------------------------------------------------

export const ListInsightsQuerySchema = z.object({
  includeDismissed: z
    .coerce.boolean()
    .default(false)
    .describe("Include previously dismissed insights in results"),
  severity: InsightSeveritySchema.optional()
    .describe("Filter by severity level"),
  limit: z.coerce.number().int().positive().max(100).default(50)
    .describe("Maximum number of insights to return"),
  offset: z.coerce.number().int().nonnegative().default(0)
    .describe("Number of insights to skip (for pagination)"),
});

// ---------------------------------------------------------------------------
// Dismiss
// ---------------------------------------------------------------------------

export const DismissInsightBodySchema = z.object({
  id: z.string().uuid().describe("ID of the insight to dismiss"),
});

export type DismissInsightBody = z.infer<typeof DismissInsightBodySchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const AgentJobInsightSchema = z.object({
  id: z.string().uuid().describe("Unique insight identifier"),
  workspaceId: z.string().describe("Workspace that owns this insight"),
  runId: z
    .string()
    .uuid()
    .nullable()
    .describe("Run that produced this insight, if any"),
  insightType: InsightTypeSchema,
  severity: InsightSeveritySchema,
  title: z.string().describe("Short headline"),
  detail: z.string().describe("Full explanation"),
  metric: InsightMetricSchema.nullable()
    .describe("Quantitative metric, if applicable"),
  relatedEntity: RelatedEntitySchema.nullable()
    .describe("Related business entity, if applicable"),
  agentId: z.string().nullable().describe("Agent that generated this insight"),
  dismissed: z.boolean().describe("Whether the insight has been dismissed"),
  dismissedByUserId: z
    .string()
    .nullable()
    .describe("User who dismissed this insight"),
  dismissedAt: z
    .string()
    .datetime()
    .nullable()
    .describe("When the insight was dismissed"),
  createdAt: z.string().datetime().describe("When the insight was created"),
});

export type AgentJobInsightResponse = z.infer<typeof AgentJobInsightSchema>;
