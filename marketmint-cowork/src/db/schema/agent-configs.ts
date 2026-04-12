import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type AgentConnector = {
  providerKey: string;
  label: string;
  available: boolean;
};

export type AgentConfigJob = {
  title: string;
  description: string | null;
  connectors: string[];
};

export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    role: text("role").notNull(),
    available: boolean("available").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    avatarColor: text("avatar_color").notNull(),
    avatarSrc: text("avatar_src").notNull(),
    description: text("description"),
    connectors: jsonb("connectors")
      .$type<AgentConnector[]>()
      .notNull()
      .default([]),
    jobs: jsonb("jobs").$type<AgentConfigJob[]>().notNull().default([]),
    soulMd: text("soul_md"),
    howToUse: text("how_to_use").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_agent_configs_workspace").on(table.workspaceId),
    index("idx_agent_configs_workspace_key").on(
      table.workspaceId,
      table.key,
    ),
  ],
);

export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;
