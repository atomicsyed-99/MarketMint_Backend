import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import type { GoogleGenerativeAIProviderMetadata } from "@ai-sdk/google";
import { fetchWithTimeout } from "@/lib/fetch";
import { env } from "@/env";
import { getDirectGoogleModel, getOpenAIModel } from "@/lib/ai-gateway";
import { listGeoPromptsByWorkspace } from "@/db/queries/geo-prompts";
import { createGeoAuditResults } from "@/db/queries/geo-audit-results";
import { emitUtility } from "@/mastra/tools/emit-utility";
import { getBrandMemories } from "@/lib/brand-memories";
import { generatePdf } from "@/mastra/tools/artifacts/generate-pdf";
import type { CitationSource, SentimentValue } from "@/db/schema/geo-audit-results";
import { getUserEmail, getUserId, getWorkspaceId, isBrandMemoryEnabled } from "./shared";

const providers = ["chatgpt", "perplexity", "gemini"] as const;

function extractHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractSiteName(url: string): string {
  const host = extractHostname(url);
  if (!host) return url;
  const parts = host.split(".");
  if (parts.length >= 2) {
    const domain = parts[parts.length - 2];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  }
  return host;
}

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const AUDIT_TIMEOUT_MS = 45_000;

function isBrandUrl(url: string, brandDomain: string | null): boolean {
  if (!brandDomain) return false;
  const host = extractHostname(url);
  if (!host) return false;
  return host === brandDomain || host.endsWith(`.${brandDomain}`);
}

function hasBrandMention(text: string, brandName: string): boolean {
  if (!brandName || brandName === "this brand") return false;
  return text.toLowerCase().includes(brandName.toLowerCase());
}

interface AuditResult {
  provider: string;
  isCited: boolean;
  citationRank: number | null;
  citationUrl: string | null;
  responseSnippet: string | null;
  citationSources: CitationSource[];
  sentiment: SentimentValue | null;
  competingBrands: string[];
  rawResponse: Record<string, unknown>;
  auditedAt: Date;
}

async function analyzeResponseWithLLM(args: {
  responseSnippet: string;
  citationSources: CitationSource[];
  brandName: string;
  promptText: string;
}): Promise<{ sentiment: SentimentValue; competingBrands: string[] }> {
  const fallback = { sentiment: "neutral" as SentimentValue, competingBrands: [] };
  if (!args.responseSnippet?.trim()) return fallback;

  const sourceNames = args.citationSources.map((s) => s.name).join(", ");
  const prompt = [
    "Analyze this AI provider response about a brand. Return ONLY valid JSON, no prose.",
    "",
    "Schema: {\"sentiment\": \"positive\"|\"neutral\"|\"negative\", \"competing_brands\": string[]}",
    "",
    "Rules:",
    `- sentiment: How the response portrays "${args.brandName}" — positive (recommends/praises), negative (warns/criticizes), neutral (factual/no opinion).`,
    `- competing_brands: List other brand/company/product names mentioned as alternatives or competitors. Do NOT include "${args.brandName}" itself. Return [] if none.`,
    "",
    `Brand: ${args.brandName}`,
    `User query: ${args.promptText}`,
    `Sources cited: ${sourceNames || "none"}`,
    `Response text: ${args.responseSnippet.slice(0, 6000)}`,
  ].join("\n");

  try {
    const { text } = await generateText({
      model: getDirectGoogleModel("gemini-2.5-flash"),
      prompt,
    });
    return parseSentimentResponse(text, fallback);
  } catch {
    try {
      const { text } = await generateText({
        model: getOpenAIModel("gpt-4o-mini"),
        prompt,
      });
      return parseSentimentResponse(text, fallback);
    } catch {
      return fallback;
    }
  }
}

function parseSentimentResponse(
  raw: string,
  fallback: { sentiment: SentimentValue; competingBrands: string[] },
): { sentiment: SentimentValue; competingBrands: string[] } {
  try {
    const cleaned = raw.trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return fallback;
    const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    const sentimentRaw = String(parsed.sentiment ?? "neutral").toLowerCase();
    const sentiment: SentimentValue =
      sentimentRaw === "positive" ? "positive" :
      sentimentRaw === "negative" ? "negative" : "neutral";
    const brands = Array.isArray(parsed.competing_brands)
      ? parsed.competing_brands.filter((b: unknown) => typeof b === "string" && b.trim())
      : [];
    return { sentiment, competingBrands: brands };
  } catch {
    return fallback;
  }
}

type ProviderAuditArgs = {
  promptText: string;
  brandDomain: string | null;
  brandName: string;
};

function makeEmptyResult(provider: string, mode: string): AuditResult {
  return {
    provider,
    isCited: false,
    citationRank: null,
    citationUrl: null,
    responseSnippet: null,
    citationSources: [],
    sentiment: null,
    competingBrands: [],
    rawResponse: { provider, mode },
    auditedAt: new Date(),
  };
}

function buildResult(
  provider: string,
  content: string,
  citationSources: CitationSource[],
  brandName: string,
  analysis: { sentiment: SentimentValue; competingBrands: string[] },
  rawResponse: Record<string, unknown>,
): AuditResult {
  const brandSource = citationSources.find((s) => s.isBrand);
  const brandMentioned = hasBrandMention(content, brandName);
  return {
    provider,
    isCited: !!brandSource || brandMentioned,
    citationRank: brandSource?.rank ?? null,
    citationUrl: brandSource?.url ?? null,
    responseSnippet: content.slice(0, 2000),
    citationSources,
    sentiment: analysis.sentiment,
    competingBrands: analysis.competingBrands,
    rawResponse,
    auditedAt: new Date(),
  };
}

// ── Perplexity: sonar model returns citations[] with actual URLs ─────

async function auditWithPerplexity(args: ProviderAuditArgs): Promise<AuditResult> {
  const apiKey = env.PERPLEXITY_API_KEY;
  if (!apiKey) return makeEmptyResult("perplexity", "no_api_key");

  const response = await fetchWithTimeout(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: args.promptText }],
    }),
    timeoutMs: AUDIT_TIMEOUT_MS,
  });
  if (!response.ok) throw new Error(`Perplexity ${response.status} ${response.statusText}`);

  const data = (await response.json()) as Record<string, unknown>;
  const choices = (data.choices ?? []) as Array<Record<string, unknown>>;
  const message = choices[0]?.message as Record<string, unknown> | undefined;
  const content = String(message?.content ?? "");
  const citations = (data.citations ?? []) as string[];

  const citationSources: CitationSource[] = citations.map((url, i) => ({
    name: extractSiteName(url),
    url,
    rank: i + 1,
    isBrand: isBrandUrl(url, args.brandDomain),
  }));

  const analysis = await analyzeResponseWithLLM({
    responseSnippet: content.slice(0, 6000),
    citationSources,
    brandName: args.brandName,
    promptText: args.promptText,
  });

  return buildResult("perplexity", content, citationSources, args.brandName, analysis, data);
}

// ── ChatGPT: web_search_options returns annotations with url_citation ──

async function auditWithChatGPT(args: ProviderAuditArgs): Promise<AuditResult> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return makeEmptyResult("chatgpt", "no_api_key");

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

  let response = await fetchWithTimeout(OPENAI_COMPLETIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: args.promptText }],
      web_search_options: { search_context_size: "medium" },
    }),
    timeoutMs: AUDIT_TIMEOUT_MS,
  });

  if (!response.ok) {
    response = await fetchWithTimeout(OPENAI_COMPLETIONS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: args.promptText }],
      }),
      timeoutMs: AUDIT_TIMEOUT_MS,
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const choices = (data.choices ?? []) as Array<Record<string, unknown>>;
  const message = choices[0]?.message as Record<string, unknown> | undefined;
  const content = String(message?.content ?? "");

  const annotations = (message?.annotations ?? []) as Array<Record<string, unknown>>;
  const citationSources: CitationSource[] = annotations
    .filter((a) => a.type === "url_citation" && typeof a.url === "string")
    .map((a, i) => ({
      name: String(a.title ?? extractSiteName(a.url as string)),
      url: a.url as string,
      rank: i + 1,
      isBrand: isBrandUrl(a.url as string, args.brandDomain),
    }));

  const analysis = await analyzeResponseWithLLM({
    responseSnippet: content.slice(0, 6000),
    citationSources,
    brandName: args.brandName,
    promptText: args.promptText,
  });

  return buildResult("chatgpt", content, citationSources, args.brandName, analysis, data);
}

// ── Gemini: google_search grounding via AI SDK + Cloudflare AI Gateway ──

async function auditWithGemini(args: ProviderAuditArgs): Promise<AuditResult> {
  const result = await generateText({
    model: getDirectGoogleModel("gemini-2.0-flash"),
    prompt: args.promptText,
    tools: {
      google_search: google.tools.googleSearch({}),
    },
  });

  const content = result.text ?? "";
  const googleMeta = result.providerMetadata
    ?.google as GoogleGenerativeAIProviderMetadata | undefined;
  const groundingChunks = googleMeta?.groundingMetadata?.groundingChunks ?? [];

  const citationSources: CitationSource[] = groundingChunks
    .filter((c) => !!c.web?.uri)
    .map((c, i) => {
      const uri = c.web!.uri;
      return {
        name: c.web?.title ?? extractSiteName(uri),
        url: uri,
        rank: i + 1,
        isBrand: isBrandUrl(uri, args.brandDomain),
      };
    });

  const analysis = await analyzeResponseWithLLM({
    responseSnippet: content.slice(0, 6000),
    citationSources,
    brandName: args.brandName,
    promptText: args.promptText,
  });

  return buildResult("gemini", content, citationSources, args.brandName, analysis, {
    provider: "gemini",
    mode: "ai-gateway",
    groundingMetadata: googleMeta?.groundingMetadata ?? null,
  });
}

// ── Dispatcher ──────────────────────────────────────────────────────

async function auditPromptAgainstProvider(args: {
  provider: (typeof providers)[number];
  promptText: string;
  brandDomain: string | null;
  brandName: string;
}): Promise<AuditResult> {
  const { provider, ...auditArgs } = args;
  try {
    switch (provider) {
      case "perplexity": return await auditWithPerplexity(auditArgs);
      case "chatgpt": return await auditWithChatGPT(auditArgs);
      case "gemini": return await auditWithGemini(auditArgs);
    }
  } catch (error) {
    return {
      ...makeEmptyResult(provider, "provider_api_failed"),
      rawResponse: {
        provider,
        mode: "provider_api_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

const citationSourceSchema = z.object({
  name: z.string(),
  url: z.string(),
  rank: z.number(),
  isBrand: z.boolean(),
});

const promptResultSchema = z.object({
  promptId: z.string(),
  promptText: z.string(),
  providers: z.record(
    z.string(),
    z.object({
      isCited: z.boolean(),
      citationRank: z.number().nullable(),
      citationUrl: z.string().nullable(),
      responseSnippet: z.string().nullable(),
      citationSources: z.array(citationSourceSchema),
      sentiment: z.enum(["positive", "neutral", "negative"]).nullable(),
      competingBrands: z.array(z.string()),
    }),
  ),
});

export const runGeoAudit = createTool({
  id: "runGeoAudit",
  description:
    "Run GEO citation audit for tracked prompts across providers. Returns prompt-level citations with source names, sentiment analysis, and competing brand mentions.",
  inputSchema: z.object({
    promptIds: z.array(z.string().uuid()).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    auditedPromptCount: z.number(),
    totalChecks: z.number(),
    citationsFound: z.number(),
    citationRate: z.number(),
    providerSummary: z.record(
      z.string(),
      z.object({
        checks: z.number(),
        citationsFound: z.number(),
      }),
    ),
    promptResults: z.array(promptResultSchema),
    pdfUrl: z.string().nullable(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const utilityId = `geo_audit_${crypto.randomUUID().slice(0, 8)}`;
    const requestContext = context?.requestContext;
    const workspaceId = getWorkspaceId(requestContext);
    const userId = getUserId(requestContext);
    const email = getUserEmail(requestContext);
    const enabled = isBrandMemoryEnabled(requestContext);

    const emptyReturn = {
      success: false as const,
      auditedPromptCount: 0,
      totalChecks: 0,
      citationsFound: 0,
      citationRate: 0,
      providerSummary: {} as Record<string, { checks: number; citationsFound: number }>,
      promptResults: [] as z.infer<typeof promptResultSchema>[],
      pdfUrl: null,
    };

    emitUtility(context, {
      id: utilityId,
      name: "runGeoAudit",
      title: "GEO Prompt Audit",
      category: "workflow",
      status: "running",
      description: "Running citation audit across providers...",
    });

    if (!enabled) {
      return {
        ...emptyReturn,
        message: "Please enable the Brand Memory toggle in the chatbox first before running GEO audit.",
        error: "Brand memory toggle is off",
      };
    }
    if (!workspaceId || !userId) {
      return {
        ...emptyReturn,
        message: "Missing workspace/user context.",
        error: "Missing workspace/user context",
      };
    }

    try {
      const allPrompts = await listGeoPromptsByWorkspace(workspaceId, {
        activeOnly: true,
      });
      const prompts = input.promptIds?.length
        ? allPrompts.filter((p) => input.promptIds?.includes(p.id))
        : allPrompts;
      if (prompts.length === 0) {
        return {
          ...emptyReturn,
          message: "No active GEO prompts found. Add prompts first.",
          error: "No active prompts",
        };
      }

      const brandMemories = await getBrandMemories(userId, workspaceId);
      const brandMemory = (brandMemories[0]?.content ?? {}) as Record<string, unknown>;
      const brandDomain = extractHostname(String(brandMemory.url ?? ""));
      const brandName = String(
        brandMemory.brand_name ?? brandMemory.name ?? brandMemory.brandName ?? "this brand",
      );

      emitUtility(context, {
        id: utilityId,
        name: "runGeoAudit",
        title: "GEO Prompt Audit",
        category: "workflow",
        status: "running",
        description: `Auditing ${prompts.length} prompts across ${providers.length} providers...`,
      });

      const dbRows: Parameters<typeof createGeoAuditResults>[0] = [];
      const providerSummary: Record<string, { checks: number; citationsFound: number }> = {};
      for (const provider of providers) {
        providerSummary[provider] = { checks: 0, citationsFound: 0 };
      }

      const promptResults: z.infer<typeof promptResultSchema>[] = [];
      let stepsDone = 0;

      for (const prompt of prompts) {
        const providerMap: z.infer<typeof promptResultSchema>["providers"] = {};

        for (const provider of providers) {
          const result = await auditPromptAgainstProvider({
            provider,
            promptText: prompt.promptText,
            brandDomain,
            brandName,
          });

          dbRows.push({
            workspaceId,
            promptId: prompt.id,
            provider: result.provider,
            isCited: result.isCited,
            citationRank: result.citationRank,
            citationUrl: result.citationUrl,
            responseSnippet: result.responseSnippet,
            citationSources: result.citationSources,
            sentiment: result.sentiment,
            competingBrands: result.competingBrands,
            rawResponse: result.rawResponse,
            auditedAt: result.auditedAt,
          });

          providerMap[provider] = {
            isCited: result.isCited,
            citationRank: result.citationRank,
            citationUrl: result.citationUrl,
            responseSnippet: result.responseSnippet,
            citationSources: result.citationSources,
            sentiment: result.sentiment,
            competingBrands: result.competingBrands,
          };

          providerSummary[provider].checks += 1;
          if (result.isCited) providerSummary[provider].citationsFound += 1;

          stepsDone++;
          emitUtility(context, {
            id: utilityId,
            name: "runGeoAudit",
            title: "GEO Prompt Audit",
            category: "workflow",
            status: "running",
            description: `[${stepsDone}/${prompts.length * providers.length}] Audited "${prompt.promptText.slice(0, 40)}…" on ${provider}`,
          });
        }

        promptResults.push({
          promptId: prompt.id,
          promptText: prompt.promptText,
          providers: providerMap,
        });
      }

      await createGeoAuditResults(dbRows);

      const totalChecks = dbRows.length;
      const citationsFound = dbRows.filter((r) => r.isCited).length;
      const citationRate = totalChecks > 0 ? Number((citationsFound / totalChecks).toFixed(4)) : 0;

      // --- Build PDF report ---
      const pdfSections: Array<Record<string, unknown>> = [
        { type: "heading", content: "GEO Audit Summary", level: 2 },
        {
          type: "bullets",
          items: [
            `Brand: ${brandName}`,
            `Prompts audited: ${prompts.length}`,
            `Providers checked: ${providers.length}`,
            `Total checks: ${totalChecks}`,
            `Citations found: ${citationsFound}`,
            `Citation rate: ${(citationRate * 100).toFixed(1)}%`,
          ],
        },
        { type: "heading", content: "Provider Breakdown", level: 3 },
        {
          type: "table",
          headers: ["Provider", "Checks", "Citations Found", "Coverage"],
          rows: providers.map((provider) => {
            const data = providerSummary[provider];
            const coverage =
              data.checks > 0
                ? `${((data.citationsFound / data.checks) * 100).toFixed(1)}%`
                : "0.0%";
            return [provider, String(data.checks), String(data.citationsFound), coverage];
          }),
        },
      ];

      for (const pr of promptResults) {
        pdfSections.push({ type: "heading", content: pr.promptText, level: 3 });
        for (const [prov, data] of Object.entries(pr.providers)) {
          const sentimentLabel = data.sentiment ? ` | Sentiment: ${data.sentiment}` : "";
          const brandCited = data.isCited ? `Cited at rank #${data.citationRank}` : "Not cited";
          pdfSections.push({
            type: "heading",
            content: `${prov} — ${brandCited}${sentimentLabel}`,
            level: 4,
          });
          if (data.citationSources.length > 0) {
            pdfSections.push({
              type: "table",
              headers: ["Rank", "Source", "URL", "Is Brand"],
              rows: data.citationSources.map((s) => [
                String(s.rank),
                s.name,
                s.url,
                s.isBrand ? "Yes" : "No",
              ]),
            });
          }
          if (data.competingBrands.length > 0) {
            pdfSections.push({
              type: "bullets",
              items: [`Competing brands mentioned: ${data.competingBrands.join(", ")}`],
            });
          }
        }
      }

      let pdfUrl: string | null = null;
      if (typeof generatePdf.execute === "function") {
        const pdfResult = await generatePdf.execute(
          {
            title: `GEO Audit Report - ${brandName} - ${new Date().toISOString().slice(0, 10)}`,
            sections: pdfSections as any,
          },
          context as any,
        );
        pdfUrl =
          pdfResult &&
          typeof pdfResult === "object" &&
          "url" in pdfResult &&
          typeof (pdfResult as { url?: unknown }).url === "string"
            ? (pdfResult as { url: string }).url
            : null;
      }

      emitUtility(context, {
        id: utilityId,
        name: "runGeoAudit",
        title: "GEO Prompt Audit",
        category: "workflow",
        status: "completed",
        description: `Audit completed. ${citationsFound}/${totalChecks} checks returned citations.`,
      });

      return {
        success: true,
        auditedPromptCount: prompts.length,
        totalChecks,
        citationsFound,
        citationRate,
        providerSummary,
        promptResults,
        pdfUrl,
        message:
          "GEO audit complete. Results saved and report delivered as an artifact PDF.",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      emitUtility(context, {
        id: utilityId,
        name: "runGeoAudit",
        title: "GEO Prompt Audit",
        category: "workflow",
        status: "failed",
        description: "Audit failed.",
        error: msg,
      });
      return {
        ...emptyReturn,
        message: "Failed to run GEO audit.",
        error: msg,
      };
    }
  },
});
