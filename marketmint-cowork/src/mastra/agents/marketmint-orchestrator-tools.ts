import type { Connections } from "@/connectors/types";
import { orchestratorTools } from "@/mastra/tools";
import {
  directImageGen,
  nb2BrandImageGen,
  executeWorkflow,
  imageEdit,
  generateSingleImage,
  generateVideoSingleShot,
  singleStepVideoGenerator,
  fetchTemplatePrompt,
  selectStorytellingTechniques,
  deliverContent,
  createInteractiveView,
  generateVideoFromReelScripts,
  recreateReel,
  downloadReel,
  writeReelScript,
  generatePresentation,
} from "@/mastra/tools";
import { buildScopedConnectorTools } from "./shared/build-scoped-tools";

/** Generation + workflow tools (formerly on a separate Creative Director agent). */
const orchestratorGenerationTools = {
  directImageGen,
  nb2BrandImageGen,
  executeWorkflow,
  imageEdit,
  generateSingleImage,
  generateVideoSingleShot,
  singleStepVideoGenerator,
  fetchTemplatePrompt,
  selectStorytellingTechniques,
  deliverContent,
  createInteractiveView,
  generateVideoFromReelScripts,
  recreateReel,
  downloadReel,
  writeReelScript,
  generatePresentation,
};

/**
 * Full orchestrator tool surface: routing tools + generation + scoped Meta read tools.
 */
export function buildMarketMintOrchestratorTools(
  requestContext: unknown,
): Record<string, any> {
  const connections = (requestContext as { get?: (k: string) => unknown })?.get?.(
    "__connections",
  ) as Connections | undefined;

  const connectorTools = buildScopedConnectorTools("orchestrator", connections);

  return {
    ...orchestratorTools,
    ...orchestratorGenerationTools,
    ...connectorTools,
  };
}
