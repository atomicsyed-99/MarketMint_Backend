import type { ConnectorDefinition } from "./types";
import { createShopifyConnectorTools } from "./tools/shopify";
import { createMetaAdsTools } from "./tools/meta-ads";
import { createGoogleAdsTools } from "./tools/google-ads";
import { createGoogleAnalyticsTools } from "./tools/google-analytics";
import { createGoogleSheetsTools } from "./tools/google-sheets";
import { createKlaviyoTools } from "./tools/klaviyo";
import { createSlackTools } from "./tools/slack";
import { createPostHogTools } from "./tools/posthog";
import {
  SHOPIFY_CAPABILITIES,
  META_ADS_CAPABILITIES,
  GOOGLE_ADS_CAPABILITIES,
  GOOGLE_ANALYTICS_CAPABILITIES,
  GOOGLE_SHEETS_CAPABILITIES,
  KLAVIYO_CAPABILITIES,
  SLACK_CAPABILITIES,
  POSTHOG_CAPABILITIES,
} from "./capabilities";

/**
 * Central connector registry.
 * To add a new connector: add one entry here + create a tool factory file.
 * To disable: set enabled: false.
 */
export const CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: "shopify",
    name: "Shopify",
    description: "E-commerce store management via Admin API",
    providerConfigKey: "shopify",
    authType: "oauth",
    toolFactory: (connectionId, _apiKeys, providerConfigKey) =>
      createShopifyConnectorTools(connectionId, providerConfigKey),
    capabilities: SHOPIFY_CAPABILITIES,
    enabled: true,
  },
  {
    id: "meta-marketing-api",
    name: "Meta Ads",
    description: "Facebook & Instagram ad management",
    providerConfigKey: "meta-marketing-api",
    authType: "oauth",
    toolFactory: (connectionId, _apiKeys, _providerConfigKey) =>
      createMetaAdsTools(connectionId),
    capabilities: META_ADS_CAPABILITIES,
    enabled: true,
  },
  {
    id: "google-ads",
    name: "Google Ads",
    description: "Search & display ad campaign management",
    providerConfigKey: "google-ads",
    authType: "oauth",
    toolFactory: (connectionId, _apiKeys, _providerConfigKey) =>
      createGoogleAdsTools(connectionId),
    capabilities: GOOGLE_ADS_CAPABILITIES,
    enabled: true,
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "GA4 website analytics and reporting",
    providerConfigKey: "google-analytics",
    authType: "oauth",
    toolFactory: (connectionId, _apiKeys, _providerConfigKey) =>
      createGoogleAnalyticsTools(connectionId),
    capabilities: GOOGLE_ANALYTICS_CAPABILITIES,
    enabled: true,
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Spreadsheet data management",
    providerConfigKey: "google-sheet",
    authType: "oauth",
    toolFactory: (connectionId, _apiKeys, _providerConfigKey) =>
      createGoogleSheetsTools(connectionId),
    capabilities: GOOGLE_SHEETS_CAPABILITIES,
    enabled: false,
  },
  {
    id: "klaviyo",
    name: "Klaviyo",
    description: "Email & SMS marketing automation",
    providerConfigKey: "klaviyo",
    authType: "api-key",
    apiKeyFields: [
      {
        key: "apiKey",
        label: "Private API Key",
        placeholder: "pk_...",
        required: true,
      },
    ],
    toolFactory: (_connId, apiKeys, _providerConfigKey) =>
      createKlaviyoTools({ apiKey: apiKeys!.apiKey }),
    capabilities: KLAVIYO_CAPABILITIES,
    enabled: true,
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages and read channels",
    providerConfigKey: "slack",
    authType: "oauth",
    toolFactory: (connectionId, _apiKeys, _providerConfigKey) =>
      createSlackTools(connectionId),
    capabilities: SLACK_CAPABILITIES,
    enabled: true,
  },
  {
    id: "posthog",
    name: "PostHog",
    description: "Product analytics, session recordings, and feature flags",
    providerConfigKey: "posthog",
    authType: "api-key",
    apiKeyFields: [
      {
        key: "apiKey",
        label: "Personal API Key",
        placeholder: "phx_...",
        required: true,
      },
      {
        key: "subdomain",
        label: "Subdomain",
        placeholder: "us",
        required: true,
      },
      {
        key: "projectId",
        label: "Project ID",
        placeholder: "12345",
        required: true,
      },
    ],
    toolFactory: (_connId, apiKeys, _providerConfigKey) => {
      // Nango stores subdomain as full URL (e.g. "https://us.i.posthog.com") in connection_config
      const subdomain = apiKeys?.subdomain ?? "";
      const host = subdomain.startsWith("http")
        ? subdomain
        : subdomain
          ? `https://${subdomain}.posthog.com`
          : undefined;
      return createPostHogTools({
        apiKey: apiKeys!.apiKey,
        projectId: apiKeys?.projectId ?? "",
        host,
      });
    },
    capabilities: POSTHOG_CAPABILITIES,
    enabled: true,
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getConnectorById(
  id: string,
): ConnectorDefinition | undefined {
  return CONNECTORS.find((c) => c.id === id && c.enabled);
}

/** Strict pattern for per-client Shopify app keys: shopify-{slug}-{6-char-random} */
export const SHOPIFY_PER_CLIENT_KEY_PATTERN = /^shopify-[a-z0-9]+-[a-z0-9]{6}$/;

export function getConnectorByProviderKey(
  key: string,
): ConnectorDefinition | undefined {
  const direct = CONNECTORS.find((c) => c.providerConfigKey === key && c.enabled);
  if (direct) return direct;
  if (SHOPIFY_PER_CLIENT_KEY_PATTERN.test(key)) {
    return CONNECTORS.find((c) => c.id === "shopify" && c.enabled);
  }
  return undefined;
}

export function getEnabledConnectors(): readonly ConnectorDefinition[] {
  return CONNECTORS.filter((c) => c.enabled);
}
