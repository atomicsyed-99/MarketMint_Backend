/**
 * Merge chat attachment URLs into directImageGen inputs and resolve brand-memory flags.
 * Sub-agents may omit URLs or should_use_brand_memory; the chat requestContext is authoritative.
 */

import { valueFromRequestContext } from "@/lib/request-context-workspace";

export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const n = u.trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Image URLs from enriched chat attachments (see chat route `attachments`). */
export function extractChatImageAttachmentUrls(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  const out: string[] = [];
  for (const a of attachments) {
    if (!a || typeof a !== "object") continue;
    const url = (a as { url?: unknown }).url;
    if (typeof url !== "string" || !url.startsWith("http")) continue;
    const type = (a as { type?: unknown }).type;
    const isImageMime = typeof type === "string" && type.startsWith("image/");
    const looksLikeImage =
      isImageMime || /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(url);
    if (looksLikeImage) out.push(url);
  }
  return dedupeUrls(out);
}

const TRUSTED_REFERENCE_HOST =
  /\.(marketmint\.ai|amazonaws\.com|cloudfront\.net)/i;

/**
 * When the user attached images, drop model-hallucinated or third-party reference URLs
 * so generation uses real chat uploads (and Marketmint/CDN assets) first.
 */
export function filterModelReferenceUrlsWhenAttachmentsPresent(
  modelRefs: string[],
  attachmentUrls: string[],
): string[] {
  if (attachmentUrls.length === 0) return modelRefs;
  const att = new Set(attachmentUrls.map((u) => u.trim()));
  let firstHost: string | undefined;
  try {
    firstHost = new URL(attachmentUrls[0].trim()).hostname;
  } catch {
    firstHost = undefined;
  }
  return modelRefs.filter((u) => {
    const t = u.trim();
    if (!t) return false;
    if (att.has(t)) return true;
    try {
      const host = new URL(t).hostname;
      if (firstHost && host === firstHost) return true;
    } catch {
      return false;
    }
    if (/wikimedia\.org|wikipedia\.org/i.test(t)) return false;
    if (TRUSTED_REFERENCE_HOST.test(t)) return true;
    return false;
  });
}

/** Read directGenBm from plain object, Map, or Mastra RequestContext (`.get`). */
export function readDirectGenBmFromRequestContext(req: unknown): boolean {
  if (!req || typeof req !== "object") return false;
  return (
    valueFromRequestContext(req, "directGenBm") === true ||
    valueFromRequestContext(req, "direct_gen_bm") === true
  );
}

/**
 * Chat attachments from request context: plain object `.attachments`, or Mastra
 * `RequestContext` (internal Map — use `.get` / `.all`, not `.attachments`).
 */
export function readAttachmentsFromRequestContext(req: unknown): unknown[] {
  if (!req || typeof req !== "object") return [];
  const rc = req as {
    attachments?: unknown;
    get?: (k: string) => unknown;
    all?: Record<string, unknown>;
  };
  if (Array.isArray(rc.attachments)) return rc.attachments;
  if (typeof rc.get === "function") {
    const g = rc.get("attachments");
    if (Array.isArray(g)) return g;
  }
  const fromAll = rc.all?.attachments;
  if (Array.isArray(fromAll)) return fromAll;
  return [];
}

/**
 * Prepend chat image URLs to asset_urls and reference_images; dedupe; optionally strip bad refs.
 */
export function mergeAttachmentUrlsIntoDirectGenInputs(params: {
  assetUrls: string[];
  referenceImages: string[];
  attachmentImageUrls: string[];
}): { assetUrls: string[]; referenceImages: string[] } {
  const { attachmentImageUrls } = params;
  if (attachmentImageUrls.length === 0) {
    return {
      assetUrls: dedupeUrls(params.assetUrls),
      referenceImages: dedupeUrls(params.referenceImages),
    };
  }
  const filteredRefs = filterModelReferenceUrlsWhenAttachmentsPresent(
    params.referenceImages,
    attachmentImageUrls,
  );
  return {
    assetUrls: dedupeUrls([...attachmentImageUrls, ...params.assetUrls]),
    referenceImages: dedupeUrls([...attachmentImageUrls, ...filteredRefs]),
  };
}

/** Matches `displayPlan` output plan ids (`plan-` + 12 hex chars). */
export const DISPLAY_PLAN_TASK_GROUP_RE = /^plan-[0-9a-f]{12}$/i;

export function isDisplayPlanTaskGroupId(id: string | undefined): boolean {
  return !!id && DISPLAY_PLAN_TASK_GROUP_RE.test(id);
}

export const DEFAULT_DIRECT_IMAGE_VARIATIONS = 4;
export const MAX_DIRECT_IMAGE_VARIATIONS = 16;

/**
 * Infer how many images the user asked for from the tool/user prompt (delegation text).
 * Returns undefined if no clear count — caller should use default 4.
 */
export function inferRequestedImageCountFromPrompt(prompt: string): number | undefined {
  if (!prompt || typeof prompt !== "string") return undefined;
  const lower = prompt.toLowerCase();
  const patterns: RegExp[] = [
    /\b(\d{1,2})\s*(?:marketing\s+)?(?:images?|pics?|photos?|visuals?|variants?|variations?)\b/,
    /\b(?:generate|create|make|give)\s+(?:me\s+)?(\d{1,2})\s+(?:marketing\s+)?(?:images?|pics?|photos?|visuals?)\b/,
    /\b(\d{1,2})\s*x\s*(?:images?|variations?)\b/,
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= MAX_DIRECT_IMAGE_VARIATIONS) return n;
    }
  }
  return undefined;
}

/**
 * Resolve variation count: explicit count in the prompt beats model num_variations; default 4.
 */
export function resolveDirectImageNumVariations(
  modelNumVariations: number | undefined,
  userPrompt: string,
): number {
  const inferred = inferRequestedImageCountFromPrompt(userPrompt);
  if (inferred != null) {
    return Math.min(MAX_DIRECT_IMAGE_VARIATIONS, Math.max(1, inferred));
  }
  if (modelNumVariations != null && Number.isFinite(modelNumVariations)) {
    return Math.min(
      MAX_DIRECT_IMAGE_VARIATIONS,
      Math.max(1, Math.round(modelNumVariations)),
    );
  }
  return DEFAULT_DIRECT_IMAGE_VARIATIONS;
}

/** Only allow multi-batch when tied to a real displayPlan id (prevents invented 3× batches). */
export function normalizeDirectImageMultiBatch(params: {
  task_group_id?: string;
  batch_index?: number;
  total_batches?: number;
}): { taskGroupId: string | undefined; batchIndex: number; totalBatches: number } {
  let totalBatches = params.total_batches ?? 1;
  const taskGroupId = params.task_group_id;
  if (totalBatches > 1 && !isDisplayPlanTaskGroupId(taskGroupId)) {
    totalBatches = 1;
  }
  const batchIndex =
    totalBatches > 1 ? Math.max(1, params.batch_index ?? 1) : 1;
  return { taskGroupId, batchIndex, totalBatches };
}
