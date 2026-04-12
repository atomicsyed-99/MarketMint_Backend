import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { env } from "@/env";

const tavilyClient = tavily({
  apiKey: env.TAVILY_API_KEY!,
});

export const tavilySearch = createTool({
  id: "tavilySearch",
  description:
    "Search the web for real-time information, trends, news, and web content.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    max_results: z.number().optional().default(5),
    search_depth: z.enum(["basic", "advanced"]).optional().default("basic"),
    include_answer: z.boolean().optional().default(false),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
      }),
    ),
    answer: z.string().optional(),
  }),
  execute: async (
    { query, max_results, search_depth, include_answer },
    context,
  ) => {
    const cardId = crypto.randomUUID();
    const start = Date.now();

    // Initial "loaded" status, mirroring Python tavily_search
    await context?.writer?.custom({
      type: "data-agent-utility",
      data: {
        id: cardId,
        name: "tavilySearch",
        title: "Web Search",
        status: "loaded",
        category: "search",
        description: `Searching for: ${query}`,
        input: {
          query,
          max_results,
          search_depth,
          include_answer,
        },
      },
    });

    // "running" status with a first step
    await context?.writer?.custom({
      type: "data-agent-utility",
      data: {
        id: cardId,
        name: "tavilySearch",
        title: "Web Search",
        status: "running",
        category: "search",
        description: `Searching web for: ${query}`,
        steps: [
          { id: "s1", title: "Querying search engine", status: "running" },
        ],
      },
    });

    try {
      const response = await tavilyClient.search(query, {
        maxResults: max_results,
        searchDepth: search_depth,
        includeAnswer: include_answer,
      });

      const durationMs = Date.now() - start;
      const results = Array.isArray(response.results) ? response.results : [];
      const resultsCount = results.length;
      const resultUrls = results
        .map((r: any) => r?.url)
        .filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"))
        .map((url: string) => ({ url }));

      const steps = [
        { id: "s1", title: "Querying search engine", status: "completed" as const },
      ];
      if (resultUrls.length > 0) {
        steps.push({
          id: "s2",
          title: `Analyzing ${resultsCount} sources`,
          status: "completed" as const,
          web_urls: resultUrls,
        });
      }

      // "completed" status with web_urls + output, mirroring Python
      await context?.writer?.custom({
        type: "data-agent-utility",
        data: {
          id: cardId,
          name: "tavilySearch",
          title: "Web Search",
          status: "completed",
          category: "search",
          description: `Found ${resultsCount} results`,
          duration_ms: durationMs,
          web_urls: resultUrls,
          output: { results_count: resultsCount },
          steps,
        },
      });

      return {
        results: results.map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        })),
        answer: response.answer,
      };
    } catch (error: any) {
      const durationMs = Date.now() - start;

      await context?.writer?.custom({
        type: "data-agent-utility",
        data: {
          id: cardId,
          name: "tavilySearch",
          title: "Web Search",
          status: "failed",
          category: "search",
          description: `Search failed: ${String(error?.message ?? error)}`,
          duration_ms: durationMs,
          error: String(error?.message ?? error),
          steps: [
            {
              id: "s1",
              title: "Querying search engine",
              status: "failed",
            },
          ],
        },
      });

      throw error;
    }
  },
  toModelOutput: (output: any) => {
    const results = output?.results ?? [];
    return {
      results_count: results.length,
      answer: output?.answer,
      results: results.map((r: any) => ({
        title: r.title,
        url: r.url,
        content_preview: r.content?.slice(0, 200),
      })),
    };
  },
});

