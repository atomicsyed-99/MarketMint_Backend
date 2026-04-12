import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { scrapeUrl } from "@/lib/firecrawl";
import { generateText } from "ai";
import { getDirectGoogleModel } from "@/lib/ai-gateway";
import { env } from "@/env";

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname || url;
  } catch {
    return url;
  }
}

async function searchForUrl(query: string): Promise<string | null> {
  try {
    const client = tavily({ apiKey: env.TAVILY_API_KEY ?? "" });
    const result = await client.search(query, { maxResults: 3, searchDepth: "basic", includeAnswer: false });
    const results = (result as { results?: Array<{ url?: string }> })?.results ?? [];
    for (const r of results) {
      const u = r?.url;
      if (u && typeof u === "string" && u.startsWith("http")) return u;
    }
    return null;
  } catch {
    return null;
  }
}

const BRAND_ANALYSIS_PROMPT = `Analyze this website content as a brand. Extract and return a JSON object with:
- brand_name (string)
- summary (string, short summary of what the brand is about)
- target_audience (string)
- design_philosophy (string)
- sections (array of { title: string, purpose: string })
- key_image_urls (array of up to 10 important image URLs: product shots, hero images; exclude logos, icons, navigation)
Return only valid JSON, no markdown.`;

async function scrapeBrandWithExtraction(url: string): Promise<Record<string, unknown>> {
  const scraped = await scrapeUrl(url, ["markdown"], { timeout: 60000 });
  const markdown = scraped.markdown ?? "";
  if (!markdown) return {};

  let model;
  try {
    model = getDirectGoogleModel("gemini-2.0-flash");
  } catch {
    return {};
  }

  const { text } = await generateText({
    model,
    prompt: `${BRAND_ANALYSIS_PROMPT}\n\n---\n\n${markdown.slice(0, 50000)}`,
  });
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const analyzeBrand = createTool({
  id: "analyzeBrand",
  description:
    "Analyze a brand from a webpage. Use when the user wants to understand a brand (mission, audience, style, key images). If the user provides a URL pass it as url; if they only describe the brand (e.g. 'Nike', 'analyze Apple') pass that as query and the tool will search then analyze the first result.",
  inputSchema: z.object({
    url: z.string().url().optional(),
    query: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    url: z.string().optional(),
    brand_name: z.string(),
    summary: z.string(),
    target_audience: z.string(),
    design_philosophy: z.string(),
    sections: z.array(z.object({ title: z.string(), purpose: z.string() })),
    key_image_urls: z.array(z.string()),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const id = crypto.randomUUID();
    const writer = context?.writer;
    const start = Date.now();
    let url: string | undefined = input.url;

    const emit = (data: Record<string, unknown>) => {
      writer?.custom({
        type: "data-agent-utility",
        data: { id, name: "analyzeBrand", title: "Brand Analysis", ...data },
      });
    };

    try {
      if (!url && !input.query) {
        return {
          success: false,
          error: "Provide either url or query (e.g. brand name to search).",
          brand_name: "",
          summary: "",
          target_audience: "",
          design_philosophy: "",
          sections: [],
          key_image_urls: [],
        };
      }

      emit({
        status: "loaded",
        category: "brand",
        description: `About to analyze brand${url ? ` from ${url}` : ` for: ${input.query}`}`,
        input: { url: input.url, query: input.query },
      });

      if (!url && input.query) {
        emit({
          status: "running",
          category: "brand",
          description: `Finding page for: ${input.query}`,
          steps: [{ id: "s1", title: "Searching for brand URL", status: "running" }],
        });
        url = await searchForUrl(input.query) ?? undefined;
        if (!url) {
          const duration_ms = Date.now() - start;
          emit({
            status: "failed",
            category: "brand",
            description: `Could not find a URL for: ${input.query}`,
            duration_ms,
            error: `Could not find a URL for: ${input.query}`,
            steps: [{ id: "s1", title: "Searching for brand URL", status: "failed" }],
          });
          return {
            success: false,
            error: `Could not find a URL for: ${input.query}`,
            brand_name: "",
            summary: "",
            target_audience: "",
            design_philosophy: "",
            sections: [],
            key_image_urls: [],
          };
        }
        emit({
          status: "running",
          category: "brand",
          description: `Found URL: ${url}`,
          steps: [{ id: "s1", title: "Searching for brand URL", status: "completed" }],
        });
      }

      const domain = url ? extractDomain(url) : "";
      emit({
        status: "running",
        category: "brand",
        description: `Scraping and analyzing ${url}`,
        web_urls: url ? [{ url }] : [],
        steps: [
          ...(input.query && !input.url ? [{ id: "s1", title: "Searching for brand URL", status: "completed" as const }] : []),
          { id: "s2", title: domain ? `Analyzing ${domain}` : "Analyzing brand", status: "running" as const, web_urls: url ? [{ url }] : [] },
        ],
      });

      const analysis = await scrapeBrandWithExtraction(url!);
      const duration_ms = Date.now() - start;
      const sections = Array.isArray(analysis.sections)
        ? (analysis.sections as Array<{ title?: string; purpose?: string }>).map((s) => ({
            title: String(s?.title ?? ""),
            purpose: String(s?.purpose ?? ""),
          }))
        : [];
      const key_image_urls = Array.isArray(analysis.key_image_urls)
        ? (analysis.key_image_urls as string[]).filter((u) => typeof u === "string")
        : [];

      emit({
        status: "completed",
        category: "brand",
        description: "Brand analysis ready",
        duration_ms,
        web_urls: url ? [{ url }] : [],
        output: {
          brand_name: analysis.brand_name ?? "",
          sections_count: sections.length,
          images_count: key_image_urls.length,
        },
        steps: [
          ...(input.query && !input.url ? [{ id: "s1", title: "Searching for brand URL", status: "completed" as const }] : []),
          { id: "s2", title: domain ? `Analyzing ${domain}` : "Analyzing brand", status: "completed" as const, duration_ms, web_urls: url ? [{ url }] : [] },
        ],
      });

      return {
        success: true,
        url,
        brand_name: String(analysis.brand_name ?? ""),
        summary: String(analysis.summary ?? ""),
        target_audience: String(analysis.target_audience ?? ""),
        design_philosophy: String(analysis.design_philosophy ?? ""),
        sections,
        key_image_urls,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const duration_ms = Date.now() - start;
      emit({
        status: "failed",
        category: "brand",
        description: `Analysis failed: ${err}`,
        duration_ms,
        error: err,
        web_urls: url ? [{ url }] : [],
        steps: [
          ...(input.query ? [{ id: "s1", title: "Searching for brand URL", status: "completed" as const }] : []),
          { id: "s2", title: url ? `Analyzing ${extractDomain(url)}` : "Analyzing brand", status: "failed" as const, web_urls: url ? [{ url }] : [] },
        ],
      });
      return {
        success: false,
        error: err,
        url,
        brand_name: "",
        summary: "",
        target_audience: "",
        design_philosophy: "",
        sections: [],
        key_image_urls: [],
      };
    }
  },
  toModelOutput: (output: any) => ({
    success: output?.success,
    brand_name: output?.brand_name,
    summary: output?.summary?.slice(0, 300),
    target_audience: output?.target_audience?.slice(0, 200),
    design_philosophy: output?.design_philosophy?.slice(0, 200),
    sections_count: output?.sections?.length ?? 0,
    images_count: output?.key_image_urls?.length ?? 0,
    error: output?.error,
  }),
});
