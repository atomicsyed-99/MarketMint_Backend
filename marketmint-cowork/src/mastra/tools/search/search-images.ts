import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { searchQuery } from "@/lib/firecrawl";

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname || url;
  } catch {
    return url;
  }
}

export const searchImages = createTool({
  id: "searchImages",
  description:
    "Search the web for images matching a description. Use when the user describes a type of image (e.g. 'minimalist living room', 'beach background') but does not give a URL. Returns image_urls and sources.",
  inputSchema: z.object({
    description: z.string().describe("What kind of images to search for"),
    max_results: z.number().int().min(1).max(50).default(12),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    description: z.string(),
    image_urls: z.array(z.string()),
    key_image_urls: z.array(z.string()),
    sources: z.array(z.string()),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const id = crypto.randomUUID();
    const writer = context?.writer;
    const start = Date.now();

    const emit = (data: Record<string, unknown>) => {
      writer?.custom({
        type: "data-agent-utility",
        data: { id, name: "searchImages", title: "Image Search", ...data },
      });
    };

    try {
      emit({
        status: "loaded",
        category: "search",
        description: `About to search for images: ${input.description}`,
        input: { description: input.description, max_results: input.max_results },
      });
      emit({
        status: "running",
        category: "search",
        description: `Finding images for: ${input.description}`,
        steps: [{ id: "s1", title: "Querying search engine", status: "running" }],
      });

      const result = await searchQuery(`high quality images ${input.description}`, {
        limit: input.max_results,
        sources: ["images"],
      });
      const rawImages = (result?.data?.images ?? result?.images ?? []) as Array<{
        imageUrl?: string;
        image_url?: string;
        url?: string;
      }>;
      const imageUrl = (item: (typeof rawImages)[0]) =>
        item?.imageUrl ?? item?.image_url ?? "";
      const pageUrl = (item: (typeof rawImages)[0]) => item?.url ?? "";
      const image_urls: string[] = [];
      const sources: string[] = [];
      const seen = new Set<string>();
      for (const item of rawImages) {
        if (image_urls.length >= input.max_results) break;
        const img = imageUrl(item);
        if (img && img.startsWith("http") && !seen.has(img)) {
          seen.add(img);
          image_urls.push(img);
          const page = pageUrl(item);
          if (page) sources.push(page);
        }
      }

      const duration_ms = Date.now() - start;
      const steps: Array<{ id: string; title: string; status: string; web_urls?: { url: string }[] }> = [
        { id: "s1", title: "Querying search engine", status: "completed" },
      ];
      for (let i = 0; i < Math.min(sources.length, input.max_results); i++) {
        steps.push({
          id: `s${i + 2}`,
          title: `Visiting ${extractDomain(sources[i])}`,
          status: "completed",
          web_urls: [{ url: sources[i] }],
        });
      }
      emit({
        status: "completed",
        category: "search",
        description: image_urls.length ? `Found ${image_urls.length} images` : "No images found for that description",
        duration_ms,
        web_urls: sources.map((url) => ({ url })),
        output: { image_count: image_urls.length, sources_count: sources.length },
        steps,
      });

      for (let i = 0; i < image_urls.length; i++) {
        writer?.custom({
          type: "data-image",
          data: { id: crypto.randomUUID(), url: image_urls[i], label: `Image ${i + 1}` },
        });
      }

      return {
        success: true,
        description: input.description,
        image_urls,
        key_image_urls: image_urls,
        sources,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const duration_ms = Date.now() - start;
      emit({
        status: "failed",
        category: "search",
        description: `Search failed: ${err}`,
        duration_ms,
        error: err,
        steps: [{ id: "s1", title: "Querying search engine", status: "failed" }],
      });
      return {
        success: false,
        description: input.description,
        image_urls: [],
        key_image_urls: [],
        sources: [],
        error: err,
      };
    }
  },
  toModelOutput: (output: any) => ({
    success: output?.success,
    description: output?.description,
    image_count: output?.image_urls?.length ?? 0,
    sources_count: output?.sources?.length ?? 0,
    error: output?.error,
  }),
});
