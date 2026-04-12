import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { chats } from "@/db/schema/chats";

/**
 * Keep Python `executions` listing in sync with chat rows.
 * Python cowork mode reads `/executions`, not `/chats`.
 */
export async function upsertExecutionForChat(chatId: string): Promise<void> {
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId as any),
  });
  if (!chat) return;

  // `postgres` driver (used by drizzle/postgres-js) expects bind params to be
  // string/Buffer-like. Converting Date -> ISO string avoids runtime crash.
  const createdAt =
    chat.createdAt instanceof Date ? chat.createdAt.toISOString() : chat.createdAt;
  const lastUpdated =
    chat.lastUpdated instanceof Date ? chat.lastUpdated.toISOString() : chat.lastUpdated;
  const deletedAt =
    chat.deletedAt instanceof Date ? chat.deletedAt.toISOString() : chat.deletedAt;

  await db.execute(sql`
    INSERT INTO public.executions (
      id,
      workspace_id,
      title,
      execution_type,
      execution_id,
      user_id,
      created_at,
      last_updated,
      deleted_at
    )
    VALUES (
      ${crypto.randomUUID()}::uuid,
      ${chat.workspaceId},
      ${chat.title},
      'chat',
      ${chat.id}::uuid,
      ${chat.userId}::uuid,
      ${createdAt},
      ${lastUpdated},
      ${deletedAt}
    )
    ON CONFLICT (execution_type, execution_id)
    DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      title = EXCLUDED.title,
      user_id = EXCLUDED.user_id,
      last_updated = EXCLUDED.last_updated,
      deleted_at = EXCLUDED.deleted_at
  `);
}

