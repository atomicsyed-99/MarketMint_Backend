import { and, eq, inArray, or } from "drizzle-orm";
import { generateText } from "ai";
import { z } from "zod";
import { db } from "@/db/client";
import { userAttachments } from "@/db/schema/userAttachments";
import { getPromptContent } from "@/lib/langsmith-prompts";
import { getDirectGoogleModel } from "@/lib/ai-gateway";
import { env } from "@/env";

const MAX_ATTACHMENTS = 20;
const MAX_URL_LENGTH = 1024;
const MAX_TAG_LENGTH = 80;
const MAX_DESC_LENGTH = 500;
const MAX_ANALYSIS_DESC_LENGTH = 500;

import { isPrivateHost } from "@/lib/url-safety";

function isTrustedProductAssetHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h.endsWith(".marketmint.ai")) return true;
  const cdn = env.CDN_URL?.trim();
  if (cdn) {
    try {
      const cdnHost = new URL(cdn).hostname.toLowerCase();
      if (h === cdnHost || h.endsWith(`.${cdnHost}`)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function sanitizeAttachmentUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const u = new URL(trimmed);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    // User uploads land on Marketmint CDN — always allow (corp/dev hosts must not be treated as SSRF).
    if (isTrustedProductAssetHost(u.hostname)) return trimmed;
    if (isPrivateHost(u.hostname)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

function deriveKeyFromUrl(url: string): string {
  const cdnUrl = env.CDN_URL;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+/, "");
    if (cdnUrl && url.startsWith(cdnUrl)) {
      const base = cdnUrl.replace(/\/$/, "") + "/";
      return url.startsWith(base) ? url.slice(base.length) : path;
    }
    return path;
  } catch {
    return url;
  }
}

async function analyzeAttachmentFromUrl(
  imageUrl: string,
): Promise<{ tag: string; description: string } | null> {
  try {
    const promptFromHub = await getPromptContent("asset-analyzer").catch(
      () => "",
    );
    const systemPrompt =
      promptFromHub ||
      "Analyze ecommerce-related images and return a concise tag and description in JSON.";
    const instructionText =
      "Analyze this image:\n\n🚨 CRITICAL INSTRUCTIONS:\n" +
      "1. Look at the actual image content, not the filename\n" +
      "2. If you see a shoe, tag it as 'product_image' with description 'Shoe product'\n" +
      "3. If you see a helmet, tag it as 'product_image' with description 'Helmet product'\n" +
      "4. If you see a person, tag it as 'model_image' with description 'Person wearing garment'\n" +
      "5. If you see clothing without a person, tag it as 'garment_front' with description containing which garment it is and the color of the garment for eg: 'Blue shirt on display'\n" +
      "6. The filename is completely irrelevant - only analyze what you see in the image";

    let model;
    try {
      model = getDirectGoogleModel("gemini-2.5-flash");
    } catch {
      return null;
    }

    const { text } = await generateText({
      model,
      messages: [
        { role: "user", content: [{ type: "text", text: systemPrompt }] },
        {
          role: "user",
          content: [
            { type: "text", text: instructionText },
            { type: "image", image: new URL(imageUrl) },
          ],
        },
      ],
    });

    const parsedRaw = JSON.parse(text) as { tag?: string; description?: string };
    const parsed = z
      .object({
        tag: z.string().optional(),
        description: z.string().optional(),
      })
      .parse(parsedRaw);
    const tag = (parsed.tag ?? "other").toString().slice(0, MAX_TAG_LENGTH);
    const description = (parsed.description ?? "")
      .toString()
      .slice(0, MAX_ANALYSIS_DESC_LENGTH);
    return { tag, description };
  } catch {
    return null;
  }
}

/**
 * Sanitize and deduplicate raw attachments from the request.
 */
export function sanitizeAttachments(
  rawAttachments: any[],
  rawMessageAttachments: any[],
): Record<string, unknown>[] {
  const merged = [...rawAttachments, ...rawMessageAttachments];
  const seen = new Set<string>();
  return merged
    .slice(0, MAX_ATTACHMENTS * 2)
    .map((a) => {
      const safeUrl = sanitizeAttachmentUrl(a?.url);
      if (!safeUrl) return null;
      if (seen.has(safeUrl)) return null;
      seen.add(safeUrl);
      return {
        ...a,
        url: safeUrl,
        tag: typeof a?.tag === "string" ? a.tag.slice(0, MAX_TAG_LENGTH) : undefined,
        description:
          typeof a?.description === "string"
            ? a.description.slice(0, MAX_DESC_LENGTH)
            : undefined,
      };
    })
    .filter((a): a is Record<string, unknown> => !!a)
    .slice(0, MAX_ATTACHMENTS);
}

/**
 * Enrich attachments with tag/description from DB and analyze missing entries via Gemini.
 */
export async function enrichAttachments(
  attachments: Record<string, unknown>[],
  userId: string,
): Promise<Record<string, unknown>[]> {
  if (attachments.length === 0) return attachments;

  const urls = attachments
    .map((a) => (a && typeof a.url === "string" ? a.url : undefined))
    .filter((u): u is string => !!u && u.length > 0);

  if (urls.length === 0) return attachments;

  try {
    const keys = urls.map((u) => deriveKeyFromUrl(u));
    const rows = await db
      .select({
        url: userAttachments.url,
        key: userAttachments.key,
        tag: userAttachments.tag,
        description: userAttachments.description,
        id: userAttachments.id,
      })
      .from(userAttachments)
      .where(
        and(
          eq(userAttachments.userId, userId),
          or(
            inArray(userAttachments.url, urls),
            inArray(userAttachments.key, keys),
          ),
        ),
      );

    let enriched = attachments;

    if (rows.length > 0) {
      const byUrl = new Map(rows.map((r) => [r.url, r]));
      const byKey = new Map(rows.map((r) => [r.key, r]));
      enriched = attachments.map((a) => {
        const url = a && typeof a.url === "string" ? a.url : undefined;
        const row =
          (url ? byUrl.get(url) : undefined) ??
          (url ? byKey.get(deriveKeyFromUrl(url)) : undefined);
        return row ? { ...a, tag: row.tag, description: row.description } : a;
      });

      const existingUrls = new Set(rows.map((r) => r.url));
      const existingKeys = new Set(rows.map((r) => r.key));
      const missing = urls.filter((u) => {
        const key = deriveKeyFromUrl(u);
        return !existingUrls.has(u) && !existingKeys.has(key);
      });
      if (missing.length > 0) {
        const values = missing.map((u) => ({
          id: crypto.randomUUID() as string,
          userId: userId as string,
          url: u,
          key: deriveKeyFromUrl(u),
          tag: "other",
          description: "",
        }));
        await db.insert(userAttachments).values(values);
      }

      const candidateRows = await db
        .select({
          id: userAttachments.id,
          url: userAttachments.url,
          key: userAttachments.key,
          tag: userAttachments.tag,
          description: userAttachments.description,
        })
        .from(userAttachments)
        .where(
          and(eq(userAttachments.userId, userId), inArray(userAttachments.key, keys)),
        );

      const needsAnalysis = candidateRows.filter(
        (r) =>
          !r.description ||
          r.description.trim().length === 0 ||
          r.tag === "other" ||
          r.tag === "unanalyzed",
      );
      if (needsAnalysis.length > 0) {
        const analysisResults = await Promise.allSettled(
          needsAnalysis.map((r) => analyzeAttachmentFromUrl(r.url)),
        );

        const updates: Array<{ id: string; tag: string; description: string }> = [];
        for (let i = 0; i < needsAnalysis.length; i++) {
          const row = needsAnalysis[i];
          const rs = analysisResults[i];
          if (rs.status !== "fulfilled" || !rs.value) continue;
          updates.push({
            id: row.id as any,
            tag: rs.value.tag || "other",
            description: rs.value.description || row.description || "",
          });
        }

        for (const u of updates) {
          await db
            .update(userAttachments)
            .set({
              tag: u.tag,
              description: u.description,
              updatedAt: new Date(),
            })
            .where(eq(userAttachments.id, u.id as any));
        }

        if (updates.length > 0) {
          const latestRows = await db
            .select({
              url: userAttachments.url,
              key: userAttachments.key,
              tag: userAttachments.tag,
              description: userAttachments.description,
            })
            .from(userAttachments)
            .where(
              and(eq(userAttachments.userId, userId), inArray(userAttachments.key, keys)),
            );

          const byLatestUrl = new Map(latestRows.map((r) => [r.url, r]));
          const byLatestKey = new Map(latestRows.map((r) => [r.key, r]));
          enriched = enriched.map((a) => {
            const url = a && typeof a.url === "string" ? a.url : undefined;
            const row =
              (url ? byLatestUrl.get(url) : undefined) ??
              (url ? byLatestKey.get(deriveKeyFromUrl(url)) : undefined);
            return row ? { ...a, tag: row.tag, description: row.description } : a;
          });
        }
      }
    }

    return enriched;
  } catch {
    return attachments;
  }
}

/**
 * Build attachment catalog and user text for the system prompt.
 */
export function buildAttachmentContext(
  content: Array<{ type: string; text: string }>,
  enrichedAttachments: Record<string, unknown>[],
) {
  const textParts = content
    .filter((p) => p.type === "text")
    .map((p) => p.text);

  const attachmentLines = enrichedAttachments.length
    ? enrichedAttachments
        .filter((a) => a && typeof a.url === "string" && (a.url as string).length > 0)
        .map((a) => `URL: ${a.url}`)
    : [];

  const attachmentMetaLines = enrichedAttachments.length
    ? enrichedAttachments
        .filter((a) => a && typeof a.url === "string" && (a.url as string).length > 0)
        .map((a) => {
          const tag = (a as any).tag ?? "";
          const desc = (a as any).description ?? "";
          return `[Attachment: url=${a.url}, tag=${tag}, description=${desc}]`;
        })
    : [];

  const userText = [...textParts, ...attachmentLines, ...attachmentMetaLines].join("\n");

  const attachmentCatalog =
    enrichedAttachments.length > 0
      ? enrichedAttachments
          .filter((a) => a && typeof a.url === "string" && (a.url as string).length > 0)
          .map((a, idx) => {
            const t = (a as any).type || "unknown";
            const tag = (a as any).tag ?? "";
            const desc = (a as any).description ?? "";
            return `- Attachment ${idx + 1}: type=${t}, tag=${tag}, description=${desc}, url=${a.url}`;
          })
          .join("\n")
      : "";

  return { userText, attachmentCatalog };
}
