# Prompt Architecture Redesign — Audit & Recommendations

## Current State Audit

### Prompt Inventory

| Prompt | Lines | ~Tokens | Identity | Greeting | Hygiene Rules | Model |
|--------|-------|---------|----------|----------|---------------|-------|
| Orchestrator (new) | 179 | ~2.5k | Strong ("ecommerce OS, supervisor") | Hardcoded verbatim | Yes | Sonnet 4.6 |
| Creative Director | 115 | ~1.8k | Moderate ("creative engine") | None | Yes | Sonnet 4.6 |
| Perf Marketing | 58 | ~0.9k | Weak (just role name) | None | No | Sonnet 4.6 |
| Store Manager | 50 | ~0.75k | Weak (just role name) | None | No | Sonnet 4.6 |
| Email & CRM | 56 | ~0.85k | Weak (just role name) | None | No | Haiku 4.5 |
| Finisher | 48 | ~0.7k | None (pure function) | None | No | Haiku 4.5 |
| Brand Analyzer | 8 | ~0.15k | None | None | No | GPT-4o |

### No shared prompt infrastructure
- Each prompt is entirely self-contained
- No shared constants, templates, or utilities
- "What You Don't Do" pattern duplicated across 4 sub-agents
- Response hygiene rules only on orchestrator + Creative Director

---

## Issues Found

### Critical (affects user experience)

**1. Hardcoded verbatim greeting → same message every time**

The orchestrator has:
```
respond with: "Hey! I'm MarketMint — your ecommerce operating system..."
```
Every greeting produces the identical message. The model's thinking exposes this: *"User said hi. My instructions say to respond with this exact text."*

**2. Extended thinking leaks prescriptive instructions**

With `thinking: { type: "enabled" }`, Claude's reasoning is visible. Prescriptive "if X then Y" rules cause thinking like *"The user asked about their brand. My instructions say to call analyze_brand_full first."* This reveals the puppet strings.

All prompts have this issue — any conditional instruction pattern leaks into thinking.

**3. No identity/personality on sub-agents**

Sub-agents have weak identities ("You are the Shopify Store Manager agent"). No personality, no communication style, no warmth. When sub-agent text is shown to the user (via `data-tool-agent`), it reads as robotic.

### Important (affects quality)

**4. Orchestrator prompt too long (~2.5k tokens, 179 lines)**

Detailed routing tables, chain rules, parallel delegation guidance — all loaded on every request. This:
- Burns context tokens on simple requests
- Creates more surface area for thinking-leaks
- Makes the LLM over-think simple routing decisions

The `agent-orchestration` skill already exists for complex multi-domain requests. Move advanced routing logic there. May be mention this skill in the main prompt for refernce.

**5. Creative Director prompt too long (~1.8k tokens, 115 lines)**

Duplicates many rules from the old monolithic prompt (garment workflow rules, template flows, reference images). These rules already exist in skills (`garment-in-lifestyle-settings`, `product-swap-or-try-on`, etc.). The prompt should be lean — identity + tool list + "load relevant skill for complex workflows." Do a deep analysis for this first before making any change.

**6. Tool name format mismatch**

Prompts reference tools as snake_case: `analyze_brand_full`, `render_widget`, `deliver_content`. But Mastra uses the **object key** (camelCase) as the stream `toolName`: `analyzeBrandFull`, `renderWidget`, `deliverContent`.

The LLM sees tool descriptions with the tool's `id` (snake_case) in the function schema. So prompt references match the `id`, but stream events use the key. This needs runtime verification — if the LLM calls tools by `id`, prompts are correct. If by key, prompts need updating.

**7. `analyzeBrandFull` on Creative Director may cause redundant calls**

Creative Director has `analyzeBrandFull` in its tool set. If the orchestrator already called it before delegating, the sub-agent calling it again is redundant. The sub-agent prompt says "Brand context is provided in the conversation" but doesn't say "do NOT call analyze_brand_full."

**8. Sub-agents expose internal architecture**

Sub-agent prompts say things like:
- "Ad performance analysis — that's Performance Marketing"
- "the orchestrator adds follow-up suggestions"
- "so the orchestrator can decide whether to chain to the Creative Director"

This wastes reasoning tokens on boundary-checking and may leak into thinking.

### Minor (cleanup)

**9. No response hygiene on Perf Marketing, Store Manager, Email & CRM**

Only orchestrator + Creative Director have "hide CDN URLs, don't expose model names." Other sub-agents can leak internal URLs.

**10. Finisher instructions embedded in code, not a prompt file**

`finisher-agent.ts` has instructions inline. Hard to iterate, not discoverable.

**11. Brand Analyzer is underdeveloped**

8-line instruction, minimal guidance. Uses GPT-4o instead of Claude (breaks the all-Anthropic architecture).

---

## Recommended Prompt Architecture

### Design Principles

1. **Identity first** — every agent should have a soul/personality, not just a role title
2. **Guidelines over rules** — frame as knowledge/identity, not conditional instructions ("you always do X" not "if user says Y, do X")
3. **Lean base prompts** — core identity + tools + communication style. Detailed workflow rules live in skills.
4. **Shared foundations** — common sections (hygiene, communication style) defined once, included everywhere
5. **Thinking-safe** — avoid prescriptive conditionals that leak into extended thinking

### Proposed Structure (all agents)

```
1. IDENTITY & SOUL (~5 lines)
   Who you are, your personality, your expertise.
   Not "You are the X agent" but a character description.

2. COMMUNICATION STYLE (~5 lines)
   How you talk to users. Tone, warmth, conciseness.
   Shared across all agents with agent-specific flavor.

3. YOUR DOMAIN (~10 lines)
   What you're expert at. What you own.
   Framed as expertise, not as rules.

4. TOOLS (~10 lines)
   Your available tools and when to use each.
   Brief, not exhaustive (tool descriptions handle details).

5. SKILLS (~5 lines)
   How to discover and load detailed workflow instructions.
   "For complex tasks, search for relevant skills first."

6. RESPONSE FORMAT (~5 lines)
   How to structure your output. Agent-specific formatting.

7. GUARDRAILS (~5 lines)
   Response hygiene, what to avoid, edge cases.
   Shared across all agents.
```

**Target: 40-50 lines per agent (~600-800 tokens)**

### Shared Prompt Constants

Create `src/mastra/agents/prompts/shared.ts`:

```typescript
export const COMMUNICATION_STYLE = `
You communicate naturally and warmly. Lead with insights, not methodology.
Use specific data points to support recommendations.
Keep responses concise — prefer 2-3 impactful sentences over long explanations.
Use markdown for readability (bold for emphasis, lists for multiple items).
Never start with "I" — lead with what matters to the user.
`;

export const RESPONSE_GUARDRAILS = `
Never expose internal infrastructure URLs (CDN, S3, API endpoints, Trigger.dev).
Use descriptive phrases instead ("your generated image", "the dashboard").
Never mention model names (Claude, GPT, Gemini) — describe capabilities in plain language.
Never repeat content that's already visible (images, widgets, search results).
Keep post-generation responses to 1-2 sentences — the output speaks for itself.
`;

export const SKILL_LOADING = `
You have access to workflow skills via skill_search and skill tools.
For complex or multi-step tasks, search for a relevant skill first to get detailed instructions.
For straightforward tasks, proceed directly with your tools.
`;
```

### Orchestrator Prompt (redesigned)

```
IDENTITY (~5 lines):
You're MarketMint — a sharp, friendly ecommerce copilot. You coordinate a team of
specialists to help merchants run and grow their business. You route tasks to
the right expert, synthesize results, and keep the conversation flowing.
You never generate creative content yourself — you delegate to specialists.

COMMUNICATION STYLE: (shared)

YOUR TEAM (~15 lines):
Brief agent descriptions — what each specialist handles.
"Delegate based on the user's intent. For ambiguous requests, ask."

TOOLS (~10 lines):
Your 8 tools, briefly.

SKILLS (~3 lines):
"For complex multi-domain coordination, load agent-orchestration skill."

RESPONSE FORMAT (~5 lines):
After delegation: brief summary. After chains: unified summary.
Call finisher_tool once at end (no duplicate suggestions in text).

GUARDRAILS: (shared)

GREETING: (no hardcoded text — guidelines only)
"When greeted, introduce yourself naturally. Mention you coordinate
specialist agents for content, analytics, marketing, and store management.
Keep it conversational, 2-3 sentences. Vary each time."
```

**Target: ~60 lines (~900 tokens) — down from 179 lines.**

### Sub-Agent Prompts (redesigned, example: Store Manager)

```
IDENTITY:
You're the store operations specialist on the MarketMint team. You know Shopify
inside and out — inventory, catalog health, SEO, conversion optimization.
You're methodical, data-driven, and always lead with actionable findings.

COMMUNICATION STYLE: (shared)

YOUR DOMAIN:
Store audits, inventory monitoring, catalog quality, SEO, CRO, product
management. You work with live Shopify data from the user's connected store.

TOOLS:
- compute_store_signals: aggregated health overview
- catalog_health_audit: product-level completeness scoring
- inventory_alert_scanner: restock alerts and stock levels
- draft_review_response: professional review responses in brand voice
- render_widget: data dashboards and charts
- deliver_content: copyable text output
- Shopify/GA4/Sheets connector tools for raw data access
- Write operations require user approval — always explain intent first.

SKILLS: (shared)

RESPONSE FORMAT:
Lead with findings grouped by severity (critical, warning, info).
Use data to support recommendations. Present actionable next steps.

GUARDRAILS: (shared)
Brand context is provided in the conversation — use it for voice matching
and recommendations. Don't call analyze_brand_full — already handled.
```

**Target: ~40 lines (~600 tokens) — down from 50 lines (already lean, but now with identity).**

### Key Changes from Current Prompts

| Aspect | Current | Proposed |
|---|---|---|
| Greeting | Hardcoded verbatim text | Guidelines only ("introduce yourself naturally, vary each time") |
| Identity | Role title only | Character with personality and expertise |
| Communication | No shared guidelines | Shared `COMMUNICATION_STYLE` constant |
| Hygiene | Only on 2 of 6 agents | Shared `RESPONSE_GUARDRAILS` on all |
| Orchestrator size | 179 lines / ~2.5k tokens | ~60 lines / ~900 tokens |
| Creative Director size | 115 lines / ~1.8k tokens | ~50 lines / ~750 tokens (workflow rules → skills) |
| "What You Don't Do" | Duplicated 4x, names other agents | Removed — "focus on your domain, say so if asked about something else" |
| Chain rules | 15 lines in orchestrator | Moved to agent-orchestration skill |
| Thinking safety | Prescriptive "if X then Y" | Knowledge-framed "you always X" |
| Conditional logic | "If the user says Hi, respond with..." | "When greeted, introduce yourself naturally" |

### Files to Create/Modify

```
CREATE: src/mastra/agents/prompts/shared.ts
  - COMMUNICATION_STYLE
  - RESPONSE_GUARDRAILS
  - SKILL_LOADING

MODIFY: src/mastra/agents/prompts/orchestrator-prompt.ts
  - Import shared constants
  - Rewrite identity section (personality, not just role)
  - Remove hardcoded greeting text
  - Move chain rules to agent-orchestration skill
  - Trim routing table (keep essential, move detail to skill)

MODIFY: src/mastra/agents/creative-director/prompt.ts
  - Import shared constants
  - Add identity/personality
  - Move garment/template workflow rules to skills
  - Remove "What You Don't Do" listing other agents
  - Remove analyzeBrandFull instruction (add guardrail: "brand context already provided")

MODIFY: src/mastra/agents/performance-marketing/prompt.ts
  - Import shared constants
  - Add identity/personality
  - Remove "What You Don't Do" listing other agents
  - Add response guardrails

MODIFY: src/mastra/agents/shopify-store-manager/prompt.ts
  - Import shared constants
  - Add identity/personality
  - Remove "What You Don't Do" listing other agents
  - Add response guardrails

MODIFY: src/mastra/agents/email-crm-manager/prompt.ts
  - Import shared constants
  - Add identity/personality
  - Remove "What You Don't Do" listing other agents
  - Add response guardrails

MODIFY: skills_v2/agent-orchestration/SKILL.md
  - Add detailed chain rules (moved from orchestrator prompt)
  - Add detailed routing table
  - Add parallel delegation patterns
```

### Verification

After implementing, test:
1. **Greeting variation** — send "hi" 3 times, verify different responses each time
2. **Thinking quality** — check extended thinking doesn't expose "my instructions say..."
3. **Sub-agent identity** — verify sub-agent text has personality, not robotic
4. **Response hygiene** — verify no CDN URLs or model names from any agent
5. **Tool calls work** — verify tool name format matches (snake_case ids in function schema)
6. **Skill loading still works** — complex workflows still load correct skills
7. **Chain triggers** — verify fatigue→creative chain still fires after prompt changes
8. **Delegation enforcement** — verify orchestrator delegates to sub-agents instead of using connector tools directly
9. **Post-skill continuation** — verify agent continues executing tools after loading a skill (especially generative-ui → render_widget)

---

## Implementation Attempt — Findings (2026-03-30)

We attempted the full redesign (shared.ts, all 5 prompt rewrites, agent-orchestration skill enhancement, analyzeBrandFull removal from Creative Director). Build passed, but two critical regressions appeared in testing:

### Regression 1: Sub-agents not activated — orchestrator uses connector tools directly

**Symptom**: Instead of delegating to sub-agents, the orchestrator called `search_tools`/`load_tool` to discover and use connector tools (Shopify, Meta Ads, Klaviyo) directly.

**Root cause**: The routing table (36-48 lines) was moved from the base prompt to the `agent-orchestration` skill (loaded on-demand). Without the routing table always present, the LLM took the path of least resistance — it found connector tools via `search_tools` and used them.

The new prompt said "sub-agents have their own scoped connector tools" (descriptive) instead of "NEVER call search_tools to find connector tools — delegate to sub-agents instead" (prescriptive). The LLM treated it as information, not enforcement.

**Key insight**: The routing table is load-bearing, not just verbosity. It must stay in the base prompt. It can be trimmed (shorter descriptions per row), but the intent-to-agent mapping must be present on every request. Moving it to a skill breaks routing because the orchestrator doesn't know to load the skill for simple single-domain requests.

**What to preserve in redesign**:
- The routing table (can be compressed but must remain in base prompt)
- An explicit prohibition: "Never use search_tools/load_tool to find connector tools. Always delegate connector operations to the appropriate sub-agent."
- The "What YOU handle directly" list that creates a clear boundary

### Regression 2: Stream stops after skill load — agent doesn't continue to execute tools

**Symptom**: Agent loaded a skill (e.g., generative-ui) and then stopped instead of continuing to call `read_guidelines` → `render_widget` as the skill instructs.

**Root cause**: Two compounding issues:

1. **`SKILL_LOADING` shared constant was too vague**: "Search for a relevant skill first to get detailed instructions." This tells the agent to load a skill but not what to do after. The old prompt had explicit follow-through: "Do NOT present data as markdown tables when a visual widget would be more useful" — this kept the agent moving toward tool execution after skill loading.

2. **`onIterationComplete` hook**: `finishReason === "stop"` triggers after ANY tool completion where the model doesn't immediately queue another tool call. If the model loads a skill, outputs some text, and stops (without calling the next tool), the hook returns `{ continue: false }` and the stream ends. The old prescriptive prompt guided the model to call the next tool in the same step; the lean prompt let the model stop.

**Key insight**: Skill loading is a two-phase action: (1) load the skill, (2) follow its instructions. The prompt must explicitly say "After loading a skill, read its instructions and execute the workflow it describes in the same turn. Do not stop after loading." This is not just prompt verbosity — it's a behavioral requirement that prevents the `onIterationComplete` hook from cutting the stream.

**What to preserve in redesign**:
- Explicit post-skill continuation instruction in the skill loading section
- For high-value skills used by the orchestrator directly (generative-ui, templates), keep the follow-through instruction in the base prompt (e.g., "load generative-ui → call read_guidelines → call render_widget")
- Consider adding `SKILL_LOADING` with: "After loading a skill, follow its step-by-step instructions to completion. Do not stop after loading."

### Revised Design Principles

The original principles are correct but need an addendum:

6. **Prescriptive where load-bearing** — Some conditional rules aren't just verbosity — they enforce tool call sequencing and delegation boundaries. These must stay prescriptive even in lean prompts. Specifically:
   - Routing table → always in base prompt (can be compressed)
   - Connector tool prohibition → explicit in base prompt
   - Post-skill continuation → explicit in skill loading section
   - Specific tool workflows (generative-ui) → keep follow-through in base prompt

7. **Test delegation before merging** — Any prompt change must verify: (a) sub-agents activate for their domains, (b) orchestrator doesn't use connector tools directly, (c) skills load AND the subsequent tools execute.

### Revised Approach

Instead of "lean base prompt + everything in skills," the architecture should be:

**Base prompt** (~100-120 lines, down from 179 but not as aggressive as the ~70 target):
- Identity with personality (keep)
- Routing table — compressed but always present (restore)
- Connector prohibition — explicit (add)
- Tool descriptions — keep as-is
- Skill loading with continuation rule (strengthen)
- Generative-ui follow-through (keep)
- Shared guardrails via constants (keep)
- Greeting as guidelines not hardcoded text (keep)

**Agent-orchestration skill** (on-demand):
- Chain patterns and detailed chain templates (keep moving here)
- Advanced parallel delegation patterns (keep moving here)
- Full business health check protocol (keep here)
- Finisher tool protocol (keep moving here)

**Sub-agent prompts** (~45-50 lines each):
- Identity with personality (add)
- Shared guardrails (add via constants)
- Domain focus framing instead of "What You Don't Do" (change)
- Post-skill continuation rule (add)
- Everything else stays the same
