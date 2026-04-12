import { eq } from "drizzle-orm";
import { db } from "../client";
import { MessagePart, NewMessage, messages } from "../schema/messages";
import { createLogger } from "@/lib/logger";

const log = createLogger("db");
import { captureException } from "@/lib/sentry";

export async function createMessage(data: NewMessage) {
  try {
    const [msg] = await db
      .insert(messages)
      .values({ ...data, agent: data.agent ?? "none" })
      .returning();
    return msg;
  } catch (error: any) {
    log.error({
      err: error,
      payload: {
        chatId: data.chatId,
        messageId: data.messageId,
        role: data.role,
        agent: data.agent,
        contentParts: Array.isArray(data.content) ? data.content.length : null,
        attachmentsCount: Array.isArray(data.attachments)
          ? data.attachments.length
          : null,
      },
      errorMessage: error?.message,
      causeMessage: error?.cause?.message,
      causeCode: error?.cause?.code,
      causeDetail: error?.cause?.detail,
    }, "createMessage insert failed");
    captureException(error, { operation: "createMessage", chatId: data.chatId });
    throw new Error("Failed to insert message");
  }
}

export async function createOrUpdateMessage(
  messageId: string,
  data: Partial<NewMessage>,
) {
  try {
    const existing = await db.query.messages.findFirst({
      where: eq(messages.messageId, messageId),
    });

    if (existing) {
      const mergedContent = mergeContentById(
        existing.content ?? [],
        data.content as MessagePart[] | undefined,
      );
      const mergedToolCalls = mergeToolCalls(
        (existing.toolCalls ?? []) as any[],
        (data.toolCalls ?? undefined) as any[] | undefined,
      );
      const [updated] = await db
        .update(messages)
        .set({ ...data, content: mergedContent, toolCalls: mergedToolCalls, updatedAt: new Date() })
        .where(eq(messages.messageId, messageId))
        .returning();
      return updated;
    }

    return createMessage({ messageId, ...data } as NewMessage);
  } catch (error) {
    log.error({ err: error, messageId, role: data.role, chatId: data.chatId }, "createOrUpdateMessage failed");
    captureException(error, { operation: "createOrUpdateMessage", messageId });
    throw error;
  }
}

export async function deleteMessageByMessageId(messageId: string) {
  try {
    await db.delete(messages).where(eq(messages.messageId, messageId));
  } catch (error) {
    log.warn({ err: error, messageId }, "deleteMessageByMessageId failed");
  }
}

/** Merge incoming tool calls into existing array, deduplicating by toolCallId. */
function mergeToolCalls(
  existing: any[],
  incoming?: any[],
): any[] {
  if (!incoming || incoming.length === 0) return existing;
  const merged = [...existing];
  for (const tc of incoming) {
    const tcId = tc?.toolCallId;
    if (!tcId) {
      merged.push(tc);
      continue;
    }
    const idx = merged.findIndex((t) => t?.toolCallId === tcId);
    if (idx >= 0) {
      merged[idx] = tc;
    } else {
      merged.push(tc);
    }
  }
  return merged;
}

function mergeContentById(
  existing: MessagePart[],
  incoming?: MessagePart[],
): MessagePart[] {
  if (!incoming) return existing;
  const merged = [...existing];

  for (const part of incoming) {
    const partId = part?.id;
    if (!partId) {
      // Keep parity with Python v2 service: parts without IDs are always appended.
      merged.push(part);
      continue;
    }

    const existingIndex = merged.findIndex((p) => p?.id === partId);
    if (existingIndex >= 0) {
      const prev = merged[existingIndex];
      if (
        part?.type === "agent-utility" &&
        prev?.type === "agent-utility" &&
        typeof part.seq === "number" &&
        typeof prev.seq === "number"
      ) {
        merged[existingIndex] = {
          ...part,
          seq: Math.min(prev.seq, part.seq),
        };
      } else {
        merged[existingIndex] = part;
      }
    } else {
      merged.push(part);
    }
  }

  return merged;
}

