import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { geoPrompts } from "./geo-prompts";

export const geoContent = pgTable(
  "geo_content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => geoPrompts.id, { onDelete: "cascade" }),
    contentMarkdown: text("content_markdown").notNull(),
    contentPdfUrl: text("content_pdf_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_geo_content_workspace_created").on(table.workspaceId, table.createdAt),
    index("idx_geo_content_prompt_created").on(table.promptId, table.createdAt),
  ],
);

export type GeoContent = typeof geoContent.$inferSelect;
export type NewGeoContent = typeof geoContent.$inferInsert;
