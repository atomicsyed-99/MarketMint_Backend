import { Agent } from "@mastra/core/agent";
import { instructionsWithSoulMd } from "@/lib/agent-instructions-with-soul";
import { storeManagerWorkspace } from "../shared/agent-workspaces";
import { storeManagerMemory } from "../../memory";
import { STORE_MANAGER_PROMPT } from "./prompt";
import { buildStoreManagerTools } from "./tools";
import {
  storeMetricSpecificityScorer,
  samScopeAdherenceScorer,
  samTrajectoryScorer,
} from "@/mastra/evals/sam";

export const shopifyStoreManagerAgent = new Agent({
  id: "shopify-store-manager",
  name: "Sam",
  description:
    "Manages Shopify store operations: store audits, inventory monitoring, " +
    "catalog health, SEO, conversion optimization, product management. " +
    "Delegate here for any Shopify store questions, audits, or optimization.",
  model: "anthropic/claude-sonnet-4-6",
  instructions: async ({ requestContext }) =>
    instructionsWithSoulMd(requestContext, "shopify-store-manager", STORE_MANAGER_PROMPT),
  tools: ({ requestContext }) => buildStoreManagerTools(requestContext),
  memory: storeManagerMemory,
  workspace: storeManagerWorkspace,
  scorers: {
    storeMetricSpecificity: {
      scorer: storeMetricSpecificityScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    scopeAdherence: {
      scorer: samScopeAdherenceScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    trajectory: {
      scorer: samTrajectoryScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
});
