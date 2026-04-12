#MarketMint Supervisor Agent System — Architecture Reference

> This document captures the implemented multi-agent supervisor system.
> For streaming/storage architecture, see `docs/stream-storage-architecture.md`.
> For cron/heartbeat system, see `docs/cron-heartbeat-system.md`.

---

## Overview

MarketMint uses a **Mastra supervisor agent pattern** where a central orchestrator delegates tasks to 4 specialist sub-agents. Each sub-agent owns a domain and has its own tools, skills, and connector access.

```
User → POST /cowork/v3/chat → Clerk auth → handleChatStream
    → Orchestrator (MarketMintAgent, Claude Sonnet 4.6)
        ├─→ Creative Director (Claude Sonnet 4.6)
        ├─→ Performance Marketing Manager (Claude Sonnet 4.6)
        ├─→ Shopify Store Manager (Claude Sonnet 4.6)
        └─→ Email & CRM Manager (Claude Haiku 4.5)
```

Sub-agents are also directly callable via `POST /cowork/agents/:agentId/run`.

---

## Mastra Tool Naming Convention

From Mastra docs — **`toolName` in stream = object key, NOT the tool's `id`**:

| Registration | toolName in stream events | id in data-tool-agent |
|---|---|---|
| `tools: { directImageGen }` | `"directImageGen"` | N/A |
| `agents: { shopifyStoreManagerAgent }` | `"agent-shopifyStoreManagerAgent"` | `"shopify-store-manager-agent"` |

This means:
- Regular tools appear as camelCase: `"finisherTool"`, `"renderWidget"`, `"searchShopifyCatalog"`
- Sub-agent delegations appear as `"agent-"` + camelCase key: `"agent-shopifyStoreManagerAgent"`
- The agent's actual `id` (kebab-case) appears only in `data-tool-agent` chunks

---

## File Structure

```
src/mastra/agents/
  marketmint-agent.ts                    # Supervisor orchestrator
  prompts/
    orchestrator-prompt.ts           # NEW: Delegation routing prompt
    tool-based-orchestrator.ts       # OLD: Preserved as reference
  creative-director/
    agent.ts                         # Agent definition
    prompt.ts                        # Lean prompt with skill loading rules
    tools.ts                         # 15 domain tools + Meta Ads read-only
  performance-marketing/
    agent.ts                         # Agent definition
    prompt.ts
    tools.ts                         # 6 domain tools + 5 connectors (read-only)
    tools/
      analyze-ad-performance.ts
      detect-fatigue.ts
      budget-waste-scanner.ts
      generate-performance-report.ts
  shopify-store-manager/
    agent.ts                         # Agent definition
    prompt.ts
    tools.ts                         # 8 domain tools (incl. shopify catalog) + Shopify/GA4/Sheets connectors
    tools/
      compute-store-signals.ts
      catalog-health-audit.ts
      inventory-alert-scanner.ts
      draft-review-response.ts
  email-crm-manager/
    agent.ts                         # Agent definition (Haiku 4.5)
    prompt.ts
    tools.ts                         # 6 domain tools + Klaviyo connector
    tools/
      audit-klaviyo-flows.ts
      flow-performance-monitor.ts
      generate-campaign-copy.ts
      segment-health-check.ts
  shared/
    build-scoped-tools.ts            # Connector scoping + requireApproval
    agent-workspaces.ts              # Per-agent scoped workspaces

src/mastra/tools/
  index.ts                           # orchestratorTools (12) + dynamicTools
  emit-utility.ts                    # Shared emitUtility() helper for tool events

src/mastra/skills/                   # 49 skill folders, each with SKILL.md
  agent-orchestration/SKILL.md       # Delegation routing rules skill
  creative-generation/SKILL.md       # ...etc

src/routes/
  chat.ts                            # __connections added to requestContext
  chat/stream-processor.ts           # Agent activation detection, tool call tracking
  agents.ts                          # POST /cowork/agents/:agentId/run
```

---

## Orchestrator Configuration

### `src/mastra/agents/marketmint-agent.ts`

```typescript
export const marketmintAgent = new Agent({
  id: "marketmint-agent",
  name: "MarketMint Content Agent",
  instructions: ORCHESTRATOR_PROMPT,
  model: "anthropic/claude-sonnet-4-6",
  tools: orchestratorTools,      // 8 tools (no image gen, no executeWorkflow)
  memory: agentMemory,           // PostgreSQL, 20 messages, working memory per-user
  workspace: agentWorkspace,     // BM25-indexed skills
  agents: {
    shopifyStoreManagerAgent,
    creativeDirectorAgent,
    performanceMarketingAgent,
    emailCrmManagerAgent,
  },
  defaultOptions: {
    delegation: {
      onDelegationStart,         // Guards iteration > 8, sets modifiedMaxSteps: 15
      onDelegationComplete,      // Logs token usage, returns feedback on error
      messageFilter,             // System msgs + last 10 non-system msgs
    },
    onIterationComplete,         // Stops on finishReason "stop"/"end_turn", hard cap at 6
  },
});
```

### Orchestrator Tools (12 — routing + connector management)

| Tool | Purpose |
|------|---------|
| `displayPlan` | Multi-step plan display |
| `finisherTool` | Follow-up suggestions |
| `analyzeBrand` | External brand analysis |
| `analyzeBrandFull` | User's brand analysis + memory |
| `tavilySearch` | Web search |
| `searchImages` | Image search |
| `extractImagesFromUrl` | URL image extraction |
| `deliverContent` | Copyable content panels |
| `generatePresentation` | Presentation/deck generation |
| `showConnectBanner` | Prompt user to connect services |
| `listConnectedIntegrations` | List connected services |
| `refreshConnections` | Refresh connection status |

**Removed from orchestrator**: `directImageGen`, `executeWorkflow` (moved to Creative Director).

### Orchestrator Prompt

File: `src/mastra/agents/prompts/orchestrator-prompt.ts`

Sections:
1. **Identity** — supervisor, pure routing, never generate content
2. **Agent descriptions** — all 4 sub-agents with delegation table
3. **Delegation routing** — intent → agent decision tree + "what YOU handle directly"
4. **Inter-agent chains** (max 3) — fatigue→creative, reviews→email, spend→store
5. **Parallel vs sequential** — independent analyses → parallel; dependent → sequential
6. **Brand memory** — analyze_brand_full first pattern
7. **Tools** — 8 orchestrator tools with intent routing
8. **Response hygiene** — hide URLs, no model names
9. **Greeting handler** — standard intro message
10. **Finisher rules** — AT MOST once, after ALL tasks, no duplicate suggestions in text

---

## Sub-Agent Specifications

### Creative Director

| Property | Value |
|---|---|
| ID | `creative-director-agent` |
| Model | Claude Sonnet 4.6 |
| Tools | 16 domain tools + Meta Ads (read-only) |
| Skills | 25 (loaded on-demand via `creativeDirectorWorkspace`) |
| Connector access | Meta Ads (insights/creatives only, read-only) |

**Domain tools**: directImageGen, executeWorkflow, imageEdit, generateSingleImage, generateVideoSingleShot, singleStepVideoGenerator, generateVideoFromReelScripts, recreateReel, downloadReel, writeReelScript, selectStorytellingTechniques, fetchTemplatePrompt, deliverContent, analyzeBrandFull, renderWidget, generatePresentation

### Performance Marketing Manager

| Property | Value |
|---|---|
| ID | `performance-marketing-agent` |
| Model | Claude Sonnet 4.6 |
| Tools | 6 domain + 5 connectors (all read-only) |
| Skills | 3 (paid-ads, ab-test-setup, analytics-tracking) |
| Connector access | Meta Ads, Google Ads, GA4, Google Sheets, PostHog |

**New domain tools**: analyzeAdPerformance, detectFatigue, budgetWasteScanner, generatePerformanceReport

### Shopify Store Manager

| Property | Value |
|---|---|
| ID | `shopify-store-manager-agent` |
| Model | Claude Sonnet 4.6 |
| Tools | 8 domain + Shopify/GA4/Sheets connectors |
| Skills | 11 (shopify, shopify-storefront, seo-audit, schema-markup, page-cro, programmatic-seo, form-cro, onboarding-cro, paywall-upgrade-cro, popup-cro, signup-flow-cro) |
| Connector access | Shopify (full, writes need approval), GA4, Google Sheets |

**Domain tools**: computeStoreSignals, catalogHealthAudit, inventoryAlertScanner, draftReviewResponse, searchShopifyCatalog, checkLinkedShopifyAccount, deliverContent, renderWidget

### Email & CRM Manager

| Property | Value |
|---|---|
| ID | `email-crm-manager-agent` |
| Model | Claude Haiku 4.5 (cost optimization) |
| Tools | 6 domain + Klaviyo connector |
| Skills | 3 (email-sequence, copywriting, ab-test-setup) |
| Connector access | Klaviyo (full, writes need approval) |

**New domain tools**: auditKlaviyoFlows, flowPerformanceMonitor, generateCampaignCopy, segmentHealthCheck

---

## Connector Scoping

### `src/mastra/agents/shared/build-scoped-tools.ts`

Each sub-agent gets only the connectors it needs. Write operations get `requireApproval: true` (propagates through supervisor via Mastra's agent approval mechanism).

```typescript
const AGENT_CONNECTOR_MAP = {
  "creative-director-agent":       { connectorIds: ["meta-ads"], readOnly: true, toolFilter: insights/creatives },
  "performance-marketing-agent":   { connectorIds: ["meta-ads", "google-ads", "google-analytics", "google-sheets", "posthog"], readOnly: true },
  "shopify-store-manager-agent":   { connectorIds: ["shopify", "google-analytics", "google-sheets"] },
  "email-crm-manager-agent":       { connectorIds: ["klaviyo"] },
};
```

### Connector Inventory (141 tools total)

| Connector | Total | READ | WRITE | Sub-Agent |
|---|---|---|---|---|
| Shopify | 62 | 38 | 24 | Store Manager |
| Klaviyo | 24 | 17 | 7 | Email & CRM |
| Meta Ads | 15 | 11 | 4 | Creative Dir + Perf Mktg |
| PostHog | 14 | 10 | 4 | Perf Mktg |
| Google Ads | 11 | 9 | 2 | Perf Mktg |
| Google Sheets | 9 | 3 | 6 | Store Mgr + Perf Mktg |
| GA4 | 6 | 6 | 0 | Store Mgr + Perf Mktg |

---

## Tool Event Emission Pattern

All new sub-agent tools use the shared `emitUtility()` helper from `src/mastra/tools/emit-utility.ts`:

```typescript
import { emitUtility } from "@/mastra/tools/emit-utility";

execute: async (_input, context) => {
  const utilityId = crypto.randomUUID();

  emitUtility(context, {
    id: utilityId,
    name: "tool_name",
    title: "Human Readable Title",
    category: "connector",           // connector | search | generation | workflow | brand | planning
    status: "running",
    description: "Doing the thing...",
  });

  try {
    const result = await doWork();

    emitUtility(context, {
      id: utilityId, name: "tool_name", title: "Title",
      category: "connector", status: "completed", description: "Done",
    });
    return result;
  } catch (err) {
    emitUtility(context, {
      id: utilityId, name: "tool_name", title: "Title",
      category: "connector", status: "failed", description: "Failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
```

This emits `data-agent-utility` events that the frontend renders as AgentUtilityPill components (running → completed/failed transitions with animated status).

---

## Stream Processing

### Agent Delegation Detection

File: `src/routes/chat/stream-processor.ts`

Delegation detected via `tool-input-start` events where `toolName.startsWith("agent-")`:

```typescript
function isAgentDelegation(toolName: string): boolean {
  return typeof toolName === "string" && toolName.startsWith("agent-");
}

function toolNameToAgentId(toolName: string): string {
  // "agent-shopifyStoreManagerAgent" → "shopify-store-manager-agent"
  const stripped = toolName.replace(/^agent-/, "");
  return stripped.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
```

Activation events emitted with the kebab-case `agentId` (matching frontend `AGENT_CONFIG` keys):
- `tool-input-start` with `agent-*` → emit `data-agent-activation` (status: activated)
- `data-tool-agent` with `finishReason` → emit `data-agent-activation` (status: completed)

### Sub-Agent Text Persistence

`data-tool-agent` events carry progressive sub-agent text. Persisted with stable ID (`tool-agent-${agentId}`) so `mergeContentById` replaces in-place — only final text survives.

### StreamState

Shared mutable state between stream-processor and chat route's onFinish:

```typescript
export interface StreamState {
  seq: number;                    // Event sequence counter
  hasSuggestions?: boolean;       // Whether suggestions event was emitted
}
```

### Persistence Strategy

See `docs/stream-storage-architecture.md` for the full storage redesign.

Summary: Only user-visible events persisted to `content[]`. Tool calls tracked via accumulator and written to `tool_calls` column on `tool-output-available`. All `*-delta` events skipped.

---

## Memory Architecture

- **Orchestrator** owns `agentMemory` (PostgreSQL, 20 messages, working memory per-user)
- **Sub-agents** inherit supervisor memory automatically (Mastra internals)
- Each delegation gets a unique thread ID for clean separation
- Resource ID is deterministic: `{parentResourceId}-{agentName}`
- Brand context flows via system messages → messageFilter passes all system messages to sub-agents

### Working Memory Template

```markdown
# Brand Context
- Brand Name, URL, Industry, Target Audience, Voice/Tone
- Color Palette, Typography, Visual Style

# User Preferences
- Preferred Image Style, Default Output Count, Preferred Workflows

# Active Campaigns
- Meta Ads Status, Google Ads Status, Last Fatigue Alert

# Store Health
- Inventory Alerts, Catalog Completeness, Last Audit Date

# Email/CRM Status
- Active Flows Count, Last Flow Audit
```

---

## Skills System

Each agent has its own scoped workspace (defined in `src/mastra/agents/shared/agent-workspaces.ts`) with BM25-indexed skills from `src/mastra/skills/`. Skills loaded on-demand via `skill_search`/`skill` tools.

**Scoping**: Each workspace instance lists only the individual skill folder paths relevant to that agent. This prevents skill bleed (e.g., Creative Director cannot load CRO skills).

| Agent | Workspace | Skill Count |
|-------|-----------|-------------|
| Orchestrator | `orchestratorWorkspace` | 11 |
| Creative Director | `creativeDirectorWorkspace` | 25 |
| Performance Marketing | `perfMarketingWorkspace` | 3 |
| Shopify Store Manager | `storeManagerWorkspace` | 11 |
| Email & CRM Manager | `emailCrmWorkspace` | 3 |

---

## Inter-Agent Chains

### Chain Rules (max 3 agents)

1. **Perf Marketing → Creative Director**: Fatigue detected → refresh briefs
2. **Store Manager → Email & CRM**: Negative reviews → post-purchase flow
3. **Perf Marketing → Store Manager**: High spend low CVR → PDP audit
4. **3-agent chain**: PerfMktg → Store → Email (cascading findings)

### Parallel Delegation

Independent analyses delegated simultaneously (LLM parallel tool calls). Examples:
- "Audit my store and ads" → Store Manager + PerfMktg in parallel
- "Full business health check" → 3+ agents in parallel

---

## Direct Agent API

### `POST /cowork/agents/:agentId/run`

File: `src/routes/agents.ts`

Authenticated via Clerk middleware. Returns JSON (not SSE). Used for direct agent testing and future cron job entry point.

```typescript
const mastra = c.get("mastra");
const agent = mastra.getAgent(agentId);
const result = await agent.generate(prompt, { requestContext, maxSteps: 15 });
return c.json({ text: result.text, toolResults: result.toolResults });
```

---

## Frontend Integration

### Agent Activation Cards

File: `apps/marketmint-pro/components/chat/agent-activation/agent-config.ts`

`getAgentConfig()` normalizes both kebab-case (`shopify-store-manager-agent`) and Mastra camelCase (`agent-shopifyStoreManagerAgent`) to resolve display names.

```typescript
const AGENT_CONFIG = {
  "creative-director-agent":       { displayName: "Creative Director", orbType: "creative-director" },
  "performance-marketing-agent":   { displayName: "Performance Marketing", orbType: "performance-marketing" },
  "shopify-store-manager-agent":   { displayName: "Shopify Store Manager", orbType: "shopify-store-manager" },
  "email-crm-manager-agent":       { displayName: "Email & CRM Manager", orbType: "email-crm-manager" },
};
```

### `<thinking>` Tag Rendering

File: `apps/marketmint-pro/components/chat/message-content-renderer-item.tsx`

Sub-agent `<thinking>` blocks in TEXT content are parsed and rendered as collapsible `ReasoningContent` components (same as orchestrator reasoning). Function `splitThinkingBlocks()` splits text into alternating thinking/text segments.

### Internal Tools Filter

See `docs/stream-storage-architecture.md` — internal tools (finisherTool, skillRead, searchTools, loadTool, readGuidelines, renderWidget) filtered from rendering as AgentUtility pills.

---

## Chat Route Changes

### `src/routes/chat.ts`

Added `requestContext.set("__connections", connections)` so sub-agent tools can access raw workspace connections for connector scoping.

### `src/mastra/index.ts`

All 4 sub-agents registered in Mastra instance + direct agent API route added:

```typescript
agents: {
  marketMintAgent, finisherAgent, brandAnalyzerAgent,
  shopifyStoreManagerAgent, creativeDirectorAgent,
  performanceMarketingAgent, emailCrmManagerAgent,
},
```

---

## Key Decisions & Trade-offs

| Decision | Rationale |
|---|---|
| Shared `agentWorkspace` for all sub-agents | Mastra skills array takes parent dirs only. BM25 search scope naturally filtered by domain-specific queries. |
| Static delegation hooks in `defaultOptions` | No per-request closures needed. Brand context flows via system messages + messageFilter. |
| All Sonnet 4.6 except Email & CRM (Haiku 4.5) | Email & CRM has simpler tasks. Haiku reduces cost without quality loss. |
| `onIterationComplete` stops on `finishReason: "stop"` | Prevents runaway loops. Without this, supervisor kept iterating after greetings. |
| orchestratorTools has 8 tools (no image gen) | Forces delegation for creative work. `coreTools` preserved as legacy fallback. |
| `emitUtility()` helper for all new tools | Consistent rich tool events. Frontend renders as AgentUtilityPill instead of raw tool-call chips. |

---

## Open Items

- [ ] Implement actual Shopify/Klaviyo/Meta API calls in domain tools (currently placeholder/TODO)
- [ ] Test inter-agent chains end-to-end (fatigue → creative, reviews → email)
- [ ] Test parallel delegation (multi-agent concurrent execution)
- [ ] Verify agent approval propagation for connector write operations
- [ ] Test `data-tool-agent` text persistence + `<thinking>` rendering on reload
- [ ] Validate stream-storage architecture changes (separate doc)
