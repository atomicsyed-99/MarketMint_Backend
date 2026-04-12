# Stream & Storage Architecture (v7)

## Overview

The chat system streams SSE events from a Mastra agent to a React frontend, persists messages to PostgreSQL, and restores them on page reload. This document describes what gets stored, how the UI renders each part, and how the streaming/reload paths work.

---

## Database Schema (no changes needed)

```typescript
messages = pgTable("messages", {
  id: bigserial,
  messageId: uuid (unique),
  chatId: uuid (FK → chats),
  role: enum("user", "ai", "tool"),
  agent: enum("none", "photographer", "developer", "planner", "finisher"),
  content: jsonb<ContentPart[]>,   // Clean, sequenced parts (~10-15 per message)
  attachments: jsonb<Attachment[]>,
  toolCalls: jsonb<ToolInvocation[]>, // Populated from tool-output-available events
  llmUsage: jsonb,
  createdAt: timestamp,
  updatedAt: timestamp,
});
```

### `content[]` — What's stored

Sequenced array of user-visible events + tool invocations. Each part has a `seq` counter for ordering. Matches the Mastra memory format closely.

### `toolCalls[]` — What's stored

Completed tool invocation records (toolCallId, toolName, args, result, status). Populated during streaming when `tool-output-available` fires. Same data as the `tool-invocation` parts in content but in a flat, queryable array.

---

## Content Part Types

### Parts persisted to `content[]`

| Type | Source | Frontend renders? | Notes |
|---|---|---|---|
| `reasoning` | Merged from reasoning-start/delta/end | Yes (collapsible) | Full thinking text, stored once on reasoning-end |
| `text` | Final assembled text from onFinish | Yes (markdown) | May appear multiple times across steps |
| `tool-invocation` | From tool-output-available | **No** (stripped on fetch) | Stored for completeness like Mastra; has full args + result |
| `step-start` | From start-step events | **No** (stripped on fetch) | Step boundary marker |
| `data-artifact` | From render-widget via writer.custom() | Yes (ArtifactCard) | Only `status: "completed"` persisted |
| `data-suggestions` | From finisherTool via writer.custom() | Yes (suggestion buttons) | Follow-up prompts |
| `data-agent-utility` | From any tool via writer.custom() | Yes (AgentUtilityPill) | Rich tool status with steps, description |
| `agent-activation` | Emitted by stream processor | Yes (AgentActivationCard) | Sub-agent delegation start/complete |
| `tool-agent` | From Mastra delegation | Yes (text content) | Sub-agent progressive text; merged by id (only latest kept). On reload, `consolidateHistoryToolCalls` converts to TEXT and strips `<thinking>` blocks |
| `image` | From generation tools via writer.custom() | Yes (image card) | Also stored in attachments[] |
| `video` / `final_video_output` | From video tools | Yes (video card) | Also stored in attachments[] |
| `data-user-action` | From tools via writer.custom() | Yes (action card) | Connect banners, batch downloads |
| `data-agent-task` | From displayPlan via writer.custom() | Yes (task card) | Execution plan display |
| `data-greeting` | From showCapabilities | Yes (greeting card) | Initial capabilities display |
| `error` | From failed operations | Yes (error display) | Error messages |

### Parts NOT persisted (streaming-only)

| Type | Why skipped |
|---|---|
| `start` | Lifecycle marker |
| `start-step` | Persisted as `step-start` for sequence tracking only |
| `finish-step` | Lifecycle marker |
| `tool-input-start` | Streaming metadata — tool tracked in memory |
| `tool-input-delta` | Character-by-character input chunks (biggest bloat source) |
| `tool-input-available` | Input stored in tool tracker, written to toolCalls on completion |
| `tool-output-available` | Output goes to toolCalls column + tool-invocation content part |
| `tool-call` / `tool-result` | Redundant with tool-invocation parts |
| `data-artifact` (loading) | Transient skeleton — only completed artifacts persisted |

---

## Rendering Rules

### Core principle

**`writer.custom()` = visible.** If a tool wants to render in the UI, it must emit a custom event via `writer.custom()`. The default `tool-invocation` parts from Mastra's tool execution are backend plumbing and are never rendered.

All 39 custom tools already use `writer.custom()`. Only Mastra built-ins (skill_read, search_tools, load_tool, read-guidelines) lack custom emits — these are correctly invisible.

### Sub-agent domain tools: `emitUtility()` requirement

Sub-agent domain tools (tools owned by Creative Director, Performance Marketing, Shopify Store Manager, Email CRM Manager) **must** use the shared `emitUtility()` helper from `src/mastra/tools/emit-utility.ts` instead of calling `writer.custom()` directly. This ensures every `data-agent-utility` event includes all fields the frontend needs to render a proper pill:

```typescript
import { emitUtility } from "@/mastra/tools/emit-utility";

execute: async (_input, context) => {
  const utilityId = crypto.randomUUID();
  emitUtility(context, {
    id: utilityId,         // UUID — SAME id for running/completed/failed
    name: "tool_id",       // matches createTool({ id: "..." })
    title: "Human Title",  // rendered in the pill header
    category: "connector", // connector | search | generation | workflow | brand | planning
    status: "running",
    description: "Running message...",
  });

  try {
    // ... tool logic ...
    emitUtility(context, {
      id: utilityId, name: "tool_id", title: "Human Title",
      category: "connector", status: "completed", description: "Done message",
    });
    return result;
  } catch (err) {
    emitUtility(context, {
      id: utilityId, name: "tool_id", title: "Human Title",
      category: "connector", status: "failed", description: "Failed message",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
```

**Key rules:**
- **Same UUID across statuses**: `id` must be the same `crypto.randomUUID()` value for `running`, `completed`, and `failed` events of the same execution. The stream processor's `mergeContentById()` uses this to update the part in-place rather than appending duplicates.
- **Always handle failures**: Wrap the tool body in try/catch, emit a `failed` event, then re-throw. Without this, a crash leaves the pill stuck in "running" forever on reload.
- **All fields required**: Omitting `name`, `title`, `category`, or `description` produces empty/broken pills in the UI. The `emitUtility()` helper enforces this via TypeScript — do not bypass it with raw `writer.custom()` calls.

### Frontend rendering dispatch

```
content[].type → Component:
  "text"               → MarkdownContentRenderer
  "reasoning"          → ReasoningContent (collapsible)
  "data-agent-utility" → AgentUtilityPill (or grouped into AgentUtilityGroup)
  "agent-activation"   → AgentActivationCard (with nested child pills)
  "data-artifact"      → ArtifactCard (iframe widget)
  "data-suggestions"   → SuggestionButtons
  "tool-agent"         → Converted to TEXT by history-tool-consolidator on reload;
                         mapped to TEXT by mapPartToContent during streaming
  "image"              → ImageCard
  "video"              → VideoCard
  "data-user-action"   → ActionRenderer
  "data-agent-task"    → TaskCard
  "data-greeting"      → GreetingCard
  "error"              → ErrorDisplay
  "tool-invocation"    → NEVER RENDERED (stripped by backend)
  "step-start"         → NEVER RENDERED (stripped by backend)
```

### Backend stripping on fetch

When `GET /messages/:chat_id` returns messages, the backend removes `tool-invocation` and `step-start` parts from `content[]` before serializing. This keeps the frontend simple and reduces payload size. The full content remains in the DB for debugging.

---

## Streaming Flow

### During streaming (SSE to client)

All events flow to the client unchanged. The stream processor intercepts events for persistence but does not modify what the client receives.

```
Mastra SSE → stream-processor → client (unchanged)
                    ↓
              DB persistence (selective)
```

### Stream processor persistence logic

```typescript
// In-memory state (StreamState shared with onFinish callback)
let seq = 0;
let currentStep = 0;
let hasSuggestions = false;          // tracks if structured suggestions were emitted
const openToolCalls = new Map<string, PartialToolCall>();
const artifactLinks = new Map<string, string>();

// Event handling (all persistence is sequential — no fire-and-forget):

"reasoning-start"       → start accumulating text
"reasoning-delta"       → append to buffer
"reasoning-end"         → await persist { seq: seq++, type: "reasoning", text: fullText }

"start-step"            → currentStep++; await persist { seq: seq++, type: "step-start" }
"finish-step"           → (skip, not persisted)

"tool-input-start"      → register in openToolCalls map; detect agent delegation
                          If agent delegation: await persist { type: "agent-activation", status: "activated" }
"tool-input-delta"      → (skip, not persisted — biggest bloat reduction)
"tool-input-available"  → store input in openToolCalls entry

"tool-output-available" → complete tool record:
                          1. Persist { seq: seq++, type: "tool-invocation",
                             toolInvocation: { state: "result", toolCallId, toolName, args, result } }
                          2. Add to toolCalls column
                          3. Remove from openToolCalls map

"data-agent-utility"    → await persist { seq: seq++, type: "agent-utility", ... }
"agent-activation"      → await persist { seq: seq++, type: "agent-activation", ... }
"tool-agent"            → await persist { seq: seq++, type: "tool-agent", ... } (progressive, merged by id)
                          If finishReason present: also await persist agent-activation (completed)
"data-artifact"         → if completed: await persist { seq: seq++, type: "artifact", ... }
"data-suggestions"      → await persist { seq: seq++, type: "suggestions", ... }; set hasSuggestions = true
"image"/"video"         → await persist + update attachments[]
(other custom events)   → await persist with seq

"text" (from onFinish)  → if hasSuggestions: strip trailing suggestions prose from finalText
                          persist { seq: seq++, type: "text", text: cleanedFinalText }
```

### Sequence ordering

The `seq` counter is a global monotonic counter that increments for **every** persisted event. This includes events later stripped on fetch (tool-invocation, step-start) and events replaced in-place (tool-agent progressive text). Visible content will have **gaps** in seq values — this is expected, not a bug.

Example from a sub-agent delegation with ~240 total persisted events:
```
seq 1:   reasoning                        (visible)
seq 2:   agent-activation (activated)     (visible)
seq 3-13: step-start + tool-invocations   (stripped on fetch — gaps!)
seq 14-19: agent-utility events           (visible)
seq 20-195: tool-agent updates + tool-invocations (tool-agent replaced in-place, invocations stripped)
seq 196: artifact                         (visible)
seq 240: tool-agent (final version)       (visible — seq jumped because of in-place replacements)
seq 241: agent-activation (completed)     (visible)
seq 244: suggestions                      (visible)
seq 247: text (from onFinish)             (visible)
```

**Array order vs seq order:** `mergeContentById` replaces parts by ID in-place, so the array position of a part reflects when it was **first inserted**, not its final seq. For example, tool-agent (seq 240) may appear at array position 2 because the first tool-agent chunk was inserted early. The frontend's `nestAgentActivationChildren` processes items in array order. This is a known limitation — for correct rendering order, a future `sortBySeq()` step can be added to the history consolidator pipeline.

---

## Reload Flow

### Fetching history

```
Frontend: GET /messages/:chat_id
Backend:  Query messages → strip tool-invocation + step-start from content → return
Frontend: Render content[] parts through same component dispatch
```

### Frontend history processing pipeline

After receiving clean content[], the frontend applies four transforms:

1. **`convertToolAgentParts()`** — converts `tool-agent` DB parts into proper `TextContent` items. Also strips `<thinking>...</thinking>` blocks from the sub-agent's text (the sub-agent's reasoning leaks into the progressive text field). During streaming, `mapPartToContent()` handles the type conversion on-the-fly; on reload, the DB stores `{ type: "tool-agent", data: { text } }` which has no corresponding `MessageContentType`.

2. **`mergeAgentActivationStatus()`** — merges `agent-activation` completed events into the matching activated pill (in-place status update) and emits a lightweight `AGENT_END` marker at the completion position. **No nesting** — all content between activated/completed renders flat. The activation pill is a simple status indicator, not a card with nested children.

3. **`moveSuggestionsToEnd()`** — reorders `SUGGESTIONS` items to the end of the array. Suggestions get a lower seq than the final text because the finisher tool emits them during execution, while `onFinish` persists text last. Semantically, suggestions ("what to do next") should always render after the response.

4. **`groupConsecutiveUtilities()`** — 2+ consecutive `agent-utility` items collapse into an `AGENT_UTILITY_GROUP` ("5 tools completed" collapsible).

These run identically during streaming and reload, producing the same UI.

---

## Example 1: Skill Invocation + Widget Rendering

**User prompt:** "Show me my Google Analytics data for the last 7 days"

### What happens during streaming

```
Step 1: Agent calls skill_read (x2), search_tools, load_tool (x2)
  → SSE events flow to client (tool-input-start/delta/available/output-available)
  → Stream processor: tracks in openToolCalls, does NOT persist deltas
  → On each tool-output-available: persists tool-invocation + adds to toolCalls

Step 2: Agent calls read-guidelines
  → Same pattern: tracked → persisted as tool-invocation on completion

Step 3: Agent calls render-widget
  → tool-input-start: skeleton injected to client (data-artifact loading)
  → render-widget execute() calls writer.custom():
    - Emits data-artifact (completed) with full widget HTML
  → tool-output-available: tool-invocation persisted, toolCalls updated

Step 4: Agent writes analysis text
  → text-delta events stream to client
  → onFinish: final text persisted as { type: "text" }

Step 5: Agent calls finisherTool
  → finisherTool execute() calls writer.custom():
    - Emits data-suggestions with follow-up prompts
  → tool-invocation persisted, toolCalls updated
```

### What's stored in DB

```json
{
  "content": [
    { "seq": 0, "type": "reasoning", "text": "The user wants GA data..." },
    { "seq": 1, "type": "step-start" },
    { "seq": 2, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_01...", "toolName": "skill_read",
        "args": { "skillName": "generative-ui", "path": "references/chart.md" },
        "result": "File not found..."
    }},
    { "seq": 3, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_02...", "toolName": "skill_read",
        "args": { "skillName": "generative-ui", "path": "references/mockup.md" },
        "result": "File not found..."
    }},
    { "seq": 4, "type": "step-start" },
    { "seq": 5, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_03...", "toolName": "search_tools",
        "args": { "query": "render widget dashboard" },
        "result": { "results": [{ "name": "render-widget", "score": 11.29 }, ...] }
    }},
    { "seq": 6, "type": "step-start" },
    { "seq": 7, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_04...", "toolName": "load_tool",
        "args": { "toolName": "render-widget" },
        "result": { "success": true }
    }},
    { "seq": 8, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_05...", "toolName": "load_tool",
        "args": { "toolName": "read-guidelines" },
        "result": { "success": true }
    }},
    { "seq": 9, "type": "step-start" },
    { "seq": 10, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_06...", "toolName": "read-guidelines",
        "args": { "modules": ["chart", "mockup"] },
        "result": { "guidelines": "...(long)...", "loaded_modules": ["chart", "mockup"] }
    }},
    { "seq": 11, "type": "step-start" },
    { "seq": 12, "type": "artifact", "id": "artifact_toolu_07...", "data": {
        "id": "artifact_toolu_07...", "kind": "generative-ui", "status": "completed",
        "title": "Google Analytics — Last 7 Days",
        "widget": { "widget_code": "<style>...</style><div>...</div><script>...</script>", "width": 900, "height": 780 }
    }},
    { "seq": 13, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_07...", "toolName": "render-widget",
        "args": { "title": "Google Analytics — Last 7 Days", "widget_code": "..." },
        "result": { "ok": true, "title": "Google Analytics — Last 7 Days" }
    }},
    { "seq": 14, "type": "text", "text": "Here's your GA report for the last 7 days!..." },
    { "seq": 15, "type": "suggestions", "data": {
        "suggestions": ["Show me what content drove the spike...", "Break down Display channel...", ...]
    }},
    { "seq": 16, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_08...", "toolName": "finisherTool",
        "args": { "generated_content_summary": "Rendered a GA4 dashboard..." },
        "result": { "suggestions": [...] }
    }}
  ],
  "toolCalls": [
    { "state": "result", "toolCallId": "toolu_01...", "toolName": "skill_read", "args": {...}, "result": "..." },
    { "state": "result", "toolCallId": "toolu_02...", "toolName": "skill_read", "args": {...}, "result": "..." },
    { "state": "result", "toolCallId": "toolu_03...", "toolName": "search_tools", "args": {...}, "result": {...} },
    { "state": "result", "toolCallId": "toolu_04...", "toolName": "load_tool", "args": {...}, "result": {...} },
    { "state": "result", "toolCallId": "toolu_05...", "toolName": "load_tool", "args": {...}, "result": {...} },
    { "state": "result", "toolCallId": "toolu_06...", "toolName": "read-guidelines", "args": {...}, "result": {...} },
    { "state": "result", "toolCallId": "toolu_07...", "toolName": "render-widget", "args": {...}, "result": {...} },
    { "state": "result", "toolCallId": "toolu_08...", "toolName": "finisherTool", "args": {...}, "result": {...} }
  ]
}
```

### What frontend receives (after backend stripping)

```json
{
  "content": [
    { "seq": 0, "type": "reasoning", "text": "The user wants GA data..." },
    { "seq": 12, "type": "artifact", "id": "artifact_toolu_07...", "data": { ... widget ... } },
    { "seq": 14, "type": "text", "text": "Here's your GA report for the last 7 days!..." },
    { "seq": 15, "type": "suggestions", "data": { "suggestions": [...] } }
  ],
  "tool_calls": [ ... full list for debugging/analytics ... ]
}
```

### What renders in the UI

```
┌─────────────────────────────────────────┐
│ 💭 Thinking... (collapsible)            │  ← reasoning
│ "The user wants GA data..."             │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 📊 Google Analytics — Last 7 Days   │ │  ← artifact card (iframe)
│ │ [KPI cards, charts, doughnut...]    │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Here's your GA report for the last 7    │  ← text (markdown)
│ days! A few highlights:                 │
│ - 📈 Traffic spiked mid-week...        │
│ - 👥 3,434 total sessions...           │
├─────────────────────────────────────────┤
│ [Show me what content drove...]         │  ← suggestion buttons
│ [Break down Display channel...]         │
│ [Why is paid search underperforming...] │
└─────────────────────────────────────────┘
```

No tool pills visible. The 8 tool invocations (skill_read x2, search_tools, load_tool x2, read-guidelines, render-widget, finisherTool) are stored in DB but invisible to the user.

---

## Example 2: Sub-Agent Delegation (Shopify Store Manager)

**User prompt:** "Analyze my Shopify store health"

### Mastra's two-identifier convention for sub-agents

Mastra uses two different identifiers for sub-agents in stream responses:
- **`toolName`** in tool-call events = `"agent-<objectKey>"` (camelCase, e.g. `"agent-shopifyStoreManagerAgent"`)
- **`id`** in `data-tool-agent` chunks = the subagent's actual `id` property (kebab-case, e.g. `"shopify-store-manager-agent"`)

The stream processor normalizes both to the **agent's actual `id`** (kebab-case) via `toolNameToAgentId()` so activation events use a consistent identifier.

### What happens during streaming

```
Step 1: Supervisor decides to delegate
  → tool-input-start: toolName "agent-shopifyStoreManagerAgent"
  → Stream processor converts to agentId: "shopify-store-manager-agent" (via toolNameToAgentId)
  → Emits: data-agent-activation { agentId: "shopify-store-manager-agent", status: "activated" }
  → Persists agent-activation part

Step 2: Sub-agent runs internally
  → Sub-agent calls its own tools (computeStoreSignals, catalogHealthAudit, etc.)
  → Sub-agent tools use writer.custom() → data-agent-utility events flow through SSE
  → These utility events are persisted to content[] with seq counters
  → Sub-agent's tool-input-start/delta/available are NOT in the SSE stream (invisible)

Step 3: Sub-agent completes
  → Mastra emits data-tool-agent: { id: "shopify-store-manager-agent", text: "analysis...", finishReason: "stop" }
  → Stream processor uses agentData.id directly (already kebab-case)
  → Emits: data-agent-activation { agentId: "shopify-store-manager-agent", status: "completed" }
  → Persists tool-agent text + completion activation

Step 4: Supervisor continues
  → May write additional text or call finisherTool
```

### What's stored in DB

```json
{
  "content": [
    { "seq": 0, "type": "agent-activation", "id": "act-activated-...", "data": {
        "agentId": "shopify-store-manager-agent",
        "agentName": "Shopify Store Manager",
        "status": "activated",
        "description": "Shopify Store Manager is working on your request..."
    }},
    { "seq": 1, "type": "step-start" },
    { "seq": 2, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_delegation...",
        "toolName": "agent-shopifyStoreManagerAgent",
        "args": { "message": "Analyze the store health..." },
        "result": { "text": "Based on my analysis..." }
    }},
    { "seq": 3, "type": "agent-utility", "id": "util-signals-...", "data": {
        "type": "data-agent-utility", "name": "Compute Store Signals",
        "status": "completed", "description": "Analyzed 45 products...",
        "steps": [
          { "title": "Fetching product catalog", "status": "completed", "duration_ms": 1200 },
          { "title": "Computing health signals", "status": "completed", "duration_ms": 800 }
        ]
    }},
    { "seq": 4, "type": "agent-utility", "id": "util-audit-...", "data": {
        "type": "data-agent-utility", "name": "Catalog Health Audit",
        "status": "completed", "description": "Found 3 issues...",
        "steps": [...]
    }},
    { "seq": 5, "type": "tool-agent", "id": "tool-agent-shopify-store-manager-agent", "data": {
        "id": "shopify-store-manager-agent",
        "text": "Based on my analysis of your Shopify store...",
        "finishReason": "stop"
    }},
    { "seq": 6, "type": "agent-activation", "id": "act-completed-...", "data": {
        "agentId": "shopify-store-manager-agent",
        "agentName": "Shopify Store Manager",
        "status": "completed"
    }},
    { "seq": 7, "type": "text", "text": "Here's a summary of your store health..." },
    { "seq": 8, "type": "suggestions", "data": { "suggestions": [...] } },
    { "seq": 9, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_finisher...",
        "toolName": "finisherTool", "args": {...}, "result": { "suggestions": [...] }
    }}
  ],
  "toolCalls": [
    { "state": "result", "toolCallId": "toolu_delegation...", "toolName": "agent-shopifyStoreManagerAgent", ... },
    { "state": "result", "toolCallId": "toolu_finisher...", "toolName": "finisherTool", ... }
  ]
}
```

### What frontend receives (after backend stripping)

```json
{
  "content": [
    { "seq": 0, "type": "agent-activation", "data": { "agentId": "shopify-store-manager-agent", "status": "activated", "agentName": "Shopify Store Manager" } },
    { "seq": 3, "type": "agent-utility", "data": { "name": "Compute Store Signals", "status": "completed", ... } },
    { "seq": 4, "type": "agent-utility", "data": { "name": "Catalog Health Audit", "status": "completed", ... } },
    { "seq": 5, "type": "tool-agent", "data": { "text": "Based on my analysis...", "finishReason": "stop" } },
    { "seq": 6, "type": "agent-activation", "data": { "agentId": "shopify-store-manager-agent", "status": "completed", "agentName": "Shopify Store Manager" } },
    { "seq": 7, "type": "text", "text": "Here's a summary of your store health..." },
    { "seq": 8, "type": "suggestions", "data": { "suggestions": [...] } }
  ]
}
```

### Frontend processing

1. **`convertToolAgentParts()`** converts seq 5 (`tool-agent`) → `{ type: "text", text: "Based on my analysis..." }` (strips `<thinking>` blocks if present)

2. **`mergeAgentActivationStatus()`** — flat processing, no nesting:
   - seq 0: agent-activation (activated) → renders as simple pill
   - seq 3: agent-utility → passes through flat
   - seq 4: agent-utility → passes through flat
   - seq 5: text (was tool-agent) → passes through flat
   - seq 6: agent-activation (completed) → merges status into seq 0 pill + emits AGENT_END marker
   - seq 7: text → passes through flat
   - seq 8: suggestions → passes through

3. **`moveSuggestionsToEnd()`** — moves seq 8 (suggestions) to end of array (after seq 7 text)

4. **`groupConsecutiveUtilities()`** — seq 3 + seq 4 → grouped: "2 tools completed"

### What renders in the UI

```
┌─────────────────────────────────────────┐
│ 🤖 Shopify Store Manager ✓  Completed  │  ← activation pill (status updated in-place)
├─────────────────────────────────────────┤
│ ✅ 2 tools completed                   │  ← grouped utility pills
│   ├─ Compute Store Signals             │
│   └─ Catalog Health Audit              │
├─────────────────────────────────────────┤
│ Based on my analysis of your store...   │  ← sub-agent text (flat, top-level)
├─────────────────────────────────────────┤
│ ── Shopify Store Manager completed ──   │  ← AGENT_END marker (subtle divider)
├─────────────────────────────────────────┤
│ Here's a summary of your store health...│  ← supervisor text
├─────────────────────────────────────────┤
│ [Fix the 3 catalog issues]             │  ← suggestion buttons
│ [Show me product performance trends]   │
└─────────────────────────────────────────┘
```

---

## Example 3: Direct Tool Call with Rich UI (Image Generation)

**User prompt:** "Generate a product photo of a red dress"

### What's stored

```json
{
  "content": [
    { "seq": 0, "type": "reasoning", "text": "User wants a product photo..." },
    { "seq": 1, "type": "agent-utility", "data": {
        "name": "Generate Image", "status": "completed",
        "description": "Generated product photo of red dress",
        "steps": [
          { "title": "Preparing prompt", "status": "completed", "duration_ms": 200 },
          { "title": "Generating image", "status": "completed", "duration_ms": 8500 },
          { "title": "Uploading to CDN", "status": "completed", "duration_ms": 1200 }
        ]
    }},
    { "seq": 2, "type": "image", "id": "img-001", "data": {
        "url": "https://cdn.example.com/generated/red-dress.jpg",
        "tag": "generated"
    }},
    { "seq": 3, "type": "step-start" },
    { "seq": 4, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_gen...",
        "toolName": "generateSingleImage",
        "args": { "prompt": "product photo of red dress..." },
        "result": { "url": "https://cdn.example.com/generated/red-dress.jpg" }
    }},
    { "seq": 5, "type": "text", "text": "Here's your product photo!" },
    { "seq": 6, "type": "suggestions", "data": { "suggestions": ["Edit the background", ...] } },
    { "seq": 7, "type": "tool-invocation", "toolInvocation": {
        "state": "result", "toolCallId": "toolu_fin...",
        "toolName": "finisherTool", "args": {...}, "result": { "suggestions": [...] }
    }}
  ]
}
```

### What frontend receives (stripped)

```json
{
  "content": [
    { "seq": 0, "type": "reasoning", "text": "User wants a product photo..." },
    { "seq": 1, "type": "agent-utility", "data": { "name": "Generate Image", "status": "completed", "steps": [...] } },
    { "seq": 2, "type": "image", "data": { "url": "https://cdn.example.com/generated/red-dress.jpg" } },
    { "seq": 5, "type": "text", "text": "Here's your product photo!" },
    { "seq": 6, "type": "suggestions", "data": { "suggestions": [...] } }
  ]
}
```

### What renders

```
┌─────────────────────────────────────────┐
│ ✅ Generate Image                       │  ← AgentUtilityPill
│ Generated product photo of red dress    │
│ ▼ 3 steps completed                    │  ← collapsible step list
│   ├─ Preparing prompt (0.2s)           │
│   ├─ Generating image (8.5s)           │
│   └─ Uploading to CDN (1.2s)          │
├─────────────────────────────────────────┤
│ 🖼️ [Product photo of red dress]        │  ← image card
├─────────────────────────────────────────┤
│ Here's your product photo!              │  ← text
├─────────────────────────────────────────┤
│ [Edit the background]                   │  ← suggestions
│ [Generate more variations]              │
└─────────────────────────────────────────┘
```

---

## Stream Processor Write Strategy

### Incremental writes during streaming

For crash safety, the stream processor persists parts as they arrive. Only user-visible custom events + tool-invocations are persisted. Deltas and lifecycle markers are skipped.

```typescript
const SKIP_FOR_CONTENT = new Set([
  "start", "finish-step",
  "tool-input-start", "tool-input-delta", "tool-input-available",
  "tool-output-available",  // handled separately → writes tool-invocation + toolCalls
  "tool-call", "tool-result",
]);

// Events that go to content[] get a seq counter
// tool-output-available → creates tool-invocation part + updates toolCalls column
// start-step → persisted as step-start (for sequence tracking)
// reasoning-start/delta/end → accumulated, persisted once as reasoning
```

### On stream finish

The `onFinish` callback is an AI SDK callback that fires **after** the agent's entire generation loop completes — all steps done, stream fully consumed. It receives `finalResult.text` (the LLM's last text output) and persists it as the final content part with `seq: streamState.seq + 1`.

**Why suggestions always have a lower seq than text:** The `finisherTool` is a tool call that executes **during** the agent's active stream — it needs the `writer` to emit `data-suggestions` via `writer.custom()`. By the time `onFinish` fires, the writer is being finalized and can't emit custom SSE events. So the timeline is always: finisher emits suggestions (seq N) → stream completes → onFinish persists text (seq N+X). The frontend's `moveSuggestionsToEnd()` compensates by reordering suggestions after text on reload.

**Suggestion deduplication:** If a structured `data-suggestions` event was emitted during the stream (tracked via `streamState.hasSuggestions`), the `onFinish` handler strips trailing suggestion prose from `finalText` before persisting. This prevents the same suggestions from rendering twice — once as interactive UI buttons (from the suggestions event) and again as markdown text (from the LLM's freeform response).

### Merge strategy

`mergeContentById()` is unchanged:
- Parts WITH `id`: replace existing part with same id (progressive updates like tool-agent)
- Parts WITHOUT `id`: append (new parts)

All persistence calls in the stream processor use `await` (no fire-and-forget). This prevents race conditions where concurrent writes to the same message could cause lost updates through `mergeContentById`.

The `seq` counter ensures correct ordering regardless of merge order in the content array.

---

## Backend Stripping Logic

When the messages API returns messages to the frontend:

```typescript
function stripInternalParts(content: ContentPart[]): ContentPart[] {
  return content.filter(part =>
    part.type !== "tool-invocation" && part.type !== "step-start"
  );
}
```

Applied in `GET /messages/:chat_id` and `GET /messages/:chat_id/legacy` endpoints.

The `tool_calls` field is still returned in the response for debugging/analytics — the frontend simply doesn't render pills from it.

---

## Migration / Backward Compatibility

### Old messages (pre-redesign)

Old messages have 430+ parts in content[] including all deltas and lifecycle events. The backend stripping still works — it removes `tool-invocation` and `step-start` parts. The remaining parts (text, reasoning, agent-utility, etc.) render correctly.

The frontend's existing rendering pipeline handles both old and new formats because it dispatches on `content[].type` — types it doesn't recognize are ignored.

### No schema migration needed

The existing `content` and `toolCalls` columns accept any jsonb. The change is purely in what data the stream processor writes. Old rows are untouched.

---

## Summary: Before vs After

### Before (430+ parts, ~500KB)
```
content: [
  { type: "start" },
  { type: "start-step" },
  { type: "tool-input-start", toolName: "skill_read", toolCallId: "..." },
  { type: "tool-input-delta", toolCallId: "...", inputTextDelta: "{\"ski" },
  { type: "tool-input-delta", toolCallId: "...", inputTextDelta: "ll" },
  { type: "tool-input-delta", toolCallId: "...", inputTextDelta: "Na" },
  ... (hundreds more deltas for each tool) ...
  { type: "tool-input-available", toolCallId: "...", input: {...} },
  { type: "tool-output-available", toolCallId: "...", output: "File not found" },
  { type: "finish-step" },
  { type: "start-step" },
  ... (repeat for every tool) ...
]
toolCalls: []  // always empty
```

### After (~15 parts, ~15-25KB)
```
content: [
  { seq: 0, type: "reasoning", text: "..." },
  { seq: 1, type: "step-start" },
  { seq: 2, type: "tool-invocation", toolInvocation: { state: "result", toolName: "skill_read", args: {...}, result: "..." } },
  { seq: 3, type: "tool-invocation", toolInvocation: { state: "result", toolName: "skill_read", args: {...}, result: "..." } },
  ... (one entry per tool, not hundreds of deltas) ...
  { seq: 12, type: "artifact", data: { kind: "generative-ui", status: "completed", widget: {...} } },
  { seq: 14, type: "text", text: "Here's your GA report!..." },
  { seq: 15, type: "suggestions", data: { suggestions: [...] } },
]
toolCalls: [
  { state: "result", toolCallId: "...", toolName: "skill_read", args: {...}, result: "..." },
  { state: "result", toolCallId: "...", toolName: "render-widget", args: {...}, result: {...} },
  ...
]
```

---

## Issue Resolution Checklist

| # | Issue | Status | How it's resolved |
|---|---|---|---|
| 1 | 430+ content parts per message | [x] | Stream processor skips deltas/lifecycle, persists ~15 clean sequenced parts |
| 2 | ~500KB+ per message in DB | [x] | Only final-state parts stored (no deltas) |
| 3 | `toolCalls` column always empty | [x] | Populated from tool-output-available events |
| 4 | Tool status "running" on reload | [x] | `emitUtility()` uses same UUID for running/completed; `mergeContentById` replaces in-place |
| 5 | Internal tools visible as pills | [x] | Backend strips `tool-invocation`; tools must opt-in via `writer.custom()` |
| 6 | No full-text search | [ ] | Deferred — text stored as content part, can add column later |
| 7 | No explicit event ordering | [x] | Every part has `seq` counter |
| 8 | Diverged streaming/reload paths | [x] | Backend strips internal parts; same dispatch in both paths |
| 9 | Sub-agent nesting on reload | [x] | `nestAgentActivationChildren` nests utility, text, reasoning, artifact inside activation cards |
| 10 | Unnecessary data over the wire | [x] | Backend strips tool-invocation + step-start |
| 11 | Old messages still render | [x] | Backend stripping + frontend ignores unknown types |
| 12 | Sub-agent text missing on reload | [x] | `convertToolAgentParts()` converts `tool-agent` → TEXT in history consolidator |
| 13 | `<thinking>` tags in sub-agent text | [x] | `convertToolAgentParts()` strips `<thinking>...</thinking>` blocks |
| 14 | Suggestions rendered twice | [x] | `streamState.hasSuggestions` flag; `onFinish` strips trailing suggestions prose |
| 15 | Suggestions before text on reload | [x] | `moveSuggestionsToEnd()` reorders in history consolidator |
| 16 | Sub-agent artifacts outside card | [x] | `ARTIFACT` added to nestable types in `nestAgentActivationChildren` |
| 17 | Persistence race conditions | [x] | All persistence calls use `await` (no fire-and-forget) |
| 18 | Array order ≠ seq order | [ ] | Known limitation — `mergeContentById` replaces in-place. `sortBySeq()` deferred. |
