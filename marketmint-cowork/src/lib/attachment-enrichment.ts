import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { userAttachments } from "@/db/schema/userAttachments";

type MessageAttachment = {
  url: string;
}

type EnrichedAttachment = {
  url: string;
  tag: string;
  description: string;
}

/**
 * Enrich attachments with tag/description from DB and persist any new URLs.
 * Returns the enriched array, falling back to the original on error.
 */
export async function enrichAttachments(
  attachments: MessageAttachment[],
  userId: string,
): Promise<(MessageAttachment | EnrichedAttachment)[]> {
  const urls = attachments
    .map((a) => a.url);

  if (urls.length === 0) return [];

  try {
    const rows = await db
      .select({
        url: userAttachments.url,
        tag: userAttachments.tag,
        description: userAttachments.description,
      })
      .from(userAttachments)
      .where(
        and(
          eq(userAttachments.userId, userId),
          inArray(userAttachments.url, urls),
        ),
      );

    const byUrl = new Map(rows.map((r) => [r.url, r]));
    const enriched = attachments.map((a) => {
      const row = a.url ? byUrl.get(a.url) : undefined;
      return row ? { ...a, tag: row.tag, description: row.description } : a;
    });

    return enriched;
  } catch {
    return attachments;
  }
}
