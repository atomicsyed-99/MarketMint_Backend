import type { JobExecutableAgentId } from "@/lib/agent-job-readonly-tools";
import { ORCHESTRATOR_PROMPT } from "@/mastra/agents/prompts/orchestrator-prompt";
import { PERF_MARKETING_PROMPT } from "@/mastra/agents/performance-marketing/prompt";
import { STORE_MANAGER_PROMPT } from "@/mastra/agents/shopify-store-manager/prompt";
import { EMAIL_CRM_PROMPT } from "@/mastra/agents/email-crm-manager/prompt";
import { GEO_OPTIMIZER_PROMPT } from "@/mastra/agents/geo-optimizer/prompt";

export function staticPromptForExecutableAgent(id: JobExecutableAgentId): string {
  switch (id) {
    case "orchestrator":
      return ORCHESTRATOR_PROMPT;
    case "performance-marketing-manager":
      return PERF_MARKETING_PROMPT;
    case "shopify-store-manager":
      return STORE_MANAGER_PROMPT;
    case "email-crm-manager":
      return EMAIL_CRM_PROMPT;
    case "geo-optimizer":
      return GEO_OPTIMIZER_PROMPT;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
