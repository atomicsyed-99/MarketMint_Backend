import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { nangoProxy } from "@/connectors/nango/proxy";

const PROVIDER = "google-analytics";
const ADMIN_API = "https://analyticsadmin.googleapis.com";
const DATA_API = "https://analyticsdata.googleapis.com";

/** Strip the "properties/" prefix so we get a bare numeric ID. */
function propertyNum(id: string): string {
  return id.replace("properties/", "");
}

export function createGoogleAnalyticsTools(connectionId: string) {
  return {
    ga_list_properties: createTool({
      id: "ga-list-properties",
      description:
        "List all Google Analytics 4 properties accessible by the connected account.",
      inputSchema: z.object({}),
      execute: async () => {
        return nangoProxy(PROVIDER, connectionId, "GET", "/v1beta/accountSummaries", {
          baseUrlOverride: ADMIN_API,
        });
      },
    }),

    ga_run_report: createTool({
      id: "ga-run-report",
      description:
        "Run a report on a GA4 property. Returns metrics like sessions, pageviews, users for a date range.",
      inputSchema: z.object({
        property_id: z.string().describe('GA4 property ID (e.g., "properties/123456")'),
        start_date: z.string().describe("Start date in YYYY-MM-DD format"),
        end_date: z.string().describe("End date in YYYY-MM-DD format"),
        metrics: z
          .array(z.string())
          .describe(
            'Metrics to retrieve (e.g., ["sessions", "totalUsers", "screenPageViews", "bounceRate", "averageSessionDuration"])',
          ),
        dimensions: z
          .array(z.string())
          .optional()
          .describe(
            'Dimensions to group by (e.g., ["date", "country", "pagePath", "sessionDefaultChannelGroup"])',
          ),
        limit: z.number().optional().describe("Max rows to return"),
        dimension_filter: z
          .any()
          .optional()
          .describe(
            'GA4 dimension filter object. Example: {"filter":{"fieldName":"landingPage","stringFilter":{"matchType":"CONTAINS","value":"/collections/"}}}',
          ),
        order_bys: z
          .array(z.any())
          .optional()
          .describe(
            'Array of GA4 orderBy objects. Example: [{"metric":{"metricName":"sessions"},"desc":true}]',
          ),
      }),
      execute: async (input) => {
        const pNum = propertyNum(input.property_id);
        return nangoProxy(PROVIDER, connectionId, "POST", `/v1beta/properties/${pNum}:runReport`, {
          baseUrlOverride: DATA_API,
          body: {
            dateRanges: [{ startDate: input.start_date, endDate: input.end_date }],
            metrics: input.metrics.map((m) => ({ name: m })),
            dimensions: input.dimensions?.map((d) => ({ name: d })),
            limit: input.limit || 10000,
            ...(input.dimension_filter ? { dimensionFilter: input.dimension_filter } : {}),
            ...(input.order_bys ? { orderBys: input.order_bys } : {}),
          },
        });
      },
    }),

    ga_get_realtime: createTool({
      id: "ga-get-realtime",
      description: "Get realtime active users and events for a GA4 property.",
      inputSchema: z.object({
        property_id: z.string().describe('GA4 property ID (e.g., "properties/123456")'),
        metrics: z
          .array(z.string())
          .optional()
          .default(["activeUsers"])
          .describe('Realtime metrics (e.g., ["activeUsers", "screenPageViews"])'),
        dimensions: z
          .array(z.string())
          .optional()
          .describe('Realtime dimensions (e.g., ["country", "unifiedScreenName"])'),
      }),
      execute: async (input) => {
        const pNum = propertyNum(input.property_id);
        return nangoProxy(PROVIDER, connectionId, "POST", `/v1beta/properties/${pNum}:runRealtimeReport`, {
          baseUrlOverride: DATA_API,
          body: {
            metrics: input.metrics.map((m) => ({ name: m })),
            dimensions: input.dimensions?.map((d) => ({ name: d })),
          },
        });
      },
    }),

    ga_get_top_pages: createTool({
      id: "ga-get-top-pages",
      description:
        "Get top pages by pageviews for a date range. Convenience wrapper around runReport.",
      inputSchema: z.object({
        property_id: z.string().describe("GA4 property ID"),
        start_date: z.string().describe("Start date YYYY-MM-DD"),
        end_date: z.string().describe("End date YYYY-MM-DD"),
        limit: z.number().optional().default(20).describe("Number of top pages to return"),
      }),
      execute: async (input) => {
        const pNum = propertyNum(input.property_id);
        return nangoProxy(PROVIDER, connectionId, "POST", `/v1beta/properties/${pNum}:runReport`, {
          baseUrlOverride: DATA_API,
          body: {
            dateRanges: [{ startDate: input.start_date, endDate: input.end_date }],
            metrics: [
              { name: "screenPageViews" },
              { name: "totalUsers" },
              { name: "averageSessionDuration" },
            ],
            dimensions: [{ name: "pagePath" }],
            orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
            limit: input.limit,
          },
        });
      },
    }),

    ga_get_traffic_sources: createTool({
      id: "ga-get-traffic-sources",
      description:
        "Get traffic sources breakdown (channels, sources, mediums) for a date range.",
      inputSchema: z.object({
        property_id: z.string().describe("GA4 property ID"),
        start_date: z.string().describe("Start date YYYY-MM-DD"),
        end_date: z.string().describe("End date YYYY-MM-DD"),
      }),
      execute: async (input) => {
        const pNum = propertyNum(input.property_id);
        return nangoProxy(PROVIDER, connectionId, "POST", `/v1beta/properties/${pNum}:runReport`, {
          baseUrlOverride: DATA_API,
          body: {
            dateRanges: [{ startDate: input.start_date, endDate: input.end_date }],
            metrics: [
              { name: "sessions" },
              { name: "totalUsers" },
              { name: "bounceRate" },
              { name: "averageSessionDuration" },
              { name: "ecommercePurchases" },
              { name: "purchaseRevenue" },
            ],
            dimensions: [{ name: "sessionDefaultChannelGroup" }],
            orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          },
        });
      },
    }),

    ga_get_user_demographics: createTool({
      id: "ga-get-user-demographics",
      description:
        "Get user demographics (country, city, device, browser) for a date range.",
      inputSchema: z.object({
        property_id: z.string().describe("GA4 property ID"),
        start_date: z.string().describe("Start date YYYY-MM-DD"),
        end_date: z.string().describe("End date YYYY-MM-DD"),
        dimension: z
          .enum(["country", "city", "deviceCategory", "browser", "operatingSystem"])
          .describe("Demographic dimension to break down by"),
      }),
      execute: async (input) => {
        const pNum = propertyNum(input.property_id);
        return nangoProxy(PROVIDER, connectionId, "POST", `/v1beta/properties/${pNum}:runReport`, {
          baseUrlOverride: DATA_API,
          body: {
            dateRanges: [{ startDate: input.start_date, endDate: input.end_date }],
            metrics: [{ name: "totalUsers" }, { name: "sessions" }],
            dimensions: [{ name: input.dimension }],
            orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
            limit: 20,
          },
        });
      },
    }),
  };
}
