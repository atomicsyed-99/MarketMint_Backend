import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentJobs } from "./agent-jobs";

export const agentJobRunTypeEnum = pgEnum("agent_job_run_type", [
  "scheduled",
  "manual",
  "retry",
]);

export const agentJobRunStatusEnum = pgEnum("agent_job_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export const agentJobRuns = pgTable(
  "agent_job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    agentIds: text("agent_ids").array().notNull().default([]),
    runType: agentJobRunTypeEnum("run_type").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: agentJobRunStatusEnum("status").notNull(),
    prompt: text("prompt").notNull(),
    summary: text("summary"),
    output: jsonb("output").notNull().default({}),
    signals: text("signals").array().default(sql`'{}'`),
    tokenUsage: jsonb("token_usage").$type<TokenUsage>(),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 10,
      scale: 6,
    }),
    errorCode: text("error_code"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    triggerRunId: text("trigger_run_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_job_runs_job").on(table.jobId, table.createdAt),
    index("idx_job_runs_workspace_status").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    index("idx_job_runs_workspace_completed")
      .on(table.workspaceId, table.completedAt)
      .where(sql`${table.status} = 'completed'`),
  ],
);

export type AgentJobRun = typeof agentJobRuns.$inferSelect;
export type NewAgentJobRun = typeof agentJobRuns.$inferInsert;
