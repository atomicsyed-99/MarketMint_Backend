import { orchestratorTools } from "@/mastra/tools";
import { isWriteTool } from "@/mastra/agents/shared/build-scoped-tools";
import { buildMarketMintOrchestratorTools } from "@/mastra/agents/marketmint-orchestrator-tools";
import { buildPerfMarketingTools } from "@/mastra/agents/performance-marketing/tools";
import { buildStoreManagerTools } from "@/mastra/agents/shopify-store-manager/tools";
import { buildEmailCrmTools } from "@/mastra/agents/email-crm-manager/tools";
import { buildGeoOptimizerTools } from "@/mastra/agents/geo-optimizer/tools";
import { AGENT_ID_ALIASES } from "./agent-id-aliases";

export const JOB_EXECUTABLE_AGENT_IDS = [
  "orchestrator",
  "performance-marketing-manager",
  "shopify-store-manager",
  "email-crm-manager",
  "geo-optimizer",
] as const;

export type JobExecutableAgentId = (typeof JOB_EXECUTABLE_AGENT_IDS)[number];

const LEGACY_JOB_AGENT_IDS =
  AGENT_ID_ALIASES as Record<string, JobExecutableAgentId>;

/**
 * Resolves optional `agentId` from the chat body to a Mastra registry key.
 * Missing/blank → orchestrator (`marketMintAgent`). Unknown id → `null`.
 */
export function mastraRegistryKeyForChatAgentId(
  bodyAgentId: string | undefined,
): string | null {
  if (bodyAgentId == null || String(bodyAgentId).trim() === "") {
    return mastraRegistryKeyForJobAgentId("orchestrator");
  }
  const trimmed = String(bodyAgentId).trim();
  const normalized = LEGACY_JOB_AGENT_IDS[trimmed] ?? trimmed;
  if (!isJobExecutableAgentId(normalized)) return null;
  return mastraRegistryKeyForJobAgentId(normalized);
}

export function isJobExecutableAgentId(id: string): id is JobExecutableAgentId {
  return (JOB_EXECUTABLE_AGENT_IDS as readonly string[]).includes(id);
}

function normalizeJobAgentId(stored: string): string {
  return LEGACY_JOB_AGENT_IDS[stored] ?? stored;
}

/** Misconfigured job manager id should not run scheduled work — use orchestrator */
export function resolveJobTargetAgentId(stored: string): JobExecutableAgentId {
  const normalized = normalizeJobAgentId(stored);
  if (normalized === "auto" || !normalized) return "orchestrator";
  if (normalized === "agents-job-manager-agent") return "orchestrator";
  if (isJobExecutableAgentId(normalized)) return normalized;
  return "orchestrator";
}

/**
 * `mastra.getAgent()` expects the Mastra instance registry key (`agents: { marketMintAgent, ... }`),
 * while jobs store each agent's `Agent.id` (kebab-case). Map here when executing scheduled runs.
 */
export function mastraRegistryKeyForJobAgentId(
  agentId: JobExecutableAgentId,
): string {
  switch (agentId) {
    case "orchestrator":
      return "marketMintAgent";
    case "performance-marketing-manager":
      return "performanceMarketingAgent";
    case "shopify-store-manager":
      return "shopifyStoreManagerAgent";
    case "email-crm-manager":
      return "emailCrmManagerAgent";
    case "geo-optimizer":
      return "geoOptimizerAgent";
    default: {
      const _x: never = agentId;
      return _x;
    }
  }
}

/** Full orchestrator tool surface for scheduled jobs (matches merged orchestrator tools). */
export function orchestratorReadOnlyActiveToolNames(): string[] {
  return Object.keys(orchestratorTools);
}

export function readOnlyActiveToolNamesForSpecialist(
  agentId: JobExecutableAgentId,
  requestContext: unknown,
): string[] {
  if (agentId === "orchestrator") {
    return Object.keys(buildMarketMintOrchestratorTools(requestContext)).filter(
      (id) => !isWriteTool(id),
    );
  }

  let built: Record<string, any>;
  switch (agentId) {
    case "performance-marketing-manager":
      built = buildPerfMarketingTools(requestContext);
      break;
    case "shopify-store-manager":
      built = buildStoreManagerTools(requestContext);
      break;
    case "email-crm-manager":
      built = buildEmailCrmTools(requestContext);
      break;
    case "geo-optimizer":
      built = buildGeoOptimizerTools(requestContext);
      break;
    default:
      built = {};
  }

  return Object.keys(built).filter((id) => !isWriteTool(id));
}
