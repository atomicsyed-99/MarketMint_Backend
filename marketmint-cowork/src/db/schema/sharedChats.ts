import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chats } from "./chats";

/** Aligns with Python `shared_chats` (ULID primary key). */
export const sharedChats = pgTable("shared_chats", {
  id: text("id").primaryKey(),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
