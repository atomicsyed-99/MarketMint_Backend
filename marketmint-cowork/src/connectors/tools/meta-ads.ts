import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { nangoProxy } from "@/connectors/nango/proxy";
import { sanitizeResourceId } from "./helpers";

const PROVIDER_CONFIG_KEY = "meta-marketing-api";
const API_VERSION = "v25.0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMetaAdsTools(
  connectionId: string,
): Record<string, any> {
  // ---------------------------------------------------------------------------
  // List Ad Accounts
  // ---------------------------------------------------------------------------
  const meta_ads_list_ad_accounts = createTool({
    id: "meta-ads-list-ad-accounts",
    description:
      "List Meta (Facebook) Ad accounts accessible by the connected user.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/me/adaccounts`, {
          params: { fields: "id,name,account_status,currency,balance" },
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Get Account Insights
  // ---------------------------------------------------------------------------
  const meta_ads_get_account_insights = createTool({
    id: "meta-ads-get-account-insights",
    description:
      "Get account-level performance insights across all campaigns.",
    inputSchema: z.object({
      ad_account_id: z.string().describe('Ad account ID (e.g., "act_123456")'),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      time_increment: z.enum(['1', '7', '14', '28', 'monthly', 'all_days']).optional().describe('Time granularity for daily/weekly/monthly breakdown. Use "1" for daily.'),
    }),
    execute: async (input) => {
      try {
        const params: Record<string, string> = {
          fields:
            "impressions,clicks,spend,cpc,cpm,ctr,actions,action_values,purchase_roas,reach,frequency",
          time_range: JSON.stringify({ since: input.start_date, until: input.end_date }),
        };
        if (input.time_increment) params.time_increment = input.time_increment;
        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.ad_account_id)}/insights`, {
          params,
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // List Campaigns
  // ---------------------------------------------------------------------------
  const meta_ads_list_campaigns = createTool({
    id: "meta-ads-list-campaigns",
    description:
      "List campaigns for a Meta Ads account with performance insights.",
    inputSchema: z.object({
      ad_account_id: z.string().describe('Ad account ID (e.g., "act_123456")'),
      status: z
        .enum(["ACTIVE", "PAUSED", "ARCHIVED"])
        .optional()
        .describe("Filter by status"),
    }),
    execute: async (input) => {
      try {
        const params: Record<string, string> = {
          fields: "id,name,status,objective,daily_budget,lifetime_budget",
        };
        if (input.status) params.effective_status = `["${input.status}"]`;

        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.ad_account_id)}/campaigns`, {
          params,
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // List Ad Sets
  // ---------------------------------------------------------------------------
  const meta_ads_list_ad_sets = createTool({
    id: "meta-ads-list-ad-sets",
    description: "List ad sets within a campaign.",
    inputSchema: z.object({
      campaign_id: z.string().describe("Campaign ID"),
    }),
    execute: async (input) => {
      try {
        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.campaign_id)}/adsets`, {
          params: {
            fields:
              "id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal",
          },
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Get Campaign Insights
  // ---------------------------------------------------------------------------
  const meta_ads_get_campaign_insights = createTool({
    id: "meta-ads-get-campaign-insights",
    description:
      "Get performance insights (impressions, clicks, spend, conversions) for a Meta campaign.",
    inputSchema: z.object({
      campaign_id: z.string().describe("Campaign ID"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      time_increment: z.enum(['1', '7', '14', '28', 'monthly', 'all_days']).optional().describe('Time granularity for daily/weekly/monthly breakdown. Use "1" for daily.'),
    }),
    execute: async (input) => {
      try {
        const params: Record<string, string> = {
          fields:
            "impressions,clicks,spend,cpc,cpm,ctr,actions,action_values,purchase_roas,reach,frequency",
          time_range: JSON.stringify({ since: input.start_date, until: input.end_date }),
        };
        if (input.time_increment) params.time_increment = input.time_increment;
        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.campaign_id)}/insights`, {
          params,
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Update Campaign
  // ---------------------------------------------------------------------------
  const meta_ads_update_campaign = createTool({
    id: "meta-ads-update-campaign",
    description:
      "Update a Meta Ads campaign (pause, enable, change budget).",
    inputSchema: z.object({
      campaign_id: z.string().describe("Campaign ID to update"),
      status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("New status"),
      daily_budget: z
        .string()
        .optional()
        .describe('New daily budget in cents (e.g., "5000" for $50)'),
    }),
    execute: async (input) => {
      try {
        const { campaign_id, ...updates } = input;
        return await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "POST", `/${API_VERSION}/${sanitizeResourceId(campaign_id)}`, {
          body: updates,
        });
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Get Campaign Insights Breakdown
  // ---------------------------------------------------------------------------
  const meta_ads_get_campaign_insights_breakdown = createTool({
    id: "meta-ads-get-campaign-insights-breakdown",
    description:
      "Get campaign insights broken down by age, gender, placement, or device.",
    inputSchema: z.object({
      campaign_id: z.string().describe("Campaign ID"),
      date_preset: z
        .enum(["today", "yesterday", "last_7d", "last_14d", "last_30d", "last_90d"])
        .optional()
        .default("last_30d")
        .describe("Date preset for the report"),
      breakdowns: z
        .enum([
          "age",
          "gender",
          "publisher_platform",
          "device_platform",
          "platform_position",
          "country",
        ])
        .describe("Breakdown dimension"),
      time_increment: z.enum(['1', '7', '14', '28', 'monthly', 'all_days']).optional().describe('Time granularity for daily/weekly/monthly breakdown. Use "1" for daily.'),
    }),
    execute: async (input) => {
      try {
        const params: Record<string, string> = {
          date_preset: input.date_preset,
          breakdowns: input.breakdowns,
          fields:
            "impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values,purchase_roas",
        };
        if (input.time_increment) params.time_increment = input.time_increment;
        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.campaign_id)}/insights`, {
          params,
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // List Ads
  // ---------------------------------------------------------------------------
  const meta_ads_list_ads = createTool({
    id: "meta-ads-list-ads",
    description: "List individual ads within an ad set.",
    inputSchema: z.object({
      ad_set_id: z.string().describe("Ad Set ID"),
      limit: z.number().optional().default(25).describe("Number of ads to return"),
    }),
    execute: async (input) => {
      try {
        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.ad_set_id)}/ads`, {
          params: {
            fields:
              "id,name,status,creative{id,name,thumbnail_url,body,title,link_url}",
            limit: String(input.limit),
          },
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Get Ad Insights
  // ---------------------------------------------------------------------------
  const meta_ads_get_ad_insights = createTool({
    id: "meta-ads-get-ad-insights",
    description: "Get performance insights for a specific ad.",
    inputSchema: z.object({
      ad_id: z.string().describe("Ad ID"),
      date_preset: z
        .enum(["today", "yesterday", "last_7d", "last_14d", "last_30d", "last_90d"])
        .optional()
        .default("last_30d")
        .describe("Date preset for the report"),
      time_increment: z.enum(['1', '7', '14', '28', 'monthly', 'all_days']).optional().describe('Time granularity for daily/weekly/monthly breakdown. Use "1" for daily.'),
    }),
    execute: async (input) => {
      try {
        const params: Record<string, string> = {
          date_preset: input.date_preset,
          fields:
            "impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values,purchase_roas,cost_per_action_type",
        };
        if (input.time_increment) params.time_increment = input.time_increment;
        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.ad_id)}/insights`, {
          params,
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Update Ad Set
  // ---------------------------------------------------------------------------
  const meta_ads_update_ad_set = createTool({
    id: "meta-ads-update-ad-set",
    description:
      "Update an ad set (pause, enable, change budget).",
    inputSchema: z.object({
      ad_set_id: z.string().describe("Ad Set ID to update"),
      status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("New status"),
      daily_budget: z
        .string()
        .optional()
        .describe('New daily budget in cents (e.g., "5000" for $50)'),
      name: z.string().optional().describe("New name for the ad set"),
    }),
    execute: async (input) => {
      try {
        const { ad_set_id, ...updates } = input;
        return await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "POST", `/${API_VERSION}/${sanitizeResourceId(ad_set_id)}`, {
          body: updates,
        });
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Get Ad Creatives
  // ---------------------------------------------------------------------------
  const meta_ads_get_ad_creatives = createTool({
    id: "meta-ads-get-ad-creatives",
    description: "List ad creatives for an ad account.",
    inputSchema: z.object({
      ad_account_id: z
        .string()
        .describe('Ad account ID (numeric, without "act_" prefix)'),
      limit: z
        .number()
        .optional()
        .default(25)
        .describe("Number of creatives to return"),
    }),
    execute: async (input) => {
      const accountId = input.ad_account_id.startsWith("act_")
        ? input.ad_account_id
        : `act_${input.ad_account_id}`;

      try {
        const data = await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(accountId)}/adcreatives`, {
          params: {
            fields:
              "id,name,body,title,link_url,image_url,thumbnail_url,status",
            limit: String(input.limit),
          },
        });
        return data;
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Create Campaign
  // ---------------------------------------------------------------------------
  const meta_ads_create_campaign = createTool({
    id: "meta-ads-create-campaign",
    description:
      "Create a new campaign.",
    inputSchema: z.object({
      ad_account_id: z.string().describe('Ad account ID (e.g., "act_123456")'),
      name: z.string().describe("Campaign name"),
      objective: z
        .enum([
          "OUTCOME_AWARENESS",
          "OUTCOME_ENGAGEMENT",
          "OUTCOME_LEADS",
          "OUTCOME_SALES",
          "OUTCOME_TRAFFIC",
          "OUTCOME_APP_PROMOTION",
        ])
        .describe("Campaign objective"),
      status: z
        .enum(["ACTIVE", "PAUSED"])
        .optional()
        .default("PAUSED")
        .describe("Initial status"),
      daily_budget: z
        .string()
        .optional()
        .describe('Daily budget in cents (e.g., "5000" for $50)'),
      special_ad_categories: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Special ad categories if applicable"),
    }),
    execute: async (input) => {
      try {
        const body: Record<string, unknown> = {
          name: input.name,
          objective: input.objective,
          status: input.status,
          special_ad_categories: input.special_ad_categories,
        };
        if (input.daily_budget) body.daily_budget = input.daily_budget;

        return await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "POST", `/${API_VERSION}/${sanitizeResourceId(input.ad_account_id)}/campaigns`, {
          body,
        });
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Create Ad Set
  // ---------------------------------------------------------------------------
  const meta_ads_create_ad_set = createTool({
    id: "meta-ads-create-ad-set",
    description:
      "Create a new ad set within a campaign.",
    inputSchema: z.object({
      ad_account_id: z.string().describe('Ad account ID (e.g., "act_123456")'),
      campaign_id: z.string().describe("Parent campaign ID"),
      name: z.string().describe("Ad set name"),
      daily_budget: z
        .string()
        .describe('Daily budget in cents (e.g., "5000" for $50)'),
      optimization_goal: z
        .enum([
          "IMPRESSIONS",
          "REACH",
          "LINK_CLICKS",
          "LANDING_PAGE_VIEWS",
          "OFFSITE_CONVERSIONS",
          "VALUE",
          "LEAD_GENERATION",
        ])
        .describe("Optimization goal"),
      billing_event: z
        .enum(["IMPRESSIONS", "LINK_CLICKS"])
        .optional()
        .default("IMPRESSIONS"),
      bid_strategy: z
        .enum([
          "LOWEST_COST_WITHOUT_CAP",
          "LOWEST_COST_WITH_BID_CAP",
          "COST_CAP",
        ])
        .optional()
        .default("LOWEST_COST_WITHOUT_CAP"),
      status: z.enum(["ACTIVE", "PAUSED"]).optional().default("PAUSED"),
      start_time: z.string().optional().describe("Start time ISO 8601"),
      end_time: z.string().optional().describe("End time ISO 8601"),
    }),
    execute: async (input) => {
      try {
        const body: Record<string, unknown> = {
          campaign_id: input.campaign_id,
          name: input.name,
          daily_budget: input.daily_budget,
          optimization_goal: input.optimization_goal,
          billing_event: input.billing_event,
          bid_strategy: input.bid_strategy,
          status: input.status,
        };
        if (input.start_time) body.start_time = input.start_time;
        if (input.end_time) body.end_time = input.end_time;

        return await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "POST", `/${API_VERSION}/${sanitizeResourceId(input.ad_account_id)}/adsets`, {
          body,
        });
      } catch (error) {
        throw error;
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Get Ad Set Insights
  // ---------------------------------------------------------------------------
  const meta_ads_get_ad_set_insights = createTool({
    id: "meta-ads-get-ad-set-insights",
    description:
      "Get performance insights for a specific ad set including CPA, targeting effectiveness.",
    inputSchema: z.object({
      ad_set_id: z.string().describe("Ad Set ID"),
      date_preset: z
        .enum(["today", "yesterday", "last_7d", "last_14d", "last_30d", "last_90d"])
        .optional()
        .default("last_30d"),
      time_increment: z.enum(['1', '7', '14', '28', 'monthly', 'all_days']).optional().describe('Time granularity for daily/weekly/monthly breakdown. Use "1" for daily.'),
    }),
    execute: async (input: { ad_set_id: string; date_preset: string; time_increment?: string }) => {
      const params: Record<string, string> = {
        date_preset: input.date_preset,
        fields:
          "impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values,purchase_roas,cost_per_action_type",
      };
      if (input.time_increment) params.time_increment = input.time_increment;
      return await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.ad_set_id)}/insights`, {
        params,
      });
    },
  });

  // ---------------------------------------------------------------------------
  // Get Insights by Level (bulk)
  // ---------------------------------------------------------------------------
  const meta_ads_get_insights_by_level = createTool({
    id: "meta-ads-get-insights-by-level",
    description:
      "Get performance insights for an ad account broken down by campaign, ad set, or ad level. Returns all entities in a single call — use this instead of fetching insights one-by-one.",
    inputSchema: z.object({
      ad_account_id: z.string().describe('Ad account ID (e.g., "act_123456")'),
      level: z.enum(["campaign", "adset", "ad"]).describe("Breakdown level"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      time_increment: z.enum(['1', '7', '14', '28', 'monthly', 'all_days']).optional().describe('Time granularity for daily/weekly/monthly breakdown. Use "1" for daily.'),
      limit: z.number().optional().default(100),
    }),
    execute: async (input: { ad_account_id: string; level: string; start_date: string; end_date: string; time_increment?: string; limit: number }) => {
      const params: Record<string, string> = {
        level: input.level,
        time_range: JSON.stringify({ since: input.start_date, until: input.end_date }),
        fields:
          "impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values,purchase_roas,cost_per_action_type",
        limit: String(input.limit),
      };
      if (input.time_increment) params.time_increment = input.time_increment;
      return await nangoProxy(PROVIDER_CONFIG_KEY, connectionId, "GET", `/${API_VERSION}/${sanitizeResourceId(input.ad_account_id)}/insights`, {
        params,
      });
    },
  });

  // ---------------------------------------------------------------------------
  // Return all tools as a Record
  // ---------------------------------------------------------------------------
  return {
    meta_ads_list_ad_accounts,
    meta_ads_get_account_insights,
    meta_ads_list_campaigns,
    meta_ads_list_ad_sets,
    meta_ads_get_campaign_insights,
    meta_ads_update_campaign,
    meta_ads_get_campaign_insights_breakdown,
    meta_ads_list_ads,
    meta_ads_get_ad_insights,
    meta_ads_get_ad_set_insights,
    meta_ads_get_insights_by_level,
    meta_ads_update_ad_set,
    meta_ads_get_ad_creatives,
    meta_ads_create_campaign,
    meta_ads_create_ad_set,
  };
}
