import { Agent } from "@mastra/core/agent";
import {
  DELEGATION_SUB_AGENT_MAX_STEPS,
  SUPERVISOR_MAX_STEPS,
} from "@/constants";
import { orchestratorMemory } from "../memory";
import { orchestratorWorkspace } from "./shared/agent-workspaces";
import { instructionsWithSoulMd } from "@/lib/agent-instructions-with-soul";
import { ORCHESTRATOR_PROMPT } from "./prompts/orchestrator-prompt";
import { shopifyStoreManagerAgent } from "./shopify-store-manager/agent";
import { performanceMarketingAgent } from "./performance-marketing/agent";
import { emailCrmManagerAgent } from "./email-crm-manager/agent";
import { agentsJobManagerAgent } from "./agents-job-manager-agent";
import { geoOptimizerAgent } from "./geo-optimizer/agent";
import { assertSubAgentDelegationEnabled } from "@/lib/orchestrator-delegation-enabled-guard";
import { buildMarketMintOrchestratorTools } from "./marketmint-orchestrator-tools";

export const marketMintAgent = new Agent({
  id: "orchestrator",
  name: "Aria",
  instructions: async ({ requestContext }) =>
    instructionsWithSoulMd(requestContext, "orchestrator", ORCHESTRATOR_PROMPT),
  model: "anthropic/claude-sonnet-4-6",
  tools: ({ requestContext }) =>
    buildMarketMintOrchestratorTools(requestContext),
  memory: orchestratorMemory,
  workspace: orchestratorWorkspace,
  agents: {
    shopifyStoreManagerAgent,
    performanceMarketingAgent,
    emailCrmManagerAgent,
    agentsJobManagerAgent,
    geoOptimizerAgent,
  },
  defaultOptions: {
    delegation: {
      onDelegationStart: async ({
        primitiveId,
        iteration,
        primitiveType,
        resourceId,
      }) => {
        console.log(
          `[delegation:start] → ${primitiveId} (iteration ${iteration})`,
        );
        if (iteration > SUPERVISOR_MAX_STEPS) {
          return {
            proceed: false,
            rejectionReason:
              "Max iterations reached. Synthesize current findings.",
          };
        }
        const enabledCheck = await assertSubAgentDelegationEnabled({
          workspaceId: resourceId,
          primitiveId,
          primitiveType,
        });
        if (!enabledCheck.proceed) {
          return {
            proceed: false,
            rejectionReason: enabledCheck.rejectionReason,
          };
        }
        return {
          proceed: true,
          modifiedMaxSteps: DELEGATION_SUB_AGENT_MAX_STEPS,
        };
      },
      onDelegationComplete: async ({ primitiveId, result, error }) => {
        if (error) {
          console.error(`[delegation:error] ${primitiveId}:`, error);
          return {
            feedback: `Delegation to ${primitiveId} failed: ${error}. Try a different approach.`,
          };
        }
        const usage = (result as any)?.usage;
        console.log(`[delegation:complete] ${primitiveId}`, {
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
        });
      },
      messageFilter: ({ messages }) => {
        const systemMsgs = messages.filter((m: any) => m.role === "system");
        const recentMsgs = messages
          .filter((m: any) => m.role !== "system")
          .slice(-10);
        return [...systemMsgs, ...recentMsgs];
      },
    },
    onIterationComplete: async ({
      iteration,
      maxIterations,
      finishReason,
    }: any) => {
      console.log(
        `[supervisor] iteration ${iteration}/${maxIterations}, reason: ${finishReason}`,
      );
      if (finishReason === "stop" || finishReason === "end_turn")
        return { continue: false };
      if (iteration >= SUPERVISOR_MAX_STEPS) return { continue: false };
      return { continue: true };
    },
  },
});
