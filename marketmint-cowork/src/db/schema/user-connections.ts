import {
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const userConnections = pgTable(
  "user_connections",
  {
    workspaceId: text("workspace_id").notNull(),
    providerConfigKey: text("provider_config_key").notNull(),
    connectionId: text("connection_id").notNull(),
    connectedByUserId: text("connected_by_user_id").notNull(),
    nangoRaw: jsonb("nango_raw").$type<Record<string, unknown>>(),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    disconnectedByUserId: text("disconnected_by_user_id"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.providerConfigKey] }),
  ],
);

export type UserConnection = typeof userConnections.$inferSelect;
export type NewUserConnection = typeof userConnections.$inferInsert;
