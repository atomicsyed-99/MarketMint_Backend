import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const geoPromptSourceEnum = pgEnum("geo_prompt_source", ["auto", "manual"]);

export const geoPrompts = pgTable(
  "geo_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    promptText: text("prompt_text").notNull(),
    category: text("category"),
    source: geoPromptSourceEnum("source").notNull().default("auto"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_geo_prompts_workspace_active").on(
      table.workspaceId,
      table.isActive,
      table.createdAt,
    ),
    uniqueIndex("ux_geo_prompts_workspace_prompt").on(
      table.workspaceId,
      table.promptText,
    ),
  ],
);

export type GeoPrompt = typeof geoPrompts.$inferSelect;
export type NewGeoPrompt = typeof geoPrompts.$inferInsert;
