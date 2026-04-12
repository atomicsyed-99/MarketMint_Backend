import { getNango } from "./client";
import type { Connections } from "../types";
import { getConnectorByProviderKey } from "../registry";
import { evictOldest, MAX_CACHE_SIZE } from "../cache-utils";
import { createLogger } from "@/lib/logger";

const log = createLogger("nango-connections");

// ---------------------------------------------------------------------------
// In-memory cache — avoids Nango API call on every chat request
// ---------------------------------------------------------------------------

interface CacheEntry {
  connections: Connections;
  expires: number;
  lastAccessed: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000; // 60 seconds

/**
 * Fetch active Nango connections for a workspace.
 * Uses Clerk orgId (workspaceId) as Nango's end_user_id tag — all
 * workspace members share the same set of connections.
 *
 * Returns {} gracefully when:
 * - workspaceId is empty/undefined
 * - NANGO_SECRET_KEY is not set
 * - Nango API is unreachable
 * - Any other error
 */
export async function getUserConnections(
  workspaceId: string,
): Promise<Connections> {
  if (!workspaceId) return {};

  // Check cache first (keyed by workspaceId so all members share one entry)
  const cached = cache.get(workspaceId);
  if (cached && Date.now() < cached.expires) {
    cached.lastAccessed = Date.now();
    return cached.connections;
  }

  const client = getNango();
  if (!client) return {};

  try {
    const result = await client.listConnections({
      tags: { end_user_id: workspaceId },
    });

    const connections: Connections = {};

    // Separate OAuth connectors (no credential fetch needed) from api-key connectors
    const apiKeyConnectors: Array<{
      providerConfigKey: string;
      connectionId: string;
    }> = [];

    for (const conn of result.connections) {
      const connector = getConnectorByProviderKey(conn.provider_config_key);
      if (connector?.authType === "api-key") {
        apiKeyConnectors.push({
          providerConfigKey: conn.provider_config_key,
          connectionId: conn.connection_id,
        });
      } else {
        // OAuth connectors — no getConnection call needed
        // Normalize key to canonical connector id (e.g. "shopify-acme-7f3a2b" → "shopify")
        const mapKey = connector?.id ?? conn.provider_config_key;
        connections[mapKey] = {
          providerConfigKey: conn.provider_config_key,
          connectionId: conn.connection_id,
        };
      }
    }

    // Fetch api-key credentials in parallel
    const apiKeyResults = await Promise.all(
      apiKeyConnectors.map(async (conn) => {
        try {
          const fullConn = await client.getConnection(
            conn.providerConfigKey,
            conn.connectionId,
          );
          const fullConnAny = fullConn as any;
          const creds = fullConnAny?.credentials ?? {};
          const connConfig = fullConnAny?.connection_config ?? fullConnAny?.connectionConfig ?? {};
          // Merge credentials + connection config so tools get all fields
          // (e.g. PostHog has apiKey in credentials + subdomain/projectId in connection_config)
          const apiKeys: Record<string, string> = {};
          for (const [k, v] of Object.entries({ ...connConfig, ...creds })) {
            if (typeof v === "string" && v) apiKeys[k] = v;
          }
          log.debug({ provider: conn.providerConfigKey, apiKeyFields: Object.keys(apiKeys) }, "API-key credentials fetched");
          return { ...conn, apiKeys };
        } catch (err) {
          log.warn({ err, provider: conn.providerConfigKey }, "failed to fetch credentials");
          return null;
        }
      }),
    );

    // Merge successful api-key results into the connections map
    for (const entry of apiKeyResults) {
      if (!entry) continue;
      const apiConnector = getConnectorByProviderKey(entry.providerConfigKey);
      const mapKey = apiConnector?.id ?? entry.providerConfigKey;
      connections[mapKey] = {
        providerConfigKey: entry.providerConfigKey,
        connectionId: entry.connectionId,
        apiKeys: entry.apiKeys,
      };
    }

    // Evict oldest entry if cache is full
    if (cache.size >= MAX_CACHE_SIZE) {
      evictOldest(cache);
    }

    // Store in cache
    const now = Date.now();
    cache.set(workspaceId, {
      connections,
      expires: now + TTL_MS,
      lastAccessed: now,
    });

    return connections;
  } catch (err) {
    log.warn({ err }, "failed to fetch connections, continuing without connectors");
    return {};
  }
}

/**
 * Invalidate cached connections for a workspace.
 * Call after connect/disconnect API operations.
 */
export function invalidateConnectionsCache(workspaceId: string): void {
  cache.delete(workspaceId);
}
