# Multi-Agent Supervisor System — Implementation Plan

## Context

marketmint currently runs a monolithic `marketmintAgent` handling all intents (image gen, brand analysis, store audits, ads, email flows). We're evolving to a **supervisor + sub-agent** system using Mastra's Supervisor Agent pattern, where specialized agents own their domain while remaining orchestrated through chat and independently callable via API.

Prior plans:
- `sprightly-floating-hamming.md` — original architecture
- `eager-growing-pretzel.md` — audit identifying 18 gaps

This plan resolves all gaps and provides the final architecture for the supervisor agent system. The cron/heartbeat system is in a separate document (`cron-heartbeat-system.md`).

---

## Gap Resolution Summary

| # | Gap | Severity | Resolution |
|---|-----|----------|------------|
| 1 | `handleChatStream` vs delegation hooks | CRITICAL | Static delegation hooks in Agent constructor `defaultOptions`. `handleChatStream` unchanged — it calls `agent.stream()` internally which auto-applies `defaultOptions`. |
| 2 | No writer in delegation hooks | CRITICAL | Detect delegation tool calls in stream processor → emit `data-agent-activation` events. No writer needed in hooks. |
| 3 | Memory for supervisor | CRITICAL | Orchestrator's existing `agentMemory` satisfies requirement. Sub-agents inherit via Mastra internals. |
| 4 | Connector scoping vs ToolSearchProcessor | MAJOR | Static tools on sub-agents via `tools: ({ requestContext }) => ...`. Only orchestrator keeps ToolSearchProcessor. |
| 5 | Skill workspace scoping | MAJOR | Per-agent workspaces with scoped `skills` arrays + BM25 search. On-demand loading via `skill_search`/`skill` tools. |
| 6 | Orchestrator prompt rewrite | MAJOR | Full rewrite: strip content gen, add delegation routing rules, agent descriptions, chain instructions. |
| 7 | Fragile signal markers | SIGNIFICANT | Orchestrator handles chaining via its own reasoning (reads sub-agent response, decides next step). No text markers. |
| 10 | Skill count inconsistency | MINOR | Fixed: Creative Director = 24, Store Manager = 15. |
| 11 | Brand context flow | SIGNIFICANT | Brand context already in conversation as system messages (injected by chat route). `messageFilter` passes all system messages to sub-agents. |
| 12 | Model selection | MODERATE | All Sonnet 4.6 except Email & CRM (Haiku 4.5). |
| 13 | Missing connectors | MODERATE | Google Sheets → Store Manager + Perf Marketing. PostHog → Perf Marketing. |
| 14 | generative-ui scope | MODERATE | Orchestrator only for skill. Sub-agents get `renderWidget` tool directly. |
| 15 | finisherTool chains | MODERATE | Orchestrator prompt rule: "Call finisher only after the FINAL agent in a chain completes." |
| 16 | Static vs per-request hooks | MODERATE | Resolved — static hooks sufficient. Brand context via system messages. requestContext propagates automatically. |
| 17 | Frontend coordination | MINOR | Track as separate frontend work item. Stream processor maps delegation events. |
| 18 | Nested skill discovery | MINOR | Per-agent workspaces handle this naturally via BM25. |

---

## Architecture Overview

```
                    ┌─────────────────────────────────┐
                    │  POST /cowork/v3/chat            │
                    └──────────┬──────────────────────┘
                               │
                    ┌──────────▼──────────────────────┐
                    │  Orchestrator (marketmintAgent)       │
                    │  Supervisor — pure routing        │
                    │  Model: Claude Sonnet 4.6         │
                    │  Memory: agentMemory (owned)      │
                    │  Workspace: agentWorkspace        │
                    │  Skills: agent-orchestration +    │
                    │    generative-ui, templates,      │
                    │    strategy skills                │
                    │  Tools: displayPlan, finisher,    │
                    │    analyzeBrand*, tavilySearch,    │
                    │    searchImages, extractImages,    │
                    │    deliverContent                 │
                    │  agents: { 4 sub-agents }         │
                    └──┬─────┬──────┬──────┬──────────┘
                       │     │      │      │  delegation (Mastra supervisor)
              ┌────────▼┐ ┌─▼─────┐│  ┌───▼──────────┐
              │Creative  │ │Perf   ││  │Email & CRM   │
              │Director  │ │Mktg   ││  │Manager       │
              │Sonnet4.6 │ │Son4.6 ││  │Haiku 4.5     │
              └──────────┘ └───────┘│  └──────────────┘
                                    │
                              ┌─────▼────────┐
                              │Shopify Store  │
                              │Manager        │
                              │Sonnet 4.6     │
                              └───────────────┘

    ┌─────────────────────────────────────────────────┐
    │  POST /cowork/agents/:agentId/run               │
    │  (Direct invocation — authenticated API)        │
    │  Each sub-agent independently callable          │
    └─────────────────────────────────────────────────┘
```

---

## 1. Supervisor Agent Configuration

### Approach: Static `defaultOptions` on Agent Constructor + `handleChatStream` Unchanged

Delegation hooks go in `defaultOptions` on the Agent constructor (canonical Mastra pattern per Research Coordinator guide). `handleChatStream` stays unchanged — it calls `agent.stream()` internally, which auto-applies `defaultOptions`.

**Why this works without per-request closures:**
- Brand context: Already in conversation as system messages. `messageFilter` passes system messages to sub-agents.
- requestContext: Mastra propagates requestContext to sub-agent tool execution automatically.
- Agent activation: Detected in stream processor via delegation tool call events.
- Inter-agent chains: Handled by orchestrator's own reasoning.

```typescript
// src/mastra/agents/marketmint-agent.ts
import { creativeDirectorAgent } from "./creative-director/agent";
import { performanceMarketingAgent } from "./performance-marketing/agent";
import { shopifyStoreManagerAgent } from "./shopify-store-manager/agent";
import { emailCrmManagerAgent } from "./email-crm-manager/agent";

export const marketmintAgent = new Agent({
  id: "marketmint-agent",
  name: "marketmint Orchestrator",
  instructions: ORCHESTRATOR_PROMPT,
  model: "anthropic/claude-sonnet-4-6",
  tools: orchestratorTools,
  memory: agentMemory,
  workspace: agentWorkspace,
  agents: {
    creativeDirectorAgent,
    performanceMarketingAgent,
    shopifyStoreManagerAgent,
    emailCrmManagerAgent,
  },
  defaultOptions: {
    maxSteps: 10,
    delegation: {
      onDelegationStart: async ({ primitiveId, prompt, iteration }) => {
        console.log(`[delegation:start] → ${primitiveId} (iteration ${iteration})`);
        if (iteration > 20) {
          return { proceed: false, rejectionReason: "Max iterations reached. Synthesize current findings." };
        }
        return { proceed: true, modifiedMaxSteps: 15 };
      },
      onDelegationComplete: async ({ primitiveId, result, error, bail }) => {
        if (error) {
          console.error(`[delegation:error] ${primitiveId}:`, error);
          return { feedback: `Delegation to ${primitiveId} failed: ${error}. Try a different approach.` };
        }
        console.log(`[delegation:complete] ${primitiveId}`);
      },
      messageFilter: ({ messages, primitiveId }) => {
        const systemMsgs = messages.filter(m => m.role === "system");
        const recentMsgs = messages.filter(m => m.role !== "system").slice(-10);
        return [...systemMsgs, ...recentMsgs];
      },
    },
    onIterationComplete: async ({ iteration, maxIterations, finishReason, text }) => {
      console.log(`[supervisor] iteration ${iteration}/${maxIterations}, reason: ${finishReason}`);
      if (iteration >= 20) return { continue: false };
      return { continue: true };
    },
  },
});
```

### Memory Isolation (Automatic per Mastra docs)

- Each delegation gets a **unique thread ID** for clean separation
- Resource ID is deterministic: `{parentResourceId}-{agentName}`
- Sub-agents receive full conversation context (via messageFilter) but only their delegation prompt/response is saved to their memory

### Chat Route — No Changes to `handleChatStream`

```typescript
// src/routes/chat.ts — UNCHANGED (existing code)
const stream = await handleChatStream({
  mastra,
  agentId: "marketmintAgent",
  params: { /* all existing params unchanged */ },
  sendReasoning: true,
});
```

Only addition: store raw connections in requestContext for sub-agent connector tools:
```typescript
const connections = await getUserConnections(workspaceId);
requestContext.set("__connections", connections); // NEW
requestContext.set("__connectorProcessor", getOrCreateConnectorProcessor(workspaceId, connections));
```

### Fallback: Direct `agent.stream()`

Only if `defaultOptions.delegation` hooks don't fire through `handleChatStream`:
```typescript
const agentInstance = mastra.getAgent("marketmintAgent");
const mastraStream = agentInstance.stream(messagesForAgent, {
  maxSteps: 10,
  modelSettings: { temperature: 0.7, maxOutputTokens: 30000 },
  providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 4000 }, sendReasoning: true } },
  memory: { thread: { id: chat_id }, resource: user.id },
  requestContext,
  inputProcessors: [connectorProcessor],
  onFinish: async (finalResult) => { /* persist AI message */ },
});
const stream = toAISdkStream(mastraStream, { sendReasoning: true });
```

---

## 2. Agent Activation Stream Events

### Approach: Stream Processor Detection

Mastra's supervisor pattern internally creates delegation tool calls to sub-agents. These appear in the SSE stream. We detect them in `wrapStreamWithPersistence` and emit `data-agent-activation` events.

```typescript
// src/routes/chat/stream-processor.ts — additions

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "creative-director-agent": "Creative Director",
  "performance-marketing-agent": "Performance Marketing Manager",
  "shopify-store-manager-agent": "Shopify Store Manager",
  "email-crm-manager-agent": "Email & CRM Manager",
};

// Inside stream event processing loop:
if (event.type === "tool-call") {
  const agentName = AGENT_DISPLAY_NAMES[event.toolName];
  if (agentName) {
    emitCustomEvent({
      type: "data-agent-activation",
      data: { agentId: event.toolName, agentName, status: "activated",
        description: `${agentName} is working on your request...` },
    });
  }
}

if (event.type === "tool-result") {
  const agentName = AGENT_DISPLAY_NAMES[event.toolName];
  if (agentName) {
    emitCustomEvent({
      type: "data-agent-activation",
      data: { agentId: event.toolName, agentName, status: "completed" },
    });
  }
}
```

**Validation needed**: Confirm that supervisor delegation appears as tool calls with the sub-agent ID as `toolName`. If Mastra uses a different event format (e.g., `agent-execution-start`), adapt the detection accordingly.

---

## 3. Sub-Agent Specifications

### Creative Director Agent

```typescript
// src/mastra/agents/creative-director/agent.ts
import { creativeDirectorWorkspace } from "../shared/agent-workspaces";

export const creativeDirectorAgent = new Agent({
  id: "creative-director-agent",
  name: "Creative Director",
  description: "Handles ALL visual content creation: marketing images, product photography, " +
    "lifestyle/studio shoots, video production, ad creatives, copy, and brand-aligned designs. " +
    "Delegate here for any image generation, video creation, copywriting, or creative brief.",
  model: "anthropic/claude-sonnet-4-6",
  instructions: CREATIVE_DIRECTOR_PROMPT, // lean identity + tool rules + skill loading instructions
  tools: ({ requestContext }) => buildCreativeDirectorTools(requestContext),
  workspace: creativeDirectorWorkspace, // BM25-indexed, 24 skills
});
```

**Tools**: directImageGen, executeWorkflow, imageEdit, generateSingleImage, generateVideoSingleShot, singleStepVideoGenerator, generateVideoFromReelScripts, recreateReel, downloadReel, writeReelScript, selectStorytellingTechniques, fetchTemplatePrompt, deliverContent, analyzeBrandFull, renderWidget

**Skills via workspace** (24): creative-director, creative-generation, creative-video-generation, static-ad-creative, hero-campaign-banner, social-content, copywriting, copy-editing, paid-ads, video-generator, template-video, garment-in-lifestyle-settings, garment-in-studio-settings, non-garment-in-lifestyle-settings, non-garment-in-studio-settings, multiple-try-on, product-swap-or-try-on, background-replacer, image-editing, sketch-to-product, material-close-up, jewellery-photoshoot, feature-highlight-graphic, product-infographic

**Connector access**: Meta Ads (read-only: insights, creatives)

### Performance Marketing Manager Agent

```typescript
import { perfMarketingWorkspace } from "../shared/agent-workspaces";

export const performanceMarketingAgent = new Agent({
  id: "performance-marketing-agent",
  name: "Performance Marketing Manager",
  description: "Analyzes ad performance across Meta and Google, detects creative fatigue, " +
    "identifies budget waste, tracks ROAS/CAC/CTR metrics. Delegate here for any " +
    "ad performance questions, campaign analysis, or marketing analytics.",
  model: "anthropic/claude-sonnet-4-6",
  instructions: PERF_MARKETING_PROMPT,
  tools: ({ requestContext }) => buildPerfMarketingTools(requestContext),
  workspace: perfMarketingWorkspace, // BM25-indexed, 3 skills
});
```

**Tools (existing)**: renderWidget, deliverContent
**Tools (new)**: analyzeAdPerformance, detectFatigue, budgetWasteScanner, generatePerformanceReport
**Connector access**: Meta Ads, Google Ads, GA4, Google Sheets, PostHog (all read-only)
**Skills via workspace**: paid-ads, ab-test-setup, analytics-tracking

### Shopify Store Manager Agent

```typescript
import { storeManagerWorkspace } from "../shared/agent-workspaces";

export const shopifyStoreManagerAgent = new Agent({
  id: "shopify-store-manager-agent",
  name: "Shopify Store Manager",
  description: "Manages Shopify store operations: store audits, inventory monitoring, " +
    "catalog health, SEO, conversion optimization, product management. Delegate here " +
    "for any Shopify store questions, audits, or optimization.",
  model: "anthropic/claude-sonnet-4-6",
  instructions: STORE_MANAGER_PROMPT,
  tools: ({ requestContext }) => buildStoreManagerTools(requestContext),
  workspace: storeManagerWorkspace, // BM25-indexed, 15 skills (incl. nested shopify/*)
});
```

**Tools (existing)**: searchShopifyCatalog, renderWidget, deliverContent
**Tools (new)**: computeStoreSignals, draftReviewResponse, inventoryAlertScanner, catalogHealthAudit
**Connector access**: Shopify (all — write tools use `requireApproval: true`), GA4 (read-only), Google Sheets
**Skills via workspace** (15): shopify (+ sub-skills), shopify-storefront, seo-audit, schema-markup, programmatic-seo, page-cro, form-cro, popup-cro, onboarding-cro, signup-flow-cro, paywall-upgrade-cro

### Email & CRM Manager Agent

```typescript
import { emailCrmWorkspace } from "../shared/agent-workspaces";

export const emailCrmManagerAgent = new Agent({
  id: "email-crm-manager-agent",
  name: "Email & CRM Manager",
  description: "Manages email marketing and CRM: Klaviyo flows, campaign copy, " +
    "audience segmentation, email A/B testing. Delegate here for any email " +
    "sequence, Klaviyo, or CRM questions.",
  model: "anthropic/claude-haiku-4-5-20251001",
  instructions: EMAIL_CRM_PROMPT,
  tools: ({ requestContext }) => buildEmailCrmTools(requestContext),
  workspace: emailCrmWorkspace, // BM25-indexed, 3 skills
});
```

**Tools (existing)**: deliverContent, renderWidget
**Tools (new)**: auditKlaviyoFlows, flowPerformanceMonitor, generateCampaignCopy, segmentHealthCheck
**Connector access**: Klaviyo (all — write tools use `requireApproval: true`)
**Skills via workspace**: email-sequence, copywriting, ab-test-setup

---

## 4. Connector Scoping

### Static Tools with Per-Request Connection Filtering

Each sub-agent has a `tools` function that builds its tool set from connections in `requestContext`. No ToolSearchProcessor for sub-agents.

```typescript
// src/mastra/agents/shared/build-scoped-tools.ts

const AGENT_CONNECTOR_MAP: Record<string, AgentConnectorConfig> = {
  "creative-director-agent": {
    connectorIds: ["meta-ads"],
    readOnly: true,
    toolFilter: (id) => id.includes("insight") || id.includes("creative"),
  },
  "performance-marketing-agent": {
    connectorIds: ["meta-ads", "google-ads", "google-analytics", "google-sheets", "posthog"],
    readOnly: true,
  },
  "shopify-store-manager-agent": {
    connectorIds: ["shopify", "google-analytics", "google-sheets"],
  },
  "email-crm-manager-agent": {
    connectorIds: ["klaviyo"],
  },
};

export function buildScopedConnectorTools(agentId, requestContext) {
  const config = AGENT_CONNECTOR_MAP[agentId];
  const connections = requestContext.get("__connections");
  if (!config || !connections) return {};

  const tools = {};
  for (const connectorId of config.connectorIds) {
    const conn = connections[connectorId];
    if (!conn) continue;
    const connector = CONNECTOR_REGISTRY[connectorId];
    const connectorTools = connector.toolFactory(conn.connectionId, conn.apiKeys);
    for (const [toolId, tool] of Object.entries(connectorTools)) {
      if (config.readOnly && isWriteTool(toolId)) continue;
      if (config.toolFilter && !config.toolFilter(toolId)) continue;
      if (isWriteTool(toolId)) {
        tools[toolId] = { ...tool, requireApproval: true }; // Agent approval for writes
      } else {
        tools[toolId] = tool;
      }
    }
  }
  return tools;
}
```

### Agent Approval for Write Operations

Connector write tools use Mastra's `requireApproval: true`. Approval requests propagate up through the supervisor delegation chain and surface to the user as `tool-call-approval` chunks in the SSE stream.

**Which tools need approval**: All 47 connector WRITE operations across all connectors. Read operations (94 tools) do NOT require approval.

### Connector Tool Inventory (Audit Results)

| Connector | Total | READ | WRITE | Sub-Agent Access |
|-----------|-------|------|-------|------------------|
| Shopify | 62 | 38 | 24 | Store Manager (full), Perf Marketing (orders/shop read-only) |
| Klaviyo | 24 | 17 | 7 | Email & CRM (full) |
| Meta Ads | 15 | 11 | 4 | Perf Marketing (full), Creative Dir (read-only: insights/creatives) |
| PostHog | 14 | 10 | 4 | Perf Marketing (full) |
| Google Ads | 11 | 9 | 2 | Perf Marketing (full) |
| Google Sheets | 9 | 3 | 6 | Store Manager + Perf Marketing |
| GA4 | 6 | 6 | 0 | Store Manager + Perf Marketing |
| **Total** | **141** | **94** | **47** | |

**High-risk write tools (financial/destructive — must have approval):**
- `shopify_create_refund` — sends money
- `shopify_cancel_order` — may trigger refund
- `shopify_delete_product` — irreversible
- `shopify_adjust_inventory` / `shopify_set_inventory_level` — affects fulfillment
- `meta_ads_update_campaign` / `google_ads_update_campaign` — pause/enable/budget changes
- `klaviyo_unsubscribe_profile` — removes subscriber

**Known connector gaps (acceptable for Phase 1-3, fill incrementally):**
- Meta Ads: Can't create new ads (only campaigns/ad sets), no audience management
- Google Ads: Can't create campaigns or ad groups (only update existing)
- Klaviyo: Can create campaigns but NOT send/trigger them, can't update flow status (pause/start)
- PostHog: Can't delete feature flags, limited dashboard CRUD

---

## 5. Skill Distribution — Per-Agent Workspaces

Each sub-agent gets its own `Workspace` instance with BM25 search over only its relevant skill directories. Skills loaded on-demand via `skill_search`/`skill` tools — same proven pattern as the current orchestrator, just with a narrower search space.

```typescript
// src/mastra/agents/shared/agent-workspaces.ts
import { Workspace, LocalFilesystem } from "@mastra/core/workspace";

const projectRoot = resolve(import.meta.dirname, "../../../..");

const CREATIVE_DIRECTOR_SKILLS = [
  "skills_v2/creative-director", "skills_v2/creative-generation",
  "skills_v2/creative-video-generation", "skills_v2/static-ad-creative",
  "skills_v2/hero-campaign-banner", "skills_v2/social-content",
  "skills_v2/copywriting", "skills_v2/copy-editing", "skills_v2/paid-ads",
  "skills_v2/video-generator", "skills_v2/template-video",
  "skills_v2/garment-in-lifestyle-settings", "skills_v2/garment-in-studio-settings",
  "skills_v2/non-garment-in-lifestyle-settings", "skills_v2/non-garment-in-studio-settings",
  "skills_v2/multiple-try-on", "skills_v2/product-swap-or-try-on",
  "skills_v2/background-replacer", "skills_v2/image-editing",
  "skills_v2/sketch-to-product", "skills_v2/material-close-up",
  "skills_v2/jewellery-photoshoot", "skills_v2/feature-highlight-graphic",
  "skills_v2/product-infographic",
];

const PERF_MARKETING_SKILLS = [
  "skills_v2/paid-ads", "skills_v2/ab-test-setup", "skills_v2/analytics-tracking",
];

const STORE_MANAGER_SKILLS = [
  "skills_v2/shopify", "skills_v2/shopify-storefront", "skills_v2/seo-audit",
  "skills_v2/schema-markup", "skills_v2/programmatic-seo",
  "skills_v2/page-cro", "skills_v2/form-cro", "skills_v2/popup-cro",
  "skills_v2/onboarding-cro", "skills_v2/signup-flow-cro", "skills_v2/paywall-upgrade-cro",
];

const EMAIL_CRM_SKILLS = [
  "skills_v2/email-sequence", "skills_v2/copywriting", "skills_v2/ab-test-setup",
];

function createScopedWorkspace(id: string, skills: string[]): Workspace {
  return new Workspace({
    id,
    filesystem: new LocalFilesystem({ basePath: projectRoot, contained: true, readOnly: true }),
    skills,
    bm25: true,
  });
}

export const creativeDirectorWorkspace = createScopedWorkspace("creative-director-ws", CREATIVE_DIRECTOR_SKILLS);
export const perfMarketingWorkspace = createScopedWorkspace("perf-marketing-ws", PERF_MARKETING_SKILLS);
export const storeManagerWorkspace = createScopedWorkspace("store-manager-ws", STORE_MANAGER_SKILLS);
export const emailCrmWorkspace = createScopedWorkspace("email-crm-ws", EMAIL_CRM_SKILLS);
```

**Orchestrator keeps its existing workspace** (`agentWorkspace`) for routing-level skills.

---

## 6. Orchestrator Prompt Rewrite

### New Prompt Structure

```
src/mastra/agents/prompts/orchestrator-prompt.ts

1. IDENTITY (10 lines)
   - "You are the marketmint Orchestrator. You route requests to specialist agents."
   - Never generate content directly

2. AGENT DESCRIPTIONS (20 lines)
   - Creative Director: what it handles, when to delegate
   - Performance Marketing: what it handles, when to delegate
   - Shopify Store Manager: what it handles, when to delegate
   - Email & CRM Manager: what it handles, when to delegate

3. DELEGATION ROUTING RULES (30 lines)
   - Intent → agent mapping (clear decision tree)
   - Multi-intent → display_plan first, then delegate parts sequentially
   - Ambiguous → ask user to clarify before delegating
   - NEVER delegate: greetings, clarifications, "what can you do"

4. INTER-AGENT CHAIN RULES (20 lines)
   - PerfMktg fatigue → Creative Director refresh briefs
   - Store negative reviews → Email & CRM post-purchase flow
   - PerfMktg high spend low CVR → Store Manager PDP audit
   - Chain up to 3 agents. If 4th needed, suggest as follow-up. Finisher only after final agent.

5. PARALLEL vs SEQUENTIAL DELEGATION (10 lines)
   - Independent analyses → delegate to multiple agents simultaneously
   - Dependent tasks → delegate sequentially, wait for each result
   - Never mix parallel and sequential in the same step

6. BRAND MEMORY FLOW (15 lines)
   - If brand memory toggle ON → call analyze_brand_full FIRST
   - Include brand context when delegating (already in working memory)

7. TOOLS YOU OWN (15 lines)
   - displayPlan, finisherTool, analyzeBrand, analyzeBrandFull
   - tavilySearch, searchImages, extractImagesFromUrl, deliverContent
   - skill_search / skill (for orchestrator-level skills only)

8. RESPONSE HYGIENE (10 lines)
   - Preserved from current prompt

9. GREETING HANDLER (5 lines)
   - Preserved from current prompt
```

**Stripped**: ALL garment workflow rules, image gen rules, skill-specific instructions, tool choice by intent, template/space flow instructions.

---

## 7. Inter-Agent Chains & Parallel Delegation

### Sequential Chains (Orchestrator-Driven, No Signal Markers)

The orchestrator reads sub-agent responses and decides whether to chain. More robust than text-based markers.

**Chain Rules (in orchestrator prompt):**

1. **Performance Marketing → Creative Director**: When PerfMktg reports creative fatigue, declining CTR, or ad frequency above threshold
2. **Shopify Store Manager → Email & CRM**: When Store Manager finds clustered negative reviews for a product category
3. **Performance Marketing → Shopify Store Manager**: When PerfMktg finds high ad spend but low conversion rate products
4. **Performance Marketing → Store Manager → Email & CRM**: High spend → PDP audit reveals review issues → post-purchase flow fix

**Chain limit: max 3 agents** (original + up to 2 follow-ups).

| Chain depth | Approx time | Acceptable? |
|-------------|-------------|-------------|
| 1 agent | 10-20s | Always |
| 2 agents | 20-40s | Yes |
| 3 agents | 40-60s | Yes for complex analysis |
| 4+ agents | 60s+ | No — present findings and suggest next step instead |

**Rules:**
- Chain up to 3 agents when findings from one agent directly require action from the next.
- After a chain completes, present a unified summary — never expose chain mechanics.
- If a 4th agent would be needed, present findings and suggest it as a follow-up.
- Call finisher_tool ONLY after the final agent in the chain completes.

### Parallel Delegation

Mastra's supervisor pattern exposes sub-agents as tools. Modern LLMs support **parallel tool calls** — calling multiple tools in a single step. The orchestrator can delegate to multiple sub-agents simultaneously when tasks are independent.

**How it works:**
1. Orchestrator determines the user's request needs multiple independent analyses
2. LLM emits parallel tool calls (e.g., `performance-marketing-agent` + `shopify-store-manager-agent` in one step)
3. Mastra executes them concurrently
4. Results return to orchestrator in the same step
5. Orchestrator synthesizes a unified response

**When to use parallel delegation:**
- "Give me a full business health check" → PerfMktg + Store Manager + Email & CRM in parallel
- "How's my store and my ads?" → Store Manager + PerfMktg in parallel
- "Audit everything" → all 4 agents in parallel

**When to use sequential delegation:**
- "Check ads, if fatigue then refresh creatives" → PerfMktg first, then conditionally Creative Director
- Any task where output of agent A is input to agent B

**Orchestrator prompt guidance:**
```
## Parallel vs Sequential Delegation

- For independent analyses (e.g., "audit my store and ads"), delegate to
  multiple agents simultaneously by calling them in the same step.
- For dependent tasks (e.g., "if fatigue, refresh creatives"), delegate
  sequentially — wait for the first agent's response before deciding the next.
- Never mix parallel and sequential in the same step. Complete parallel
  calls first, then evaluate results for potential chains.
```

**Stream processor note:** Multiple agents can be `"activated"` simultaneously. The frontend should handle overlapping `data-agent-activation` events by rendering multiple status cards.

---

## 8. Direct Agent API Route

```typescript
// src/routes/agents.ts — POST /cowork/agents/:agentId/run
export async function agentRunRoute(c: Context) {
  const user = c.get("authUser"); // Clerk auth
  const { agentId } = c.req.param();
  const { prompt, context: userContext } = await c.req.json();

  const agent = mastra.getAgent(agentId);
  if (!agent) return c.json({ error: "Agent not found" }, 404);

  const requestContext = buildAgentRequestContext(user, userContext);
  const result = await agent.generate(prompt, { requestContext, maxSteps: 15 });

  return c.json({ text: result.text, toolResults: result.toolResults });
}
```

---

## 9. Memory & Brand Context Flow

### Memory Architecture

- **Orchestrator**: Owns `agentMemory` (PostgreSQL, 20 last messages, working memory per-user)
- **Sub-agents**: Inherit supervisor's memory automatically:
  - Each delegation: unique thread ID
  - Resource ID: deterministic `{parentResourceId}-{agentName}`
  - Only delegation prompt/response saved to sub-agent memory

### Brand Context Flow

1. Chat route injects brand memory block + connector capabilities as system messages
2. `messageFilter` passes ALL system messages to sub-agents
3. Sub-agents see brand context without explicit hook injection
4. No `onDelegationStart` prompt modification needed

### Working Memory Template (Extended)

```markdown
# Brand Context
- **Brand Name**:
- **Brand URL**:
- **Industry**:
- **Target Audience**:
- **Brand Voice/Tone**:
- **Color Palette**:
- **Typography Preferences**:
- **Visual Style**:

# User Preferences
- **Preferred Image Style**:
- **Default Output Count**:
- **Preferred Workflows**:

# Active Campaigns
- **Meta Ads Status**:
- **Google Ads Status**:
- **Last Fatigue Alert**:

# Store Health
- **Inventory Alerts**:
- **Catalog Completeness**:
- **Last Audit Date**:

# Email/CRM Status
- **Active Flows Count**:
- **Last Flow Audit**:
```

---

## 10. Tool Distribution

### Orchestrator Tools (8 — routing only, no content gen)

| Tool | Purpose |
|------|---------|
| displayPlan | Multi-step plan display |
| finisherTool | Follow-up suggestions |
| analyzeBrand | External brand analysis |
| analyzeBrandFull | User's brand analysis + memory |
| tavilySearch | Web search |
| searchImages | Image search |
| extractImagesFromUrl | URL image extraction |
| deliverContent | Copyable content panels |

**Removed from orchestrator**: `directImageGen`, `executeWorkflow` → moved to Creative Director

### Creative Director Tools (15)

directImageGen, executeWorkflow, imageEdit, generateSingleImage, generateVideoSingleShot, singleStepVideoGenerator, generateVideoFromReelScripts, recreateReel, downloadReel, writeReelScript, selectStorytellingTechniques, fetchTemplatePrompt, deliverContent, analyzeBrandFull, renderWidget

### Performance Marketing Tools (6)

analyzeAdPerformance (NEW), detectFatigue (NEW), budgetWasteScanner (NEW), generatePerformanceReport (NEW), renderWidget, deliverContent

### Shopify Store Manager Tools (7)

computeStoreSignals (NEW), draftReviewResponse (NEW), inventoryAlertScanner (NEW), catalogHealthAudit (NEW), searchShopifyCatalog, renderWidget, deliverContent

### Email & CRM Manager Tools (6)

auditKlaviyoFlows (NEW), flowPerformanceMonitor (NEW), generateCampaignCopy (NEW), segmentHealthCheck (NEW), renderWidget, deliverContent

**Plus connector tools** — each agent gets scoped connector tools built at runtime (see Section 4).

---

## 11. File Structure

```
skills_v2/
  agent-orchestration/
    SKILL.md                                 # NEW: Delegation routing rules

src/mastra/agents/
  marketmint-agent.ts                            # MODIFY: Add agents + defaultOptions.delegation
  creative-director/
    agent.ts                                 # NEW
    prompt.ts                                # NEW (lean identity + tool rules)
    tools.ts                                 # NEW
  performance-marketing/
    agent.ts                                 # NEW
    prompt.ts                                # NEW
    tools.ts                                 # NEW
    tools/
      analyze-ad-performance.ts              # NEW
      detect-fatigue.ts                      # NEW
      budget-waste-scanner.ts                # NEW
      generate-performance-report.ts         # NEW
  shopify-store-manager/
    agent.ts                                 # NEW
    prompt.ts                                # NEW
    tools.ts                                 # NEW
    tools/
      compute-store-signals.ts               # NEW
      draft-review-response.ts               # NEW
      inventory-alert-scanner.ts             # NEW
      catalog-health-audit.ts                # NEW
  email-crm-manager/
    agent.ts                                 # NEW
    prompt.ts                                # NEW
    tools.ts                                 # NEW
    tools/
      audit-klaviyo-flows.ts                 # NEW
      flow-performance-monitor.ts            # NEW
      generate-campaign-copy.ts              # NEW
      segment-health-check.ts                # NEW
  shared/
    agent-workspaces.ts                      # NEW: Per-agent Workspace instances
    build-scoped-tools.ts                    # NEW: Connector tool builder + requireApproval
  prompts/
    tool-based-orchestrator.ts               # REWRITE: Pure orchestrator prompt

src/mastra/tools/
  index.ts                                   # MODIFY: Split into orchestratorTools + exports

src/routes/
  chat.ts                                    # MODIFY: Add __connections to requestContext
  chat/
    stream-processor.ts                      # MODIFY: Add delegation event detection
  agents.ts                                  # NEW: POST /cowork/agents/:agentId/run

src/mastra/
  index.ts                                   # MODIFY: Register all agents
```

---

## 12. Phased Implementation

### Phase 1: Supervisor Foundation (Week 1)

**Goal**: Basic delegation working end-to-end with one sub-agent.

1. Create `src/mastra/agents/shared/agent-workspaces.ts` — verify Workspace `skills` array accepts individual directory paths
2. Create `src/mastra/agents/shared/build-scoped-tools.ts`
3. Create Shopify Store Manager agent (simplest domain, existing Shopify connector)
   - `agent.ts`, `prompt.ts` (lean identity + tool rules + skill loading), `tools.ts`
   - Workspace: `storeManagerWorkspace` with 15 scoped skills via BM25
   - 2 initial tools: `computeStoreSignals`, `catalogHealthAudit`
4. Modify `marketmintAgent`: add `agents: { shopifyStoreManagerAgent }` + `defaultOptions.delegation`
5. Write orchestrator prompt v1 (delegation routing for Store Manager only, keep existing logic for rest)
6. Validate delegation fires correctly (hooks log, sub-agent responds)
7. If delegation doesn't fire via `handleChatStream`, switch to `agent.stream()` + `toAISdkStream()`
8. Add delegation event detection in stream processor
9. Add `POST /cowork/agents/:agentId/run` route
10. Register new agent in `src/mastra/index.ts`
11. Store raw connections in requestContext

**Verify**: "Audit my Shopify store" → orchestrator delegates → Store Manager returns analysis → activation events in stream

### Phase 2: Creative Director (Week 2-3)

**Goal**: ALL creative/generative work flows through Creative Director.

1. Create Creative Director agent (lean prompt, `creativeDirectorWorkspace` with 24 skills, tools)
2. Move `directImageGen` and `executeWorkflow` from orchestrator to Creative Director
3. Move all dynamic image/video tools to Creative Director's tool set
4. Major orchestrator prompt rewrite (strip ALL content gen instructions)
5. Add Creative Director to supervisor's `agents`
6. Test: "Generate a marketing image" → Creative Director. "Create a product video" → Creative Director.

**Critical risk**: ALL existing image/video gen flows must continue working through Creative Director. Extensive regression testing.

### Phase 3: Performance Marketing + Email & CRM + Inter-Agent Chains (Week 4-6)

1. Create Performance Marketing agent (4 new tools, connector scoping for Meta/Google/GA4)
2. Create Email & CRM Manager (4 new tools, Klaviyo connector)
3. Complete Store Manager tools (inventoryAlertScanner, draftReviewResponse)
4. Add inter-agent chain rules to orchestrator prompt
5. Add all agents to supervisor's `agents`
6. Test chains: PerfMktg → Creative, Store → Email, PerfMktg → Store

---

## 13. Token Usage Monitoring

With the supervisor pattern, token usage can 2-3x per request: orchestrator reasoning + sub-agent execution + tool calls. Parallel delegation can further multiply this for multi-agent requests.

### Tracking Strategy

```typescript
// In onDelegationComplete hook — log token usage per delegation
onDelegationComplete: async ({ primitiveId, result, error }) => {
  if (error) {
    console.error(`[delegation:error] ${primitiveId}:`, error);
    return { feedback: `Delegation to ${primitiveId} failed: ${error}. Try a different approach.` };
  }
  const usage = result?.usage;
  console.log(`[delegation:complete] ${primitiveId}`, {
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
  });
},

// In onIterationComplete — log cumulative supervisor usage
onIterationComplete: async ({ iteration, maxIterations, finishReason }) => {
  console.log(`[supervisor] iteration ${iteration}/${maxIterations}, reason: ${finishReason}`);
  if (iteration >= 20) return { continue: false };
  return { continue: true };
},
```

### Observability

- **LangSmith tracing** already configured — multi-agent flows will create parent/child spans
- Each delegation appears as a child span under the supervisor trace
- Monitor: avg tokens per request (before vs after multi-agent), P95 latency, delegation count per request

### Cost Alerts

| Metric | Threshold | Action |
|--------|-----------|--------|
| Tokens per request | > 100K | Log warning |
| Delegations per request | > 4 | Log warning |
| Parallel agents per step | > 3 | Log warning |
| Request latency | > 60s | Log warning |

Implementation: Add these checks in `onIterationComplete` and `onDelegationComplete` hooks. Log to LangSmith custom metadata for dashboarding.

### Estimated Token Budget (per request type)

| Request Type | Orchestrator | Sub-agent(s) | Total Est. |
|-------------|-------------|-------------|------------|
| Simple delegation (1 agent) | ~2K | ~5-15K | ~7-17K |
| Chain (2 agents) | ~3K | ~10-25K | ~13-28K |
| Chain (3 agents) | ~4K | ~15-35K | ~19-39K |
| Parallel (2 agents) | ~3K | ~10-30K | ~13-33K |
| Parallel (3-4 agents, full audit) | ~4K | ~20-50K | ~24-54K |
| Current monolith (baseline) | - | ~10-20K | ~10-20K |

**Expected cost increase**: 1.5-2.5x per request for single delegations, 2-4x for parallel/chain requests. Offset by better task completion (fewer follow-up requests needed).

---

## 14. Verification Plan

| Test | Type | What to verify |
|------|------|----------------|
| Delegation routing | Integration | User message → correct sub-agent receives it |
| Creative Director regression | E2E | All existing image/video gen flows work through Creative Director |
| Inter-agent chain | E2E | Fatigue → Creative, Store → Email, PerfMktg → Store chains fire correctly |
| Brand context flow | Integration | Sub-agent receives brand context via system messages + messageFilter |
| Connector scoping | Unit | Each sub-agent only sees its allowed connectors |
| Agent approval | E2E | Connector write tools surface `tool-call-approval` in supervisor stream |
| Direct API invocation | Integration | `POST /cowork/agents/:agentId/run` returns correct results |
| Stream events | Integration | `data-agent-activation` events appear in SSE stream during delegation |
| Memory isolation | Integration | Sub-agent delegation doesn't pollute orchestrator's thread |
| finisherTool chains | E2E | Finisher called only after final agent in chain |
| Skill loading | Integration | Sub-agent loads correct skills from its scoped workspace |
| Parallel delegation | E2E | "Audit my store and ads" → Store Manager + PerfMktg run concurrently, orchestrator synthesizes |
| 3-agent chain | E2E | PerfMktg → Store Manager → Email & CRM chain fires correctly |
| Token monitoring | Observability | Token usage logged per delegation, alerts fire at thresholds |
| Connector write approval | E2E | `shopify_update_product` surfaces `tool-call-approval`, user can approve/decline |

---

## 15. Open Risks

1. **`defaultOptions.delegation` auto-application**: Hooks are in Agent constructor's `defaultOptions`. `handleChatStream` should apply them via `agent.stream()` internally. If hooks don't fire, fallback to `agent.stream()` + `toAISdkStream()`. Phase 1 validates this.
2. **Supervisor stream event format**: Delegation may not emit `tool-call` events with sub-agent IDs as `toolName`. May need to adapt detection logic.
3. **requestContext propagation to sub-agents**: Mastra docs indicate propagation, but needs explicit verification. Fallback: pass connection identifiers in delegation prompt.
4. **Workspace `skills` array behavior**: Need to verify Mastra accepts individual skill directory paths. If not, reorganize into per-agent parent directories.
5. **Memory isolation with PostgresStore**: Mastra creates deterministic resource IDs for sub-agent memory. Verify compatibility with our PostgresStore and existing per-user working memory.
6. **Token cost increase**: Multi-agent requests will cost 1.5-4x more than current monolith. Monitor via LangSmith and alert at thresholds. Offset by fewer follow-up requests.
7. **Parallel delegation stream events**: Multiple concurrent `data-agent-activation` events may confuse the frontend. Frontend needs to handle overlapping agent status cards.
8. **Sub-agent tool event propagation**: When Creative Director calls `directImageGen` which emits `data-agent-utility` custom events via `writer.custom()`, need to verify these flow through the supervisor stream. If not, image generation progress won't show in the UI.
9. **Attachment handling in delegation**: Current system passes uploaded images via `requestContext.attachments`. Creative Director needs these for product swap/try-on. Need to verify requestContext propagation includes attachments.
