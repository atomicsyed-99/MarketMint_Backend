import { ToolSearchProcessor } from "@mastra/core/processors";
import { getConnectorById } from "./registry";
import type { Connections } from "./types";
import { createLogger } from "@/lib/logger";

const log = createLogger("processor-cache");

// ---------------------------------------------------------------------------
// Build flat tool map from active connections
// ---------------------------------------------------------------------------

export function buildAllConnectorTools(
  connections: Connections,
): Record<string, any> {
  const allTools: Record<string, any> = {};

  for (const [connectorId, info] of Object.entries(connections)) {
    if (!info) continue;
    const connector = getConnectorById(connectorId);
    if (!connector || !connector.enabled) continue;

    const tools = connector.toolFactory(
      info.connectionId,
      info.apiKeys,
      info.providerConfigKey,
    );
    Object.assign(allTools, tools);
  }

  return allTools;
}

// ---------------------------------------------------------------------------
// Shared processor cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface ProcessorCacheEntry {
  processor: ToolSearchProcessor;
  connectionsHash: string;
  lastAccessed: number;
}

export const processorCache = new Map<string, ProcessorCacheEntry>();

// unref() prevents this timer from keeping the process alive on shutdown
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of processorCache) {
    if (now - entry.lastAccessed > CACHE_TTL_MS) {
      processorCache.delete(key);
    }
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

export function hashConnections(connections: Connections): string {
  const active = Object.entries(connections)
    .filter(([_, v]) => v)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(active);
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

export function invalidateProcessorCache(workspaceId: string): void {
  processorCache.delete(workspaceId);
}

// ---------------------------------------------------------------------------
// Live tool injection (mutates an existing processor mid-stream)
// ---------------------------------------------------------------------------

export function injectToolsIntoProcessor(
  processor: ToolSearchProcessor,
  connections: Connections,
): number {
  const newTools = buildAllConnectorTools(connections);
  const p = processor as any;
  let added = 0;
  for (const [key, tool] of Object.entries(newTools)) {
    if (p.allTools[key]) continue;
    p.allTools[key] = tool;
    const name = (tool as any).id ?? key;
    const description = (tool as any).description ?? "";
    p.bm25Index.add(name, `${name} ${description}`);
    p.toolDescriptions.set(name, description);
    added++;
  }
  return added;
}
