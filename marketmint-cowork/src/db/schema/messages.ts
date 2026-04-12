import {
  bigserial,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { chats } from "./chats";

export const messageRoleEnum = pgEnum("messagerole", ["user", "ai", "tool"]);
export const messageAgentEnum = pgEnum("messageagent", [
  "none",
  "photographer",
  "developer",
  "planner",
  "finisher",
]);

export type MessagePart = {
  id?: string;
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type Attachment = {
  id?: string;
  url: string;
  [key: string]: unknown;
};

export const messages = pgTable("messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  messageId: uuid("message_id").unique().defaultRandom().notNull(),
  chatId: uuid("chat_id")
    .references(() => chats.id)
    .notNull(),
  role: messageRoleEnum("role").notNull(),
  agent: messageAgentEnum("agent").default("none"),
  content: jsonb("content").$type<MessagePart[]>().default([]),
  attachments: jsonb("attachments").$type<Attachment[]>().default([]),
  toolCalls: jsonb("tool_calls").default([]),
  llmUsage: jsonb("llm_usage"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type NewMessage = typeof messages.$inferInsert;

