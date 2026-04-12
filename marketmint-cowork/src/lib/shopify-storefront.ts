/**
 * Shopify Storefront MCP client and response parsing. Mirrors Python app.ai.tools.orchestrator.shopify_storefront.
 */

export function normalizeStoreDomain(storeUrl: string): string {
  let url = (storeUrl ?? "").trim();
  if (!url) return "";
  if (!url.includes("://")) url = "https://" + url;
  try {
    const u = new URL(url);
    const host = u.hostname?.toLowerCase() ?? "";
    if (host.endsWith(".myshopify.com")) return host;
    if (host === "myshopify.com") return "";
    return "";
  } catch {
    return "";
  }
}

export type Product = {
  name: string;
  price: string;
  currency: string;
  product_url: string;
  image_url: string;
  description: string;
  variant_id: string;
};

function normalizeProduct(p: Record<string, unknown>): Product {
  return {
    name: String(p.name ?? p.title ?? ""),
    price: String(p.price ?? p.priceRange ?? ""),
    currency: String(p.currency ?? ""),
    product_url: String(p.url ?? p.productUrl ?? p.product_url ?? ""),
    image_url: String(p.imageUrl ?? p.image_url ?? p.image ?? ""),
    description: String(p.description ?? p.body ?? ""),
    variant_id: String(p.variantId ?? p.variant_id ?? p.id ?? ""),
  };
}

function parseProductsFromKeyValueText(text: string): Product[] {
  const products: Product[] = [];
  let name = "",
    price = "",
    product_url = "",
    image_url = "",
    description = "";
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    let m = l.match(/^(?:title|name|product)\s*:\s*(.+)$/i);
    if (m) {
      name = m[1].trim();
      continue;
    }
    m = l.match(/^price\s*:\s*(.+)$/i);
    if (m) {
      price = m[1].trim();
      continue;
    }
    m = l.match(/^(?:url|link|product\s*url)\s*:\s*(.+)$/i);
    if (m) {
      product_url = m[1].trim();
      continue;
    }
    m = l.match(/^(?:image|image\s*url|img)\s*:\s*(.+)$/i);
    if (m) {
      image_url = m[1].trim();
      continue;
    }
    m = l.match(/^description\s*:\s*(.+)$/i);
    if (m) {
      description = m[1].trim();
      continue;
    }
    if (/^\$[\d.,]+/.test(l)) {
      price = l;
      continue;
    }
    if (l.startsWith("http://") || l.startsWith("https://")) {
      if (!product_url) product_url = l;
      else if (!image_url && (l.includes(".jpg") || l.includes(".png") || l.toLowerCase().includes("cdn") || l.includes("shopify")))
        image_url = l;
      continue;
    }
  }
  if (name || price || product_url || image_url || description) {
    products.push({
      name,
      price,
      currency: "",
      product_url,
      image_url,
      description,
      variant_id: "",
    });
  }
  return products;
}

function parseProductsFromMarkdown(text: string): Product[] {
  const products: Product[] = [];
  const linkUrls: string[] = [];
  const imageUrls: string[] = [];
  const linkRe = /\[([^\]]*)\]\(\s*(https?:\/\/[^)\s]+\s*)\)/g;
  const imgRe = /!\[([^\]]*)\]\(\s*(https?:\/\/[^)\s]+\s*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) linkUrls.push(m[2].trim());
  while ((m = imgRe.exec(text)) !== null) imageUrls.push(m[2].trim());
  const lines = text.split("\n");
  const bulletRe = /^(?:\d+\.|\*|\-)\s*(.+?)(?:\s*[-–—]\s*|\s+)\$?\s*([\d.,]+(?:\s*[A-Z]{3})?)\s*$/i;
  const bulletRe2 = /^(.+?)(?:\s*[-–—]\s*|\s+)\$?\s*([\d.,]+(?:\s*[A-Z]{3})?)\s*$/i;
  const bulletRe3 = /^(?:\d+\.|\*|\-)\s*(.+)$/;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 2) continue;
    let namePart = "",
      pricePart = "";
    let match = trimmed.match(bulletRe);
    if (match) {
      namePart = match[1].trim();
      pricePart = match[2].trim();
    } else {
      match = trimmed.match(bulletRe2);
      if (match) {
        namePart = match[1].trim();
        pricePart = match[2].trim();
      } else {
        match = trimmed.match(bulletRe3);
        if (match) {
          namePart = match[1].trim();
        } else continue;
      }
    }
    const name = namePart.replace(/\*\*/g, "").trim() || namePart;
    products.push({
      name,
      price: pricePart && !/^\$/.test(pricePart) ? `$${pricePart}` : pricePart,
      currency: "",
      product_url: "",
      image_url: "",
      description: "",
      variant_id: "",
    });
  }
  products.forEach((p, i) => {
    if (i < linkUrls.length) p.product_url = linkUrls[i];
    if (i < imageUrls.length) p.image_url = imageUrls[i];
  });
  return products;
}

function parseMcpResponse(data: Record<string, unknown>): Product[] {
  const products: Product[] = [];
  const result = data.result as Record<string, unknown> | undefined;
  if (result == null) return products;
  const content = result.content as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(content)) {
    for (const block of content) {
      const text = (block.text ?? block.content ?? "") as string;
      if (!text) continue;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          for (const p of parsed) {
            if (p && typeof p === "object") products.push(normalizeProduct(p as Record<string, unknown>));
          }
        } else if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          const items = (obj.products ?? obj.items ?? obj.results) as unknown[] | undefined;
          if (Array.isArray(items)) {
            for (const p of items) {
              if (p && typeof p === "object") products.push(normalizeProduct(p as Record<string, unknown>));
            }
          } else {
            products.push(normalizeProduct(obj));
          }
        }
      } catch {
        const kv = parseProductsFromKeyValueText(text);
        if (kv.length) products.push(...kv);
        else products.push(...parseProductsFromMarkdown(text));
      }
    }
  }
  if (products.length === 0 && result) {
    const direct = (result.products ?? result.items ?? result.results) as unknown[] | undefined;
    if (Array.isArray(direct)) {
      for (const p of direct) {
        if (p && typeof p === "object") products.push(normalizeProduct(p as Record<string, unknown>));
      }
    }
  }
  return products;
}

export async function callStorefrontMcp(
  storeDomain: string,
  query: string,
  context: string
): Promise<Record<string, unknown>> {
  const url = `https://${storeDomain}/api/mcp`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 1,
      params: {
        name: "search_shop_catalog",
        arguments: { query, context },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  return (await res.json()) as Record<string, unknown>;
}

export function parseMcpResponseToProducts(data: Record<string, unknown>): Product[] {
  return parseMcpResponse(data);
}

/** Parse product list from key-value or markdown text (fallback when MCP returns plain text). */
export function parseProductsFromText(text: string): Product[] {
  const kv = parseProductsFromKeyValueText(text);
  if (kv.length) return kv;
  return parseProductsFromMarkdown(text);
}
