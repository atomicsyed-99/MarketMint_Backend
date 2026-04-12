import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../client";
import { geoPrompts, type NewGeoPrompt } from "../schema/geo-prompts";

export async function createGeoPrompt(data: NewGeoPrompt) {
  const [row] = await db
    .insert(geoPrompts)
    .values(data)
    .onConflictDoNothing({
      target: [geoPrompts.workspaceId, geoPrompts.promptText],
    })
    .returning();

  if (row) return row;
  const [existing] = await db
    .select()
    .from(geoPrompts)
    .where(
      and(
        eq(geoPrompts.workspaceId, data.workspaceId),
        eq(geoPrompts.promptText, data.promptText),
      ),
    );
  return existing ?? null;
}

export async function getGeoPromptById(id: string) {
  const [row] = await db.select().from(geoPrompts).where(eq(geoPrompts.id, id));
  return row ?? null;
}

export async function listGeoPromptsByWorkspace(
  workspaceId: string,
  opts?: { activeOnly?: boolean; order?: "asc" | "desc" },
) {
  const conditions = [eq(geoPrompts.workspaceId, workspaceId)];
  if (opts?.activeOnly) conditions.push(eq(geoPrompts.isActive, true));
  return db
    .select()
    .from(geoPrompts)
    .where(and(...conditions))
    .orderBy(
      opts?.order === "asc" ? asc(geoPrompts.createdAt) : desc(geoPrompts.createdAt),
    );
}

export async function countActiveGeoPromptsByWorkspace(workspaceId: string) {
  const rows = await db
    .select()
    .from(geoPrompts)
    .where(and(eq(geoPrompts.workspaceId, workspaceId), eq(geoPrompts.isActive, true)));
  return rows.length;
}

export async function updateGeoPromptActive(
  id: string,
  workspaceId: string,
  isActive: boolean,
) {
  const [row] = await db
    .update(geoPrompts)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(geoPrompts.id, id), eq(geoPrompts.workspaceId, workspaceId)))
    .returning();
  return row ?? null;
}
