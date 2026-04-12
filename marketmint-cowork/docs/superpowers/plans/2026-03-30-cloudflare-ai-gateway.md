# Cloudflare AI Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all Gemini image generation calls through Cloudflare AI Gateway using the `ai-gateway-provider` + Vercel AI SDK pattern from trigger-workflows.

**Architecture:** Create a gateway client module that wraps Google AI + Vertex providers through Cloudflare. Refactor `gemini-image-gen.ts` to use `generateText()` from the `ai` SDK instead of `@google/genai`'s `generateContent()`. Refactor `direct-image-workflow.ts` Creative Director calls to use Vercel AI SDK directly (no gateway). Preserve all existing function signatures.

**Tech Stack:** `ai-gateway-provider`, `@ai-sdk/google`, `@ai-sdk/google-vertex`, `ai` (Vercel AI SDK)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/env.ts` | Add Cloudflare + model env vars |
| Modify | `package.json` | Add ai-gateway-provider, @ai-sdk/google, @ai-sdk/google-vertex |
| Create | `src/lib/ai-gateway.ts` | Gateway client setup, model factory |
| Modify | `src/lib/gemini-image-gen.ts` | Refactor to Vercel AI SDK + gateway |
| Modify | `src/lib/direct-image-workflow.ts` | Refactor Creative Director to Vercel AI SDK (no gateway) |

---

### Task 1: Install dependencies and add env vars

**Files:**
- Modify: `package.json`
- Modify: `src/env.ts`

- [ ] **Step 1: Install dependencies**

Run: `npm install ai-gateway-provider @ai-sdk/google @ai-sdk/google-vertex`

- [ ] **Step 2: Add env vars to src/env.ts**

In `src/env.ts`, after the existing `// Database pool` section (after `DB_POOL_MAX`), add:

```typescript
  // Cloudflare AI Gateway
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  GATEWAY_NAME: z.string().optional(),
  CF_AIG_TOKEN: z.string().optional(),

  // Image generation model
  GEMINI_IMAGE_MODEL: z.string().optional(),
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: No new type errors

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json bun.lockb bun.lock src/env.ts
git commit -m "feat: add ai-gateway-provider deps and Cloudflare env vars"
```

---

### Task 2: Create AI Gateway client module

**Files:**
- Create: `src/lib/ai-gateway.ts`

- [ ] **Step 1: Create the gateway client module**

Create `src/lib/ai-gateway.ts`:

```typescript
/**
 * Cloudflare AI Gateway client for image generation.
 * Routes Gemini image gen calls through Cloudflare for observability and fallback.
 * Falls back to direct Google AI provider when Cloudflare env vars are not set.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { env } from "@/env";

const LOCATION = "global";
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

function hasGatewayConfig(): boolean {
  return !!(env.CLOUDFLARE_ACCOUNT_ID && env.GATEWAY_NAME && env.CF_AIG_TOKEN);
}

function createGatewayModel(modelId: string) {
  // Dynamic import to avoid requiring ai-gateway-provider when not using gateway
  const {
    createGoogleGenerativeAI: createGoogleFromGateway,
  } = require("ai-gateway-provider/providers/google") as typeof import("ai-gateway-provider/providers/google");
  const {
    createVertex: createVertexFromGateway,
  } = require("ai-gateway-provider/providers/google-vertex") as typeof import("ai-gateway-provider/providers/google-vertex");
  const {
    createAiGateway,
  } = require("ai-gateway-provider") as typeof import("ai-gateway-provider");

  const gateway = createAiGateway({
    accountId: env.CLOUDFLARE_ACCOUNT_ID!,
    gateway: env.GATEWAY_NAME!,
    apiKey: env.CF_AIG_TOKEN!,
  });

  const googleFromGateway = createGoogleFromGateway();
  const vertexFromGateway = createVertexFromGateway({ location: LOCATION });

  return gateway([
    googleFromGateway(modelId),
    vertexFromGateway(modelId),
  ]);
}

function createDirectModel(modelId: string) {
  const project = env.GOOGLE_CLOUD_PROJECT;
  const apiKey = env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (project && env.GOOGLE_APPLICATION_CREDENTIALS) {
    const vertex = createVertex({ project, location: LOCATION });
    return vertex(modelId);
  }

  if (apiKey) {
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }

  throw new Error(
    "Image generation requires Cloudflare AI Gateway config (CLOUDFLARE_ACCOUNT_ID + GATEWAY_NAME + CF_AIG_TOKEN), " +
    "or Google credentials (GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_API_KEY).",
  );
}

/**
 * Get a Vercel AI SDK model for image generation, routed through Cloudflare AI Gateway
 * when gateway env vars are configured. Falls back to direct Google provider otherwise.
 */
export function getImageGenModel(modelId?: string) {
  const model = modelId ?? env.GEMINI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
  if (hasGatewayConfig()) {
    return createGatewayModel(model);
  }
  return createDirectModel(model);
}

/**
 * Get a direct Google AI provider model (no gateway). Used for text/analysis calls
 * that don't need to go through the gateway.
 */
export function getDirectGoogleModel(modelId: string) {
  const apiKey = env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY;
  const project = env.GOOGLE_CLOUD_PROJECT;

  if (project && env.GOOGLE_APPLICATION_CREDENTIALS) {
    const vertex = createVertex({ project, location: LOCATION });
    return vertex(modelId);
  }

  if (apiKey) {
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelId);
  }

  throw new Error(
    "Google AI requires GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_API_KEY.",
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No new type errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai-gateway.ts
git commit -m "feat: add Cloudflare AI Gateway client module"
```

---

### Task 3: Refactor gemini-image-gen.ts to use Vercel AI SDK + gateway

**Files:**
- Modify: `src/lib/gemini-image-gen.ts`

- [ ] **Step 1: Rewrite gemini-image-gen.ts**

Replace the entire contents of `src/lib/gemini-image-gen.ts` with:

```typescript
/**
 * Image generation using Gemini through Cloudflare AI Gateway (or direct fallback).
 * Uses Vercel AI SDK's generateText() with providerOptions for image config.
 */

import { generateText, type LanguageModel } from "ai";
import { uploadToS3, refreshSignedUrl } from "./s3";
import { getImageGenModel } from "./ai-gateway";

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Generate a single image with Gemini via Cloudflare AI Gateway.
 * Returns S3 key and metadata; caller can use refreshSignedUrl(key) for a URL.
 */
export async function generateOneImage(params: {
  prompt: string;
  assetUrls?: string[];
  referenceUrls?: string[];
  aspectRatio: string;
  tag: string;
  generationId: string;
}): Promise<{
  url: string;
  id: string;
  tag: string;
  s3Key: string;
  metadata?: unknown;
}> {
  const model = getImageGenModel();

  // Build content parts: images first, then prompt text (matching trigger-workflows pattern)
  type TextPart = { type: "text"; text: string };
  type ImagePart = { type: "image"; image: Buffer; mediaType: "image/jpeg" };
  const contentParts: Array<TextPart | ImagePart> = [];

  for (const url of [...(params.assetUrls ?? []), ...(params.referenceUrls ?? [])]) {
    const bytes = await fetchImageBytes(url);
    if (bytes) {
      contentParts.push({ type: "image", image: Buffer.from(bytes), mediaType: "image/jpeg" });
    }
  }

  contentParts.push({ type: "text", text: params.prompt.trim() });

  // Retry loop: mirror Python's robustness with retries on transient failures.
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { files } = await generateText({
        model: model as LanguageModel,
        messages: [
          {
            role: "user",
            content: contentParts,
          },
        ],
        maxOutputTokens: 8192,
        maxRetries: 1,
        providerOptions: {
          google: {
            imageConfig: {
              aspectRatio: params.aspectRatio,
            },
            safetySettings: [
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
            ],
          },
        },
      });

      const generated = files?.find((f) => f.mediaType.startsWith("image/"));
      if (!generated?.uint8Array) {
        throw new Error("No image in Gemini response");
      }

      const imageBuffer = Buffer.from(generated.uint8Array);
      const mime = generated.mediaType || "image/jpeg";
      const ext = mime === "image/png" ? "png" : "jpg";
      const filename = `${params.generationId}.${ext}`;
      const key = await uploadToS3(imageBuffer, filename, mime);
      const url = await refreshSignedUrl(key);
      return {
        url,
        id: params.generationId,
        tag: params.tag,
        s3Key: key,
      };
    } catch (err) {
      lastError = err;
      if (attempt === 3) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Unknown error from Gemini image generation";
        throw new Error(`Image generation failed after 3 attempts: ${message}`);
      }
      // Brief backoff between attempts
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  // Unreachable, satisfies type system
  throw lastError instanceof Error
    ? lastError
    : new Error("Image generation failed after retries");
}

export type GenerateIntelligentImagesParams = {
  prompt: string;
  brandContext?: string;
  assetUrls?: string[];
  referenceImages?: string[];
  numVariations: number;
  aspectRatio: string;
};

export type GeneratedImage = {
  url: string;
  id: string;
  tag: string;
  s3Key: string;
  metadata?: unknown;
};

/**
 * Generate multiple image variations using Gemini via Cloudflare AI Gateway.
 */
export async function generateIntelligentImages(
  params: GenerateIntelligentImagesParams,
): Promise<{ images: GeneratedImage[] }> {
  const numVariations = Math.max(1, Math.min(params.numVariations, 4));
  const promptWithBrand =
    params.brandContext?.trim()
      ? `${params.brandContext}\n\n---\n\n${params.prompt}`
      : params.prompt;

  const tasks = Array.from({ length: numVariations }, (_, i) => {
    const generationId = crypto.randomUUID();
    const tag = `generated_image_${i}`;
    return generateOneImage({
      prompt: promptWithBrand,
      assetUrls: params.assetUrls,
      referenceUrls: params.referenceImages,
      aspectRatio: params.aspectRatio,
      tag,
      generationId,
    });
  });

  const images = await Promise.all(tasks);
  return { images };
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No new type errors in gemini-image-gen.ts

- [ ] **Step 3: Commit**

```bash
git add src/lib/gemini-image-gen.ts
git commit -m "feat: route image generation through Cloudflare AI Gateway"
```

---

### Task 4: Refactor direct-image-workflow.ts Creative Director to Vercel AI SDK

**Files:**
- Modify: `src/lib/direct-image-workflow.ts`

This file has two concerns:
1. **Creative Director analysis** (text/JSON call) — refactor to Vercel AI SDK, no gateway
2. **Image generation** — already calls `generateOneImage()` which now uses the gateway

- [ ] **Step 1: Update imports and remove @google/genai usage**

In `src/lib/direct-image-workflow.ts`:

Replace the imports block (lines 1-14):

```typescript
/**
 * Enhanced image generation workflow — full parity with Python app.workflows.direct_image_gen.
 * 1. Creative Director: Gemini analyzes request and produces variation prompts (MarketMintPromptResponse).
 * 2. Concurrent generation: one Gemini image per variation with variation.image_prompt.
 * Uses same models as Python: Gemini 2.5 Flash for analysis, Gemini image model for generation.
 */

import { generateText, type LanguageModel } from "ai";
import { generateOneImage } from "./gemini-image-gen";
import { getDirectGoogleModel } from "./ai-gateway";
```

Remove `getGeminiChatClient()` function (lines 55-68).

Remove `bytesToBase64()` function (lines 81-83). Instead, inline `Buffer.from(bytes).toString("base64")` where needed.

Keep `fetchImageBytes()` (lines 70-79) — still needed.

Keep `parseMarketMintPromptResponse()`, `FALLBACK_RESPONSE`, and all types — unchanged.

- [ ] **Step 2: Rewrite the runAnalysis function inside analyzeAndCreateVariations**

Find the `runAnalysis` inner function (lines 162-188) and replace it with:

```typescript
  const runAnalysis = async (assets: string[], refs: string[]) => {
    const model = getDirectGoogleModel("gemini-2.5-flash");

    type TextPart = { type: "text"; text: string };
    type ImagePart = { type: "image"; image: Buffer; mediaType: "image/jpeg" };
    const contentParts: Array<TextPart | ImagePart> = [];

    contentParts.push({
      type: "text",
      text: systemPrompt +
        "\n\nUser request:\n" +
        userPrompt +
        (assets.length || refs.length
          ? "\n\nThe following images are the asset and reference images (in order)."
          : ""),
    });

    for (const url of [...assets, ...refs]) {
      const bytes = await fetchImageBytes(url);
      if (bytes) {
        contentParts.push({ type: "image", image: Buffer.from(bytes), mediaType: "image/jpeg" });
      }
    }

    const { text } = await generateText({
      model: model as LanguageModel,
      messages: [{ role: "user", content: contentParts }],
      maxOutputTokens: 8192,
    });

    return parseMarketMintPromptResponse(text);
  };
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: No new type errors in direct-image-workflow.ts

- [ ] **Step 4: Commit**

```bash
git add src/lib/direct-image-workflow.ts
git commit -m "refactor: switch Creative Director to Vercel AI SDK (no gateway)"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No new type errors in modified files

- [ ] **Step 3: Verify imports are clean**

Run: `grep -r "from \"@google/genai\"" src/lib/gemini-image-gen.ts src/lib/direct-image-workflow.ts`
Expected: No matches — both files should no longer import from @google/genai

- [ ] **Step 4: Verify gateway module is importable**

Run: `node -e "require('./src/lib/ai-gateway.ts')"` — this may not work directly, but at minimum verify no circular deps:

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
