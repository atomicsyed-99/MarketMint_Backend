import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const shopifyApps = pgTable(
  "shopify_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    providerConfigKey: text("provider_config_key").notNull().unique(),
    appName: text("app_name").notNull(),
    clientIdLast4: text("client_id_last4"),
    storeDomain: text("store_domain"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("pending"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("shopify_apps_workspace_active_idx")
      .on(table.workspaceId)
      .where(sql`disabled_at IS NULL`),
    check(
      "shopify_apps_status_check",
      sql`status IN ('pending', 'active', 'failed', 'deleting')`,
    ),
  ],
);

export type ShopifyApp = typeof shopifyApps.$inferSelect;
export type NewShopifyApp = typeof shopifyApps.$inferInsert;
export type ShopifyAppStatus = "pending" | "active" | "failed" | "deleting";
