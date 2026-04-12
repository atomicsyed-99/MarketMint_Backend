import type { Context } from "hono";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { chats } from "@/db/schema/chats";
import { messages } from "@/db/schema/messages";
import { createMessage, createOrUpdateMessage } from "@/db/queries/messages";
import { serializeMessage } from "@/lib/api-serialization";
import { getWorkspaceId } from "@/lib/workspace-context";

type CreateMessageBody = {
  chat_id: string;
  role: "user" | "ai" | "tool";
  message_id?: string;
  content?: any[];
  attachments?: any[];
  tool_calls?: any[];
  llm_usage?: Record<string, any>;
  agent?: "none" | "photographer" | "developer" | "planner" | "finisher";
};

export async function createMessageHandler(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

  const body = (await c.req.json()) as CreateMessageBody;
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, body.chat_id as any)),
  });
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  if (chat.workspaceId !== getWorkspaceId(c)) return c.json({ error: "Forbidden" }, 403);
  if (chat.deletedAt) return c.json({ error: "Chat not found" }, 404);

  const payload = {
    messageId: body.message_id,
    chatId: body.chat_id as any,
    role: body.role,
    content: body.content ?? [],
    attachments: body.attachments ?? [],
    toolCalls: body.tool_calls ?? [],
    llmUsage: body.llm_usage ?? {},
    agent: body.agent ?? "none",
  } as any;
  const msg = body.message_id
    ? await createOrUpdateMessage(body.message_id, payload)
    : await createMessage(payload);

  await db
    .update(chats)
    .set({ lastUpdated: new Date() })
    .where(eq(chats.id, body.chat_id as any));

  if (!msg) return c.json({ status: "ok" });
  return c.json(serializeMessage(msg));
};

export async function getMessages(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

  const chatId = c.req.param("chat_id");
  const cursor = c.req.query("cursor");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || 20)));
  const direction = (c.req.query("direction") || "newer") as "older" | "newer";

  const chat = await db.query.chats.findFirst({ where: and(eq(chats.id, chatId as any)) });
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  if (chat.workspaceId !== getWorkspaceId(c)) return c.json({ error: "Forbidden" }, 403);
  if (chat.deletedAt) return c.json({ error: "Chat not found" }, 404);

  const cursorMessage = cursor
    ? await db.query.messages.findFirst({
        where: and(eq(messages.messageId, cursor as any), eq(messages.chatId, chatId as any)),
      })
    : null;
  const cursorCreatedAt = cursorMessage?.createdAt ?? null;

  const items = await db.query.messages.findMany({
    where: (() => {
      if (direction === "older") {
        return cursorCreatedAt
          ? and(eq(messages.chatId, chatId as any), lt(messages.createdAt, cursorCreatedAt))
          : eq(messages.chatId, chatId as any);
      }
      return cursorCreatedAt
        ? and(eq(messages.chatId, chatId as any), gt(messages.createdAt, cursorCreatedAt))
        : eq(messages.chatId, chatId as any);
    })(),
    orderBy:
      direction === "older"
        ? [desc(messages.createdAt), desc(messages.id)]
        : [asc(messages.createdAt), asc(messages.id)],
    limit: limit + 1,
  });
  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const normalized = direction === "older" ? [...sliced].reverse() : sliced;

  return c.json({
    messages: normalized.map(serializeMessage),
    has_more: hasMore,
  });
};

export async function getMessagesLegacy(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);
  const chatId = c.req.param("chat_id");
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId as any)),
  });
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  if (chat.workspaceId !== getWorkspaceId(c)) return c.json({ error: "Forbidden" }, 403);
  if (chat.deletedAt) return c.json({ error: "Chat not found" }, 404);

  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || 20)));
  const offset = (page - 1) * limit;
  const items = await db.query.messages.findMany({
    where: eq(messages.chatId, chatId as any),
    orderBy: [desc(messages.createdAt), desc(messages.id)],
    limit,
    offset,
  });
  return c.json([...items].reverse().map(serializeMessage));
};

export async function deleteMessage(c: Context) {
  const user = c.get("authUser");
  if (!user?.id) return c.json({ error: "Unauthorized" }, 401);
  const messageId = Number(c.req.param("message_id"));
  if (!Number.isFinite(messageId)) return c.json({ error: "Invalid message id" }, 400);

  const msg = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!msg) return c.json({ error: "Message not found" }, 404);
  const chat = await db.query.chats.findFirst({ where: eq(chats.id, msg.chatId) });
  if (!chat || chat.workspaceId !== getWorkspaceId(c)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await db.delete(messages).where(eq(messages.id, messageId));
  return c.json("Message deleted successfully");
};

export async function batchCompleted(c: Context) {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const metadata = body?.metadata ?? {};
  const chatId = metadata?.chat_id;
  if (!chatId) return c.json({ error: "Metadata is required" }, 400);

  const latest = await db.query.messages.findFirst({
    where: eq(messages.chatId, chatId as any),
    orderBy: [desc(messages.createdAt)],
  });
  if (!latest) return c.json({ error: "Message not found" }, 404);

  const updatedContent = Array.isArray(latest.content) ? [...latest.content] : [];
  for (const part of updatedContent as any[]) {
    const data = (part?.data ?? {}) as any;
    if (part?.type === "task-progress") {
      const steps = Array.isArray(data.steps) ? data.steps : [];
      data.steps = steps.map((s: any) => ({ ...s, status: "completed" }));
      data.title = `${body.batch_name ?? "Batch"} batch is ready`;
      data.description =
        "We have generated your batch and it is ready to download.";
      data.status = "completed";
      data.completionPercentage = 100;
      part.data = data;
    }
    if (part?.type === "batch-processing") {
      data.status = "completed";
      part.data = data;
    }
  }

  const sampleAssets = Array.isArray(body?.sample_assets) ? body.sample_assets : [];
  updatedContent.push({
    id: crypto.randomUUID(),
    type: "user-action",
    text: undefined,
    data: {
      hideWaitingLoader: true,
      actions: [
        {
          type: "batch-download",
          widgetProps: {
            images: sampleAssets.map((a: any) => a?.url).filter(Boolean),
            media: { batchId: body?.batch_id },
            title: body?.batch_name,
            description: `Here is the collection of your ${body?.batch_name ?? "generated"} batch which resonates with your brand identity and your input preferences`,
            actions: {
              orientation: "horizontal",
              data: [{ label: "Download", action: "download", url: body?.download_url }],
            },
            assets: sampleAssets,
          },
        },
      ],
    },
  });

  await db
    .update(messages)
    .set({ content: updatedContent, updatedAt: new Date() })
    .where(eq(messages.id, latest.id));
  await db
    .update(chats)
    .set({ lastUpdated: new Date() })
    .where(eq(chats.id, latest.chatId));

  return c.json({ message: "Batch completed message updated successfully" });
};

export async function batchRefineCompleted(c: Context) {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const metadata = body?.metadata ?? {};
  const chatId = metadata?.chat_id;
  if (!chatId) return c.json({ error: "Metadata is required" }, 400);

  const latest = await db.query.messages.findFirst({
    where: eq(messages.chatId, chatId as any),
    orderBy: [desc(messages.createdAt)],
  });
  if (!latest) return c.json({ error: "Message not found" }, 404);

  const updatedContent = Array.isArray(latest.content) ? [...latest.content] : [];
  for (const part of updatedContent as any[]) {
    const data = (part?.data ?? {}) as any;
    if (part?.type === "task-progress") {
      const steps = Array.isArray(data.steps) ? data.steps : [];
      data.steps = steps.map((s: any) => ({ ...s, status: "completed" }));
      data.title = "Your batch is refined";
      data.description =
        "We have refined your batch and it is ready to download.";
      data.status = "completed";
      data.completionPercentage = 100;
      part.data = data;
    }
    if (part?.type === "refine-processing") {
      data.status = "completed";
      part.data = data;
    }
  }

  const sampleAssets = Array.isArray(body?.sample_assets) ? body.sample_assets : [];
  updatedContent.push({
    id: crypto.randomUUID(),
    type: "user-action",
    text: undefined,
    data: {
      hideWaitingLoader: true,
      actions: [
        {
          type: "batch-download",
          widgetProps: {
            images: sampleAssets.map((a: any) => a?.url).filter(Boolean),
            media: { batchId: body?.batch_id },
            title: body?.batch_name,
            description: `Here is the collection of your ${body?.batch_name ?? "refined"} batch which resonates with your brand identity and your input preferences`,
            actions: {
              orientation: "vertical",
              data: [
                { label: "Download full batch", action: "download", url: body?.full_batch_url },
                {
                  label: "Download only refined batch",
                  action: "download",
                  url: body?.only_refined_url,
                  variant: "outline",
                },
              ],
            },
            assets: sampleAssets,
          },
        },
      ],
    },
  });

  await db
    .update(messages)
    .set({ content: updatedContent, updatedAt: new Date() })
    .where(eq(messages.id, latest.id));
  await db
    .update(chats)
    .set({ lastUpdated: new Date() })
    .where(eq(chats.id, latest.chatId));

  return c.json({ message: "Batch refine completed message updated successfully" });
};

export async function singleHumanRefineCompleted(c: Context) {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const metadata = body?.metadata ?? {};
  const chatId = metadata?.chat_id;
  if (!chatId) return c.json({ error: "Metadata is required" }, 400);

  const latest = await db.query.messages.findFirst({
    where: eq(messages.chatId, chatId as any),
    orderBy: [desc(messages.createdAt)],
  });
  if (!latest) return c.json({ error: "Message not found" }, 404);

  const updatedContent = Array.isArray(latest.content) ? [...latest.content] : [];
  for (const part of updatedContent as any[]) {
    const data = (part?.data ?? {}) as any;
    if (part?.type === "task-progress") {
      const steps = Array.isArray(data.steps) ? data.steps : [];
      data.steps = steps.map((s: any) => ({ ...s, status: "completed" }));
      data.title = "Your request is ready";
      data.description = "You can download the refined images below";
      data.status = "completed";
      data.completionPercentage = 100;
      part.data = data;
    }
    if (part?.type === "refine-processing") {
      data.status = "completed";
      part.data = data;
    }
  }

  const refinedUrl = body?.refinedImage?.url;
  if (typeof refinedUrl === "string" && refinedUrl.trim()) {
    updatedContent.push({
      type: "image",
      id: crypto.randomUUID(),
      source: "refine",
      data: {
        id: crypto.randomUUID(),
        url: refinedUrl,
        tag: "refined-image",
        metadata: { parent_image_url: metadata?.parent_asset_url },
      },
    });
  }

  await db
    .update(messages)
    .set({ content: updatedContent, updatedAt: new Date() })
    .where(eq(messages.id, latest.id));
  await db
    .update(chats)
    .set({ lastUpdated: new Date() })
    .where(eq(chats.id, latest.chatId));

  return c.json({ message: "Single human refine completed message updated successfully" });
};

