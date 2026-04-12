import type { AgentConfig } from "@/schemas/agent-configs";
import { getAgentConfigByKey } from "@/services/agent-configs";
import { NotFoundError } from "@/services/agent-jobs";

/**
 * Resolves which `agent_configs.key` "owns" a tool call in the supervisor stream.
 * - `agent-*` delegation tools are invoked by the orchestrator → `orchestrator`.
 * - All other tools while a delegation frame is open → that sub-agent's `configKey`.
 * - Otherwise → `orchestrator`.
 */
export function agentConfigKeyForToolEvent(
  toolName: string | undefined,
  delegationStack: readonly { configKey: string }[],
): string {
  if (typeof toolName === "string" && toolName.startsWith("agent-")) {
    return "orchestrator";
  }
  if (delegationStack.length > 0) {
    return delegationStack[delegationStack.length - 1]!.configKey;
  }
  return "orchestrator";
}

/** JSON-serializable agent row for SSE / toolCalls column (dates as ISO strings). */
export function serializeAgentConfigForClient(
  config: AgentConfig,
): Record<string, unknown> {
  return {
    id: config.id,
    workspaceId: config.workspaceId,
    name: config.name,
    key: config.key,
    role: config.role,
    enabled: config.enabled,
    available: config.available,
    avatarColor: config.avatarColor,
    avatarSrc: config.avatarSrc,
    description: config.description,
    connectors: config.connectors,
    jobs: config.jobs,
    soulMd: config.soulMd,
    howToUse: config.howToUse,
    createdAt:
      config.createdAt instanceof Date
        ? config.createdAt.toISOString()
        : config.createdAt,
    updatedAt:
      config.updatedAt instanceof Date
        ? config.updatedAt.toISOString()
        : config.updatedAt,
  };
}

export async function loadSerializedAgentConfigCached(
  workspaceId: string,
  agentConfigKey: string,
  cache: Map<string, Promise<Record<string, unknown> | null>>,
): Promise<Record<string, unknown> | null> {
  let pending = cache.get(agentConfigKey);
  if (!pending) {
    pending = (async () => {
      try {
        const row = await getAgentConfigByKey(workspaceId, agentConfigKey);
        return row ? serializeAgentConfigForClient(row) : null;
      } catch (e) {
        if (e instanceof NotFoundError) return null;
        console.error(
          `[tool-call-context] Failed to load agent config ${agentConfigKey}:`,
          e,
        );
        return null;
      }
    })();
    cache.set(agentConfigKey, pending);
  }
  return pending;
}

export const TOOL_LIFECYCLE_EVENT_TYPES = new Set([
  "tool-input-start",
  "tool-input-delta",
  "tool-input-available",
  "tool-output-available",
  "tool-output-error",
]);
