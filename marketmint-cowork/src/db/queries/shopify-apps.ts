import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  shopifyApps,
  type ShopifyApp,
  type ShopifyAppStatus,
} from "@/db/schema/shopify-apps";

export interface InsertPendingShopifyAppParams {
  workspaceId: string;
  providerConfigKey: string;
  appName: string;
  clientIdLast4: string | null;
  storeDomain: string | null;
  scopes: string[];
  createdBy: string;
}

export async function getActiveShopifyApp(
  workspaceId: string,
): Promise<ShopifyApp | null> {
  const rows = await db
    .select()
    .from(shopifyApps)
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        isNull(shopifyApps.disabledAt),
        eq(shopifyApps.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getAnyActiveOrPendingShopifyApp(
  workspaceId: string,
): Promise<ShopifyApp | null> {
  const rows = await db
    .select()
    .from(shopifyApps)
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        isNull(shopifyApps.disabledAt),
        inArray(shopifyApps.status, ["pending", "active"]),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertPendingShopifyApp(
  params: InsertPendingShopifyAppParams,
): Promise<void> {
  await db.insert(shopifyApps).values({
    workspaceId: params.workspaceId,
    providerConfigKey: params.providerConfigKey,
    appName: params.appName,
    clientIdLast4: params.clientIdLast4,
    storeDomain: params.storeDomain,
    scopes: params.scopes,
    status: "pending",
    createdBy: params.createdBy,
  });
}

export async function promoteShopifyAppToActive(
  workspaceId: string,
): Promise<void> {
  await db
    .update(shopifyApps)
    .set({ status: "active", updatedAt: new Date() })
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        eq(shopifyApps.status, "pending"),
      ),
    );
}

export async function markShopifyAppFailed(
  workspaceId: string,
): Promise<void> {
  await db
    .update(shopifyApps)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        eq(shopifyApps.status, "pending"),
      ),
    );
}

export async function markShopifyAppDeleting(
  workspaceId: string,
): Promise<string | null> {
  const rows = await db
    .update(shopifyApps)
    .set({ status: "deleting", updatedAt: new Date() })
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        isNull(shopifyApps.disabledAt),
        eq(shopifyApps.status, "active"),
      ),
    )
    .returning({ providerConfigKey: shopifyApps.providerConfigKey });
  return rows[0]?.providerConfigKey ?? null;
}

export async function finalizeShopifyAppSoftDelete(
  workspaceId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(shopifyApps)
    .set({ disabledAt: now, updatedAt: now })
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        eq(shopifyApps.status, "deleting"),
      ),
    );
}

export async function listStuckShopifyApps(
  olderThanMs: number,
): Promise<ShopifyApp[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  return db
    .select()
    .from(shopifyApps)
    .where(
      and(
        isNull(shopifyApps.disabledAt),
        or(
          eq(shopifyApps.status, "pending"),
          eq(shopifyApps.status, "deleting"),
        ),
        lte(shopifyApps.updatedAt, cutoff),
      ),
    );
}
