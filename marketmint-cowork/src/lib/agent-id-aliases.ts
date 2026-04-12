/**
 * Single source of truth for mapping wire-format / legacy agent IDs
 * to canonical `agent_configs.key` values. Consumed by
 * `normalize-agent-id.ts` (chat stream enrichment) and
 * `agent-job-readonly-tools.ts` (job executor legacy bridge).
 */
export const AGENT_ID_ALIASES: Record<string, string> = {
  "marketmint-agent": "orchestrator",
  "marketmint-agent": "orchestrator",
  "creative-director": "orchestrator",
  "creative-director-agent": "orchestrator",
  "performance-marketing-agent": "performance-marketing-manager",
  "shopify-store-manager-agent": "shopify-store-manager",
  "email-crm-manager-agent": "email-crm-manager",
  "geo-optimizer-agent": "geo-optimizer",
};
