import { chats } from "@/db/schema/chats";
import { messages } from "@/db/schema/messages";

export type ChatRow = typeof chats.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

/** Python-style snake_case JSON for chat rows. */
export function serializeChat(row: ChatRow) {
  return {
    id: row.id,
    user_id: row.userId,
    workspace_id: row.workspaceId,
    title: row.title,
    version: row.version,
    deleted_at: row.deletedAt,
    created_at: row.createdAt,
    last_updated: row.lastUpdated,
  };
}

/**
 * Content part types that are backend-only plumbing — stripped before
 * sending to the frontend.  See docs/stream-storage-architecture.md.
 */
const STRIP_CONTENT_TYPES = new Set(["tool-invocation", "step-start"]);

/** Python-style snake_case JSON for message rows. */
export function serializeMessage(row: MessageRow) {
  const content = Array.isArray(row.content)
    ? row.content.filter((p: any) => !STRIP_CONTENT_TYPES.has(p?.type))
    : row.content;

  return {
    id: row.id,
    message_id: row.messageId,
    chat_id: row.chatId,
    role: row.role,
    agent: row.agent,
    content,
    attachments: row.attachments,
    tool_calls: row.toolCalls,
    llm_usage: row.llmUsage,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
