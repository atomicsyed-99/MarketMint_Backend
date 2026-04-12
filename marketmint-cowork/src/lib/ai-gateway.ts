/**
 * Cloudflare AI Gateway — centralized AI model providers.
 * All Gemini calls route through Cloudflare; provider credentials are
 * stored on the gateway (BYOK), so no direct Google API key is needed.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/env";

import { createAiGateway } from "ai-gateway-provider";
import { createGoogleGenerativeAI as createGoogleFromGateway } from "ai-gateway-provider/providers/google";

const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
// Placeholder — the real Google credential is stored in Cloudflare AI Gateway (BYOK).
const CF_BYOK_PLACEHOLDER = "cf-aig-byok";

function createGatewayModel(modelId: string) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.GATEWAY_NAME || !env.CF_AIG_TOKEN) {
    throw new Error(
      "Cloudflare AI Gateway is not configured. Set CLOUDFLARE_ACCOUNT_ID, GATEWAY_NAME, and CF_AIG_TOKEN.",
    );
  }

  const gateway = createAiGateway({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    gateway: env.GATEWAY_NAME,
    apiKey: env.CF_AIG_TOKEN,
  });

  const googleFromGateway = createGoogleFromGateway({ apiKey: CF_BYOK_PLACEHOLDER });
  return gateway([googleFromGateway(modelId)]);
}

/**
 * Get a Vercel AI SDK model for image generation, routed through Cloudflare AI Gateway.
 */
export function getImageGenModel(modelId?: string) {
  const model = modelId ?? env.GEMINI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
  return createGatewayModel(model);
}

/**
 * Get an OpenAI model via the Vercel AI SDK.
 */
export function getOpenAIModel(modelId: string) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI requires OPENAI_API_KEY.");
  }
  const openai = createOpenAI({ apiKey });
  return openai(modelId);
}

/**
 * Get a Google AI provider model for text/analysis calls, routed through Cloudflare AI Gateway.
 */
export function getDirectGoogleModel(modelId: string) {
  return createGatewayModel(modelId);
}
