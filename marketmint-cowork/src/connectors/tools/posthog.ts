import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sanitizeResourceId } from "./helpers";

export interface PostHogConfig {
  apiKey: string;
  projectId: string;
  host?: string;
}

function makeRequest(config: PostHogConfig) {
  const host = config.host || "https://us.posthog.com";
  return async (method: string, path: string, body?: unknown) => {
    const url = `${host}/api/projects/${sanitizeResourceId(config.projectId)}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PostHog API error ${res.status}: ${text}`);
    }
    return res.json();
  };
}

export function createPostHogTools(config: PostHogConfig) {
  const request = makeRequest(config);

  return {
    posthog_get_trends: createTool({
      id: "posthog-get-trends",
      description:
        "Query PostHog trends — get event counts, unique users, or other aggregations over time.",
      inputSchema: z.object({
        events: z
          .array(
            z.object({
              id: z.string().describe('Event name (e.g., "$pageview", "purchase")'),
              math: z
                .enum(["total", "dau", "weekly_active", "monthly_active", "unique_group", "hogql"])
                .optional()
                .describe("Aggregation type"),
            }),
          )
          .describe("Events to query"),
        date_from: z.string().describe('Start date (e.g., "-7d", "-30d", "2024-01-01")'),
        date_to: z.string().optional().describe("End date (default: now)"),
        interval: z.enum(["hour", "day", "week", "month"]).optional().default("day"),
        breakdown: z.string().optional().describe('Property to break down by (e.g., "$browser", "$os")'),
      }),
      execute: async (input) => {
        return request("POST", "/query/", {
          query: {
            kind: "TrendsQuery",
            series: input.events.map((e) => ({
              kind: "EventsNode",
              event: e.id,
              math: e.math || "total",
            })),
            dateRange: { date_from: input.date_from, date_to: input.date_to },
            interval: input.interval,
            breakdownFilter: input.breakdown
              ? { breakdown_type: "event", breakdown: input.breakdown }
              : undefined,
          },
        });
      },
    }),

    posthog_get_events: createTool({
      id: "posthog-get-events",
      description: "Get recent events from PostHog with optional filtering.",
      inputSchema: z.object({
        event: z.string().optional().describe('Filter by event name (e.g., "$pageview", "purchase")'),
        limit: z.number().optional().default(20),
        person_id: z.string().optional().describe("Filter by person ID"),
      }),
      execute: async (input) => {
        const params = new URLSearchParams();
        if (input.event) params.set("event", input.event);
        if (input.limit) params.set("limit", String(input.limit));
        if (input.person_id) params.set("person_id", input.person_id);
        return request("GET", `/events/?${params.toString()}`);
      },
    }),

    posthog_get_persons: createTool({
      id: "posthog-get-persons",
      description: "List persons (users) in PostHog. Search by email or properties.",
      inputSchema: z.object({
        search: z.string().optional().describe("Search by email, name, or distinct ID"),
        limit: z.number().optional().default(20),
      }),
      execute: async (input) => {
        const params = new URLSearchParams();
        if (input.search) params.set("search", input.search);
        if (input.limit) params.set("limit", String(input.limit));
        return request("GET", `/persons/?${params.toString()}`);
      },
    }),

    posthog_get_session_recordings: createTool({
      id: "posthog-get-session-recordings",
      description: "List recent session recordings from PostHog.",
      inputSchema: z.object({
        limit: z.number().optional().default(10),
        date_from: z.string().optional().describe('Start date (e.g., "-7d")'),
      }),
      execute: async (input) => {
        const params = new URLSearchParams();
        if (input.limit) params.set("limit", String(input.limit));
        if (input.date_from) params.set("date_from", input.date_from);
        return request("GET", `/session_recordings/?${params.toString()}`);
      },
    }),

    posthog_get_feature_flags: createTool({
      id: "posthog-get-feature-flags",
      description: "List all feature flags in the PostHog project.",
      inputSchema: z.object({
        active: z.boolean().optional().describe("Filter by active status"),
      }),
      execute: async (input) => {
        const params = new URLSearchParams();
        if (input.active !== undefined) params.set("active", String(input.active));
        return request("GET", `/feature_flags/?${params.toString()}`);
      },
    }),

    posthog_get_dashboards: createTool({
      id: "posthog-get-dashboards",
      description: "List all dashboards in the PostHog project.",
      inputSchema: z.object({}),
      execute: async () => {
        return request("GET", "/dashboards/");
      },
    }),

    posthog_get_insights: createTool({
      id: "posthog-get-insights",
      description: "List saved insights (charts, tables, funnels) from PostHog.",
      inputSchema: z.object({
        limit: z.number().optional().default(20),
        saved: z.boolean().optional().default(true),
      }),
      execute: async (input) => {
        const params = new URLSearchParams();
        if (input.limit) params.set("limit", String(input.limit));
        if (input.saved) params.set("saved", "true");
        return request("GET", `/insights/?${params.toString()}`);
      },
    }),

    posthog_run_funnel: createTool({
      id: "posthog-run-funnel",
      description: "Run a funnel analysis to see conversion between steps.",
      inputSchema: z.object({
        steps: z
          .array(z.object({ event: z.string().describe("Event name for this funnel step") }))
          .min(2)
          .describe("Funnel steps (at least 2 events)"),
        date_from: z.string().describe('Start date (e.g., "-30d")'),
        date_to: z.string().optional(),
        funnel_window_days: z.number().optional().default(14).describe("Conversion window in days"),
      }),
      execute: async (input) => {
        return request("POST", "/query/", {
          query: {
            kind: "FunnelsQuery",
            series: input.steps.map((s) => ({
              kind: "EventsNode",
              event: s.event,
            })),
            dateRange: { date_from: input.date_from, date_to: input.date_to },
            funnelsFilter: {
              funnelWindowIntervalUnit: "day",
              funnelWindowInterval: input.funnel_window_days,
            },
          },
        });
      },
    }),

    posthog_create_annotation: createTool({
      id: "posthog-create-annotation",
      description:
        "Create an annotation in PostHog (e.g., mark a deployment, sale, or launch).",
      inputSchema: z.object({
        content: z.string().describe('Annotation text (e.g., "Summer sale launched")'),
        date_marker: z.string().describe('Date for the annotation (ISO format, e.g., "2024-06-15T00:00:00Z")'),
      }),
      execute: async (input) => {
        return request("POST", "/annotations/", {
          content: input.content,
          date_marker: input.date_marker,
          scope: "project",
        });
      },
    }),

    posthog_create_feature_flag: createTool({
      id: "posthog-create-feature-flag",
      description:
        "Create a new feature flag in PostHog.",
      inputSchema: z.object({
        key: z.string().describe('Flag key (e.g., "new-checkout")'),
        name: z.string().optional().describe("Display name"),
        active: z.boolean().optional().default(false),
        rollout_percentage: z.number().min(0).max(100).optional().default(0),
      }),
      execute: async (input) => {
        return request("POST", "/feature_flags/", {
          key: input.key,
          name: input.name || input.key,
          active: input.active ?? false,
          filters: {
            groups: [{ rollout_percentage: input.rollout_percentage ?? 0, properties: [] }],
          },
        });
      },
    }),

    posthog_update_feature_flag: createTool({
      id: "posthog-update-feature-flag",
      description:
        "Update or toggle a feature flag in PostHog.",
      inputSchema: z.object({
        flag_id: z.string().describe("The feature flag ID"),
        active: z.boolean().optional(),
        rollout_percentage: z.number().min(0).max(100).optional(),
        name: z.string().optional(),
      }),
      execute: async (input) => {
        const body: Record<string, unknown> = {};
        if (input.active !== undefined) body.active = input.active;
        if (input.name !== undefined) body.name = input.name;
        if (input.rollout_percentage !== undefined) {
          body.filters = {
            groups: [{ rollout_percentage: input.rollout_percentage, properties: [] }],
          };
        }
        return request("PATCH", `/feature_flags/${sanitizeResourceId(input.flag_id)}/`, body);
      },
    }),

    posthog_list_event_definitions: createTool({
      id: "posthog-list-event-definitions",
      description: "List all event definitions (what events are being tracked) in PostHog.",
      inputSchema: z.object({
        limit: z.number().optional().default(50),
      }),
      execute: async (input) => {
        const params = new URLSearchParams();
        if (input.limit) params.set("limit", String(input.limit));
        return request("GET", `/event_definitions/?${params.toString()}`);
      },
    }),

    posthog_get_cohorts: createTool({
      id: "posthog-get-cohorts",
      description: "List all cohorts in the PostHog project.",
      inputSchema: z.object({}),
      execute: async () => {
        return request("GET", "/cohorts/");
      },
    }),
  };
}
