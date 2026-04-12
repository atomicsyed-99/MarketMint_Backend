import { Agent } from "@mastra/core/agent";
import { instructionsWithSoulMd } from "@/lib/agent-instructions-with-soul";
import { geoOptimizerWorkspace } from "../shared/agent-workspaces";
import { geoOptimizerMemory } from "../../memory";
import { GEO_OPTIMIZER_PROMPT } from "./prompt";
import { buildGeoOptimizerTools } from "./tools";
import {
  geoPrecisionScorer,
  sageScopeAdherenceScorer,
  sageTrajectoryScorer,
} from "@/mastra/evals/sage";

export const geoOptimizerAgent = new Agent({
  id: "geo-optimizer",
  name: "Sage",
  description:
    "Improves brand GEO visibility across ChatGPT, Perplexity, Gemini, and other LLM providers. " +
    "Extracts trackable prompts, runs citation audits, and generates GEO-optimized content.",
  model: "anthropic/claude-sonnet-4-6",
  instructions: async ({ requestContext }) =>
    instructionsWithSoulMd(requestContext, "geo-optimizer", GEO_OPTIMIZER_PROMPT),
  tools: ({ requestContext }) => buildGeoOptimizerTools(requestContext),
  memory: geoOptimizerMemory,
  workspace: geoOptimizerWorkspace,
  scorers: {
    geoPrecision: {
      scorer: geoPrecisionScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    scopeAdherence: {
      scorer: sageScopeAdherenceScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    trajectory: {
      scorer: sageTrajectoryScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
});
