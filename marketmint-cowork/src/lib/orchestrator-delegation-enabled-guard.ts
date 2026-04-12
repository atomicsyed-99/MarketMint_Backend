import { getAgentConfigByKey } from "@/db/queries/agent-configs";
import { MASTRA_PRIMITIVE_ID_TO_AGENT_CONFIG_KEY } from "@/lib/orchestrator-sub-agent-context";

/**
 * Whether orchestrator delegation to a sub-agent is allowed for this workspace.
 *
 * Reads **`enabled`** from PostgreSQL table **`agent_configs`** for
 * `(workspace_id, key)` where `key` matches the specialist (see mapping above).
 * Same source as the Marketmint UI / `GET` agent settings: seeded via
 * `seedAgentConfigsForWorkspace` from `AGENTS_CONFIG`, updated via
 * `disableAgentConfig` / `updateAgentConfig` in `src/services/agent-configs.ts`.
 *
 * If there is **no row** for that agent key, delegation is **allowed** (no gate).
 */
export async function assertSubAgentDelegationEnabled(args: {
  workspaceId: string | undefined;
  primitiveId: string;
  primitiveType: "agent" | "workflow";
}): Promise<{ proceed: true } | { proceed: false; rejectionReason: string }> {
  const { workspaceId, primitiveId, primitiveType } = args;
  if (primitiveType !== "agent") return { proceed: true };
  if (!workspaceId?.trim()) return { proceed: true };

  const key = MASTRA_PRIMITIVE_ID_TO_AGENT_CONFIG_KEY[primitiveId];
  if (!key) return { proceed: true };

  const row = await getAgentConfigByKey(workspaceId, key);
  if (!row) return { proceed: true };

  if (row.enabled) return { proceed: true };

  return {
    proceed: false,
    rejectionReason: `${row.name} is disabled for this workspace. Open the Agents section and enable this agent, then try again.`,
  };
}
