# Cloudflare AI Gateway for Image Generation

## Context

MarketMint Pro Cowork uses Google Gemini for image generation via the `@google/genai` SDK. The trigger-workflows repo already routes Gemini calls through Cloudflare AI Gateway using the `ai-gateway-provider` npm package with the Vercel AI SDK. This design migrates image generation calls to the same pattern for consistency, observability, and provider fallback.

**Scope:** Image generation calls only. Text/analysis Gemini calls stay on `@google/genai` directly.

**No enterprise gateway** — single gateway instance.

---

## Changes

### 1. Gateway Client Module

**New file:** `src/lib/ai-gateway.ts`

Sets up the Cloudflare AI Gateway with Google AI + Vertex AI fallback, matching the trigger-workflows pattern.

**Exports:**
- `getImageGenModel(modelId?: string)` — returns a gateway-wrapped Vercel AI SDK model for `generateText()`
- Falls back to direct Google AI provider (no gateway) if Cloudflare env vars aren't set, preserving local dev compatibility

**New env vars in `src/env.ts`:**
- `CLOUDFLARE_ACCOUNT_ID` (optional string)
- `GATEWAY_NAME` (optional string)
- `CF_AIG_TOKEN` (optional string)
- `GEMINI_IMAGE_MODEL` (optional string, defaults to `gemini-2.5-flash-image`)

**Dependency:** `ai-gateway-provider`, `@ai-sdk/google`

### 2. Refactor gemini-image-gen.ts

Replace `@google/genai` SDK calls with Vercel AI SDK `generateText()` through the gateway.

**Changes to `generateOneImage()`:**
- Remove `getGeminiClient()`, `createPartFromText`/`createPartFromBase64` imports from `@google/genai`
- Call `getImageGenModel()` from the gateway module
- Use `generateText()` from `ai` package with `providerOptions.google.imageConfig` for aspect ratio and `providerOptions.google.responseModalities: ["IMAGE"]`
- Input images as base64 data parts in messages
- Extract generated image from response (base64 inline data), upload to S3 -- same as current
- Keep the 3-attempt retry loop with backoff

**Preserved interfaces:**
- `generateOneImage()` signature and return type -- unchanged
- `generateIntelligentImages()` -- unchanged (calls `generateOneImage` internally)
- `fetchImageBytes()`, `bytesToBase64()` -- kept as-is
- S3 upload + signed URL logic -- kept as-is
- All downstream callers (`image-edit.ts`, `generate-single-image.ts`) work unchanged

**Model:** Default `gemini-2.5-flash-image` (configurable via `GEMINI_IMAGE_MODEL` env var)

### 3. Refactor direct-image-workflow.ts

Replace `@google/genai` imports with Vercel AI SDK for the Creative Director text/JSON analysis call. **No gateway** -- direct Google provider.

**Changes:**
- Remove `GoogleGenAI`, `createPartFromText`, `createPartFromBase64` imports
- Remove `getGeminiChatClient()` function
- Use `createGoogleGenerativeAI` from `@ai-sdk/google` for direct provider
- Replace `client.models.generateContent()` in `analyzeAndCreateVariations()` with `generateText()` from `ai`
- Input images sent as base64 parts in messages
- JSON output parsed from response text

**Preserved interfaces:**
- All type exports (`MarketMintPromptResponse`, `VariationItem`, etc.)
- `createIntelligentImages()` signature and return type
- Fallback response logic
- Concurrent image generation via `generateConcurrentImages()`

---

## Files Modified

| Action | File | What |
|--------|------|------|
| Create | `src/lib/ai-gateway.ts` | Gateway client module |
| Modify | `src/env.ts` | Add 4 env vars |
| Modify | `src/lib/gemini-image-gen.ts` | Vercel AI SDK + gateway |
| Modify | `src/lib/direct-image-workflow.ts` | Vercel AI SDK (no gateway) |
| Modify | `package.json` | Add ai-gateway-provider, @ai-sdk/google |

## Files NOT Changing

- `src/routes/chat/attachment-enrichment.ts` -- text analysis, stays on @google/genai
- `src/mastra/tools/search/analyze-brand.ts` -- text analysis
- `src/mastra/tools/search/analyze-brand-full.ts` -- text analysis
- `src/mastra/tools/search/extract-images-from-url.ts` -- text analysis
- `src/mastra/tools/generation/image-edit.ts` -- calls generateOneImage, gets gateway for free
- `src/mastra/tools/generation/generate-single-image.ts` -- calls generateOneImage, gets gateway for free
- `src/mastra/tools/video/write-reel-script.ts` -- text analysis

## New Env Vars

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CLOUDFLARE_ACCOUNT_ID` | No | (no gateway) | Cloudflare account ID |
| `GATEWAY_NAME` | No | (no gateway) | AI Gateway name |
| `CF_AIG_TOKEN` | No | (no gateway) | AI Gateway auth token |
| `GEMINI_IMAGE_MODEL` | No | `gemini-2.5-flash-image` | Default image generation model |
