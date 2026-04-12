import { sql } from "drizzle-orm";
import { db } from "../client";

/** Clerk user ids are `user_` + alphanumerics; `public.users.id` is the app primary key. */
function looksLikeClerkUserId(userId: string): boolean {
  return /^user_[a-zA-Z0-9]+$/.test(userId);
}

/**
 * Resolves email for a job owner id stored in `agent_jobs.created_by_user_id`.
 * That column may hold either internal `users.id` or (legacy) Clerk `user_…` — both work.
 */
export async function getUserEmailByUserId(
  userId: string
): Promise<string | undefined> {
  const result = looksLikeClerkUserId(userId)
    ? await db.execute<{ email: string }>(sql`
        SELECT email
        FROM public.users
        WHERE clerk_user_id = ${userId}
        LIMIT 1
      `)
    : await db.execute<{ email: string }>(sql`
        SELECT email
        FROM public.users
        WHERE id = ${userId}
        LIMIT 1
      `);

  return result?.[0]?.email;
}

export async function getInternalUserIdByClerkUserId(
  clerkUserId: string
): Promise<string | undefined> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT id
    FROM public.users
    WHERE clerk_user_id = ${clerkUserId}
    LIMIT 1
  `);
  return result?.[0]?.id;
}