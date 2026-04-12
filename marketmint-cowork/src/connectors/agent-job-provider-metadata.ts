/**
 * Lightweight connector id ↔ Nango provider key mapping for scheduled-job validation.
 * Keeps Mastra tool bundles from importing `registry.ts` (which pulls all connector tool factories).
 * When adding a connector in `registry.ts`, add a row here too.
 */
export const AGENT_JOB_CONNECTOR_ENTRIES = [
    { id: "shopify", nangoKey: "shopify", name: "Shopify" },
    { id: "meta-ads", nangoKey: "meta-marketing-api", name: "Meta Ads" },
    { id: "google-ads", nangoKey: "google-ads", name: "Google Ads" },
    { id: "google-analytics", nangoKey: "google-analytics", name: "Google Analytics" },
    { id: "google-sheets", nangoKey: "google-sheet", name: "Google Sheets" },
    { id: "klaviyo", nangoKey: "klaviyo", name: "Klaviyo" },
    { id: "slack", nangoKey: "slack", name: "Slack" },
    { id: "posthog", nangoKey: "posthog", name: "PostHog" },
  ] as const;