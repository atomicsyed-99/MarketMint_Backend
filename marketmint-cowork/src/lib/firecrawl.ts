/**
 * Firecrawl helpers for scrape and search. Uses @mendable/firecrawl-js.
 */
import Firecrawl from "@mendable/firecrawl-js";
import { env } from "@/env";

function getClient(): InstanceType<typeof Firecrawl> {
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is required");
  return new Firecrawl({ apiKey });
}

export type ScrapeFormats = "markdown" | "html" | "images" | { type: "json"; schema: object; prompt: string };

export async function scrapeUrl(
  url: string,
  formats: ScrapeFormats[] = ["markdown", "images", "html"],
  options?: { timeout?: number }
): Promise<{ markdown?: string; html?: string; images?: string[]; data?: Record<string, unknown>; json?: Record<string, unknown> }> {
  const client = getClient();
  const result = await (
    (client as { scrape?: (u: string, o?: object) => Promise<unknown> }).scrape?.(url, {
      formats: formats as string[],
      timeout: options?.timeout ?? 60000,
    }) ??
    (client as { scrapeUrl?: (u: string, o?: object) => Promise<unknown> }).scrapeUrl?.(url, {
      formats: formats as string[],
      timeout: options?.timeout ?? 60000,
    })
  );
  if (!result) throw new Error("Firecrawl scrape returned empty");
  const out: Record<string, unknown> = {};
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.data && typeof r.data === "object") Object.assign(out, r.data as Record<string, unknown>);
    if (r.markdown) out.markdown = r.markdown;
    if (r.html) out.html = r.html;
    if (r.images) out.images = r.images;
    if (r.json) out.json = r.json;
  }
  return out as { markdown?: string; html?: string; images?: string[]; data?: Record<string, unknown>; json?: Record<string, unknown> };
}

export async function searchQuery(
  query: string,
  options: { limit?: number; sources?: string[] } = {}
): Promise<{ data?: { images?: Array<{ imageUrl?: string; image_url?: string; url?: string }> }; images?: unknown[] }> {
  const client = getClient();
  const result = await (client as { search?: (q: string, o?: object) => Promise<unknown> }).search
    ? (client as { search: (q: string, o?: object) => Promise<unknown> }).search(query, {
        limit: options.limit ?? 10,
        sources: options.sources ?? ["images"],
      })
    : (client as Record<string, unknown>).search?.(query, { limit: options.limit ?? 10, sources: options.sources ?? ["images"] });
  if (!result) return {};
  const data = result && typeof result === "object" && "data" in result
    ? (result as { data: unknown }).data
    : result;
  return (data as Record<string, unknown>) ?? {};
}
