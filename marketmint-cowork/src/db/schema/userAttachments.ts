import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const userAttachments = pgTable("user_attachments", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  url: text("url").notNull(),
  key: text("key").notNull(),
  tag: text("tag").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

