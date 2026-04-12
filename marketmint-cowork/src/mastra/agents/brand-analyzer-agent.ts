import { Agent } from "@mastra/core/agent";
import { USER_FACING_OUTPUT_RULES_MD } from "@/mastra/agents/shared/user-facing-output-rules";

export const brandAnalyzerAgent = new Agent({
  id: "brandAnalyzerAgent",
  name: "Brand Analyzer",
  instructions: `You analyze brands and produce structured reports covering:
brand identity, target audience, design philosophy, color palette,
typography, imagery style, and content tone.

${USER_FACING_OUTPUT_RULES_MD}`,
  model: "openai/gpt-4o",
});

