import { randomBytes } from "node:crypto";

/**
 * Generate a Nango provider_config_key for a per-client Shopify app.
 * Format: shopify-{slug}-{6-char-hex}
 */
export function generateShopifyProviderConfigKey(appName: string): string {
  const slug = appName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeSlug = slug.length > 0 ? slug : "app";
  const rand = randomBytes(3).toString("hex");
  return `shopify-${safeSlug}-${rand}`;
}
