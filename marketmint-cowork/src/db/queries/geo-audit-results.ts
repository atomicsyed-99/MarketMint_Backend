import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { geoAuditResults, type NewGeoAuditResult } from "../schema/geo-audit-results";

export async function createGeoAuditResult(data: NewGeoAuditResult) {
  const [row] = await db.insert(geoAuditResults).values(data).returning();
  return row;
}

export async function createGeoAuditResults(data: NewGeoAuditResult[]) {
  if (data.length === 0) return [];
  return db.insert(geoAuditResults).values(data).returning();
}

export async function listGeoAuditResultsByWorkspace(
  workspaceId: string,
  opts?: { promptIds?: string[]; limit?: number },
) {
  const conditions = [eq(geoAuditResults.workspaceId, workspaceId)];
  if (opts?.promptIds && opts.promptIds.length > 0) {
    conditions.push(inArray(geoAuditResults.promptId, opts.promptIds));
  }
  return db
    .select()
    .from(geoAuditResults)
    .where(and(...conditions))
    .orderBy(desc(geoAuditResults.auditedAt))
    .limit(opts?.limit ?? 500);
}

export async function getLatestGeoAuditResultForPrompt(
  workspaceId: string,
  promptId: string,
  provider?: string,
) {
  const conditions = [
    eq(geoAuditResults.workspaceId, workspaceId),
    eq(geoAuditResults.promptId, promptId),
  ];
  if (provider) conditions.push(eq(geoAuditResults.provider, provider));
  const [row] = await db
    .select()
    .from(geoAuditResults)
    .where(and(...conditions))
    .orderBy(desc(geoAuditResults.auditedAt))
    .limit(1);
  return row ?? null;
}

export async function getLatestGeoAuditDateByWorkspace(workspaceId: string) {
  const [row] = await db
    .select({ auditedAt: geoAuditResults.auditedAt })
    .from(geoAuditResults)
    .where(eq(geoAuditResults.workspaceId, workspaceId))
    .orderBy(desc(geoAuditResults.auditedAt))
    .limit(1);
  return row?.auditedAt ?? null;
}
