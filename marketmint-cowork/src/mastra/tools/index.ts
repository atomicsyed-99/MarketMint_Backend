// ---------------------------------------------------------------------------
// Tool imports
// ---------------------------------------------------------------------------

import { directImageGen } from "./generation/direct-image-gen";
import { nb2BrandImageGen } from "./generation/nb2-brand-image-gen";
import { imageEdit } from "./generation/image-edit";
import { generateSingleImage } from "./generation/generate-single-image";
import { generateVideoSingleShot } from "./generation/generate-video-single-shot";
import { singleStepVideoGenerator } from "./generation/single-step-video-generator";
import { displayPlan } from "./discovery/display-plan";
import { fetchTemplatePrompt } from "./discovery/fetch-template-prompt";
import { selectStorytellingTechniques } from "./discovery/select-storytelling-techniques";
import { tavilySearch } from "./search/tavily-search";
import { extractImagesFromUrl } from "./search/extract-images-from-url";
import { searchImages } from "./search/search-images";
import { analyzeBrand } from "./search/analyze-brand";
import { deliverContent } from "./artifacts/deliver-content";
import { readGuidelines } from "./artifacts/read-guidelines";
import { createInteractiveView } from "./artifacts/create-interactive-view";
import { generatePresentation } from "./artifacts/generate-presentation";
import { generatePdf } from "./artifacts/generate-pdf";
import { executeWorkflow } from "./workflow/execute-workflow";
import { finisherTool } from "./workflow/finisher";
import { generateVideoFromReelScripts } from "./workflow/generate-from-reel-scripts";
import { recreateReel } from "./workflow/recreate-reel";
import { searchShopifyCatalog } from "./shopify/search-catalog";
import { checkLinkedShopifyAccount } from "./shopify/check-linked-account";
import { showConnectBanner } from "./connectors/show-connect-banner";
import { listConnectedIntegrations } from "./connectors/list-connections";
import { refreshConnections } from "./connectors/refresh-connections";
import { downloadReel } from "./video/download-reel";
import { writeReelScript } from "./video/write-reel-script";

// ---------------------------------------------------------------------------
// Orchestrator tools — routing-only tools for the supervisor agent.
// No content generation tools (directImageGen, executeWorkflow moved to
// Creative Director sub-agent).
// ---------------------------------------------------------------------------

export const orchestratorTools = {
  displayPlan,
  tavilySearch,
  extractImagesFromUrl,
  searchImages,
  analyzeBrand,
  deliverContent,
  finisherTool,
  showConnectBanner,
  listConnectedIntegrations,
  refreshConnections,
} as const;

// ---------------------------------------------------------------------------
// Dynamic tools — loaded on-demand via ToolSearchProcessor (search_tools / load_tool)
// These are specialized tools that are only needed for specific workflows.
// ---------------------------------------------------------------------------

export const dynamicTools: Record<string, any> = {
  imageEdit,
  generateSingleImage,
  generateVideoSingleShot,
  singleStepVideoGenerator,
  fetchTemplatePrompt,
  selectStorytellingTechniques,
  searchShopifyCatalog,
  checkLinkedShopifyAccount,
  readGuidelines,
  createInteractiveView,
  generateVideoFromReelScripts,
  recreateReel,
  downloadReel,
  writeReelScript,
  generatePresentation,
  generatePdf,
};

// Re-export individual tools for direct imports elsewhere
export {
  directImageGen,
  nb2BrandImageGen,
  imageEdit,
  generateSingleImage,
  generateVideoSingleShot,
  singleStepVideoGenerator,
  fetchTemplatePrompt,
  displayPlan,
  selectStorytellingTechniques,
  tavilySearch,
  extractImagesFromUrl,
  searchImages,
  analyzeBrand,
  searchShopifyCatalog,
  checkLinkedShopifyAccount,
  showConnectBanner,
  listConnectedIntegrations,
  refreshConnections,
  readGuidelines,
  createInteractiveView,
  deliverContent,
  executeWorkflow,
  finisherTool,
  generateVideoFromReelScripts,
  recreateReel,
  downloadReel,
  writeReelScript,
  generatePresentation,
  generatePdf,
};
