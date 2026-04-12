import { getNango } from "@/connectors/nango/client";
import {
  finalizeShopifyAppSoftDelete,
  listStuckShopifyApps,
  markShopifyAppFailed,
  promoteShopifyAppToActive,
} from "@/db/queries/shopify-apps";
import { createLogger } from "@/lib/logger";

const log = createLogger("reconcile-shopify-apps");

const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

export async function runReconcile(): Promise<void> {
  const nango = getNango();
  if (!nango) {
    log.warn("Nango not configured; skipping reconcile");
    return;
  }

  const stuck = await listStuckShopifyApps(STUCK_THRESHOLD_MS);
  if (stuck.length === 0) {
    log.debug("no stuck rows");
    return;
  }

  log.info({ count: stuck.length }, "reconciling stuck shopify_apps rows");

  for (const row of stuck) {
    try {
      if (row.status === "pending") {
        await reconcilePending(nango, row.workspaceId, row.providerConfigKey);
      } else if (row.status === "deleting") {
        await reconcileDeleting(nango, row.workspaceId, row.providerConfigKey);
      }
    } catch (err) {
      log.error(
        { err, workspaceId: row.workspaceId, providerConfigKey: row.providerConfigKey, status: row.status },
        "reconcile iteration failed; will retry next tick",
      );
    }
  }
}

async function integrationExists(
  nango: NonNullable<ReturnType<typeof getNango>>,
  providerConfigKey: string,
): Promise<boolean> {
  try {
    await nango.getIntegration({ uniqueKey: providerConfigKey });
    return true;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return false;
    throw err;
  }
}

async function reconcilePending(
  nango: NonNullable<ReturnType<typeof getNango>>,
  workspaceId: string,
  providerConfigKey: string,
): Promise<void> {
  const exists = await integrationExists(nango, providerConfigKey);
  if (exists) {
    log.info({ workspaceId, providerConfigKey }, "pending → active");
    await promoteShopifyAppToActive(workspaceId);
  } else {
    log.warn({ workspaceId, providerConfigKey }, "pending → failed (integration missing)");
    await markShopifyAppFailed(workspaceId);
  }
}

async function reconcileDeleting(
  nango: NonNullable<ReturnType<typeof getNango>>,
  workspaceId: string,
  providerConfigKey: string,
): Promise<void> {
  const exists = await integrationExists(nango, providerConfigKey);
  if (!exists) {
    log.info({ workspaceId, providerConfigKey }, "deleting → finalized (integration gone)");
    await finalizeShopifyAppSoftDelete(workspaceId);
    return;
  }

  log.info({ workspaceId, providerConfigKey }, "deleting: retrying teardown");
  const connections = await nango.listConnections({
    tags: { end_user_id: workspaceId },
  });
  for (const conn of connections.connections) {
    if (conn.provider_config_key !== providerConfigKey) continue;
    try {
      await nango.deleteConnection(providerConfigKey, conn.connection_id);
    } catch (err) {
      log.warn({ err, workspaceId, connectionId: conn.connection_id }, "retry deleteConnection failed");
    }
  }
  try {
    await nango.deleteIntegration(providerConfigKey);
  } catch (err) {
    log.warn({ err, workspaceId, providerConfigKey }, "retry deleteIntegration failed; will retry next tick");
    return;
  }
  await finalizeShopifyAppSoftDelete(workspaceId);
}
