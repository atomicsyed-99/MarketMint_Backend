import { AGENTS_CONFIG } from "@/data/agents_config";
import { listAgentConfigs } from "@/services/agent-configs";

/**
 * Mastra sub-agents registered on `marketMintAgent` → `agent_configs.key`.
 * Single source of truth for delegation gating and orchestrator roster text.
 */
export const MASTRA_SUB_AGENTS: readonly {
  mastraPrimitiveId: string;
  configKey: string;
}[] = [
  {
    mastraPrimitiveId: "performance-marketing-manager",
    configKey: "performance-marketing-manager",
  },
  {
    mastraPrimitiveId: "shopify-store-manager",
    configKey: "shopify-store-manager",
  },
  { mastraPrimitiveId: "email-crm-manager", configKey: "email-crm-manager" },
  {
    mastraPrimitiveId: "agents-job-manager-agent",
    configKey: "agents-job-manager",
  },
  { mastraPrimitiveId: "geo-optimizer", configKey: "geo-optimizer" },
] as const;

/** Maps Mastra `primitiveId` → `agent_configs.key` for delegation checks. */
export const MASTRA_PRIMITIVE_ID_TO_AGENT_CONFIG_KEY: Record<string, string> =
  Object.fromEntries(
    MASTRA_SUB_AGENTS.map((x) => [x.mastraPrimitiveId, x.configKey]),
  );

function displayNameForConfigKey(configKey: string): string {
  const seed = AGENTS_CONFIG.find((c) => c.key === configKey);
  if (seed?.name?.trim()) return seed.name.trim();
  if (configKey === "agents-job-manager") return "Job Manager Agent";
  return configKey;
}

function defaultEnabledForConfigKey(configKey: string): boolean {
  const seed = AGENTS_CONFIG.find((c) => c.key === configKey);
  return seed?.enabled ?? true;
}

/**
 * Markdown block prepended to the orchestrator system prompt: current specialist
 * names and enabled flags (from `agent_configs` when workspace is known).
 */
export async function buildOrchestratorSubAgentContextAppendix(
  workspaceId: string | undefined,
): Promise<string> {
  const byKey = new Map<string, { name: string; enabled: boolean }>();

  if (workspaceId?.trim()) {
    const configs = await listAgentConfigs(workspaceId.trim());
    for (const c of configs) {
      byKey.set(c.key, { name: c.name.trim(), enabled: c.enabled });
    }
  } else {
    for (const entry of AGENTS_CONFIG) {
      if (entry.key === "orchestrator") continue;
      byKey.set(entry.key, {
        name: entry.name.trim(),
        enabled: entry.enabled,
      });
    }
  }

  const lines: string[] = [
    "## Live specialist roster (this workspace)",
    "",
    "Each line is the **current** display name and whether the specialist is **enabled** in Marketmint agent settings. This list overrides static labels elsewhere in the prompt if they disagree.",
    "",
  ];

  for (const { mastraPrimitiveId, configKey } of MASTRA_SUB_AGENTS) {
    const row = byKey.get(configKey);
    const name = row?.name ?? displayNameForConfigKey(configKey);
    const enabled = row !== undefined ? row.enabled : defaultEnabledForConfigKey(configKey);
    const status = enabled ? "enabled" : "disabled";
    lines.push(`- **${name}** — delegation id \`${mastraPrimitiveId}\` — **${status}**`);
  }

  lines.push("");
  lines.push("### When a required specialist is disabled (mandatory)");
  lines.push("");
  lines.push(
    "If the user’s request requires work from a specialist listed above as **disabled**:",
  );
  lines.push("");
  lines.push("1. **Do not** delegate to that specialist.");
  lines.push(
    "2. **Do not** use tools, skills, web search, planning, or your own writing to substitute or approximate that specialist’s work.",
  );
  lines.push("3. **Do not** suggest other agents or workarounds for the same intent.");
  lines.push(
    "4. Reply with **only** a brief message: that specialist is turned off for their workspace. Tell them to open the **Agents** section (in Marketmint), enable that agent there, then ask again. Do **not** send them to Dashboards for this. Nothing else in that turn — no summaries, tips, or alternatives.",
  );
  lines.push("");

  return lines.join("\n");
}
