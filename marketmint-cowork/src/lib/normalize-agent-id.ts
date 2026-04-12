import { AGENT_ID_ALIASES } from "./agent-id-aliases";

/**
 * Normalize a Mastra-emitted agent identifier to an `agent_configs.key`.
 *
 * Handles all wire forms Mastra may emit:
 *   - `creativeDirectorAgent`       (registry key)
 *   - `creative-director-agent`     (kebab + suffix)
 *   - `agent-creativeDirectorAgent` (tool-prefixed)
 *   - `creative-director`           (canonical)
 *
 * Aliases from `AGENT_ID_ALIASES` apply BEFORE the `-agent` suffix
 * strip so structural remaps (e.g. `performance-marketing-agent` →
 * `performance-marketing-manager`) resolve correctly instead of
 * collapsing to `performance-marketing`.
 */
export function normalizeAgentId(raw: string): string {
  if (typeof raw !== "string") return "";
  let id = raw.trim();
  if (!id) return "";

  if (id.startsWith("agent-")) {
    id = id.slice("agent-".length);
  }

  id = id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

  if (AGENT_ID_ALIASES[id]) return AGENT_ID_ALIASES[id];

  if (id.endsWith("-agent")) {
    id = id.slice(0, -"-agent".length);
  }

  return id;
}
