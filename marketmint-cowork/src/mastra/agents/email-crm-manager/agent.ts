import { Agent } from "@mastra/core/agent";
import { instructionsWithSoulMd } from "@/lib/agent-instructions-with-soul";
import { emailCrmWorkspace } from "../shared/agent-workspaces";
import { emailCrmMemory } from "../../memory";
import { EMAIL_CRM_PROMPT } from "./prompt";
import { buildEmailCrmTools } from "./tools";
import {
  emailMetricSpecificityScorer,
  elaraScopeAdherenceScorer,
  elaraTrajectoryScorer,
} from "@/mastra/evals/elara";

export const emailCrmManagerAgent = new Agent({
  id: "email-crm-manager",
  name: "Elara",
  description:
    "Manages email marketing and CRM: Klaviyo flows, campaign copy, " +
    "audience segmentation, email A/B testing. Delegate here for any email " +
    "sequence, Klaviyo, or CRM questions.",
  model: "anthropic/claude-haiku-4-5-20251001",
  instructions: async ({ requestContext }) =>
    instructionsWithSoulMd(requestContext, "email-crm-manager", EMAIL_CRM_PROMPT),
  tools: ({ requestContext }) => buildEmailCrmTools(requestContext),
  memory: emailCrmMemory,
  workspace: emailCrmWorkspace,
  scorers: {
    emailMetricSpecificity: {
      scorer: emailMetricSpecificityScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    scopeAdherence: {
      scorer: elaraScopeAdherenceScorer,
      sampling: { type: "ratio", rate: 1 },
    },
    trajectory: {
      scorer: elaraTrajectoryScorer,
      sampling: { type: "ratio", rate: 1 },
    },
  },
});
