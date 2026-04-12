import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { userConnections } from "../schema/user-connections";

export interface UpsertConnectionParams {
  workspaceId: string;
  providerConfigKey: string;
  connectionId: string;
  connectedByUserId: string;
  nangoRaw?: Record<string, unknown>;
}

/**
 * Upsert a single connection record.
 * On reconnect, clears any previous soft-delete and updates connectionId.
 */
export async function upsertConnection(params: UpsertConnectionParams) {
  await db
    .insert(userConnections)
    .values({
      workspaceId: params.workspaceId,
      providerConfigKey: params.providerConfigKey,
      connectionId: params.connectionId,
      connectedByUserId: params.connectedByUserId,
      nangoRaw: params.nangoRaw,
    })
    .onConflictDoUpdate({
      target: [
        userConnections.workspaceId,
        userConnections.providerConfigKey,
      ],
      set: {
        connectionId: params.connectionId,
        nangoRaw: params.nangoRaw,
        updatedAt: new Date(),
        disconnectedAt: null,
        disconnectedByUserId: null,
      },
    });
}

/**
 * Batch upsert connections in a single INSERT statement.
 * Used by the list-connections route to sync all Nango connections to DB.
 */
export async function batchUpsertConnections(
  rows: UpsertConnectionParams[],
) {
  if (rows.length === 0) return;

  await db
    .insert(userConnections)
    .values(
      rows.map((r) => ({
        workspaceId: r.workspaceId,
        providerConfigKey: r.providerConfigKey,
        connectionId: r.connectionId,
        connectedByUserId: r.connectedByUserId,
        nangoRaw: r.nangoRaw,
      })),
    )
    .onConflictDoUpdate({
      target: [
        userConnections.workspaceId,
        userConnections.providerConfigKey,
      ],
      set: {
        connectionId: sql`excluded.connection_id`,
        nangoRaw: sql`excluded.nango_raw`,
        updatedAt: new Date(),
        disconnectedAt: null,
        disconnectedByUserId: null,
      },
    });
}

/**
 * Soft-delete a connection (preserves audit trail).
 */
export async function softDeleteConnection(params: {
  workspaceId: string;
  providerConfigKey: string;
  disconnectedByUserId: string;
}) {
  const now = new Date();
  await db
    .update(userConnections)
    .set({
      disconnectedAt: now,
      disconnectedByUserId: params.disconnectedByUserId,
      updatedAt: now,
    })
    .where(
      and(
        eq(userConnections.workspaceId, params.workspaceId),
        eq(userConnections.providerConfigKey, params.providerConfigKey),
      ),
    );
}

/**
 * List active (non-disconnected) connections for a workspace.
 */
export async function listActiveConnections(workspaceId: string) {
  return db
    .select()
    .from(userConnections)
    .where(
      and(
        eq(userConnections.workspaceId, workspaceId),
        isNull(userConnections.disconnectedAt),
      ),
    );
}
