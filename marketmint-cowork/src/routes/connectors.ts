import type { Context } from "hono";
import { env } from "@/env";
import { getNango } from "@/connectors/nango/client";
import {
  getUserConnections,
  invalidateConnectionsCache,
} from "@/connectors/nango/connections";
import { invalidateProcessorCache } from "@/connectors/build-toolset";
import { getConnectorById, getEnabledConnectors } from "@/connectors/registry";
import {
  batchUpsertConnections,
  softDeleteConnection,
} from "@/db/queries/user-connections";
import { getErrorMessage } from "@/connectors/tools/helpers";
import {
  ConnectSessionBodySchema,
  DisconnectBodySchema,
} from "@/schemas/connectors";
import {
  getActiveShopifyApp,
  getAnyActiveOrPendingShopifyApp,
  insertPendingShopifyApp,
  promoteShopifyAppToActive,
  markShopifyAppFailed,
  markShopifyAppDeleting,
  finalizeShopifyAppSoftDelete,
} from "@/db/queries/shopify-apps";
import { generateShopifyProviderConfigKey } from "@/connectors/shopify-slug";
import { REQUIRED_SHOPIFY_SCOPES } from "@/connectors/shopify-scopes";
import { ProvisionShopifyAppBodySchema } from "@/schemas/provision-shopify-app";
import { listSlackChannels } from "@/services/slack";
import { createLogger } from "@/lib/logger";

const log = createLogger("connectors");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const WORKSPACE_REQUIRED_ERROR =
  "A workspace is required to manage connections";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

function getWorkspaceId(c: Context): string | null {
  const user = c.get("authUser");
  return user?.orgId ?? user?.id ?? null;
}

function getAvailableConnectors() {
  return getEnabledConnectors().map((conn) => ({
    id: conn.id,
    providerConfigKey: conn.providerConfigKey,
    name: conn.name,
    description: conn.description,
    authType: conn.authType,
    apiKeyFields: conn.apiKeyFields,
  }));
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/v3/connectors/connect-session
 */
export async function connectSessionHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: WORKSPACE_REQUIRED_ERROR }, 422);

    const nango = getNango();
    if (!nango) return c.json({ error: "Connectors not configured" }, 503);

    const raw = await c.req.json().catch(() => ({}));
    const parsed = ConnectSessionBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }

    log.info({ workspaceId, userId: c.get("authUser")?.id }, "creating connect session");

    // Resolve the frontend connector id to Nango's providerConfigKey
    // (e.g. "meta-ads" → "meta-marketing-api")
    let nangoIntegrationKey: string | undefined;
    if (parsed.data.integrationId) {
      const connector = getConnectorById(parsed.data.integrationId);
      nangoIntegrationKey = connector?.providerConfigKey ?? parsed.data.integrationId;
    }

    // Shopify: resolve per-workspace app and check for existing connection in parallel
    if (parsed.data.integrationId === "shopify") {
      const [shopifyApp, existing] = await Promise.all([
        getActiveShopifyApp(workspaceId),
        getUserConnections(workspaceId),
      ]);
      if (!shopifyApp) {
        return c.json({ error: "No Shopify app provisioned for this workspace. Contact support." }, 422);
      }
      nangoIntegrationKey = shopifyApp.providerConfigKey;
      if (existing.shopify) {
        return c.json({ error: "This workspace already has Shopify connected. Disconnect first or use a separate workspace." }, 409);
      }
    }

    const { data } = await nango.createConnectSession({
      tags: { end_user_id: workspaceId },
      allowed_integrations: nangoIntegrationKey ? [nangoIntegrationKey] : undefined,
    });

    // Pre-emptively invalidate caches
    invalidateConnectionsCache(workspaceId);
    invalidateProcessorCache(workspaceId);

    // Meta Login for Business needs the config_id OAuth param
    const metaConfigId =
      nangoIntegrationKey === "meta-marketing-api" ? env.META_LOGIN_CONFIG_ID : undefined;

    return c.json({ sessionToken: data.token, providerConfigKey: nangoIntegrationKey, metaConfigId });
  } catch (err) {
    const detail = (err as any)?.response?.data;
    log.error({ err, detail }, "connect-session error");
    return c.json(
      { error: getErrorMessage(err) || "Failed to create connect session" },
      500,
    );
  }
}

/**
 * GET /api/v3/connectors/connections
 */
export async function listConnectionsHandler(c: Context) {
  try {
    const user = c.get("authUser")!;
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: WORKSPACE_REQUIRED_ERROR }, 422);

    const nango = getNango();
    if (!nango) {
      return c.json({
        connections: [],
        availableConnectors: getAvailableConnectors(),
      });
    }

    // Invalidate caches so the chat route picks up new connections immediately
    invalidateConnectionsCache(workspaceId);
    invalidateProcessorCache(workspaceId);

    const result = await nango.listConnections({
      tags: { end_user_id: workspaceId },
    });

    const connections = result.connections.map((conn: any) => ({
      providerConfigKey: conn.provider_config_key,
      connectionId: conn.connection_id,
      createdAt: conn.created_at,
    }));

    batchUpsertConnections(
      result.connections.map((conn: any) => ({
        workspaceId,
        providerConfigKey: conn.provider_config_key,
        connectionId: conn.connection_id,
        connectedByUserId: user.id,
        nangoRaw: conn as Record<string, unknown>,
      })),
    ).catch((err) =>
      log.warn({ err }, "DB batch upsert failed (non-blocking)"),
    );

    return c.json({
      connections,
      availableConnectors: getAvailableConnectors(),
    });
  } catch (err) {
    log.error({ err }, "list-connections error");
    return c.json(
      { error: getErrorMessage(err) || "Failed to list connections", connections: [] },
      500,
    );
  }
}

/**
 * GET /cowork/connectors/slack/channels
 */
export async function listSlackChannelsHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: WORKSPACE_REQUIRED_ERROR }, 422);

    const cursor = c.req.query("cursor");


    const result = await listSlackChannels(workspaceId, cursor);
    return c.json(result);
  } catch (err) {
    log.error({ err }, "list-slack-channels error");
    return c.json(
      { error: getErrorMessage(err) || "Failed to list Slack channels", channels: [] },
      500,
    );
  }
}

/**
 * DELETE /api/v3/connectors/disconnect
 */
export async function disconnectHandler(c: Context) {
  try {
    const user = c.get("authUser")!;
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: WORKSPACE_REQUIRED_ERROR }, 422);

    const nango = getNango();
    if (!nango) return c.json({ error: "Connectors not configured" }, 503);

    const raw = await c.req.json().catch(() => ({}));
    const parsed = DisconnectBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }

    const { providerConfigKey, connectionId } = parsed.data;

    const wsConnections = await getUserConnections(workspaceId);
    const ownsConnection = Object.values(wsConnections).some(
      (conn) =>
        conn?.providerConfigKey === providerConfigKey &&
        conn?.connectionId === connectionId,
    );
    if (!ownsConnection) {
      return c.json({ error: "Connection not found for this workspace" }, 403);
    }

    await nango.deleteConnection(providerConfigKey, connectionId);

    softDeleteConnection({
      workspaceId,
      providerConfigKey,
      disconnectedByUserId: user.id,
    }).catch((err) =>
      log.warn({ err }, "DB soft-delete failed (non-blocking)"),
    );

    invalidateConnectionsCache(workspaceId);
    invalidateProcessorCache(workspaceId);

    return c.json({ success: true });
  } catch (err) {
    log.error({ err }, "disconnect error");
    return c.json(
      { error: getErrorMessage(err) || "Failed to disconnect" },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// Self-service Shopify app provisioning
// ---------------------------------------------------------------------------

/**
 * POST /cowork/connectors/shopify-app
 * Client enters their Shopify custom app credentials. We validate against
 * Shopify, then provision via two-phase commit (same as the old admin flow
 * but clerk-authed and workspace-scoped).
 */
export async function provisionShopifyAppHandler(c: Context) {
  try {
    const user = c.get("authUser")!;
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: WORKSPACE_REQUIRED_ERROR }, 422);

    const nango = getNango();
    if (!nango) return c.json({ error: "Connectors not configured" }, 503);

    const raw = await c.req.json().catch(() => ({}));
    const parsed = ProvisionShopifyAppBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }

    const body = {
      ...parsed.data,
      store_domain: parsed.data.store_domain.toLowerCase(),
    };
    const storeName = body.store_domain.replace(/\.myshopify\.com$/, "");
    const providerConfigKey = generateShopifyProviderConfigKey(storeName);
    const clientIdLast4 = body.client_id.slice(-4);

    // DB row lands in 'pending' before any Nango side-effect so failures are reconcilable
    try {
      await insertPendingShopifyApp({
        workspaceId,
        providerConfigKey,
        appName: storeName,
        clientIdLast4,
        storeDomain: body.store_domain,
        scopes: [...REQUIRED_SHOPIFY_SCOPES],
        createdBy: user.id,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json({ error: "This workspace already has a Shopify app configured" }, 409);
      }
      throw err;
    }

    try {
      await nango.createIntegration({
        provider: "shopify",
        unique_key: providerConfigKey,
        display_name: `${storeName}-shopify-nango`,
        credentials: {
          type: "OAUTH2",
          client_id: body.client_id,
          client_secret: body.client_secret,
          scopes: REQUIRED_SHOPIFY_SCOPES.join(","),
        },
      });
    } catch (err) {
      log.error({ err, workspaceId, providerConfigKey }, "nango createIntegration failed");
      await markShopifyAppFailed(workspaceId);
      return c.json({
        error: "Failed to create Shopify integration",
        detail: getErrorMessage(err),
      }, 502);
    }

    await promoteShopifyAppToActive(workspaceId);

    log.info({ workspaceId, providerConfigKey }, "shopify app provisioned (self-service)");

    return c.json({
      provider_config_key: providerConfigKey,
      app_name: storeName,
      store_domain: body.store_domain,
      status: "active",
    });
  } catch (err) {
    log.error({ err }, "provisionShopifyApp error");
    return c.json({ error: getErrorMessage(err) || "Internal error" }, 500);
  }
}

/**
 * DELETE /cowork/connectors/shopify-app
 * Tear down the workspace's Shopify app and all its connections.
 */
export async function deprovisionShopifyAppHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: WORKSPACE_REQUIRED_ERROR }, 422);

    const nango = getNango();
    if (!nango) return c.json({ error: "Connectors not configured" }, 503);

    const providerConfigKey = await markShopifyAppDeleting(workspaceId);
    if (!providerConfigKey) {
      return c.json({ error: "No active Shopify app for this workspace" }, 404);
    }

    invalidateConnectionsCache(workspaceId);
    invalidateProcessorCache(workspaceId);

    let deletedConnections = 0;
    try {
      const result = await nango.listConnections({
        tags: { end_user_id: workspaceId },
      });
      for (const conn of result.connections) {
        if (conn.provider_config_key !== providerConfigKey) continue;
        try {
          await nango.deleteConnection(providerConfigKey, conn.connection_id);
          deletedConnections += 1;
        } catch (err) {
          log.warn({ err, workspaceId, connectionId: conn.connection_id }, "failed to delete nango connection");
        }
      }
    } catch (err) {
      log.warn({ err, workspaceId }, "listConnections failed during teardown");
      return c.json({ error: "Teardown incomplete; will retry automatically", detail: getErrorMessage(err) }, 202);
    }

    try {
      await nango.deleteIntegration(providerConfigKey);
    } catch (err) {
      log.warn({ err, workspaceId, providerConfigKey }, "deleteIntegration failed");
      return c.json({ error: "Teardown incomplete; will retry automatically", detail: getErrorMessage(err) }, 202);
    }

    await finalizeShopifyAppSoftDelete(workspaceId);

    log.info({ workspaceId, providerConfigKey, deletedConnections }, "shopify app torn down (self-service)");

    return c.json({ success: true, deleted_connections: deletedConnections });
  } catch (err) {
    log.error({ err }, "deprovisionShopifyApp error");
    return c.json({ error: getErrorMessage(err) || "Internal error" }, 500);
  }
}

/**
 * GET /cowork/connectors/shopify-app
 * Return the workspace's current Shopify app status (or null if none).
 */
export async function getShopifyAppHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: WORKSPACE_REQUIRED_ERROR }, 422);

    const app = await getAnyActiveOrPendingShopifyApp(workspaceId);
    if (!app) {
      return c.json({ app: null, required_scopes: REQUIRED_SHOPIFY_SCOPES });
    }

    return c.json({
      app: {
        provider_config_key: app.providerConfigKey,
        app_name: app.appName,
        store_domain: app.storeDomain,
        status: app.status,
        client_id_last4: app.clientIdLast4,
        scopes: app.scopes,
        created_at: app.createdAt,
      },
      required_scopes: REQUIRED_SHOPIFY_SCOPES,
    });
  } catch (err) {
    log.error({ err }, "getShopifyApp error");
    return c.json({ error: getErrorMessage(err) || "Internal error" }, 500);
  }
}
