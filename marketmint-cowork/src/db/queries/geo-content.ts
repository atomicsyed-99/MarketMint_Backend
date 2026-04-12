import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { geoContent, type NewGeoContent } from "../schema/geo-content";

export async function createGeoContent(data: NewGeoContent) {
  const [row] = await db.insert(geoContent).values(data).returning();
  return row;
}

export async function listGeoContentByWorkspace(
  workspaceId: string,
  opts?: { limit?: number; promptId?: string },
) {
  const conditions = [eq(geoContent.workspaceId, workspaceId)];
  if (opts?.promptId) conditions.push(eq(geoContent.promptId, opts.promptId));
  return db
    .select()
    .from(geoContent)
    .where(and(...conditions))
    .orderBy(desc(geoContent.createdAt))
    .limit(opts?.limit ?? 100);
}

export async function getLatestGeoContentByPrompt(
  workspaceId: string,
  promptId: string,
) {
  const [row] = await db
    .select()
    .from(geoContent)
    .where(and(eq(geoContent.workspaceId, workspaceId), eq(geoContent.promptId, promptId)))
    .orderBy(desc(geoContent.createdAt))
    .limit(1);
  return row ?? null;
}
