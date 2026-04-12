import { Agent } from "@mastra/core/agent";
import { instructionsWithSoulMd } from "@/lib/agent-instructions-with-soul";
import { perfMarketingWorkspace } from "../shared/agent-workspaces";
import { perfMarketingMemory } from "../../memory";
import { PERF_MARKETING_PROMPT } from "./prompt";
import { buildPerfMarketingTools } from "./tools";
import {
  metricSpecificityScorer,
  actionabilityScorer,
  scopeAdherenceScorer,
  donTrajectoryScorer,
} from "@/mastra/evals/don";

export const performanceMarketingAgent = new Agent({
  id: "performance-marketing-manager",
  name: "Don",
  description:
    "Analyzes ad performance across Meta and Google, detects creative fatigue, " +
    "identifies budget waste, tracks ROAS/CAC/CTR metrics. Delegate here for any " +
    "ad performance questions, campaign analysis, or marketing analytics.",
  model: "anthropic/claude-sonnet-4-6",
  instructions: async ({ requestContext }) =>
    instructionsWithSoulMd(
      requestContext,
      "performance-marketing-manager",
      PERF_MARKETING_PROMPT,
    ),
  tools: ({ requestContext }) => buildPerfMarketingTools(requestContext),
  memory: perfMarketingMemory,
  workspace: perfMarketingWorkspace,
  scorers: {
    metricSpecificity: {
      scorer: metricSpecificityScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    actionability: {
      scorer: actionabilityScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    scopeAdherence: {
      scorer: scopeAdherenceScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    trajectory: {
      scorer: donTrajectoryScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
});
