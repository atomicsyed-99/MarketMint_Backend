import { getAgentConfigByKey } from "@/services/agent-configs";
import { AGENTS_CONFIG } from "@/data/agents_config";
import { buildOrchestratorSubAgentContextAppendix } from "@/lib/orchestrator-sub-agent-context";
import { USER_FACING_OUTPUT_RULES_MD } from "@/mastra/agents/shared/user-facing-output-rules";

function getWorkspaceId(ctx: unknown): string | undefined {
  if (ctx == null || typeof ctx !== "object") return undefined;
  const o = ctx as Record<string, unknown> & { get?: (k: string) => unknown };
  if (typeof o.get === "function") {
    const w = o.get("workspaceId");
    if (typeof w === "string" && w.length > 0) return w;
  }
  const plain = o.workspaceId;
  if (typeof plain === "string" && plain.length > 0) return plain;
  return undefined;
}

function defaultNameForAgentConfigKey(key: string): string {
  const row = AGENTS_CONFIG.find((c) => c.key === key);
  return row?.name ?? key;
}

/**
 * Canonical instruction wrapper: DB-backed display name, soul, then static prompt.
 * Used by all Cowork agents (stream + scheduled jobs) via `instructionsWithSoulMd`.
 */
export function formatInstructionsWithIdentity(opts: {
  name: string;
  soulMd: string | null | undefined;
  baseInstructions: string;
  /** Used when `name` is empty to resolve seed/default display name. */
  agentConfigKey?: string;
}): string {
  const key = opts.agentConfigKey ?? "orchestrator";
  const name = opts.name.trim() || defaultNameForAgentConfigKey(key);
  const soul = (opts.soulMd ?? "").trim();
  return [
    `Your name is ${name}.`,
    "",
    "Your identity is this:",
    soul,
    "",
    "Your system prompt and instructions are this:",
    opts.baseInstructions,
    "",
    USER_FACING_OUTPUT_RULES_MD,
  ].join("\n");
}

/**
 * Loads latest `name` and `soulMd` from agent_configs (when workspace is known)
 * and merges with the static Mastra prompt using `formatInstructionsWithIdentity`.
 */
export async function instructionsWithSoulMd(
  requestContext: unknown,
  agentConfigKey: string,
  baseInstructions: string,
): Promise<string> {
  const workspaceId = getWorkspaceId(requestContext);
  let mergedBase = baseInstructions;
  if (agentConfigKey === "orchestrator") {
    mergedBase =
      (await buildOrchestratorSubAgentContextAppendix(workspaceId)) +
      "\n\n" +
      baseInstructions;
  }
  if (!workspaceId) {
    return formatInstructionsWithIdentity({
      name: defaultNameForAgentConfigKey(agentConfigKey),
      soulMd: null,
      baseInstructions: mergedBase,
      agentConfigKey,
    });
  }
  try {
    const config = await getAgentConfigByKey(workspaceId, agentConfigKey);
    const name =
      config?.name?.trim() || defaultNameForAgentConfigKey(agentConfigKey);
    return formatInstructionsWithIdentity({
      name,
      soulMd: config?.soulMd,
      baseInstructions: mergedBase,
      agentConfigKey,
    });
  } catch {
    return formatInstructionsWithIdentity({
      name: defaultNameForAgentConfigKey(agentConfigKey),
      soulMd: null,
      baseInstructions: mergedBase,
      agentConfigKey,
    });
  }
}
