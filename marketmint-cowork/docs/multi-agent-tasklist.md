# Multi-Agent System — Task List

> Track implementation progress across all phases.
> Mark tasks `[x]` as completed. Reference implementation docs for details.

---

## Phase 1: Supervisor Foundation (Week 1)

**Goal**: Basic delegation working end-to-end with Shopify Store Manager sub-agent.

### 1.1 Infrastructure Setup
- [x] Verify Mastra `Workspace` `skills` array behavior — skills array takes parent dirs only. **Decision**: all sub-agents share existing `agentWorkspace` for Phase 1. Scoping deferred.
- [x] ~~Create `src/mastra/agents/shared/agent-workspaces.ts`~~ — not needed (shared workspace)
- [x] Create `src/mastra/agents/shared/build-scoped-tools.ts` — connector tool builder with `requireApproval` for writes
- [x] Add `requestContext.set("__connections", connections)` in `src/routes/chat.ts`

### 1.2 Shopify Store Manager Agent
- [x] Create `src/mastra/agents/shopify-store-manager/agent.ts` — Agent definition with shared `agentWorkspace`
- [x] Create `src/mastra/agents/shopify-store-manager/prompt.ts` — lean identity + tool rules + skill loading instructions
- [x] Create `src/mastra/agents/shopify-store-manager/tools.ts` — tool builder (domain tools + scoped connector tools)
- [x] Create `src/mastra/agents/shopify-store-manager/tools/compute-store-signals.ts`
- [x] Create `src/mastra/agents/shopify-store-manager/tools/catalog-health-audit.ts`

### 1.3 Orchestrator Supervisor Setup
- [x] Modify `src/mastra/agents/marketmint-agent.ts` — add `agents: { all 4 sub-agents }` + `defaultOptions.delegation`
- [x] Orchestrator prompt rewritten (see Phase 2.3) — full delegation routing for all 4 agents
- [x] Create `skills_v2/agent-orchestration/SKILL.md` — delegation routing rules, chain patterns, advanced orchestration
- [x] Register all agents in `src/mastra/index.ts`

### 1.4 Delegation Validation
- [ ] Validate delegation hooks fire via `handleChatStream` (console logs appear)
- [ ] If hooks don't fire: implement fallback with `agent.stream()` + `toAISdkStream()`
- [ ] Verify requestContext propagates to sub-agent tools (connector tools receive connections)
- [ ] Verify sub-agent tool custom events (`writer.custom()`) flow through supervisor stream

### 1.5 Stream Events
- [x] Add agent display name map to `src/routes/chat/stream-processor.ts`
- [x] Add delegation tool call detection → emit `data-agent-activation` events
- [ ] Verify `data-agent-activation` events appear in SSE stream during delegation

### 1.6 Direct Agent API
- [x] Create `src/routes/agents.ts` — `POST /cowork/agents/:agentId/run`
- [x] Register route in `src/mastra/index.ts` apiRoutes
- [ ] Test direct invocation: `POST /cowork/agents/shopify-store-manager-agent/run`

### 1.7 Phase 1 Verification
- [ ] E2E: "Audit my Shopify store" → orchestrator delegates → Store Manager returns analysis
- [ ] E2E: Non-store requests still handled by orchestrator directly (no regression)
- [ ] Stream: `data-agent-activation` events render correctly
- [ ] Memory: sub-agent delegation doesn't pollute orchestrator's thread
- [ ] Connector: Store Manager sees only Shopify + GA4 + Sheets tools

---

## Phase 2: Creative Director (Week 2-3)

**Goal**: ALL creative/generative work flows through Creative Director. Orchestrator prompt fully rewritten.

### 2.1 Creative Director Agent
- [x] Create `src/mastra/agents/creative-director/agent.ts` — Agent with shared `agentWorkspace`
- [x] Create `src/mastra/agents/creative-director/prompt.ts` — identity, tool rules, skill loading, garment workflow rules
- [x] Create `src/mastra/agents/creative-director/tools.ts` — tool builder (15 domain tools + Meta Ads read-only connector tools)
- [x] Add Creative Director to supervisor's `agents` in `marketmint-agent.ts`
- [x] Register Creative Director in `src/mastra/index.ts`

### 2.2 Tool Migration
- [x] Created `orchestratorTools` (8 tools: displayPlan, finisher, analyzeBrand*, tavilySearch, searchImages, extractImages, deliverContent)
- [x] Removed `directImageGen` and `executeWorkflow` from orchestrator tool set
- [x] Creative Director tools.ts already imports all 15 generation/video/edit tools directly
- [x] Updated `src/mastra/tools/index.ts` — `orchestratorTools` (8 tools) + `coreTools` (legacy, kept for compat)
- [x] Updated `marketmint-agent.ts` to use `orchestratorTools` instead of `coreTools`

### 2.3 Orchestrator Prompt Rewrite (covers all 4 agents at once)
- [x] Created `src/mastra/agents/prompts/orchestrator-prompt.ts` (old prompt preserved at tool-based-orchestrator.ts)
- [x] Section 1: Identity — supervisor, pure routing, never generate content
- [x] Section 2: Agent descriptions — all 4 sub-agents with routing table
- [x] Section 3: Delegation routing rules — intent → agent decision tree + "what YOU handle directly"
- [x] Section 4: Inter-agent chain rules (max 3 chains, 4 chain patterns)
- [x] Section 5: Parallel vs sequential delegation guidance
- [x] Section 6: Brand memory flow — analyze_brand_full first pattern
- [x] Section 7: Tools you own (8 orchestrator tools) with tool choice by intent
- [x] Section 8: Response hygiene (preserved)
- [x] Section 9: Greeting handler (preserved)
- [x] Stripped: garment workflow rules, image gen rules, skill-specific instructions, template/space flow instructions
- [x] Updated `marketmint-agent.ts` to use `ORCHESTRATOR_PROMPT`

### 2.4 Phase 2 Verification
- [ ] E2E: "Generate a marketing image" → delegates to Creative Director → image generated
- [ ] E2E: "Create a product video" → Creative Director → video generated
- [ ] E2E: Garment workflow (lifestyle/studio) → Creative Director loads skill → executeWorkflow
- [ ] E2E: Template-based generation → Creative Director handles correctly
- [ ] E2E: Product swap / try-on → Creative Director (verify attachment handling)
- [ ] Regression: ALL existing image/video gen flows still work through Creative Director
- [ ] Regression: Brand memory first pattern still works
- [ ] Regression: Multi-step plan display still works
- [ ] Stream: Creative Director tool events (image progress, video progress) flow through supervisor stream

---

## Phase 3: Performance Marketing + Email & CRM + Chains (Week 4-6)

**Goal**: All 4 sub-agents live. Inter-agent chains and parallel delegation working.

### 3.1 Performance Marketing Agent
- [x] Create `src/mastra/agents/performance-marketing/agent.ts` — Agent with shared `agentWorkspace`
- [x] Create `src/mastra/agents/performance-marketing/prompt.ts`
- [x] Create `src/mastra/agents/performance-marketing/tools.ts` — tool builder
- [x] Create `src/mastra/agents/performance-marketing/tools/analyze-ad-performance.ts`
- [x] Create `src/mastra/agents/performance-marketing/tools/detect-fatigue.ts`
- [x] Create `src/mastra/agents/performance-marketing/tools/budget-waste-scanner.ts`
- [x] Create `src/mastra/agents/performance-marketing/tools/generate-performance-report.ts`
- [x] Register in `src/mastra/index.ts`
- [x] Add to supervisor's `agents`

### 3.2 Email & CRM Manager Agent
- [x] Create `src/mastra/agents/email-crm-manager/agent.ts` — Agent with shared `agentWorkspace`, Haiku 4.5
- [x] Create `src/mastra/agents/email-crm-manager/prompt.ts`
- [x] Create `src/mastra/agents/email-crm-manager/tools.ts` — tool builder
- [x] Create `src/mastra/agents/email-crm-manager/tools/audit-klaviyo-flows.ts`
- [x] Create `src/mastra/agents/email-crm-manager/tools/flow-performance-monitor.ts`
- [x] Create `src/mastra/agents/email-crm-manager/tools/generate-campaign-copy.ts`
- [x] Create `src/mastra/agents/email-crm-manager/tools/segment-health-check.ts`
- [x] Register in `src/mastra/index.ts`
- [x] Add to supervisor's `agents`

### 3.3 Complete Store Manager Tools
- [x] Create `src/mastra/agents/shopify-store-manager/tools/inventory-alert-scanner.ts`
- [x] Create `src/mastra/agents/shopify-store-manager/tools/draft-review-response.ts`
- [x] Register both in Store Manager tools.ts

### 3.4 Inter-Agent Chains
- [ ] Update orchestrator prompt — add chain rules for all 4 agents (max 3 chains)
- [ ] Update orchestrator prompt — add parallel delegation guidance
- [ ] Test chain: PerfMktg → Creative Director (fatigue → refresh briefs)
- [ ] Test chain: Store Manager → Email & CRM (negative reviews → post-purchase flow)
- [ ] Test chain: PerfMktg → Store Manager (high spend low CVR → PDP audit)
- [ ] Test chain: PerfMktg → Store Manager → Email & CRM (3-agent chain)

### 3.5 Parallel Delegation
- [ ] Test: "Audit my store and ads" → Store Manager + PerfMktg run concurrently
- [ ] Test: "Full business health check" → 3+ agents in parallel
- [ ] Verify stream processor handles overlapping `data-agent-activation` events

### 3.6 Agent Approval (Connector Writes)
- [ ] Verify `requireApproval: true` on Shopify write tools surfaces `tool-call-approval` in stream
- [ ] Verify `requireApproval: true` on Klaviyo write tools surfaces correctly
- [ ] Test approve flow: user approves → tool executes → result returned
- [ ] Test decline flow: user declines → agent adjusts approach

### 3.7 Token Monitoring
- [x] Add token usage logging in `onDelegationComplete` hook (added in marketmint-agent.ts defaultOptions)
- [ ] Add threshold alerts (>100K tokens, >4 delegations, >60s latency)
- [ ] Verify LangSmith traces show parent/child spans for multi-agent flows
- [ ] Measure baseline: avg tokens per request for single delegation vs chain vs parallel

### 3.8 Phase 3 Verification
- [ ] E2E: All 4 agents reachable via delegation
- [ ] E2E: All 3 chain patterns work correctly
- [ ] E2E: Parallel delegation works for independent analyses
- [ ] E2E: Agent approval works for connector write operations
- [ ] Regression: All Phase 1 + Phase 2 flows still work
- [ ] Performance: Token usage within expected ranges
- [ ] Memory: No cross-contamination between sub-agent threads

---

## Phase A: Cron Foundation (Week 7)

> See `docs/cron-heartbeat-system.md` for detailed implementation.

### A.1 Database
- [ ] Add `agent_runs` table to Drizzle schema
- [ ] Add `agent_notifications` table to Drizzle schema
- [ ] Generate and run migration (`npm run db:generate && npm run db:push`)
- [ ] Create `src/db/queries/agent-runs.ts` — CRUD for agent_runs + notifications

### A.2 Headless Agent Runner
- [ ] Create `src/trigger/shared/agent-runner.ts` — `runAgentHeadless()` utility
- [ ] Create `src/lib/workspace-registry.ts` — `getActiveWorkspaces()` + `getWorkspacesWithConnectors()`

### A.3 First Cron Job
- [ ] Create `src/trigger/jobs/shopify-daily-health.ts` — Daily 7 AM, Store Manager, Haiku
- [ ] Test: manually trigger via Trigger.dev dashboard
- [ ] Verify: agent_runs record created, notification created if findings exist

---

## Phase B: Full Cron Suite + Notifications (Week 8)

### B.1 Remaining Cron Jobs
- [ ] Create `src/trigger/jobs/performance-daily-scan.ts` — Daily 8 AM
- [ ] Create `src/trigger/jobs/creative-fatigue-check.ts` — 2x daily (8 AM, 4 PM)
- [ ] Create `src/trigger/jobs/email-weekly-audit.ts` — Monday 9 AM
- [ ] Test all 4 jobs across multiple workspaces

### B.2 Notification API
- [ ] Add `GET /cowork/notifications` route — unread notifications for workspace
- [ ] Add `POST /cowork/notifications/read` route — mark as read
- [ ] Register routes in apiRoutes

### B.3 Phase B Verification
- [ ] All 4 cron jobs execute correctly
- [ ] Workspaces without relevant connectors are skipped
- [ ] Notification API returns correct data
- [ ] Token costs per cron run are within budget

---

## Phase C: Proactive Surfacing (Week 9)

### C.1 Frontend Integration
- [ ] Frontend: notification badge/card on chat open
- [ ] Frontend: "View findings" action → starts chat thread about finding
- [ ] Frontend: handle `tool-call-approval` chunks for connector writes
- [ ] Frontend: handle overlapping `data-agent-activation` events (parallel agents)
- [ ] Mark notifications as read after display

### C.2 Opt-in Controls
- [ ] Per-workspace cron job opt-in/opt-out (if cost is a concern)
- [ ] Monitor token usage across all cron jobs
- [ ] Add staggered execution for rate limit protection

### C.3 Final Verification
- [ ] Full E2E: cron runs → notification created → user opens chat → sees findings → drills in via chat
- [ ] Full regression: all chat-based flows from Phases 1-3 still work
- [ ] Cost analysis: actual vs estimated token usage
