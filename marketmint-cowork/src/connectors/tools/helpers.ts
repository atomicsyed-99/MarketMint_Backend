/** Known connector name prefixes → human-readable provider labels. */
const PROVIDER_PREFIXES: Record<string, string> = {
  shopify: "Shopify",
  ga: "GA4",
  google_ads: "Google Ads",
  google_sheets: "Google Sheets",
  meta_ads: "Meta Ads",
  klaviyo: "Klaviyo",
  slack: "Slack",
  posthog: "PostHog",
};

/**
 * Convert a snake_case connector tool name to a human-readable title.
 * e.g. "ga_list_properties" → "GA4: List Properties"
 *      "shopify_create_product" → "Shopify: Create Product"
 */
export function humanizeConnectorToolName(name: string): string {
  let matchedPrefix = "";
  let matchedLabel = "";
  for (const [prefix, label] of Object.entries(PROVIDER_PREFIXES)) {
    if (name.startsWith(prefix + "_") && prefix.length > matchedPrefix.length) {
      matchedPrefix = prefix;
      matchedLabel = label;
    }
  }
  if (matchedPrefix) {
    const rest = name
      .slice(matchedPrefix.length + 1)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return `${matchedLabel}: ${rest}`;
  }
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Sanitize a resource ID for use in URL paths. Strips everything except digits, letters, underscores, and hyphens. */
export function sanitizeResourceId(value: string): string {
  return value.replace(/[^0-9a-zA-Z_-]/g, "");
}

/** Extract a human-readable message from an unknown error value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
