/**
 * Structured brand-memory analysis for the NB2 (Gemini image) path:
 * pick logo + character + scene asset URLs from the saved JSON and rephrase the user query.
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { getOpenAIModel } from "@/lib/ai-gateway";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("brand-memory-nb2-analysis");

const NB2_BRAND_SYSTEM = `You are given a user image-generation query and structured brand memory JSON (logos, characters, scenes, palette, fonts, voice, etc.).

The server will **override** logo/character/scene URL lists using structured fields in the JSON (\`logos\`, \`characters\`, \`scenes\`, \`site_images\`). Your job is mainly the **text** fields:

1–3. **logo_asset_urls**, **character_asset_urls**, **scene_asset_urls**: You may leave these as best-effort hints; the pipeline replaces them with deterministic picks from the JSON.
4. **rephrased_user_query**: One detailed image-generation prompt that:
   - Preserves the user's subject and intent.
   - States that **each output variation** will use **one** brand logo reference, **one** character reference, and **one** scene reference (rotating through the brand library when multiple exist).
   - Weaves brand colors (hex), typography, and voice from the JSON.
5. **acknowledgement**: One short line that brand logo + character + scene refs will be applied per variation (counts optional).

If the user explicitly asked **not** to use brand visuals, say so in acknowledgement and keep rephrased_user_query aligned.`;

export type BrandMemoryNb2Analysis = {
  /** Exactly one primary logo URL when enforcement applies (pools below carry rotation lists). */
  logo_asset_urls: string[];
  /** Full ordered pool of character image URLs (one per variation index, rotated). */
  character_asset_urls: string[];
  /** Full ordered pool of scene image URLs (one per variation index, rotated). */
  scene_asset_urls: string[];
  rephrased_user_query: string;
  acknowledgement: string;
};

/** User explicitly opted out of brand visual references (logo/character/scene from memory). */
export function userRequestsNoBrandVisualRefs(userQuery: string): boolean {
  const q = userQuery.trim().toLowerCase();
  if (!q) return false;
  const patterns = [
    /\bno\s+brand\s+memory\b/,
    /\bdon'?t\s+use\s+brand\s+memory\b/,
    /\bwithout\s+brand\s+memory\b/,
    /\bskip\s+brand\s+memory\b/,
    /\bno\s+logos?\b/,
    /\bno\s+characters?\b/,
    /\bno\s+scenes?\b/,
    /\bdon'?t\s+use\s+(the\s+)?(logo|character|scene)/,
    /\bwithout\s+(the\s+)?(logo|character|scene)/,
    /\bno\s+brand\s+(assets?|refs?|references?)\b/,
    /\bexclude\s+(logo|character|scene)/,
  ];
  return patterns.some((re) => re.test(q));
}

function isHttp(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

/** Skip non-image assets (fonts CSS, bare marketing site, etc.). */
export function isEligibleBrandImageUrl(u: string): boolean {
  const t = u.trim();
  if (!isHttp(t)) return false;
  if (/fonts\.googleapis|fonts\.gstatic|\.css(\?|$)/i.test(t)) return false;
  if (/\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(t)) return true;
  if (/brand-memory|\/assets\/|\/uploads?\//i.test(t)) return true;
  return false;
}

function dedupeHttps(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = u.trim();
    if (!isHttp(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Recursively collect eligible image-like https URLs from brand JSON. */
export function collectEligibleImageUrlsFromBrandJson(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 40) return;
    if (v == null) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (isEligibleBrandUrlCandidate(t)) found.add(t);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
    }
  };
  walk(value, 0);
  return [...found];
}

function isEligibleBrandUrlCandidate(t: string): boolean {
  if (!isHttp(t)) return false;
  return isEligibleBrandImageUrl(t);
}

const LOGO_KEY =
  /^(logo|logos|favicon|brand_logo|brand_mark|wordmark|icon|icons|app_icon)$/i;
const CHAR_KEY =
  /^(character|characters|mascot|people|person|models?|avatars?|cast|talent)$/i;
const SCENE_KEY =
  /^(scene|scenes|environment|environments|background|backgrounds|setting|settings|location|locations|place|places)$/i;

/** Prefer URLs stored under keys that suggest logo / character / scene. */
export function extractUrlsByKeyHints(structured: unknown): {
  logos: string[];
  chars: string[];
  scenes: string[];
} {
  const logos = new Set<string>();
  const chars = new Set<string>();
  const scenes = new Set<string>();

  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 40) return;
    if (v == null) return;

    if (typeof v === "string") {
      const t = v.trim();
      if (!isEligibleBrandImageUrl(t)) return;
      if (LOGO_KEY.test(key)) logos.add(t);
      else if (CHAR_KEY.test(key)) chars.add(t);
      else if (SCENE_KEY.test(key)) scenes.add(t);
      return;
    }

    if (Array.isArray(v)) {
      for (const item of v) walk(item, key, depth + 1);
      return;
    }

    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        walk(val, k, depth + 1);
      }
    }
  };

  walk(structured, "", 0);

  return {
    logos: [...logos],
    chars: [...chars],
    scenes: [...scenes],
  };
}

/** URL path/name heuristics when JSON is flat CDN ids. */
function scoreLogoUrl(u: string): number {
  const s = u.toLowerCase();
  let n = 0;
  if (/favi|favicon|logo|wordmark|mark|icon(?!\w)/i.test(s)) n += 5;
  if (/pazfavi|webclip/i.test(s)) n += 4;
  return n;
}

function scoreCharacterUrl(u: string): number {
  const s = u.toLowerCase();
  let n = 0;
  if (/character|mascot|people|model|avatar|portrait|person/i.test(s)) n += 4;
  return n;
}

function scoreSceneUrl(u: string): number {
  const s = u.toLowerCase();
  let n = 0;
  if (/scene|environment|background|setting|location|lifestyle|office|indoor|outdoor/i.test(s))
    n += 4;
  return n;
}

function bestScoringUrl(
  pool: string[],
  score: (u: string) => number,
): string | undefined {
  if (pool.length === 0) return undefined;
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

/** Merge root + nested \`data\` (API row shape). */
function brandMemoryDataRoot(structured: unknown): Record<string, unknown> {
  if (structured == null) return {};
  // HTTP/DB payloads are often `[{ id, url, data: { logos, characters, ... } }]`.
  // Without unwrapping, spreading an array yields numeric keys and misses `data.*`.
  if (Array.isArray(structured)) {
    if (structured.length === 0) return {};
    return brandMemoryDataRoot(structured[0]);
  }
  if (typeof structured !== "object") return {};
  const r = structured as Record<string, unknown>;
  const inner =
    r.data && typeof r.data === "object"
      ? (r.data as Record<string, unknown>)
      : {};
  return { ...r, ...inner };
}

function urlsFromObjectArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const u = (item as { url?: unknown }).url;
    if (typeof u === "string" && isEligibleBrandImageUrl(u)) out.push(u.trim());
  }
  return dedupeHttps(out);
}

/**
 * Deterministic pools from structured brand memory (\`logos\`, \`characters\`, \`scenes\`, \`site_images\`).
 */
export function extractStructuredBrandAssetPools(structured: unknown): {
  logoUrls: string[];
  characterUrls: string[];
  sceneUrls: string[];
  siteImages: string[];
} {
  const root = brandMemoryDataRoot(structured);
  const logoUrls = urlsFromObjectArray(root.logos);
  const characterUrls = urlsFromObjectArray(root.characters);
  const sceneUrls = urlsFromObjectArray(root.scenes);
  const siteImages: string[] = [];
  const raw = root.site_images;
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === "string" && isEligibleBrandImageUrl(x)) siteImages.push(x.trim());
    }
  }
  return {
    logoUrls: dedupeHttps(logoUrls),
    characterUrls: dedupeHttps(characterUrls),
    sceneUrls: dedupeHttps(sceneUrls),
    siteImages: dedupeHttps(siteImages),
  };
}

/** Prefer primary wordmark / webclip over tiny favicon when multiple logos exist. */
export function pickSingleLogoUrl(logoUrls: string[]): string | undefined {
  if (logoUrls.length === 0) return undefined;
  if (logoUrls.length === 1) return logoUrls[0];
  return bestScoringUrl(logoUrls, scoreLogoUrl);
}

function splitSiteImagesIntoPools(
  siteImages: string[],
  logoUrls: string[],
): { chars: string[]; scenes: string[] } {
  const logoSet = new Set(logoUrls);
  const rest = siteImages.filter((u) => !logoSet.has(u));
  if (rest.length === 0) return { chars: [], scenes: [] };
  if (rest.length === 1) return { chars: [rest[0]], scenes: [rest[0]] };
  const mid = Math.max(1, Math.ceil(rest.length / 2));
  return {
    chars: rest.slice(0, mid),
    scenes: rest.slice(mid),
  };
}

/**
 * Final URL lists: **one** logo, **pools** of characters and scenes for per-variation rotation.
 * Respects \`userRequestsNoBrandVisualRefs\`.
 */
export function finalizeBrandAssetSelections(
  parsed: BrandMemoryNb2Analysis,
  brandMemoryStructured: unknown,
  userQuery: string,
): BrandMemoryNb2Analysis {
  if (userRequestsNoBrandVisualRefs(userQuery)) {
    log.info({}, "finalizeBrandAssetSelections: user opted out of brand visual refs");
    return {
      ...parsed,
      logo_asset_urls: [],
      character_asset_urls: [],
      scene_asset_urls: [],
    };
  }

  const eligible = dedupeHttps(
    collectEligibleImageUrlsFromBrandJson(brandMemoryStructured),
  ).sort();
  const hinted = extractUrlsByKeyHints(brandMemoryStructured);
  const structuredPools = extractStructuredBrandAssetPools(brandMemoryStructured);

  let logoCandidates = dedupeHttps([
    ...parsed.logo_asset_urls,
    ...structuredPools.logoUrls,
    ...hinted.logos,
  ]);
  let singleLogo = pickSingleLogoUrl(logoCandidates);
  if (!singleLogo) {
    singleLogo = bestScoringUrl(eligible, scoreLogoUrl) ?? eligible[0];
  }
  const logoArr = singleLogo ? [singleLogo] : [];
  const logoSet = new Set(logoArr);

  let characters = dedupeHttps([
    ...structuredPools.characterUrls,
    ...parsed.character_asset_urls,
    ...hinted.chars,
  ]);
  let scenes = dedupeHttps([
    ...structuredPools.sceneUrls,
    ...parsed.scene_asset_urls,
    ...hinted.scenes,
  ]);

  if (!characters.length || !scenes.length) {
    const split = splitSiteImagesIntoPools(structuredPools.siteImages, [...logoSet]);
    if (!characters.length && split.chars.length) characters = split.chars;
    if (!scenes.length && split.scenes.length) scenes = split.scenes;
  }

  if (!characters.length) {
    const pool = eligible.filter((u) => !logoSet.has(u));
    const pick =
      bestScoringUrl(pool.length ? pool : eligible, scoreCharacterUrl) ??
      eligible.find((u) => !logoSet.has(u)) ??
      eligible[0];
    if (pick) characters = [pick];
  }
  if (!scenes.length) {
    const avoid = new Set([...logoArr, ...characters]);
    const pool = eligible.filter((u) => !avoid.has(u));
    const pick =
      bestScoringUrl(pool.length ? pool : eligible, scoreSceneUrl) ??
      eligible.find((u) => !avoid.has(u)) ??
      characters[0] ??
      eligible[0];
    if (pick) scenes = [pick];
  }

  const out: BrandMemoryNb2Analysis = {
    ...parsed,
    logo_asset_urls: dedupeHttps(logoArr),
    character_asset_urls: dedupeHttps(characters),
    scene_asset_urls: dedupeHttps(scenes),
  };

  log.info(
    {
      eligibleCount: eligible.length,
      structuredCharacters: structuredPools.characterUrls.length,
      structuredScenes: structuredPools.sceneUrls.length,
      logos: out.logo_asset_urls.length,
      charPool: out.character_asset_urls.length,
      scenePool: out.scene_asset_urls.length,
    },
    "finalizeBrandAssetSelections",
  );

  return out;
}

/** If the model returns a weak acknowledgement despite having structured memory, replace with a clear UX line. */
export function normalizeNb2BrandAcknowledgement(
  acknowledgement: string,
  brandMemoryStructured: unknown,
): string {
  const raw = (acknowledgement ?? "").trim();
  const json =
    typeof brandMemoryStructured === "string"
      ? brandMemoryStructured
      : JSON.stringify(brandMemoryStructured ?? "");
  const hasSubstance =
    json.length > 80 && !/^\s*(\{\s*\}|null)\s*$/i.test(json);
  if (!hasSubstance) return raw;

  const weak =
    !raw ||
    /no specific (characters|scenes)/i.test(raw) ||
    /nothing (was )?applied/i.test(raw) ||
    /did not use/i.test(raw);

  if (weak) {
    return "Applied workspace brand memory: logo, character, and scene reference assets plus palette and voice (per policy).";
  }
  return raw;
}

export async function analyseBrandMemoryForNb2(
  brandMemoryStructured: unknown,
  userQuery: string,
): Promise<BrandMemoryNb2Analysis> {
  const empty = (): BrandMemoryNb2Analysis => ({
    logo_asset_urls: [],
    character_asset_urls: [],
    scene_asset_urls: [],
    rephrased_user_query: userQuery,
    acknowledgement: "",
  });

  if (!env.OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set; NB2 brand analysis passthrough");
    return finalizeBrandAssetSelections(empty(), brandMemoryStructured, userQuery);
  }

  const brandMemoryJson =
    typeof brandMemoryStructured === "string"
      ? brandMemoryStructured
      : JSON.stringify(brandMemoryStructured, null, 2);

  const { output } = await generateText({
    model: getOpenAIModel("gpt-4o"),
    temperature: 0.1,
    output: Output.object({
      schema: z.object({
        logo_asset_urls: z.array(z.string()),
        character_asset_urls: z.array(z.string()),
        scene_asset_urls: z.array(z.string()),
        rephrased_user_query: z.string(),
        acknowledgement: z.string(),
      }),
    }),
    system: NB2_BRAND_SYSTEM,
    prompt: `User query:\n${userQuery}\n\nBrand memory JSON:\n${brandMemoryJson}`,
  });

  const filterHttp = (urls: string[]) => urls.filter((u) => isHttp(u.trim()));

  const parsed: BrandMemoryNb2Analysis = {
    logo_asset_urls: filterHttp(output.logo_asset_urls ?? []),
    character_asset_urls: filterHttp(output.character_asset_urls ?? []),
    scene_asset_urls: filterHttp(output.scene_asset_urls ?? []),
    rephrased_user_query: output.rephrased_user_query ?? userQuery,
    acknowledgement: output.acknowledgement ?? "",
  };

  return finalizeBrandAssetSelections(parsed, brandMemoryStructured, userQuery);
}
