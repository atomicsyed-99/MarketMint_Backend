import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { geoPrompts } from "./geo-prompts";

export type CitationSource = {
  name: string;
  url: string;
  rank: number;
  isBrand: boolean;
};

export type SentimentValue = "positive" | "neutral" | "negative";

export const geoAuditResults = pgTable(
  "geo_audit_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => geoPrompts.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    isCited: boolean("is_cited").notNull().default(false),
    citationRank: integer("citation_rank"),
    citationUrl: text("citation_url"),
    responseSnippet: text("response_snippet"),
    citationSources: jsonb("citation_sources").$type<CitationSource[]>().notNull().default([]),
    sentiment: text("sentiment").$type<SentimentValue>(),
    competingBrands: text("competing_brands").array().notNull().default([]),
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>().notNull().default({}),
    auditedAt: timestamp("audited_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_geo_audit_workspace_time").on(table.workspaceId, table.auditedAt),
    index("idx_geo_audit_prompt_provider_time").on(
      table.promptId,
      table.provider,
      table.auditedAt,
    ),
  ],
);

export type GeoAuditResult = typeof geoAuditResults.$inferSelect;
export type NewGeoAuditResult = typeof geoAuditResults.$inferInsert;
