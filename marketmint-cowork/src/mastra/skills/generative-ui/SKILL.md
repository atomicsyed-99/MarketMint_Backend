---
name: generative-ui
description: Use when the user asks for a dashboard, report, chart, visualization, overview, data table, or diagram — or when presenting integration data (Shopify, GA, Meta Ads, PostHog, Klaviyo, Google Sheets) that has multiple data points, trends, or comparisons. Creates rich interactive HTML widgets rendered in the artifact panel.
---

# Generative UI — Visual Widgets

Create rich interactive HTML widgets (dashboards, charts, data tables, diagrams) from integration data. Widgets render in a sandboxed iframe in the artifact panel.

## When to Use

ALWAYS use this skill when:
- User asks for a "dashboard", "report", "chart", "visualization", "overview", "show me", "visualize"
- Presenting data with multiple metrics, trends over time, comparisons, or lists of items
- Analytics data, revenue data, campaign performance, product listings
- Data has more than 2-3 data points

Do NOT use when:
- Simple single-value questions: "how many products?" → just answer in text
- Yes/no questions
- Simple status checks

## Mandatory Workflow

Follow these steps exactly:

1. **Load design system** — Call `readGuidelines` with the relevant modules (chart, mockup, interactive, diagram, art). Do this silently — do NOT mention it to the user. Do NOT skip this step.
2. **Fetch data** — Use the appropriate integration tools (search_tools → load_tool → connector tools) to get the data.
3. **Render widget** — Call `createInteractiveView` with generated HTML following the design system. This is the critical step — you MUST call this tool, do NOT present data as markdown instead.

## Module Selection Guide

| User Intent | Modules to Load |
|---|---|
| Revenue chart, trends over time, analytics | chart, mockup |
| KPI dashboard, metrics overview | mockup |
| Campaign performance with charts | chart, mockup |
| Product listing, data table | mockup |
| Interactive calculator, what-if | interactive, mockup |
| Process flow, architecture diagram | diagram |
| Funnel visualization | chart, diagram |

## Widget Quality Rules

- Follow the loaded design system guidelines **exactly**
- Structure HTML as: `<style>` → HTML content → `<script>` (order is critical)
- Use Chart.js from CDN: `https://cdn.jsdelivr.net/npm/chart.js@4`
- Include a descriptive title and one-line description
- List data sources used (e.g., `["Shopify", "Google Analytics"]`)
- Keep widgets focused — one clear purpose per widget
- NEVER output widget HTML as markdown code blocks — always use `createInteractiveView`
- CDN allowlist: cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, esm.sh
