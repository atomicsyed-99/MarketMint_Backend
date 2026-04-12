# Generative UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generative UI to the MarketMint Mastra agent — two new tools (`read_guidelines` and `render_widget`) that let the agent generate rich interactive HTML widgets (dashboards, charts, data tables, diagrams) emitted as `artifact` SSE chunks for the frontend to render in a sandboxed iframe panel.

**Architecture:** The agent calls `read_guidelines` to lazily load a design system into its context, fetches data via existing connector/integration tools, then calls `render_widget` with generated HTML. The tool emits a `data-artifact` SSE event matching the frontend contract (`kind: "generative-ui"` with a nested `widget` object). The `artifact` type is extensible — future artifact kinds can be added without changing the event shape. Adapted from the nango-poc at `/Users/adarsh/Desktop/Projects/Experiments/nango-poc/`.

**Tech Stack:** Mastra `createTool()`, Zod schemas, `context.writer.custom()` for SSE streaming. Design guidelines are plain TypeScript string constants. No new npm dependencies.

**Source reference:** All guidelines are copied verbatim from `/Users/adarsh/Desktop/Projects/Experiments/nango-poc/lib/guidelines/`. Do NOT copy from inline code blocks in this plan — copy directly from the source files to avoid escaping artifacts.

---

## Frontend Contract

### Raw SSE frame (what the frontend receives in the stream)

The tool emits via `writer.custom()` with `type: "data-artifact"` and `id` at the **top level** (required by frontend). The `chat.ts` wrappedStream forwards raw SSE frames **as-is** — no normalization on the forwarded stream. So the frontend receives:

```json
{
  "type": "data-artifact",
  "id": "artifact_<uuid>",
  "data": {
    "id": "artifact_<uuid>",
    "kind": "generative-ui",
    "title": "Revenue Dashboard",
    "description": "Monthly revenue breakdown by channel",
    "widget": {
      "widget_code": "<style>...</style><div>...</div><script>...</script>",
      "width": 900,
      "height": 600,
      "module_type": "chart",
      "data_sources": ["Shopify", "Google Analytics"]
    }
  }
}
```

**Important**: `id` appears at **both** the top level and inside `data`. The top-level `id` is used by `chat.ts` for event deduplication (`const eventId = payload?.id ?? crypto.randomUUID()`). The `data.id` is the canonical artifact identifier for the frontend.

### Persisted form (what's stored in the database)

The `chat.ts` stream wrapper normalizes the `type` by stripping the `data-` prefix before persisting. So the database stores:

```json
{
  "type": "artifact",
  "id": "artifact_<uuid>",
  "data": {
    "id": "artifact_<uuid>",
    "kind": "generative-ui",
    "title": "Revenue Dashboard",
    "description": "Monthly revenue breakdown by channel",
    "widget": { ... }
  }
}
```

When loading message history from DB, the frontend receives `type: "artifact"` (without `data-` prefix).

### Frontend detection

Frontend should handle **both** forms:
- In live SSE stream: match `type === "data-artifact"`
- In stored messages: match `type === "artifact"`
- Or normalize by stripping `data-` prefix on the client side (recommended — consistent with how all other event types work)

The `artifact` type is extensible — new `kind` values (e.g., `"code-sandbox"`, `"data-table"`) can be added later without changing the envelope shape.

---

## File Structure

```
src/
  lib/
    guidelines/
      index.ts             # getGuidelines() — module loader & concatenator
      core.ts              # Core design system (always loaded): colors, typography, layout, forbidden patterns
      chart.ts             # Chart.js v4: setup, color palette, axes, tooltips, chart type configs
      mockup.ts            # KPI cards, stats rows, data tables, badges, progress bars, dashboard layouts
      interactive.ts       # Sliders, toggles, live calculations, tabs, filter pills
      diagram.ts           # SVG flowcharts, box/node styling, arrows, layout patterns
      art.ts               # Canvas animations, SVG illustrations, performance limits
  mastra/
    tools/
      generative-ui/
        read-guidelines.ts  # read_guidelines tool — loads design system modules into LLM context
        render-widget.ts    # render_widget tool — emits artifact SSE event matching frontend contract
      index.ts             # (modify) — add exports for new tools
  routes/
    chat.ts                # (modify) — add "artifact" to persistence allowlist
skills_v2/
  generative-ui/
    SKILL.md               # On-demand skill: workflow instructions for generative UI (loaded via skill_search)
```

---

## Chunk 1: Design System Guidelines

### Task 1: Create core design guidelines

**Files:**
- Create: `src/lib/guidelines/core.ts`

- [ ] **Step 1: Copy `core.ts` from nango-poc**

Copy the file verbatim:
```bash
cp /Users/adarsh/Desktop/Projects/Experiments/nango-poc/lib/guidelines/core.ts src/lib/guidelines/core.ts
```

This contains CSS custom properties, typography scale, layout rules, component reference, and forbidden patterns. It is always loaded before any widget generation.

- [ ] **Step 2: Verify file created**

Run: `head -5 src/lib/guidelines/core.ts`
Expected: Shows `export const CORE =` with the first lines of the design system.

- [ ] **Step 3: Commit**

```bash
git add src/lib/guidelines/core.ts
git commit -m "feat(generative-ui): add core design system guidelines"
```

---

### Task 2: Create module guidelines (chart, mockup, interactive, diagram, art)

**Files:**
- Create: `src/lib/guidelines/chart.ts`
- Create: `src/lib/guidelines/mockup.ts`
- Create: `src/lib/guidelines/interactive.ts`
- Create: `src/lib/guidelines/diagram.ts`
- Create: `src/lib/guidelines/art.ts`

- [ ] **Step 1: Copy all module files from nango-poc**

Copy each file verbatim from the nango-poc source:

```bash
cp /Users/adarsh/Desktop/Projects/Experiments/nango-poc/lib/guidelines/chart.ts src/lib/guidelines/chart.ts
cp /Users/adarsh/Desktop/Projects/Experiments/nango-poc/lib/guidelines/mockup.ts src/lib/guidelines/mockup.ts
cp /Users/adarsh/Desktop/Projects/Experiments/nango-poc/lib/guidelines/interactive.ts src/lib/guidelines/interactive.ts
cp /Users/adarsh/Desktop/Projects/Experiments/nango-poc/lib/guidelines/diagram.ts src/lib/guidelines/diagram.ts
cp /Users/adarsh/Desktop/Projects/Experiments/nango-poc/lib/guidelines/art.ts src/lib/guidelines/art.ts
```

Contents:
- **chart.ts**: Chart.js v4 setup, monochrome color palette, legend/axes/tooltip config, number formatting helper, chart type configs (line, bar, doughnut, stacked), dashboard layout pattern
- **mockup.ts**: KPI/metric card CSS, stats row, data table CSS, badges (status text only), progress bar, dashboard layout CSS
- **interactive.ts**: Styled slider, toggle switch, live calculation pattern with data-bind, tab component CSS, filter pills
- **diagram.ts**: SVG setup with viewBox, box/node styling, arrow/connector styling, marker defs, layout patterns (horizontal, vertical, tree), state colors
- **art.ts**: Canvas setup, requestAnimationFrame animation, SVG illustration patterns, monochrome palette, performance limits

- [ ] **Step 2: Verify all files exist**

Run: `ls src/lib/guidelines/`
Expected: `art.ts  chart.ts  core.ts  diagram.ts  interactive.ts  mockup.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/guidelines/
git commit -m "feat(generative-ui): add chart, mockup, interactive, diagram, art guidelines"
```

---

### Task 3: Create guidelines index/loader

**Files:**
- Create: `src/lib/guidelines/index.ts`

- [ ] **Step 1: Create `src/lib/guidelines/index.ts`**

```typescript
import { CORE } from "./core";
import { CHART } from "./chart";
import { MOCKUP } from "./mockup";
import { INTERACTIVE } from "./interactive";
import { DIAGRAM } from "./diagram";
import { ART } from "./art";

export const AVAILABLE_MODULES = [
  "chart",
  "mockup",
  "interactive",
  "diagram",
  "art",
] as const;

export type GuidelineModule = (typeof AVAILABLE_MODULES)[number];

const MODULE_MAP: Record<GuidelineModule, string> = {
  chart: CHART,
  mockup: MOCKUP,
  interactive: INTERACTIVE,
  diagram: DIAGRAM,
  art: ART,
};

export function getGuidelines(modules: GuidelineModule[]): string {
  let content = CORE;
  const seen = new Set<string>();
  for (const mod of modules) {
    const section = MODULE_MAP[mod];
    if (section && !seen.has(mod)) {
      seen.add(mod);
      content += "\n\n" + section;
    }
  }
  return content;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "guidelines" | head -10`
Expected: No errors related to guidelines files.

- [ ] **Step 3: Commit**

```bash
git add src/lib/guidelines/index.ts
git commit -m "feat(generative-ui): add guidelines index with module loader"
```

---

## Chunk 2: Tool Definitions

### Task 4: Create `read_guidelines` tool

**Files:**
- Create: `src/mastra/tools/generative-ui/read-guidelines.ts`

- [ ] **Step 1: Create the tool**

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGuidelines, AVAILABLE_MODULES } from "@/lib/guidelines";

export const readGuidelines = createTool({
  id: "read-guidelines",
  description:
    "Load design guidelines for generating visual widgets. Call this ONCE before your first render_widget call. " +
    "Do NOT mention this call to the user — it is an internal setup step. " +
    "Pick modules matching your use case: chart (Chart.js data viz), mockup (dashboards, tables, KPI cards), " +
    "interactive (sliders, calculators), diagram (SVG flowcharts), art (illustrations).",
  inputSchema: z.object({
    modules: z
      .array(z.enum(AVAILABLE_MODULES))
      .describe("Which guideline modules to load."),
  }),
  outputSchema: z.object({
    guidelines: z.string(),
    loaded_modules: z.array(z.string()),
    note: z.string(),
  }),
  execute: async (input, _context) => {
    const content = getGuidelines(input.modules);
    return {
      guidelines: content,
      loaded_modules: input.modules,
      note: "Guidelines loaded. You may now call render_widget. Set has_read_guidelines: true.",
    };
  },
});
```

Note: `_context` parameter is prefixed with underscore (unused but included for codebase consistency, matching `check-linked-account.ts` pattern).

- [ ] **Step 2: Verify file created**

Run: `head -10 src/mastra/tools/generative-ui/read-guidelines.ts`
Expected: Shows imports and createTool definition.

- [ ] **Step 3: Commit**

```bash
git add src/mastra/tools/generative-ui/read-guidelines.ts
git commit -m "feat(generative-ui): add read_guidelines tool"
```

---

### Task 5: Create `render_widget` tool

**Files:**
- Create: `src/mastra/tools/generative-ui/render-widget.ts`

This tool emits an `artifact` SSE event matching the frontend contract. The event uses `kind: "generative-ui"` with a nested `widget` object. It also emits `data-agent-utility` events for status feedback (running/completed/failed), following the same flat structure as `generate-single-image.ts`.

- [ ] **Step 1: Create the tool**

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const renderWidget = createTool({
  id: "render-widget",
  description:
    "Render a rich visual widget (dashboard, chart, data table, diagram) in the artifact panel. " +
    "The widget is displayed in a sandboxed iframe with full CSS/JS support including CDN libraries like Chart.js. " +
    "You MUST call read_guidelines first to load the design system before using this tool. " +
    "Structure your HTML as: <style> block → HTML content → <script> tags (this order is critical for streaming). " +
    "Output HTML fragments only — no DOCTYPE, <html>, <head>, or <body> tags. " +
    "CDN allowlist: cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, esm.sh.",
  inputSchema: z.object({
    has_read_guidelines: z
      .boolean()
      .describe(
        "Confirm you have called read_guidelines in this conversation. Must be true."
      ),
    title: z
      .string()
      .describe(
        'Human-readable title for the widget (e.g., "Revenue Dashboard")'
      ),
    description: z
      .string()
      .describe("One-line description of what this widget shows"),
    widget_code: z
      .string()
      .describe(
        "HTML fragment to render. Structure: <style> → HTML → <script>. No DOCTYPE/<html>/<head>/<body>."
      ),
    width: z
      .number()
      .optional()
      .describe("Widget width in pixels. Default: 900."),
    height: z
      .number()
      .optional()
      .describe("Widget height in pixels. Default: 600."),
    module_type: z
      .enum(["chart", "mockup", "interactive", "diagram", "art"])
      .optional()
      .describe("Primary module type used."),
    data_sources: z
      .array(z.string())
      .optional()
      .describe(
        'Integration names that provided the data (e.g., ["Shopify"])'
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    title: z.string(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const cardId = crypto.randomUUID();
    const artifactId = `artifact_${crypto.randomUUID().slice(0, 12)}`;
    const writer = context?.writer;

    if (!input.has_read_guidelines) {
      await writer?.custom({
        type: "data-agent-utility",
        id: cardId,
        data: {
          id: cardId,
          name: "render_widget",
          status: "failed",
          category: "generative-ui",
          description: "Must call read_guidelines first",
        },
      });
      return {
        ok: false,
        title: "",
        message: "",
        error:
          "You must call read_guidelines before render_widget. Load the design system first.",
      };
    }

    // Emit running status — `id` at top level (required by frontend) AND inside `data`
    await writer?.custom({
      type: "data-agent-utility",
      id: cardId,
      data: {
        id: cardId,
        name: "render_widget",
        status: "running",
        category: "generative-ui",
        description: `Rendering ${input.module_type ?? "mockup"} widget: ${input.title}`,
        steps: [
          {
            id: "render",
            label: `Building ${input.module_type ?? "mockup"} widget`,
            status: "running",
          },
        ],
      },
    });

    // Emit the artifact SSE event matching frontend contract
    // `id` at top level (required by frontend) AND inside `data`
    // type: "data-artifact" — frontend receives as-is in live stream
    // Persisted as "artifact" (chat.ts strips "data-" prefix for DB)
    await writer?.custom({
      type: "data-artifact",
      id: artifactId,
      data: {
        id: artifactId,
        kind: "generative-ui",
        title: input.title,
        description: input.description,
        widget: {
          widget_code: input.widget_code,
          width: input.width ?? 900,
          height: input.height ?? 600,
          module_type: input.module_type ?? "mockup",
          data_sources: input.data_sources ?? [],
        },
      },
    });

    // Emit completed status
    await writer?.custom({
      type: "data-agent-utility",
      id: cardId,
      data: {
        id: cardId,
        name: "render_widget",
        status: "completed",
        category: "generative-ui",
        description: `Widget rendered: ${input.title}`,
        steps: [
          {
            id: "render",
            label: `Building ${input.module_type ?? "mockup"} widget`,
            status: "completed",
          },
        ],
      },
    });

    // Return lightweight confirmation to the LLM (widget_code NOT repeated —
    // it's already sent to frontend via SSE, no need to bloat the tool result)
    return {
      ok: true,
      title: input.title,
      message: `Widget "${input.title}" rendered in artifact panel. Do NOT repeat the HTML in your response — the user can already see the widget.`,
    };
  },
});
```

Key design decisions:
- **`outputSchema` is lightweight** — returns `ok`, `title`, `message` instead of echoing back `widget_code`. The HTML is already streamed to the frontend via the `data-artifact` SSE event. Sending it again in the tool result would bloat the LLM context unnecessarily.
- **`data-agent-utility` uses flat structure** matching `generate-single-image.ts` pattern — `id` inside `data` only, not on the outer call.
- **`data-artifact` event shape** matches the frontend contract: `{ kind, title, description, widget: { widget_code, width, height, module_type, data_sources } }`.
- **`data-artifact`** is normalized to `"artifact"` by the `chat.ts` stream wrapper (which strips the `data-` prefix).

- [ ] **Step 2: Verify file created**

Run: `head -10 src/mastra/tools/generative-ui/render-widget.ts`
Expected: Shows imports and createTool definition.

- [ ] **Step 3: Commit**

```bash
git add src/mastra/tools/generative-ui/render-widget.ts
git commit -m "feat(generative-ui): add render_widget tool with artifact SSE emission"
```

---

### Task 6: Register tools in the exports index

**Files:**
- Modify: `src/mastra/tools/index.ts`

- [ ] **Step 1: Add exports for new tools**

Add these two lines to `src/mastra/tools/index.ts` (after the existing connector exports):

```typescript
export { readGuidelines } from "./generative-ui/read-guidelines";
export { renderWidget } from "./generative-ui/render-widget";
```

These will be picked up by `import * as tools from "../tools"` in `marketmint-agent.ts` and automatically registered with the Mastra agent.

- [ ] **Step 2: Verify exports resolve**

Run: `npx tsc --noEmit 2>&1 | grep -i "generative-ui" | head -10`
Expected: No errors related to generative-ui files.

- [ ] **Step 3: Commit**

```bash
git add src/mastra/tools/index.ts
git commit -m "feat(generative-ui): register read_guidelines and render_widget in tool index"
```

---

## Chunk 3: Skill File & Chat Route Integration

### Task 7: Create generative-ui skill file

**Files:**
- Create: `skills_v2/generative-ui/SKILL.md`

The generative UI instructions are loaded **on demand** via the agent's existing `skill_search` → `skill` workflow — NOT injected into every request's system prompt. When a user asks for dashboards/charts/visualizations, the agent discovers this skill and loads the workflow instructions.

- [ ] **Step 1: Create `skills_v2/generative-ui/SKILL.md`**

```markdown
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

1. **Load design system** — Call `read_guidelines` with the relevant modules (chart, mockup, interactive, diagram, art). Do this silently — do NOT mention it to the user. Do NOT skip this step.
2. **Fetch data** — Use the appropriate integration tools (search_tools → load_tool → connector tools) to get the data.
3. **Render widget** — Call `render_widget` with generated HTML following the design system. This is the critical step — you MUST call this tool, do NOT present data as markdown instead.

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
- NEVER output widget HTML as markdown code blocks — always use `render_widget`
- CDN allowlist: cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, esm.sh
```

- [ ] **Step 2: Commit**

```bash
git add skills_v2/generative-ui/SKILL.md
git commit -m "feat(generative-ui): add on-demand skill for widget workflow instructions"
```

---

### Task 8: Add artifact to chat route persistence allowlist

**Files:**
- Modify: `src/routes/chat.ts`

One change needed: add `"artifact"` to the SSE event type persistence allowlist so widgets survive page refresh.

- [ ] **Step 1: Add `"artifact"` to the persistence allowlist**

In `src/routes/chat.ts`, find the event type allowlist array (around line 779-806). Add `"artifact"` to the array:

```typescript
            } else if (
              [
                "image",
                "video",
                "final_video_output",
                "agent-utility",
                "agent-task",
                "agent-start",
                "agent-start-indicator",
                "agent-task-progress-indicator",
                "progress-indicator",
                "task-progress",
                "user-action",
                "action",
                "loop",
                "suggestions",
                "greeting",
                "markdown-doc",
                "html",
                "error",
                "batch-media",
                "refine-request",
                "refine-processing",
                "batch-processing",
                "interrupt",
                "tool-call",
                "tool-result",
                "artifact",               // ← ADD THIS
              ].includes(eventType)
```

Without this, artifacts stream to the frontend in real-time but are NOT persisted to the database — users would lose their widgets on page refresh.

- [ ] **Step 3: Verify the chat route compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i "chat.ts" | head -10`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat.ts
git commit -m "feat(generative-ui): inject system prompt and persist artifact events in chat route"
```

---

## Chunk 4: Smoke Test & Verification

### Task 9: Verify end-to-end

- [ ] **Step 1: Run `npm run build`**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Verify tools are registered**

Run: `grep -r "readGuidelines\|renderWidget" src/mastra/tools/index.ts`
Expected: Both exports present.

- [ ] **Step 3: Verify guidelines load correctly**

Run: `npx tsx -e "import { getGuidelines } from './src/lib/guidelines'; console.log('OK:', getGuidelines(['chart']).substring(0, 80))"`
Expected: Shows the beginning of CORE + CHART guidelines text.

- [ ] **Step 4: Verify artifact in persistence allowlist**

Run: `grep '"artifact"' src/routes/chat.ts`
Expected: Shows `"artifact",` in the allowlist array.

- [ ] **Step 5: Verify skill file exists**

Run: `head -5 skills_v2/generative-ui/SKILL.md`
Expected: Shows frontmatter with `name: generative-ui`.

- [ ] **Step 6: Run existing tests**

Run: `npm test`
Expected: All existing tests pass (no regressions).

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(generative-ui): complete generative UI with tools, guidelines, and chat integration"
```

---

## Notes

### maxSteps Budget
The chat route sets `maxSteps: 10`. The generative UI workflow uses minimum 3 steps: `read_guidelines` + data-fetching tool(s) + `render_widget`. Combined with skill loading and other tool calls, complex scenarios may hit the 10-step limit. Monitor and increase if needed.

### has_read_guidelines Soft Guard
The `has_read_guidelines` boolean in `render_widget` is a soft LLM-honor-system check. The LLM could set it to `true` without calling `read_guidelines`. This is acceptable for MVP — a stronger server-side session tracking mechanism can be added later if needed.
