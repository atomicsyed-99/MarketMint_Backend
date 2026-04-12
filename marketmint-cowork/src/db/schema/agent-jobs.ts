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
import { sql } from "drizzle-orm";

export const agentJobNotificationChannel = pgEnum("agent_job_notification_channel", [
  "email",
  "slack",
  "sms",
]);

export const agentJobs = pgTable(
  "agent_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    triggerScheduleId: text("trigger_schedule_id"),
    name: text("name").notNull(),
    description: text("description"),
    agentIds: text("agent_ids").array().notNull().default([]),
    prompt: text("prompt").notNull(),
    schedule: text("schedule").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    connectorRequirements: text("connector_requirements")
      .array()
      .default([]),
    notifyOnComplete: boolean("notify_on_complete").notNull().default(true),
    notifyOnFailure: boolean("notify_on_failure").notNull().default(true),
    notificationChannels: agentJobNotificationChannel("notification_channels").array().default(["email"]),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_agent_jobs_workspace").on(table.workspaceId, table.enabled),
    index("idx_agent_jobs_next_run")
      .on(table.nextRunAt)
      .where(sql`${table.enabled} = TRUE`),
  ],
);

export type AgentJob = typeof agentJobs.$inferSelect;
export type NewAgentJob = typeof agentJobs.$inferInsert;
