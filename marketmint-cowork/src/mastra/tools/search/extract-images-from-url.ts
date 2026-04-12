import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as cheerio from "cheerio";
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

export const extractImagesFromUrl = createTool({
  id: "extractImagesFromUrl",
  description:
    "Extract images from a webpage URL. Use when the user provides a URL and wants images from it. Optionally pass query (e.g. 'shoe images') to return only relevant images, and max_images for the limit.",
  inputSchema: z.object({
    url: z.string().url().describe("The page URL to scrape images from"),
    query: z.string().optional().describe("Optional description of what kind of images to prioritize"),
    max_images: z.number().int().min(1).max(50).default(12),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    url: z.string(),
    images: z.array(z.string()),
    key_image_urls: z.array(z.string()),
    returned: z.number(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const id = crypto.randomUUID();
    const writer = context?.writer;
    const domain = extractDomain(input.url);

    const emit = (data: Record<string, unknown>) => {
      writer?.custom({
        type: "data-agent-utility",
        data: { id, name: "extractImagesFromUrl", title: "Image Extraction", ...data },
      });
    };

    try {
      emit({
        status: "loaded",
        category: "search",
        description: `About to extract images from ${input.url}`,
        input: { url: input.url, max_images: input.max_images, query: input.query },
      });
      emit({
        status: "running",
        category: "search",
        description: `Fetching images from ${input.url}${input.query ? ` (matching: ${input.query})` : ""}`,
        web_urls: [{ url: input.url }],
        steps: [{ id: "s1", title: `Scraping ${domain}`, status: "running", web_urls: [{ url: input.url }] }],
      });

      let images: string[];
      if (input.query?.trim()) {
        const scraped = await scrapeUrl(input.url, ["markdown", "images", "html"], { timeout: 60000 });
        const html = scraped.html ?? "";
        const firecrawlImages = (scraped.images ?? []) as string[];
        const extracted: string[] = [];
        if (html) {
          const $ = cheerio.load(html);
          const og = $('meta[property="og:image"]').attr("content");
          if (og) extracted.push(og);
          const tw = $('meta[property="twitter:image"]').attr("content");
          if (tw) extracted.push(tw);
          $("img").each((_, el) => {
            const src = $(el).attr("src") ?? $(el).attr("data-src");
            if (src && src.startsWith("http") && !src.toLowerCase().includes("icon") && !src.toLowerCase().includes("logo"))
              extracted.push(src);
          });
        }
        const all = [...new Set([...extracted, ...firecrawlImages])];
        let hasModel = false;
        try {
          getDirectGoogleModel("gemini-2.0-flash");
          hasModel = true;
        } catch {
          // no Google credentials configured
        }
        if (hasModel && all.length > 0) {
          const { text } = await generateText({
            model: getDirectGoogleModel("gemini-2.0-flash"),
            prompt: `From this list of image URLs from a webpage, return only those that clearly show or depict: ${input.query}. Return at most ${input.max_images} URLs as JSON: { "image_urls": ["url1", "url2"] }. Exclude logos, icons, navigation, thumbnails. Return only full-size, content-relevant image URLs.\n\nURLs:\n${all.slice(0, 50).join("\n")}`,
          });
          try {
            const parsed = JSON.parse(text) as { image_urls?: string[] };
            images = Array.isArray(parsed.image_urls) ? parsed.image_urls.slice(0, input.max_images) : all.slice(0, input.max_images);
          } catch {
            images = all.slice(0, input.max_images);
          }
        } else {
          images = all.slice(0, input.max_images);
        }
      } else {
        const scraped = await scrapeUrl(input.url, ["markdown", "images", "html"], { timeout: 60000 });
        const html = scraped.html ?? "";
        const firecrawlImages = (scraped.images ?? []) as string[];
        const extracted: string[] = [];
        if (html) {
          const $ = cheerio.load(html);
          const og = $('meta[property="og:image"]').attr("content");
          if (og) extracted.push(og);
          const tw = $('meta[property="twitter:image"]').attr("content");
          if (tw) extracted.push(tw);
          $("img").each((_, el) => {
            const src = $(el).attr("src") ?? $(el).attr("data-src");
            if (src && src.startsWith("http") && !src.toLowerCase().includes("icon") && !src.toLowerCase().includes("logo"))
              extracted.push(src);
          });
        }
        images = [...new Set([...extracted, ...firecrawlImages])].slice(0, input.max_images);
      }

      const duration_ms = 0;
      emit({
        status: "completed",
        category: "search",
        description: images.length ? `Found ${images.length} images${input.query ? " matching your request" : " from page"}` : "No images found",
        duration_ms,
        web_urls: [{ url: input.url }],
        output: { image_count: images.length, url: input.url },
        steps: [{ id: "s1", title: `Scraping ${domain}`, status: "completed", duration_ms, web_urls: [{ url: input.url }] }],
      });

      for (let i = 0; i < images.length; i++) {
        writer?.custom({
          type: "data-image",
          data: { id: crypto.randomUUID(), url: images[i], label: `Extracted image ${i + 1}` },
        });
      }

      return {
        success: true,
        url: input.url,
        images,
        key_image_urls: images,
        returned: images.length,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      emit({
        status: "failed",
        category: "search",
        description: `Extraction failed: ${err}`,
        error: err,
        web_urls: [{ url: input.url }],
        steps: [{ id: "s1", title: `Scraping ${domain}`, status: "failed", web_urls: [{ url: input.url }] }],
      });
      return {
        success: false,
        url: input.url,
        images: [],
        key_image_urls: [],
        returned: 0,
        error: err,
      };
    }
  },
  toModelOutput: (output: any) => ({
    success: output?.success,
    url: output?.url,
    image_count: output?.returned ?? 0,
    error: output?.error,
  }),
});
