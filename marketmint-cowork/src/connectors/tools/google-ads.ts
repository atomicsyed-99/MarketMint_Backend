import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("google-ads");

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

/** Cached after first call so env lookup + object allocation happen only once. */
let _cachedHeaders: Record<string, string> | null = null;
function getGoogleAdsHeaders(): Record<string, string> {
  if (!_cachedHeaders) {
    const token = env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
    if (!token) {
      log.warn("GOOGLE_ADS_DEVELOPER_TOKEN not set — Google Ads API calls will fail");
    }
    _cachedHeaders = { "developer-token": token };
  }
  return _cachedHeaders;
}

/** Strip everything except digits to prevent GAQL injection. */
function sanitizeId(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** Validate YYYY-MM-DD format; throws on mismatch. */
function sanitizeDate(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) throw new Error(`Invalid date format: ${value}. Expected YYYY-MM-DD`);
  return value;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createGoogleAdsTools(
  connectionId: string,
) {
  // ── List accessible customers ──────────────────────────────────────────

  const google_ads_list_customers = createTool({
    id: "google-ads-list-customers",
    description: "List accessible Google Ads customer/account IDs.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "GET",
          "/v23/customers:listAccessibleCustomers",
          { headers: getGoogleAdsHeaders() },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── List campaigns ─────────────────────────────────────────────────────

  const google_ads_list_campaigns = createTool({
    id: "google-ads-list-campaigns",
    description: "List campaigns for a Google Ads customer account with performance metrics.",
    inputSchema: z.object({
      customer_id: z.string().describe('Google Ads customer ID (no dashes, e.g., "1234567890")'),
      campaign_type: z.enum(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX", "SMART"]).optional().describe("Filter by campaign type"),
    }),
    execute: async (input) => {
      try {
        const whereClause = input.campaign_type
          ? `WHERE campaign.advertising_channel_type = '${input.campaign_type}'`
          : "";
        const query = `
          SELECT campaign.id, campaign.name, campaign.status,
                 campaign.advertising_channel_type,
                 campaign_budget.amount_micros,
                 metrics.impressions, metrics.clicks, metrics.cost_micros,
                 metrics.conversions, metrics.conversions_value
          FROM campaign
          ${whereClause}
          ORDER BY campaign.name
        `;
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/googleAds:searchStream`,
          { body: { query }, headers: getGoogleAdsHeaders() },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── Get ad groups ──────────────────────────────────────────────────────

  const google_ads_get_ad_groups = createTool({
    id: "google-ads-get-ad-groups",
    description: "List ad groups for a campaign with performance metrics.",
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
      campaign_id: z.string().describe("Campaign ID to filter by"),
    }),
    execute: async (input) => {
      try {
        const query = `
          SELECT ad_group.id, ad_group.name, ad_group.status,
                 metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
          FROM ad_group
          WHERE campaign.id = ${sanitizeId(input.campaign_id)}
          ORDER BY ad_group.name
        `;
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/googleAds:searchStream`,
          { body: { query }, headers: getGoogleAdsHeaders() },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── Run custom GAQL query ──────────────────────────────────────────────

  const google_ads_run_query = createTool({
    id: "google-ads-run-query",
    description:
      'Run a custom GAQL (Google Ads Query Language) query against a customer account.',
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
      query: z.string().describe(
        'GAQL query string (e.g., "SELECT campaign.name, metrics.clicks FROM campaign WHERE metrics.clicks > 100")',
      ),
    }),
    execute: async (input) => {
      // Only allow read-only SELECT queries to prevent mutation via arbitrary GAQL
      const trimmed = input.query.trim();
      if (!/^SELECT\s/i.test(trimmed)) {
        return { error: "Only SELECT queries are allowed. Mutations must use dedicated tools." };
      }

      try {
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/googleAds:searchStream`,
          { body: { query: trimmed }, headers: getGoogleAdsHeaders() },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── Update campaign ────────────────────────────────────────────────────

  const google_ads_update_campaign = createTool({
    id: "google-ads-update-campaign",
    description:
      "Update a Google Ads campaign (e.g., pause/enable).",
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
      campaign_id: z.string().describe('Campaign resource name (e.g., "customers/123/campaigns/456")'),
      status: z.enum(["ENABLED", "PAUSED"]).optional().describe("New campaign status"),
    }),
    execute: async (input) => {
      try {
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/campaigns:mutate`,
          {
            body: {
              operations: [
                {
                  update: { resourceName: input.campaign_id, status: input.status },
                  updateMask: "status",
                },
              ],
            },
            headers: getGoogleAdsHeaders(),
          },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── Update budget ──────────────────────────────────────────────────────

  const google_ads_update_budget = createTool({
    id: "google-ads-update-budget",
    description:
      "Update a campaign budget.",
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
      budget_resource_name: z.string().describe('Budget resource name (e.g., "customers/123/campaignBudgets/456")'),
      amount_micros: z.string().describe('New budget amount in micros (e.g., "50000000" for $50)'),
    }),
    execute: async (input) => {
      try {
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/campaignBudgets:mutate`,
          {
            body: {
              operations: [
                {
                  update: {
                    resourceName: input.budget_resource_name,
                    amountMicros: input.amount_micros,
                  },
                  updateMask: "amount_micros",
                },
              ],
            },
            headers: getGoogleAdsHeaders(),
          },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── List keywords ──────────────────────────────────────────────────────

  const google_ads_list_keywords = createTool({
    id: "google-ads-list-keywords",
    description: "List keywords in an ad group with performance metrics.",
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
      ad_group_id: z.string().describe("Ad group ID to list keywords for"),
      limit: z.number().optional().default(50).describe("Max number of results to return"),
      start_date: z.string().optional().describe("Start date YYYY-MM-DD for metrics"),
      end_date: z.string().optional().describe("End date YYYY-MM-DD for metrics"),
    }),
    execute: async (input) => {
      try {
        const hasDateRange = input.start_date && input.end_date;
        const selectFields = [
          "ad_group_criterion.keyword.text",
          "ad_group_criterion.keyword.match_type",
          "ad_group_criterion.status",
          "ad_group_criterion.quality_info.quality_score",
          "metrics.impressions",
          "metrics.clicks",
          "metrics.cost_micros",
          "metrics.ctr",
          "metrics.average_cpc",
          "metrics.conversions",
          "metrics.conversions_value",
          ...(hasDateRange ? ["segments.date"] : []),
        ].join(", ");
        const whereClause = `WHERE ad_group.id = ${sanitizeId(input.ad_group_id)}${hasDateRange ? ` AND segments.date BETWEEN '${sanitizeDate(input.start_date!)}' AND '${sanitizeDate(input.end_date!)}'` : ""}`;
        const query = `
          SELECT ${selectFields}
          FROM keyword_view
          ${whereClause}
          ORDER BY metrics.impressions DESC
          LIMIT ${input.limit}
        `;
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/googleAds:searchStream`,
          { body: { query }, headers: getGoogleAdsHeaders() },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── Search terms report ────────────────────────────────────────────────

  const google_ads_get_search_terms_report = createTool({
    id: "google-ads-get-search-terms-report",
    description: "Get search terms that triggered ads.",
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
      campaign_id: z.string().optional().describe("Campaign ID to filter by"),
      limit: z.number().optional().default(50).describe("Max number of results to return"),
      start_date: z.string().optional().describe("Start date YYYY-MM-DD for metrics"),
      end_date: z.string().optional().describe("End date YYYY-MM-DD for metrics"),
    }),
    execute: async (input) => {
      try {
        const hasDateRange = input.start_date && input.end_date;
        const dateFilter = hasDateRange
          ? `segments.date BETWEEN '${sanitizeDate(input.start_date!)}' AND '${sanitizeDate(input.end_date!)}'`
          : "segments.date DURING LAST_30_DAYS";
        const query = `
          SELECT search_term_view.search_term, segments.keyword.info.text,
                 metrics.impressions, metrics.clicks, metrics.cost_micros,
                 metrics.ctr, metrics.conversions
          FROM search_term_view
          WHERE ${dateFilter} ${input.campaign_id ? `AND campaign.id = ${sanitizeId(input.campaign_id)}` : ""}
          ORDER BY metrics.impressions DESC
          LIMIT ${input.limit}
        `;
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/googleAds:searchStream`,
          { body: { query }, headers: getGoogleAdsHeaders() },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── Performance by date ────────────────────────────────────────────────

  const google_ads_get_performance_by_date = createTool({
    id: "google-ads-get-performance-by-date",
    description: "Get daily campaign performance for a date range.",
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
      campaign_id: z.string().optional().describe("Campaign ID to filter by"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
    }),
    execute: async (input) => {
      try {
        const query = `
          SELECT segments.date, segments.device, segments.ad_network_type,
                 campaign.name, metrics.impressions, metrics.clicks,
                 metrics.cost_micros, metrics.ctr, metrics.conversions,
                 metrics.conversions_value, metrics.average_cpc
          FROM campaign
          WHERE segments.date BETWEEN '${sanitizeDate(input.start_date)}' AND '${sanitizeDate(input.end_date)}' ${input.campaign_id ? `AND campaign.id = ${sanitizeId(input.campaign_id)}` : ""}
          ORDER BY segments.date DESC
        `;
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/googleAds:searchStream`,
          { body: { query }, headers: getGoogleAdsHeaders() },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── List conversions ───────────────────────────────────────────────────

  const google_ads_list_conversions = createTool({
    id: "google-ads-list-conversions",
    description: "List conversion actions configured in the account.",
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
    }),
    execute: async (input) => {
      try {
        const query = `
          SELECT conversion_action.name, conversion_action.type, conversion_action.status,
                 conversion_action.category, metrics.conversions, metrics.conversions_value
          FROM conversion_action
          ORDER BY metrics.conversions DESC
        `;
        const result = await nangoProxy(
          "google-ads",
          connectionId,
          "POST",
          `/v23/customers/${sanitizeId(input.customer_id)}/googleAds:searchStream`,
          { body: { query }, headers: getGoogleAdsHeaders() },
        );

        return result;
      } catch (error) {
        throw error;
      }
    },
  });

  // ── Shopping performance ─────────────────────────────────────────────

  const google_ads_get_shopping_performance = createTool({
    id: "google-ads-get-shopping-performance",
    description:
      "Get Shopping campaign product-level performance — shows which products have the best ROAS, clicks, conversions.",
    inputSchema: z.object({
      customer_id: z.string().describe("Google Ads customer ID"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      limit: z.number().optional().default(50),
    }),
    execute: async (input: { customer_id: string; start_date: string; end_date: string; limit: number }) => {
      const query = `
        SELECT segments.product_title, segments.product_item_id, segments.product_brand,
               metrics.clicks, metrics.impressions, metrics.cost_micros,
               metrics.conversions, metrics.conversions_value
        FROM shopping_performance_view
        WHERE segments.date BETWEEN '${sanitizeDate(input.start_date)}' AND '${sanitizeDate(input.end_date)}'
        ORDER BY metrics.conversions_value DESC
        LIMIT ${input.limit}
      `;
      return nangoProxy(
        "google-ads",
        connectionId,
        "POST",
        `/v23/customers/${sanitizeId(input.customer_id)}/googleAds:searchStream`,
        { body: { query }, headers: getGoogleAdsHeaders() },
      );
    },
  });

  // ── Return all tools ───────────────────────────────────────────────────

  return {
    google_ads_list_customers,
    google_ads_list_campaigns,
    google_ads_get_ad_groups,
    google_ads_run_query,
    google_ads_update_campaign,
    google_ads_update_budget,
    google_ads_list_keywords,
    google_ads_get_search_terms_report,
    google_ads_get_performance_by_date,
    google_ads_list_conversions,
    google_ads_get_shopping_performance,
  };
}
