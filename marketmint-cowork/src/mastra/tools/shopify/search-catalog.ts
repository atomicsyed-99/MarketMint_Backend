import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  normalizeStoreDomain,
  callStorefrontMcp,
  parseMcpResponseToProducts,
  parseProductsFromText,
  type Product,
} from "@/lib/shopify-storefront";

export const searchShopifyCatalog = createTool({
  id: "searchShopifyCatalog",
  description:
    "Search a Shopify store's public product catalog (unauthenticated, read-only). Only use when search_tools is NOT available. If search_tools is available, use shopify_list_products instead for full authenticated Admin API access. Requires store_url (e.g. mystore.myshopify.com).",
  inputSchema: z.object({
    store_url: z.string().describe("Shopify store domain (e.g. mystore.myshopify.com)"),
    query: z.string().optional().default("products"),
    context: z.string().optional().default("Customer is browsing the store catalog."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    store_domain: z.string().optional(),
    products: z.array(
      z.object({
        name: z.string(),
        price: z.string(),
        currency: z.string(),
        product_url: z.string(),
        image_url: z.string(),
        description: z.string(),
        variant_id: z.string(),
      })
    ),
    key_image_urls: z.array(z.string()),
    returned: z.number(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const id = crypto.randomUUID();
    const writer = context?.writer;
    const start = Date.now();

    const emit = (data: Record<string, unknown>) => {
      writer?.custom({
        type: "data-agent-utility",
        data: { id, name: "searchShopifyCatalog", title: "Shopify Catalog", ...data },
      });
    };

    const store_domain = normalizeStoreDomain(input.store_url);
    if (!store_domain) {
      emit({
        status: "failed",
        category: "connector",
        description: "Store URL must be a Shopify domain (e.g. mystore.myshopify.com). Custom domains are not supported.",
        error: "Invalid store URL: must be *.myshopify.com",
        input: { store_url: input.store_url, query: input.query },
      });
      return {
        success: false,
        products: [],
        key_image_urls: [],
        returned: 0,
        error: "Store URL must be a Shopify domain (e.g. mystore.myshopify.com). Custom domains are not supported.",
      };
    }

    try {
      emit({
        status: "loaded",
        category: "connector",
        description: `About to search catalog at ${store_domain}`,
        input: { store_url: input.store_url, query: input.query, context: input.context },
      });
      emit({
        status: "running",
        category: "connector",
        description: `Searching catalog for: ${input.query}`,
        web_urls: [{ url: `https://${store_domain}` }],
        steps: [
          {
            id: "s1",
            title: `Calling Storefront MCP (${store_domain})`,
            status: "running",
            web_urls: [{ url: `https://${store_domain}` }],
          },
        ],
      });

      const raw = await callStorefrontMcp(store_domain, input.query, input.context ?? "Customer is browsing the store catalog.");
      const duration_ms = Date.now() - start;

      if (raw.error && typeof raw.error === "string") {
        emit({
          status: "failed",
          category: "connector",
          description: `Catalog request failed: ${raw.error}`,
          duration_ms,
          error: raw.error,
          web_urls: [{ url: `https://${store_domain}` }],
          steps: [
            {
              id: "s1",
              title: `Calling Storefront MCP (${store_domain})`,
              status: "failed",
              web_urls: [{ url: `https://${store_domain}` }],
            },
          ],
        });
        return {
          success: false,
          store_domain,
          products: [],
          key_image_urls: [],
          returned: 0,
          error: raw.error,
        };
      }

      let products = parseMcpResponseToProducts(raw);
      const result = raw.result as Record<string, unknown> | undefined;
      let firstContentText = "";
      if (result && typeof result === "object" && Array.isArray(result.content)) {
        const block = result.content[0];
        if (block && typeof block === "object")
          firstContentText = String((block as { text?: string }).text ?? (block as { content?: string }).content ?? "").slice(0, 2000);
      }
      if (products.length === 0 && firstContentText) {
        products = parseProductsFromText(firstContentText);
      }

      const key_image_urls = products
        .map((p) => (p.image_url ?? "").trim())
        .filter((u) => u.startsWith("http"));
      const seen = new Set<string>();
      const key_images_dedup: string[] = [];
      for (const u of key_image_urls) {
        if (!seen.has(u)) {
          seen.add(u);
          key_images_dedup.push(u);
        }
      }

      emit({
        status: "completed",
        category: "connector",
        description: products.length ? `Found ${products.length} products` : "No products returned",
        duration_ms,
        web_urls: [{ url: `https://${store_domain}` }],
        output: { product_count: products.length, image_count: key_images_dedup.length, store_domain },
        steps: [
          {
            id: "s1",
            title: `Calling Storefront MCP (${store_domain})`,
            status: "completed",
            duration_ms,
            web_urls: [{ url: `https://${store_domain}` }],
          },
        ],
      });

      for (let i = 0; i < key_images_dedup.length; i++) {
        writer?.custom({
          type: "data-image",
          data: { id: crypto.randomUUID(), url: key_images_dedup[i], label: `Product image ${i + 1}` },
        });
      }

      return {
        success: true,
        store_domain,
        products: products as Product[],
        key_image_urls: key_images_dedup,
        returned: products.length,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const duration_ms = Date.now() - start;
      emit({
        status: "failed",
        category: "connector",
        description: `Catalog request failed: ${err}`,
        duration_ms,
        error: err,
        web_urls: [{ url: `https://${store_domain}` }],
        steps: [
          { id: "s1", title: `Calling Storefront MCP (${store_domain})`, status: "failed", web_urls: [{ url: `https://${store_domain}` }] },
        ],
      });
      return {
        success: false,
        store_domain,
        products: [],
        key_image_urls: [],
        returned: 0,
        error: err,
      };
    }
  },
});
