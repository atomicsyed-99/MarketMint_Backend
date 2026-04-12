import type { Context } from "hono";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("chats");
import { ulid } from "ulid";
import { db } from "@/db/client";
import { chats } from "@/db/schema/chats";
import { messages } from "@/db/schema/messages";
import { sharedChats } from "@/db/schema/sharedChats";
import { serializeChat, serializeMessage } from "@/lib/api-serialization";
import { getWorkspaceId } from "@/lib/workspace-context";
import { upsertExecutionForChat } from "@/lib/executions-sync";

type CreateChatBody = {
  title?: string;
  version?: string;
  workspace_id?: string;
};

export async function createChat(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);
  const userEmail = user.email?.trim() || `${user.id}@placeholder.local`;
  let internalUserId: string | null = null;
  try {
    const existingByClerk = (await db.execute(sql`
      SELECT id
      FROM public.users
      WHERE clerk_user_id = ${user.id}
      LIMIT 1
    `)) as any;
    internalUserId = existingByClerk?.[0]?.id ?? null;
  } catch (err) {
    log.warn({ err, clerkUserId: user.id }, "user lookup by clerk_user_id failed");
  }
  if (!internalUserId) {
    try {
      const existingByEmail = (await db.execute(sql`
        SELECT id
        FROM public.users
        WHERE email = ${userEmail}
        LIMIT 1
      `)) as any;
      internalUserId = existingByEmail?.[0]?.id ?? null;
    } catch (err) {
      log.warn({ err, email: userEmail }, "user lookup by email failed");
    }
  }
  if (!internalUserId) {
    const created = (await db.execute(sql`
      INSERT INTO public.users (
        id,
        email,
        is_onboarded,
        brand_ids,
        created_at,
        is_work_email,
        clerk_user_id,
        workspace_id
      )
      VALUES (
        ${crypto.randomUUID()}::uuid,
        ${userEmail},
        false,
        '{}'::uuid[],
        now(),
        true,
        ${user.id},
        ${user.orgId ?? null}
      )
      RETURNING id
    `)) as any;
    internalUserId = created?.[0]?.id ?? null;
  }
  if (!internalUserId) return c.json({ error: "Unable to resolve user profile" }, 500);

  const body = (await c.req.json().catch(() => ({}))) as CreateChatBody;
  const [created] = await db
    .insert(chats)
    .values({
      id: crypto.randomUUID() as any,
      userId: internalUserId as any,
      workspaceId: body.workspace_id ?? user.orgId ?? null,
      title: body.title ?? "New Chat",
      version: body.version ?? "v3",
    })
    .returning();
  await upsertExecutionForChat(created.id);

  return c.json(serializeChat(created));
};

export async function adminViewChat(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);
  if (!user.email?.endsWith("@marketmint.ai")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const chatId = c.req.param("chat_id");
  const chat = await db.query.chats.findFirst({ where: eq(chats.id, chatId as any) });
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  const chatMessages = await db.query.messages.findMany({
    where: eq(messages.chatId, chatId as any),
    orderBy: [desc(messages.createdAt)],
  });

  return c.json({
    chat: {
      id: chat.id,
      title: chat.title,
      created_at: chat.createdAt,
      updated_at: chat.lastUpdated,
      deleted_at: chat.deletedAt,
      user_id: chat.userId,
    },
    messages: chatMessages.map(serializeMessage),
  });
};

export async function getShareStatus(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

  const workspaceId = getWorkspaceId(c);
  const chatId = c.req.param("chat_id");
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId as any),
  });
  if (!chat || chat.deletedAt) return c.json({ error: "Chat not found" }, 404);
  if (chat.workspaceId !== workspaceId) return c.json({ error: "Chat not found" }, 404);

  const sc = await db.query.sharedChats.findFirst({
    where: eq(sharedChats.chatId, chat.id),
  });
  if (!sc) {
    return c.json({ shared_chat_id: null, is_public: false });
  }
  return c.json({
    shared_chat_id: sc.id,
    is_public: sc.isPublic,
  });
};

export async function updateShareStatus(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

  const workspaceId = getWorkspaceId(c);
  const chatId = c.req.param("chat_id");
  const isPublic = c.req.query("is_public") === "false" ? false : true;

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId as any),
  });
  if (!chat || chat.deletedAt) return c.json({ error: "Chat not found" }, 404);
  if (chat.workspaceId !== workspaceId) return c.json({ error: "Chat not found" }, 404);

  let sc = await db.query.sharedChats.findFirst({
    where: eq(sharedChats.chatId, chat.id),
  });
  if (!sc) {
    const [inserted] = await db
      .insert(sharedChats)
      .values({
        id: ulid(),
        chatId: chat.id,
        isPublic,
      })
      .returning();
    sc = inserted;
  } else if (sc.isPublic !== isPublic) {
    await db
      .update(sharedChats)
      .set({ isPublic, updatedAt: new Date() })
      .where(eq(sharedChats.id, sc.id));
    sc = { ...sc, isPublic };
  }

  return c.json({
    shared_chat_id: String(sc.id),
    is_public: isPublic,
  });
};

export async function listChats(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

  const page = Math.max(1, Number(c.req.param("current_page") || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.param("limit") || 20)));
  const offset = (page - 1) * limit;
  const workspaceId = getWorkspaceId(c);

  const items = await db.query.chats.findMany({
    where: and(eq(chats.workspaceId, workspaceId), isNull(chats.deletedAt)),
    orderBy: [desc(chats.lastUpdated)],
    limit,
    offset,
  });

  return c.json({
    page,
    total_pages: page + (items.length === limit ? 1 : 0),
    size: items.length,
    data: items.map(serializeChat),
    has_next_page: items.length === limit,
    has_previous_page: page > 1,
  });
};

export async function getChat(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

  const chat = await db.query.chats.findFirst({
    where: and(
      eq(chats.id, c.req.param("id") as any),
    ),
  });
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  if (chat.workspaceId !== getWorkspaceId(c)) {
    return c.json({ error: "You are not allowed to access this chat" }, 403);
  }
  if (chat.deletedAt) return c.json({ error: "Chat not found" }, 404);
  return c.json(serializeChat(chat));
};

export async function updateChat(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as Partial<CreateChatBody>;
  const existing = await db.query.chats.findFirst({
    where: eq(chats.id, c.req.param("id") as any),
  });
  if (!existing) return c.json({ error: "Chat not found" }, 404);
  if (existing.workspaceId !== getWorkspaceId(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (existing.deletedAt) return c.json({ error: "Chat already deleted" }, 409);

  const [updated] = await db
    .update(chats)
    .set({
      title: body.title,
      version: body.version,
      workspaceId: body.workspace_id,
      lastUpdated: new Date(),
    })
    .where(
      and(
        eq(chats.id, c.req.param("id") as any),
      ),
    )
    .returning();

  if (!updated) return c.json({ error: "Chat not found" }, 404);
  await upsertExecutionForChat(updated.id);
  return c.json("Chat updated successfully");
};

export async function deleteChat(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);
  const existing = await db.query.chats.findFirst({
    where: eq(chats.id, c.req.param("id") as any),
  });
  if (!existing) return c.json({ error: "Chat not found" }, 404);
  if (existing.workspaceId !== getWorkspaceId(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (existing.deletedAt) return c.json({ error: "Chat already deleted" }, 409);

  const [deleted] = await db
    .update(chats)
    .set({ deletedAt: new Date(), lastUpdated: new Date() })
    .where(
      and(
        eq(chats.id, c.req.param("id") as any),
      ),
    )
    .returning();

  if (!deleted) return c.json({ error: "Chat not found" }, 404);
  await upsertExecutionForChat(deleted.id);
  return c.json("Chat deleted successfully");
};
