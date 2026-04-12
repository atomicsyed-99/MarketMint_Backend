# Agent Utility Event System Improvements

Session date: 2026-03-26

## Overview

Comprehensive overhaul of the agent utility chip/pill system across backend  and frontend . Addresses design critique feedback about cluttered chips, wrong agent identity, vague status text, verbose post-generation copy, and inconsistent event schemas.

---

## Bug Fixes

### 1. Zod v4 `z.record()` crash

**File:** `src/mastra/tools/shopify/check-linked-account.ts`

In Zod v4, `z.record(z.u nknown())` treats the single arg as the key type (not value type like Zod v3), leaving `valueType` as `undefined`. This crashed Mastra's `prepare-tools-step` when converting tool schemas to JSON schema.

```diff
- accounts: z.array(z.record(z.unknown())).optional(),
+ accounts: z.array(z.record(z.string(), z.unknown())).optional(),
```

### 2. Skills path permission denied

**File:** `src/mastra/workspace.ts`

Leading `/` made the skills path absolute (`/skills_v2` on filesystem root), which `contained: true` correctly blocked.

```diff
- skills: ["/skills_v2"],
+ skills: ["skills_v2"],
```

### 3. Connector tools not reloading after mid-stream connection

**Files:**
- `src/connectors/build-toolset.ts` — Added `createEmptyConnectorProcessor()` and `injectToolsIntoProcessor()`
- `src/routes/chat.ts` — Always creates a `ToolSearchProcessor` (even empty), stores ref in `requestContext.__connectorProcessor`
- `src/mastra/tools/connectors/refresh-connections.ts` — After invalidating caches, fetches fresh connections and injects tools into the live processor mid-stream

Previously, connecting a new service (e.g., Google Analytics) mid-conversation required the user to send a follow-up message. Now the `refreshConnections` tool mutates the live processor's `allTools` and BM25 index, making new tools immediately discoverable via `search_tools`/`load_tool` within the same streaming request.

---

## Backend Changes



### Phase 1: System Prompt Improvements

**File:** `src/mastra/agents/prompts/tool-based-orchestrator.ts`

- **Large-generation plan rule**: When a generation request asks for 5+ outputs, agent must call `display_plan` first with estimated count and steps. Passes `plan_id` as `task_group_id` to each `direct_image_gen` call for live progress tracking.
- **Post-generation copy ban**: After generation, 1-2 sentences max. No numbered recap lists, no filler about "creative vision" or generation techniques.
- **Single finisher per turn**: `finisher_tool` called at most once per conversation turn, after all generation is complete. Never per-batch.

### Phase 2: Dynamic Variation Descriptions

**File:** `src/lib/direct-image-workflow.ts`

Step titles now use Creative Director variation names instead of generic "variation N":

```diff
- title: `Generating variation ${i + 1}`
+ title: `Generating ${i + 1} of ${numVariations} — ${v.name}`
```

Running/completed descriptions updated similarly. Final description changed:

```diff
- "Images generated successfully"
+ `${successful.length} of ${results.length} images generated`
```

### Phase 3A: Connector Helper Upgrade

**File:** `src/connectors/tools/helpers.ts`

- Added `humanizeConnectorToolName()` utility: `ga_list_properties` → `"GA4: List Properties"`, `shopify_create_product` → `"Shopify: Create Product"`
- `emitToolStatus()` now auto-generates a `title` field via `humanizeConnectorToolName()`. Cascades to all 50+ connector tools automatically.
- `withToolStatus()` accepts optional `title` override parameter.
- Event now includes `id` at top level (was only inside `data`).

### Phase 3B: New Shared Emit Helper

**New file:** `src/mastra/tools/emit-utility.ts`

Typed helper with enforced category enum:

```typescript
export type UtilityCategory = "connector" | "search" | "generation" | "workflow" | "brand" | "planning";
```

### Phase 3C: Core Tool Migration (~20 files)

Every core tool now emits a `title` field and uses standardized `category` values.

**Category consolidation (7 old → 6 new):**

| Old category | New category | Affected tools |
|---|---|---|
| `"tool"` | `"generation"` | direct_image_gen, video tools, image_edit |
| `"api"` (brand tools) | `"brand"` | analyze_brand, analyze_brand_full |
| `"api"` (other) | `"workflow"` | download_reel |
| `"file"` | `"search"` | extract_images_from_url |
| `"space"` | `"workflow"` | execute_workflow |
| `"skill"` | `"planning"` | display_plan, show_capabilities, fetch_template_prompt |
| `"search"` | `"search"` | tavily_search, search_images (unchanged) |
| `"connector"` | `"connector"` | all connector tools, search_catalog (unchanged) |

**Title assignments per tool:**

| Tool file | `title` value |
|---|---|
| `direct-image-gen.ts` | `"Image Generation"` |
| `generate-single-image.ts` | `"Single Image Generation"` |
| `image-edit.ts` | `"Image Edit"` |
| `generate-video-single-shot.ts` | `"Video Generation"` |
| `single-step-video-generator.ts` | `"Template Video"` |
| `generate-batch.ts` | `"Batch Generation"` |
| `execute-workflow.ts` | `"Space Workflow"` |
| `tavily-search.ts` | `"Web Search"` |
| `search-images.ts` | `"Image Search"` |
| `extract-images-from-url.ts` | `"Image Extraction"` |
| `analyze-brand.ts` | `"Brand Analysis"` |
| `analyze-brand-full.ts` | `"Brand Report"` |
| `display-plan.ts` | `"Execution Plan"` |
| `show-capabilities.ts` | `"Capabilities"` |
| `fetch-template-prompt.ts` | `"Template Prompt Lookup"` |
| `select-storytelling-techniques.ts` | `"Storytelling Technique Selection"` |
| `search-catalog.ts` | `"Shopify Catalog"` |
| `check-linked-account.ts` | `"Shopify Connection"` |
| `download-reel.ts` | `"Reel Download"` |
| `write-reel-script.ts` | `"Script Generation"` |
| `recreate-reel.ts` | `"Reel Recreation"` |
| `generate-from-reel-scripts.ts` | `"Script-to-Video"` |

**Note:** `name` field values were NOT changed to preserve frontend `inferToolCategory()` name-prefix matching. Name normalization (snake_case → kebab-case) is deferred to a coordinated frontend+backend change.

### Phase 4: Plan-Integrated Batch Tracking

**File:** `src/mastra/tools/generation/direct-image-gen.ts`

Added optional input fields for multi-batch tracking:

```typescript
task_group_id: z.string().optional()  // plan_id from display_plan
batch_index: z.number().optional()     // 1-indexed
total_batches: z.number().optional()
```

When `task_group_id` is set:
- All batches share the same card ID (single chip that updates)
- Non-final batches emit `status: "running"` with description "Batch 2 of 3 done (6 images)"
- Only the final batch emits `status: "completed"` with "All N images generated"

---

## Frontend Changes



### Phase 5: Fix Agent Identity

**Files:** `components/chat/agent-orb.tsx`, `components/chat/agent-utility-pill.tsx`

**Root cause:** `getAgentOrbType()` checked `displayName?.includes("generat")` and returned `"catalog-manager"`, which was then rendered as the chip label text.

**Changes:**
- Renamed `AgentOrbType` value from `"catalog-manager"` to `"content-creator"`
- `getAgentOrbType()` now uses backend `category` field as primary signal (e.g., `category === "generation"` → `"content-creator"`).

### Phase 6: Backend Category Mapping

**File:** `modules/chat-v3/adapters/ai-sdk-adapter.ts`

`inferToolCategory()` now accepts and prefers the backend's `category` field:

```typescript
const BACKEND_CATEGORY_MAP: Record<string, AgentUtilityCategory> = {
  connector: "shopify",  // refined by name prefix for service-specific icon
  search: "search",
  generation: "tool",
  workflow: "space",
  brand: "brand_memory",
  planning: "plan",
};
```

Falls back to legacy name-prefix matching for events without new categories.

### Phase 7: New Category Icons

**File:** `components/chat/agent-utility-pill.tsx`

Added icon cases for new backend categories:

| Category | Icon |
|---|---|
| `generation` | `Sparkles` |
| `workflow` | `Play` |
| `brand` | `Brain` |
| `planning` | `AlignLeft` |
| `connector` | `Plug` |

These supplement existing categories (`search` → Globe, `shopify` → Shopify SVG, etc.).

### Phase 8: Agent Utility Grouping

Consecutive agent utility pills are collapsed into a single summary chip during streaming (same pattern as `groupProgressIndicators`).

**New files:**
- `components/chat/agent-utility-group.tsx` — Group component

**Modified files:**
- `components/chat/types/chat-chunk-types.ts` — Added `AGENT_UTILITY_GROUP` content type and `AgentUtilityGroupContent` interface
- `components/chat/types/chat-types.ts` — Added new category values (`connector`, `generation`, `workflow`, `brand`, `planning`)
- `components/chat/utils/message-helpers.ts` — Added `groupConsecutiveUtilities()` function
- `components/chat/message-content-renderer.tsx` — Added grouping step in transform pipeline
- `components/chat/message-content-renderer-item.tsx` — Added render case for `AGENT_UTILITY_GROUP`

**Grouping rules:**
- 2+ consecutive `AGENT_UTILITY` items collapse into one `AGENT_UTILITY_GROUP`
- Non-utility items (text, images) break the run
- Works live during streaming via `useMemo` — groups form and grow as tools complete
- Recurses into agent-task-card children

**Group chip states:**

| State | Visual |
|---|---|
| Running | Pulsing orb, shimmer text showing latest running tool + progress count |
| Failed | Red XCircle, count of completed vs failed |
| Completed | Normal orb, "N tools completed", total duration |

**Expanded list icons (per item):**

| Item type | Icon | Running | Failed |
|---|---|---|---|
| Tool call | `Wrench` | Icon pulses + ShimmerText | Red icon + red text |
| Skill/discovery | `FileText` (doc) | Icon pulses + ShimmerText | Red icon + red text |
| Completed | Normal muted color | — | — |

Skill detection uses both `category` field (`skill`, `code`, `planning`, `plan`) and name-based fallback (`skill`, `skillsearch`, `loadtool`, `searchtool`).

---

## Known Deferred Items

1. **`display-plan.ts` double-nesting bug** (line 73): `data: { id: toolId, data }` creates `data.data` nesting. Flagged but deferred until frontend verification confirms how it handles the structure.
2. **`name` field normalization**: Event names use snake_case (`ga_list_properties`) while tool IDs use kebab-case (`ga-list-properties`). Deferred to coordinated frontend+backend change.
3. **Fallback pill dedup**: The adapter's `richEventNames` pre-scan may not suppress all fallback pills during streaming (timing issue). The grouping feature provides visual relief, but the root cause dedup should be investigated separately.
