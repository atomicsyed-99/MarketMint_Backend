import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const KLAVIYO_BASE_URL = "https://a.klaviyo.com/api";
const KLAVIYO_API_REVISION = "2025-04-15";

function makeRequest(apiKey: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${KLAVIYO_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        "Content-Type": "application/json",
        revision: KLAVIYO_API_REVISION,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Klaviyo API error ${res.status}: ${text}`);
    }
    return res.json();
  };
}

export function createKlaviyoTools(
  config: { apiKey: string },
) {
  const request = makeRequest(config.apiKey);

  return {
    klaviyo_list_campaigns: createTool({
      id: "klaviyo-list-campaigns",
      description: "List email/SMS campaigns from Klaviyo.",
      inputSchema: z.object({
        channel: z
          .enum(["email", "sms"])
          .optional()
          .describe("Filter by channel type"),
      }),
      execute: async (input) => {
        const params = new URLSearchParams();
        if (input.channel) {
          params.set("filter", `equals(messages.channel,'${input.channel}')`);
        }
        return request("GET", `/campaigns/?${params.toString()}`);
      },
    }),

    klaviyo_get_campaign: createTool({
      id: "klaviyo-get-campaign",
      description: "Get details of a specific Klaviyo campaign.",
      inputSchema: z.object({
        campaign_id: z.string().describe("Campaign ID"),
      }),
      execute: async (input) => {
        return request("GET", `/campaigns/${input.campaign_id}/`);
      },
    }),

    klaviyo_list_flows: createTool({
      id: "klaviyo-list-flows",
      description:
        "List automation flows from Klaviyo (e.g., welcome series, abandoned cart).",
      inputSchema: z.object({}),
      execute: async () => {
        return request("GET", "/flows/");
      },
    }),

    klaviyo_get_flow: createTool({
      id: "klaviyo-get-flow",
      description: "Get details of a specific automation flow.",
      inputSchema: z.object({
        flow_id: z.string().describe("Flow ID"),
      }),
      execute: async (input) => {
        return request("GET", `/flows/${input.flow_id}/`);
      },
    }),

    klaviyo_list_lists: createTool({
      id: "klaviyo-list-lists",
      description: "List all subscriber lists in Klaviyo.",
      inputSchema: z.object({}),
      execute: async () => {
        return request("GET", "/lists/");
      },
    }),

    klaviyo_get_list_profiles: createTool({
      id: "klaviyo-get-list-profiles",
      description: "Get profiles (subscribers) in a specific list.",
      inputSchema: z.object({
        list_id: z.string().describe("List ID"),
      }),
      execute: async (input) => {
        return request("GET", `/lists/${input.list_id}/profiles/`);
      },
    }),

    klaviyo_list_segments: createTool({
      id: "klaviyo-list-segments",
      description: "List all segments in Klaviyo.",
      inputSchema: z.object({}),
      execute: async () => {
        return request("GET", "/segments/");
      },
    }),

    klaviyo_search_profiles: createTool({
      id: "klaviyo-search-profiles",
      description:
        "Search for a profile (subscriber/customer) in Klaviyo by email.",
      inputSchema: z.object({
        email: z.string().email().describe("Email address to search for"),
      }),
      execute: async (input) => {
        return request(
          "GET",
          `/profiles/?filter=equals(email,"${encodeURIComponent(input.email)}")`,
        );
      },
    }),

    klaviyo_get_metrics: createTool({
      id: "klaviyo-get-metrics",
      description: "List available metrics (events tracked) in Klaviyo.",
      inputSchema: z.object({}),
      execute: async () => {
        return request("GET", "/metrics/");
      },
    }),

    klaviyo_query_metric_aggregates: createTool({
      id: "klaviyo-query-metric-aggregates",
      description:
        "Query metric aggregates - get counts, sums, or unique values for a metric over time (e.g., email opens, revenue from flows).",
      inputSchema: z.object({
        metric_id: z.string().describe("Metric ID to aggregate"),
        measurement: z
          .enum(["count", "sum", "unique"])
          .describe("Aggregation type"),
        interval: z
          .enum(["day", "week", "month"])
          .optional()
          .default("day"),
        start_date: z
          .string()
          .describe('Start date (ISO format, e.g., "2024-01-01T00:00:00Z")'),
        end_date: z.string().describe("End date (ISO format)"),
        group_by: z
          .array(z.string())
          .optional()
          .default([])
          .describe(
            'Dimensions to group by (e.g., ["$flow", "$campaign", "$message"])',
          ),
      }),
      execute: async (input) => {
        return request("POST", "/metric-aggregates/", {
          data: {
            type: "metric-aggregate",
            attributes: {
              metric_id: input.metric_id,
              measurements: [input.measurement],
              interval: input.interval,
              filter: [
                `greater-or-equal(datetime,${input.start_date})`,
                `less-than(datetime,${input.end_date})`,
              ],
              by: input.group_by,
            },
          },
        });
      },
    }),

    klaviyo_add_profile_to_list: createTool({
      id: "klaviyo-add-profile-to-list",
      description:
        "Add a profile to a Klaviyo list.",
      inputSchema: z.object({
        list_id: z.string().describe("List ID to add profile to"),
        email: z.string().describe("Email of the profile to add"),
      }),
      execute: async (input) => {
        const profileRes = await request("POST", "/profiles/", {
          data: {
            type: "profile",
            attributes: { email: input.email },
          },
        });
        const profileId = profileRes?.data?.id;
        if (!profileId) {
          throw new Error("Could not create or find profile");
        }

        return request(
          "POST",
          `/lists/${input.list_id}/relationships/profiles/`,
          {
            data: [{ type: "profile", id: profileId }],
          },
        );
      },
    }),

    klaviyo_create_list: createTool({
      id: "klaviyo-create-list",
      description:
        "Create a new subscriber list in Klaviyo.",
      inputSchema: z.object({
        name: z.string().describe("Name of the list to create"),
      }),
      execute: async (input) => {
        return request("POST", "/lists/", {
          data: {
            type: "list",
            attributes: { name: input.name },
          },
        });
      },
    }),

    klaviyo_update_profile: createTool({
      id: "klaviyo-update-profile",
      description:
        "Update a subscriber profile in Klaviyo.",
      inputSchema: z.object({
        profile_id: z.string().describe("Profile ID to update"),
        email: z.string().optional().describe("New email address"),
        first_name: z.string().optional().describe("First name"),
        last_name: z.string().optional().describe("Last name"),
        phone_number: z.string().optional().describe("Phone number"),
        properties: z
          .record(z.string(), z.string())
          .optional()
          .describe("Custom profile properties"),
      }),
      execute: async (input) => {
        const attributes: Record<string, unknown> = {};
        if (input.email !== undefined) attributes.email = input.email;
        if (input.first_name !== undefined)
          attributes.first_name = input.first_name;
        if (input.last_name !== undefined)
          attributes.last_name = input.last_name;
        if (input.phone_number !== undefined)
          attributes.phone_number = input.phone_number;
        if (input.properties !== undefined)
          attributes.properties = input.properties;

        return request("PATCH", `/profiles/${input.profile_id}/`, {
          data: {
            type: "profile",
            id: input.profile_id,
            attributes,
          },
        });
      },
    }),

    klaviyo_get_campaign_performance: createTool({
      id: "klaviyo-get-campaign-performance",
      description:
        "Get performance details for a specific campaign including estimated recipient count.",
      inputSchema: z.object({
        campaign_id: z.string().describe("Campaign ID"),
      }),
      execute: async (input) => {
        return request(
          "GET",
          `/campaigns/${input.campaign_id}/?additional-fields[campaign]=estimated_recipient_count`,
        );
      },
    }),

    klaviyo_get_profile: createTool({
      id: "klaviyo-get-profile",
      description: "Get full profile details by profile ID.",
      inputSchema: z.object({
        profile_id: z.string().describe("Profile ID"),
      }),
      execute: async (input) => {
        return request("GET", `/profiles/${input.profile_id}/`);
      },
    }),

    klaviyo_create_campaign: createTool({
      id: "klaviyo-create-campaign",
      description:
        "Create a new email campaign in Klaviyo.",
      inputSchema: z.object({
        name: z.string().describe("Campaign name"),
        subject_line: z.string().describe("Email subject line"),
        from_email: z.string().describe("Sender email address"),
        from_name: z.string().describe("Sender display name"),
        list_id: z.string().describe("List ID to send the campaign to"),
      }),
      execute: async (input) => {
        // Step 1: Create the campaign
        const campaign = await request("POST", "/campaigns/", {
          data: {
            type: "campaign",
            attributes: {
              name: input.name,
              channel: "email",
              audiences: {
                included: [input.list_id],
              },
              send_strategy: {
                method: "immediate",
              },
            },
          },
        });

        // Step 2: Update the campaign message with subject/sender
        const campaignId = campaign?.data?.id;
        if (campaignId) {
          const messagesRes = await request(
            "GET",
            `/campaigns/${campaignId}/campaign-messages/`,
          );
          const messageId = messagesRes?.data?.[0]?.id;
          if (messageId) {
            await request("PATCH", `/campaign-messages/${messageId}/`, {
              data: {
                type: "campaign-message",
                id: messageId,
                attributes: {
                  label: input.name,
                  subject: input.subject_line,
                  from_email: input.from_email,
                  from_name: input.from_name,
                },
              },
            });
          }
        }

        return campaign;
      },
    }),

    klaviyo_get_campaign_values_report: createTool({
      id: "klaviyo-get-campaign-values-report",
      description:
        "Get campaign performance stats: opens, clicks, unsubscribes, bounce rate, revenue, recipients, spam complaints.",
      inputSchema: z.object({
        campaign_ids: z
          .array(z.string())
          .describe("List of campaign IDs to report on"),
        statistics: z
          .array(z.string())
          .optional()
          .default([
            "opens",
            "open_rate",
            "clicks",
            "click_rate",
            "unsubscribes",
            "bounce_rate",
            "recipients",
            "revenue",
            "spam_complaints",
          ])
          .describe("Statistics to retrieve"),
        timeframe: z
          .object({
            start: z.string().describe("Start datetime ISO 8601"),
            end: z.string().describe("End datetime ISO 8601"),
          })
          .optional()
          .describe("Optional time filter"),
      }),
      execute: async (input) => {
        const body: Record<string, unknown> = {
          data: {
            type: "campaign-values-report",
            attributes: {
              statistics: input.statistics,
              filter: `any(campaign_id,[${input.campaign_ids.map((id) => `"${id}"`).join(",")}])`,
            },
          },
        };
        if (input.timeframe) {
          (body.data as Record<string, any>).attributes.timeframe = {
            start: input.timeframe.start,
            end: input.timeframe.end,
          };
        }
        return request("POST", "/campaign-values-reports/", body);
      },
    }),

    klaviyo_get_flow_values_report: createTool({
      id: "klaviyo-get-flow-values-report",
      description:
        "Get flow performance stats: opens, clicks, unsubscribes, bounce rate, revenue, recipients.",
      inputSchema: z.object({
        flow_ids: z
          .array(z.string())
          .describe("List of flow IDs to report on"),
        statistics: z
          .array(z.string())
          .optional()
          .default([
            "opens",
            "open_rate",
            "clicks",
            "click_rate",
            "unsubscribes",
            "bounce_rate",
            "recipients",
            "revenue",
            "spam_complaints",
          ])
          .describe("Statistics to retrieve"),
        timeframe: z
          .object({
            start: z.string().describe("Start datetime ISO 8601"),
            end: z.string().describe("End datetime ISO 8601"),
          })
          .optional()
          .describe("Optional time filter"),
      }),
      execute: async (input) => {
        const body: Record<string, unknown> = {
          data: {
            type: "flow-values-report",
            attributes: {
              statistics: input.statistics,
              filter: `any(flow_id,[${input.flow_ids.map((id) => `"${id}"`).join(",")}])`,
            },
          },
        };
        if (input.timeframe) {
          (body.data as Record<string, any>).attributes.timeframe = {
            start: input.timeframe.start,
            end: input.timeframe.end,
          };
        }
        return request("POST", "/flow-values-reports/", body);
      },
    }),

    klaviyo_get_campaign_series_report: createTool({
      id: "klaviyo-get-campaign-series-report",
      description:
        "Get day-by-day campaign performance time-series (opens, clicks, revenue, etc.) using metric aggregates. Useful for spotting trends over time.",
      inputSchema: z.object({
        metric_id: z
          .string()
          .describe(
            'Metric ID (use klaviyo_get_metrics to find IDs for "Opened Email", "Clicked Email", "Placed Order", etc.)',
          ),
        measurement: z
          .enum(["count", "sum", "unique"])
          .describe(
            "Aggregation type — count for opens/clicks, sum for revenue",
          ),
        start_date: z.string().describe("Start date YYYY-MM-DD"),
        end_date: z.string().describe("End date YYYY-MM-DD"),
        interval: z
          .enum(["day", "week", "month"])
          .optional()
          .default("day"),
        group_by: z
          .array(z.string())
          .optional()
          .default(["$campaign"])
          .describe(
            'Group by dimension — use ["$campaign"] for per-campaign breakdown',
          ),
      }),
      execute: async (input) => {
        return request("POST", "/metric-aggregates/", {
          data: {
            type: "metric-aggregate",
            attributes: {
              metric_id: input.metric_id,
              measurements: [input.measurement],
              interval: input.interval,
              filter: [
                `greater-or-equal(datetime,${input.start_date})`,
                `less-than(datetime,${input.end_date})`,
              ],
              by: input.group_by,
            },
          },
        });
      },
    }),

    klaviyo_get_flow_series_report: createTool({
      id: "klaviyo-get-flow-series-report",
      description:
        "Get day-by-day flow performance time-series using metric aggregates. Useful for spotting flow performance trends.",
      inputSchema: z.object({
        metric_id: z.string().describe("Metric ID"),
        measurement: z
          .enum(["count", "sum", "unique"])
          .describe(
            "Aggregation type — count for opens/clicks, sum for revenue",
          ),
        start_date: z.string().describe("Start date YYYY-MM-DD"),
        end_date: z.string().describe("End date YYYY-MM-DD"),
        interval: z
          .enum(["day", "week", "month"])
          .optional()
          .default("day"),
        group_by: z
          .array(z.string())
          .optional()
          .default(["$flow"])
          .describe(
            'Group by dimension — use ["$flow"] for per-flow breakdown',
          ),
      }),
      execute: async (input) => {
        return request("POST", "/metric-aggregates/", {
          data: {
            type: "metric-aggregate",
            attributes: {
              metric_id: input.metric_id,
              measurements: [input.measurement],
              interval: input.interval,
              filter: [
                `greater-or-equal(datetime,${input.start_date})`,
                `less-than(datetime,${input.end_date})`,
              ],
              by: input.group_by,
            },
          },
        });
      },
    }),

    klaviyo_unsubscribe_profile: createTool({
      id: "klaviyo-unsubscribe-profile",
      description:
        "Remove a profile from a Klaviyo list.",
      inputSchema: z.object({
        list_id: z.string().describe("List ID to remove the profile from"),
        profile_id: z.string().describe("Profile ID to remove"),
      }),
      execute: async (input) => {
        return request(
          "DELETE",
          `/lists/${input.list_id}/relationships/profiles/`,
          {
            data: [{ type: "profile", id: input.profile_id }],
          },
        );
      },
    }),
  };
}
