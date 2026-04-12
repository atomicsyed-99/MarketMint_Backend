# Memory Configuration Enhancement Plan

> Status: **Planned** — findings from subagent system audit (2026-03-31)

---

## Current Setup

```
Orchestrator (marketMintAgent)
  memory: agentMemory (lastMessages: 20, workingMemory: resource-scoped, semanticRecall: off)

Sub-agents (4x)
  memory: not set — should inherit from supervisor per Mastra docs

Mastra instance
  storage: PostgresStore (env.MASTRA_DATABASE_URL)

Memory instance
  storage: PostgresStore (env.DATABASE_URL)
```

Chat route passes: `memory: { thread: { id: chat_id }, resource: user.id }`

---

## Issues Found

### 1. "No memory is configured" Warning on Sub-agents

When the orchestrator delegates, Mastra passes `resourceId` and `threadId` to sub-agents. Per docs:

> "If a subagent has no memory configured, it inherits the supervisor's Memory instance."

But we see: `[Agent:Shopify Store Manager] - No memory is configured but resourceId and threadId were passed in args.`

**Root cause**: Either the Mastra version doesn't properly implement inheritance, or there's a configuration gap. Needs investigation.

**Fix options**:
- A) Add explicit `memory` to sub-agents with appropriate config
- B) Upgrade Mastra if inheritance is a bug fix in a newer version
- C) Both

### 2. Working Memory Template Is Orchestrator-Specific

Current template:
```markdown
# Brand Context
- Brand Name, URL, Industry, Target Audience, Voice/Tone
- Color Palette, Typography, Visual Style

# User Preferences
- Preferred Image Style, Default Output Count, Preferred Workflows
```

Per Mastra delegation docs:
- Sub-agent gets deterministic resourceId: `{parentResourceId}-{agentName}`
- Resource-scoped working memory persists between delegations per user

If sub-agents share the same Memory instance, they'd use this brand-focused template at their own resource scope — which doesn't match their domain.

**Options**:
- **Option A (recommended for now)**: Sub-agents get a separate Memory instance with working memory **disabled**. Brand context flows via `messageFilter` (system messages).
- **Option B (future)**: Domain-specific working memory templates per agent:
  - Store Manager: `# Store Health\n- Last Audit Date:\n- Inventory Alerts:\n- Catalog Completeness:`
  - Perf Marketing: `# Active Campaigns\n- Meta Ads Status:\n- Google Ads Status:\n- Last Fatigue Alert:`
  - Email & CRM: `# Email Status\n- Active Flows Count:\n- Last Flow Audit:\n- List Health:`
  - Creative Director: `# Creative State\n- Brand Visual Style:\n- Recent Campaigns:\n- Active Briefs:`
- **Option C**: Use `readOnly: true` on delegation calls (per-request, not per-agent config — may need Mastra support for delegation)

### 3. Two Separate PostgresStore Instances

```typescript
// Memory storage
new PostgresStore({ id: "marketmint-agent-memory", connectionString: env.DATABASE_URL })
// Mastra storage
new PostgresStore({ id: "marketmint-mastra-storage", connectionString: env.MASTRA_DATABASE_URL })
```

Per docs, Memory can inherit storage from the Mastra instance if not provided. If `DATABASE_URL` === `MASTRA_DATABASE_URL`, this is redundant. Verify and consolidate if same.

### 4. Observational Memory Not Configured

OM compresses old messages into dense observations via background Observer/Reflector agents. Benefits for Marketmint:
- Orchestrator chains produce many tool calls + sub-agent responses → fills context fast
- OM auto-compresses, keeping only recent messages + observations + reflections
- 5-40x compression ratio per the docs
- Supports async buffering (no pause during conversation)
- Default model: `google/gemini-2.5-flash`

**Recommendation**: Enable OM on the orchestrator with thread scope:
```typescript
const agentMemory = new Memory({
  options: {
    lastMessages: 20,
    workingMemory: { enabled: true, scope: "resource", template: ... },
    observationalMemory: {
      model: "google/gemini-2.5-flash",
      scope: "thread",
    },
  },
});
```

**Considerations**:
- Requires `@mastra/memory@1.1.0+`
- Only supports `@mastra/pg`, `@mastra/libsql`, `@mastra/mongodb` storage
- Adds background LLM cost (Gemini Flash is cheap)
- Thread scope is well-tested; resource scope is experimental

### 5. Semantic Recall Disabled

Currently `semanticRecall: false`. Each call adds latency (embedding + vector query). For real-time chat this tradeoff is reasonable.

**When to revisit**: If users need cross-conversation recall (e.g., "what did we discuss about my brand last week?"), enable with:
```typescript
semanticRecall: {
  topK: 3,
  messageRange: 2,
  scope: "resource",
}
```
Requires a vector store and embedder configuration.

---

## Recommended Implementation Order

### Phase 1: Fix Sub-agent Memory (addresses the warning)
1. Create `subAgentMemory` — same storage, `lastMessages: 10`, working memory **disabled**, semantic recall off
2. Add `memory: subAgentMemory` to all 4 sub-agents
3. Keep orchestrator on `agentMemory` unchanged

### Phase 2: Evaluate Observational Memory
1. Enable OM on orchestrator (thread scope, Gemini Flash)
2. Test with long conversations to measure compression and quality
3. Monitor background LLM costs

### Phase 3: Domain-Specific Working Memory (optional)
1. Create per-agent working memory templates
2. Sub-agents build up domain-specific memory across delegations
3. Useful for "Store Manager remembers last audit findings"

### Phase 4: Semantic Recall (optional)
1. Add vector store (PgVector) and embedder (text-embedding-3-small)
2. Enable for cross-conversation recall
3. Measure latency impact

---

## References

- [Mastra Memory Overview](https://mastra.ai/docs/memory/overview)
- [Memory in Multi-Agent Systems](https://mastra.ai/docs/memory/overview#memory-in-multi-agent-systems)
- [Observational Memory](https://mastra.ai/docs/memory/observational-memory)
- [Working Memory](https://mastra.ai/docs/memory/working-memory)
- [Semantic Recall](https://mastra.ai/docs/memory/semantic-recall)
