import type { Context } from "hono";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { chats } from "@/db/schema/chats";
import { messages } from "@/db/schema/messages";
import { sharedChats } from "@/db/schema/sharedChats";
import { serializeChat, serializeMessage } from "@/lib/api-serialization";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export async function getSharedChat(c: Context) {
  const id = c.req.param("id")!;
  if (!ULID_RE.test(id)) {
    return c.json({ error: "Shared chat not found" }, 404);
  }

  const authUser = c.get("authUser");
  const workspaceId =authUser?.orgId;

  const row = await db.query.sharedChats.findFirst({
    where: eq(sharedChats.id, id),
  });
  if (!row) return c.json({ error: "Shared chat not found" }, 404);

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, row.chatId),
  });
  if (!chat) return c.json({ error: "Shared chat not found" }, 404);
  if (chat.deletedAt) {
    return c.json({ error: "Chat is no longer available" }, 410);
  }

  const email = authUser?.email;
  if (email) {
    if (!row.isPublic) {
      if (
        !(
          chat.workspaceId &&
          workspaceId &&
          chat.workspaceId === workspaceId
        )
      ) {
        return c.json({ error: "Chat is no longer available" }, 410);
      }
    }
  } else if (!row.isPublic) {
    return c.json({ error: "Chat is no longer available" }, 410);
  }

  const chatMessages = await db.query.messages.findMany({
    where: eq(messages.chatId, chat.id),
    orderBy: [asc(messages.updatedAt)],
  });

  return c.json({
    chat: serializeChat(chat),
    messages: chatMessages.map(serializeMessage),
  });
};
