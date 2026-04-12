import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { chats } from "./chats";
import { agentJobs } from "./agent-jobs";
import { agentJobRuns } from "./agent-job-runs";

export const agentJobChats = pgTable(
  "agent_job_chats",
  {
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    agentJobId: uuid("agent_job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    agentJobRunId: uuid("agent_job_run_id")
      .notNull()
      .references(() => agentJobRuns.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.agentJobId, table.agentJobRunId] }),
  ],
);
