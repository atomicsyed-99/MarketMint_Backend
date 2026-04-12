import { ToolSearchProcessor } from "@mastra/core/processors";
import type { Connections } from "./types";
import { evictOldest, MAX_CACHE_SIZE } from "./cache-utils";
import {
  processorCache,
  hashConnections,
} from "./processor-cache";
import { dynamicTools } from "@/mastra/tools";
import { wrapToolWithUtility } from "./tools/wrap-with-utility";
import { createLogger } from "@/lib/logger";
import { getConnectorById } from "./registry";

// Re-export so existing callers don't need to change their imports
export { invalidateProcessorCache, injectToolsIntoProcessor } from "./processor-cache";

/**
 * Build all connector tools for a workspace's active connections.
 *
 * NOTE: Write tools SHOULD have `requireApproval: true` for the
 * ToolApprovalCard UI, but Mastra's ToolSearchProcessor has a bug:
 * makeCoreTool() doesn't copy `requireApproval` from the tool object
 * to the options (unlike the agent-level path). Filed upstream.
 * When fixed, add `isWriteTool` check here to set requireApproval.
 */
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
    for (const [toolKey, tool] of Object.entries(tools)) {
      wrapToolWithUtility(tool, toolKey);
    }
    Object.assign(allTools, tools);
  }

  return allTools;
}
const log = createLogger("build-toolset");

// ---------------------------------------------------------------------------
// Cached ToolSearchProcessor per user
// ---------------------------------------------------------------------------

/**
 * Get or create a cached ToolSearchProcessor for a workspace.
 *
 * The processor is long-lived so that loaded tools (via load_tool)
 * persist across requests within the same chat thread.
 * Keyed by workspaceId so all workspace members share one cache entry.
 *
 * Returns null when the workspace has no active connections.
 */
export function getOrCreateConnectorProcessor(
  workspaceId: string,
  connections: Connections,
): ToolSearchProcessor | null {
  if (!workspaceId) return null;

  // Check empty connections first (cheap)
  const connectedKeys = Object.keys(connections).filter(
    (k) => connections[k],
  );
  if (connectedKeys.length === 0) return null;

  // Hash check BEFORE building tools — avoids expensive buildAllConnectorTools on cache hits
  const newHash = hashConnections(connections);
  const cached = processorCache.get(workspaceId);

  if (cached && cached.connectionsHash === newHash) {
    cached.lastAccessed = Date.now();
    log.debug({ workspaceId, hash: newHash }, "cache HIT — reusing processor");
    return cached.processor;
  }
  log.debug({ workspaceId, oldHash: cached?.connectionsHash, newHash }, "cache MISS — rebuilding");

  // Only build tools on cache miss
  const connectorTools = buildAllConnectorTools(connections);
  // Merge dynamic core tools + connector tools into a single processor
  const allTools = { ...dynamicTools, ...connectorTools };
  log.debug({ total: Object.keys(allTools).length, dynamic: Object.keys(dynamicTools).length, connector: Object.keys(connectorTools).length }, "built tools");
  if (Object.keys(allTools).length === 0) return null;

  // Evict oldest entry if cache is full
  if (processorCache.size >= MAX_CACHE_SIZE) {
    evictOldest(processorCache);
  }

  // Build new processor
  const processor = new ToolSearchProcessor({
    tools: allTools,
    search: { topK: 10, minScore: 0 },
    ttl: 3600000, // 1 hour — auto-cleans stale thread state
  });

  processorCache.set(workspaceId, {
    processor,
    connectionsHash: newHash,
    lastAccessed: Date.now(),
  });

  return processor;
}

// ---------------------------------------------------------------------------
// Empty processor for requests with no initial connections
// ---------------------------------------------------------------------------

/**
 * Create a ToolSearchProcessor with dynamic core tools but no connector tools.
 * Used when a workspace has no active connections so that search_tools /
 * load_tool are still available for the non-core agent tools. If the user
 * connects a service mid-stream, refreshConnections can inject connector
 * tools into this processor.
 */
export function createEmptyConnectorProcessor(): ToolSearchProcessor {
  return new ToolSearchProcessor({
    tools: { ...dynamicTools },
    search: { topK: 10, minScore: 0 },
    ttl: 3600000,
  });
}

/**
 * Supervisor (`marketMintAgent`) ToolSearchProcessor: generation tools are merged on the
 * agent directly; this processor stays empty for the orchestrator path.
 */
export function createOrchestratorInputProcessor(): ToolSearchProcessor {
  return new ToolSearchProcessor({
    tools: {},
    search: { topK: 10, minScore: 0 },
    ttl: 3600000,
  });
}
