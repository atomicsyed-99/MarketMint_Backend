import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agentJobRuns } from "./agent-job-runs";

export const insightTypeEnum = pgEnum("insight_type", [
  "finding",
  "trend",
  "correlation",
  "anomaly",
]);

export const insightSeverityEnum = pgEnum("insight_severity", [
  "critical",
  "warning",
  "info",
]);

export type InsightMetric = {
  name: string;
  value: number;
  unit: string;
  direction?: string;
};

export type RelatedEntity = {
  type: string;
  id: string;
  name: string;
};

export const agentJobInsights = pgTable(
  "agent_job_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    runId: uuid("run_id").references(() => agentJobRuns.id, {
      onDelete: "set null",
    }),
    insightType: insightTypeEnum("insight_type").notNull(),
    severity: insightSeverityEnum("severity").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    metric: jsonb("metric").$type<InsightMetric>(),
    relatedEntity: jsonb("related_entity").$type<RelatedEntity>(),
    dismissed: boolean("dismissed").notNull().default(false),
    dismissedByUserId: text("dismissed_by_user_id"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_insights_workspace").on(
      table.workspaceId,
      table.dismissed,
      table.createdAt,
    ),
    index("idx_insights_severity").on(
      table.workspaceId,
      table.severity,
      table.createdAt,
    ),
  ],
);

export type AgentJobInsight = typeof agentJobInsights.$inferSelect;
export type NewAgentJobInsight = typeof agentJobInsights.$inferInsert;
