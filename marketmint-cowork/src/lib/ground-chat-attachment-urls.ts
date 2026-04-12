/**
 * Replace model-hallucinated asset URLs with real chat attachment URLs from requestContext.
 * Any http(s) string not matching the current request's attachment allowlist is rewritten
 * using a deterministic pool (order preserved from the chat request).
 *
 * Models sometimes emit fake asset locators like `attachment://0` (mimicking catalog indices).
 * Those are not http(s), so they must be handled explicitly — otherwise they pass through
 * unchanged and downstream workflows receive unusable "URLs".
 */

import { dedupeUrls } from "@/lib/direct-image-gen-chat-context";

/** Keys whose string values may legitimately point outside user uploads (do not rewrite). */
const SKIP_GROUND_URL_KEYS = new Set([
  "music_url",
  "audio_url",
  "soundtrack_url",
  "callback_url",
  "webhook_url",
  "redirect_url",
  "license_url",
  "terms_url",
]);

function looksLikeHttpUrl(s: string): boolean {
  const t = s.trim();
  return t.startsWith("http://") || t.startsWith("https://");
}

/** Model-invented locators that are not real network URLs (e.g. catalog index fantasy). */
function isModelAttachmentPlaceholder(s: string): boolean {
  return /^attachment:\/\//i.test(s.trim());
}

/**
 * Map `attachment://N` → Nth chat upload URL; unknown `attachment://...` → first URL.
 * With no uploads, return empty string so callers do not forward fake schemes.
 */
export function resolveAttachmentPlaceholderToUrl(
  s: string,
  orderedAttachmentUrls: string[],
): string {
  const t = s.trim();
  if (!isModelAttachmentPlaceholder(t)) return t;
  if (!orderedAttachmentUrls.length) return "";
  const m = /^attachment:\/\/(\d+)$/i.exec(t);
  if (m) {
    const i = parseInt(m[1], 10);
    if (i >= 0 && i < orderedAttachmentUrls.length) return orderedAttachmentUrls[i];
    return orderedAttachmentUrls[0];
  }
  return orderedAttachmentUrls[0];
}

function normalizeUrlForMatch(s: string): string {
  try {
    const u = new URL(s.trim());
    u.hash = "";
    return u.href;
  } catch {
    return s.trim();
  }
}

function buildAllowSet(orderedUrls: string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of orderedUrls) {
    const t = raw.trim();
    if (!t) continue;
    set.add(t);
    set.add(normalizeUrlForMatch(t));
    try {
      const u = new URL(t);
      u.search = "";
      set.add(u.href);
    } catch {
      /* ignore */
    }
  }
  return set;
}

function urlsLooselyEqual(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x === y) return true;
  try {
    return normalizeUrlForMatch(x) === normalizeUrlForMatch(y);
  } catch {
    return false;
  }
}

function isAllowedAttachmentUrl(s: string, allow: Set<string>): boolean {
  const t = s.trim();
  if (!t) return false;
  if (allow.has(t)) return true;
  if (allow.has(normalizeUrlForMatch(t))) return true;
  try {
    const u = new URL(t);
    u.search = "";
    if (allow.has(u.href)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** All http(s) attachment URLs from chat (images, video, etc.). */
export function extractAllChatAttachmentUrls(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  const out: string[] = [];
  for (const a of attachments) {
    if (!a || typeof a !== "object") continue;
    const url = (a as { url?: unknown }).url;
    if (typeof url === "string" && looksLikeHttpUrl(url)) out.push(url.trim());
  }
  return dedupeUrls(out);
}

export type GroundChatAttachmentUrlsOptions = {
  /** Object keys for which string values are never rewritten (e.g. external music). */
  skipKeys?: Set<string>;
};

function walkDeepStrings<T>(
  value: T,
  skip: Set<string>,
  onString: (s: string, key: string) => string,
): T {
  function walk(val: unknown, key: string): unknown {
    if (skip.has(key)) return val;

    if (Array.isArray(val)) {
      return val.map((item, idx) => walk(item, `${key}[${idx}]`));
    }

    if (val !== null && typeof val === "object") {
      const proto = Object.getPrototypeOf(val);
      if (proto !== Object.prototype && proto !== null) {
        return val;
      }
      const obj = val as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = walk(v, k);
      }
      return out;
    }

    if (typeof val === "string") {
      return onString(val, key);
    }

    return val;
  }

  return walk(value, "") as T;
}

/** Remove `""` entries left after stripping bogus attachment locators from string arrays. */
function filterEmptyStringsFromArraysDeep(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val
      .map(filterEmptyStringsFromArraysDeep)
      .filter((item) => item !== "");
  }
  if (val !== null && typeof val === "object") {
    const proto = Object.getPrototypeOf(val);
    if (proto !== Object.prototype && proto !== null) {
      return val;
    }
    const obj = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = filterEmptyStringsFromArraysDeep(v);
    }
    return out;
  }
  return val;
}

/**
 * When there are no chat attachment URLs, still strip `attachment://...` placeholders
 * so tools never forward model-invented locators unchanged.
 */
function stripAttachmentPlaceholdersDeep<T>(
  value: T,
  options?: GroundChatAttachmentUrlsOptions,
): T {
  const skip = new Set([...SKIP_GROUND_URL_KEYS, ...(options?.skipKeys ?? [])]);
  const stripped = walkDeepStrings(value, skip, (s, _key) =>
    isModelAttachmentPlaceholder(s) ? "" : s,
  );
  return filterEmptyStringsFromArraysDeep(stripped) as T;
}

/**
 * Deep-walk `value` and replace any http(s) string not in the attachment allowlist.
 * Valid allowlisted URLs consume one matching entry from the pool when possible.
 */
export function groundDeepWithChatAttachments<T>(
  value: T,
  orderedAttachmentUrls: string[],
  options?: GroundChatAttachmentUrlsOptions,
): T {
  if (!orderedAttachmentUrls.length) {
    return stripAttachmentPlaceholdersDeep(value, options);
  }

  const allow = buildAllowSet(orderedAttachmentUrls);
  const skip = new Set([...SKIP_GROUND_URL_KEYS, ...(options?.skipKeys ?? [])]);
  let pool = [...orderedAttachmentUrls];

  function tryConsumeValid(url: string): void {
    const i = pool.findIndex((u) => urlsLooselyEqual(u, url));
    if (i >= 0) pool.splice(i, 1);
  }

  function replaceInvalid(): string {
    if (pool.length > 0) return pool.shift()!;
    return orderedAttachmentUrls[0];
  }

  function walk(val: unknown, key: string): unknown {
    if (skip.has(key)) return val;

    if (Array.isArray(val)) {
      return val.map((item, idx) => walk(item, `${key}[${idx}]`));
    }

    if (val !== null && typeof val === "object") {
      const proto = Object.getPrototypeOf(val);
      if (proto !== Object.prototype && proto !== null) {
        return val;
      }
      const obj = val as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = walk(v, k);
      }
      return out;
    }

    if (typeof val === "string") {
      if (isModelAttachmentPlaceholder(val)) {
        const resolved = resolveAttachmentPlaceholderToUrl(val, orderedAttachmentUrls);
        if (looksLikeHttpUrl(resolved)) {
          if (isAllowedAttachmentUrl(resolved, allow)) {
            tryConsumeValid(resolved);
          }
        }
        return resolved;
      }
      if (looksLikeHttpUrl(val)) {
        if (isAllowedAttachmentUrl(val, allow)) {
          tryConsumeValid(val);
          return val;
        }
        if (skip.has(key)) return val;
        return replaceInvalid();
      }
    }

    return val;
  }

  return walk(value, "") as T;
}
