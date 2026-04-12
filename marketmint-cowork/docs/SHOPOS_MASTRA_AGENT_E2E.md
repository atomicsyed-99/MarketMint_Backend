# MarketMint Mastra Agent — End-to-End Architecture

This document describes how the **MarketMint Content Agent** (`MarketMintAgent`) is implemented in `marketmint-agent-ts`, from HTTP entry through Mastra, memory, workspace skills, tools, streaming, and persistence. It is written to mirror the actual code paths in this repository.

---

## 1. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Client (Bearer token)                                                   │
└─────────────────────────────────────────────────────────────────────────┘
        │ POST /api/v2/chat or POST /v2/chat (Mastra-registered)
        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Hono + MastraServer (src/server.ts)                                     │
│  • Mastra injects `mastra` + Clerk auth on routes                        │
└─────────────────────────────────────────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  chatRoute (src/routes/chat.ts)                                          │
│  • Auth / dev JWT fallback                                               │
│  • Credits check                                                         │
│  • Persist user message + placeholder AI message                         │
│  • Build user text + ASSET CATALOG + brand-memory system blocks           │
│  • marketmintAgent.stream(...) → NDJSON events to client                     │
└─────────────────────────────────────────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Agent: marketmintAgent (src/mastra/agents/marketmint-agent.ts)                  │
│  • Model: anthropic/claude-sonnet-4-5                                    │
│  • Memory: Postgres-backed @mastra/memory (thread = chat, resource=user) │
│  • Workspace: LocalFilesystem + skills_v2 (Mastra skill tools)          │
│  • Tools: allToolsV2 (Zod createTool implementations)                     │
│  • Instructions: SYSTEM_PROMPT (tool-based-orchestrator)                 │
└─────────────────────────────────────────────────────────────────────────┘
        │
        ├──► Tools call Python/backend (Trigger stream, credits), DB, APIs
        └──► Tools use context.writer to emit agent-utility / image / video events
```

**Related agents** registered on the same `Mastra` instance but **not** the main chat loop unless invoked from a tool:

- `finisherAgent` — used by `finisherTool` for follow-up suggestions.
- `brandAnalyzerAgent` — defined for potential brand-focused flows; not wired into `chatRoute` directly.

---

## 2. Entry points and configuration

| Piece | Role |
|--------|------|
| `mastra.config.ts` | `defineConfig({ app: "./src/server.ts" })` — Mastra CLI uses **your** Hono app as the app entrypoint. |
| `src/server.ts` | Creates `Hono`, wraps with `MastraServer({ app, mastra })`, `await server.init()`, then registers **`POST /api/v2/chat`** → `chatRoute`. |
| `src/mastra/index.ts` | Exports `mastra` singleton: agents, `PostgresStore` storage, Clerk auth, custom **`registerApiRoute("/v2/chat", ...)`** (same handler; path differs from bare `server.ts` mount). |

**Two URLs for the same handler:**

- **`POST /api/v2/chat`** — registered directly on the Hono app in `server.ts` (comment in `mastra/index.ts` mentions `4111`; actual path prefix may include `/api` depending on deployment).
- **`POST /v2/chat`** — registered via Mastra `apiRoutes` (when the Mastra server stack mounts this route).

Clients must use whichever base URL your deployment exposes.

---

## 3. Mastra instance (`src/mastra/index.ts`)

### 3.1 Agents

```ts
agents: { marketmintAgent, finisherAgent, brandAnalyzerAgent }
```

Only `marketmintAgent` is retrieved in `chatRoute` via `mastra.getAgent("marketmintAgent")`.

### 3.2 Storage

`PostgresStore` with `DATABASE_URL` — Mastra’s storage for framework data (distinct from your Drizzle `messages` / `chats` tables, though both may use the same Postgres server).

### 3.3 Server auth

`MastraAuthClerk` with `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWKS_URI`. Routes that set `requiresAuth: true` expect Clerk-validated requests.

### 3.4 Custom API route

`registerApiRoute("/v2/chat", { method: "POST", requiresAuth: true, handler })` delegates to `chatRoute`.

---

## 4. Main agent definition (`src/mastra/agents/marketmint-agent.ts`)

| Property | Value |
|----------|--------|
| `id` | `"marketmint-agent"` (must match `getAgent("marketmintAgent")` export name — Mastra registers by **exported key** `marketmintAgent`) |
| `name` | `"marketmint Content Agent"` |
| `instructions` | `SYSTEM_PROMPT` from `./prompts/tool-based-orchestrator` |
| `model` | `"anthropic/claude-sonnet-4-5"` |
| `tools` | `allToolsV2` |
| `memory` | `agentMemory` |
| `workspace` | `agentWorkspace` |

The **workspace** attaches Mastra’s **skill** tooling over `skills_v2` (see §8). The **tool registry** adds all custom `createTool` tools (see §9).

---

## 5. Memory (`src/mastra/memory/index.ts`)

- `Memory` from `@mastra/memory` with `PostgresStore` (`id: "marketmint-agent-memory"`).
- Options: `lastMessages: 50`, `semanticRecall: false`.

**Usage in `chatRoute`:**

```ts
memory: {
  thread: { id: chat_id },
  resource: user.id,
}
```

So **conversation history** is keyed by **chat** (`thread.id = chat_id`) and **user** (`resource = user.id`). Semantic recall is off; long-range context relies on last N messages plus explicit system blocks (brand memory, asset catalog).

---

## 6. Workspace and skills (`src/mastra/workspace.ts`)

```ts
new Workspace({
  id: "marketmint-agent-workspace",
  name: "MarketMint Skills",
  filesystem: new LocalFilesystem({
    basePath: projectRoot,  // resolved from this file → repo root (marketmint-agent-ts)
    contained: true,
  }),
  skills: ["/skills_v2"],
})
```

- **`basePath`** is resolved with `import.meta.url` so it works when the bundled app runs from another cwd (e.g. `.mastra` output).
- **`skills_v2`** holds one folder per skill; each contains `SKILL.md` with YAML frontmatter (`name`, `description`, optional `workflow_id` / `use_case_id`).

The orchestrator prompt **requires** the model to use workspace **skill_search** then **skill** to load instructions before acting on new intents — this is the primary skill-loading path at runtime.

### 6.1 Alternate implementation (not wired to the agent)

`src/mastra/tools/discovery/load-skills-and-read.ts` implements a custom tool that uses `SkillLoaderV2` + `decideSkillsToLoad` (Gemini-based router). It is **not** included in `allToolsV2`, so the live agent does **not** expose it unless you add it. `chat.ts` still recognizes tool result names `load-skills-and-read` / `load_skills_and_read` for streaming UI labels, for parity if you enable it later.

---

## 7. System prompt (`src/mastra/agents/prompts/tool-based-orchestrator.ts`)

The `SYSTEM_PROMPT` is large and encodes product behavior. At a high level it defines:

1. **Greeting / identity** — Fixed canned reply for “who are you” with **no tools**.
2. **Mandatory skill loading** — For each new intent: `skill_search` → `skill`; default fallback `creative-generation` for generic image asks; limits retries.
3. **Brand memory exception** — If user enables brand memory (`direct_gen_bm`), **first** call `analyze_brand_full`, then skills (mirrored in dynamic system messages in `chatRoute`).
4. **Plans** — Multi-step intents must use **`display_plan`** (not plain text). Single-intent flows must **not** use `display_plan`.
5. **Garment vs non-garment, lifestyle vs studio, multiple try-on** — Detailed routing rules to avoid wrong skills.
6. **Tool choice** — Mapping intents to `extract_images_from_url`, `search_images`, `tavily_search`, `analyze_brand` vs `analyze_brand_full`, etc.
7. **Reference images / product swap / creative-generation** — Non-negotiable paths and fallbacks when generation fails.
8. **Response hygiene** — No internal URLs, model names, or infrastructure leakage.

---

## 8. Skill metadata loading (`src/skills/skill-loader.ts`)

`SkillLoaderV2` scans `skills_v2`, parses `SKILL.md` with `gray-matter`, and exposes `getSkillsList()` for **`decideSkillsToLoad`** (used only by the optional `load-skills-and-read` tool). The Mastra workspace reads the same files via the **`/skills_v2`** path for **`skill` / `skill_search`**.

---

## 9. Tool registry (`src/mastra/tools/index.ts`)

`allToolsV2` is a flat object; keys are the **tool identifiers exposed to the model** (some aliases for LLM compatibility):

| Area | Tools |
|------|--------|
| **Generation** | `directImageGen`, `imageEdit`, `generateSingleImage`, `generateVideoSingleShot`, `singleStepVideoGenerator` |
| **Discovery** | `fetchTemplatePrompt`, `displayPlan`, `select_storytelling_techniques` |
| **Search / brand** | `tavilySearch`, `extractImagesFromUrl`, `searchImages`, `analyzeBrand`, `analyzeBrandFull` |
| **Shopify** | `searchShopifyCatalog`, `checkLinkedShopifyAccount`, `showShopifyConnectBanner` |
| **Workflows / reels** | `execute_workflow` (alias for `executeWorkflow`), `finisherTool`, `generateVideoFromReelScripts`, `recreateReel` |
| **Video helpers** | `downloadReel`, `writeReelScript` |

**Plus** workspace-injected tools: **`skill`**, **`skill_search`**, (and related Mastra skill APIs as provided by the framework).

---

## 10. HTTP handler: `chatRoute` (`src/routes/chat.ts`)

### 10.1 Authentication

1. **`c.get("user")`** — Populated by Mastra/Clerk when auth succeeds.
2. **Dev fallback** — If missing, decode **JWT payload** from `Authorization: Bearer` (no signature verification in this path): extract `sub` / `user_id`, `email`, `orgId` from common claim shapes.

If still no `user.id` → **401 Unauthorized**.

### 10.2 Credits

`getCreditsBalance(user.id)` — if `available <= 0` → **402** with `{ error: "Insufficient credits" }`.

### 10.3 Request body (expected shape)

Parsed as JSON; fields used:

| Field | Usage |
|--------|--------|
| `chat_id` | Chat UUID; memory thread id; DB foreign key |
| `message_id` | User message id (generated if absent) |
| `content` | Array of parts (e.g. `{ type: "text", text }`) |
| `attachments` | Array of `{ url, ... }`; enriched from DB |
| `resume` | Destructured but **not used** in handler (reserved) |
| `selected_asset_mode` | Passed through `requestContext.selectedAssetMode` |
| `direct_gen_bm` | Brand memory toggle → `requestContext.directGenBm` + dynamic system prompt |

### 10.4 Attachment enrichment

For each attachment URL, the handler loads `tag` and `description` from `user_attachments` for this user. Missing URLs can be **inserted** as new rows (`tag: "other"`) to align with Python upload behavior.

**User message text** is built from:

- All `content` parts with `type === "text"`.
- Lines `URL: …` per attachment.
- Lines `[Attachment: url=…, tag=…, description=…]`.
- Optional **ASSET CATALOG** system message listing `type`, `tag`, `description`, `url` per attachment for the model.

### 10.5 Persistence

1. **`createMessage`** — User message with `role: "user"`, `content`, `attachments`.
2. **`chats.lastUpdated`** bumped.
3. **Placeholder AI message** — `role: "ai"`, `content: []`, id = `responseMessageId` (final text merged in `onFinish`).

### 10.6 `requestContext`

A plain object (with **`get` / `set` / `forEach`** shim for Mastra internals) carrying:

- `userId`, `email`, `workspaceId` (org)
- `chatId`, `responseMessageId`
- `directGenBm`, `selectedAssetMode`
- `userAccessToken` (Bearer token without prefix) for backend calls
- `attachments` (enriched array)

Tools read this via `context.requestContext`.

### 10.7 Dynamic system messages

1. **`buildBrandMemoryBlock(direct_gen_bm === true)`** — Instructs when to call `analyze_brand_full` first vs optional use; aligns with Python `apply_brand_memory_prompt`.
2. **`ASSET CATALOG`** — If attachments exist, a second system message lists structured attachment metadata.

These are **prepended** to the single user turn: `[...systemMessages, { role: "user", content: userText }]`.

### 10.8 `agent.stream` options

- `maxSteps: 10`
- `modelSettings`: `temperature: 1`, `maxOutputTokens: 30000`
- `providerOptions.anthropic`: **extended thinking** — `thinking: { type: "enabled", budgetTokens: 2000 }`, `sendReasoning: true`
- `memory`: thread + resource (see §5)
- `requestContext`: see §10.6
- `onFinish`: persists assistant text + `llmUsage`; if final text contains `<TEXT_EDIT>`, `<TEXT_CONTENT_GENERATION>`, or `<TEXT_VARIATION>`, emits a **`markdown-doc`** event (Python v2 parity)

### 10.9 Streaming to the client

- **`stream()`** from Hono wraps the response.
- **Heartbeat** every 15s: `{ type: "heartbeat" }\n`.
- Initial **`start`** event: `{ type: "start", messageId, source: "marketmint_agent_v2" }`.
- **`for await (const chunk of result.fullStream)`** → `translateChunk` (see §11).
- Final **`finish`**: `{ type: "finish", source: "marketmint_agent_v2" }`.
- Errors → `{ type: "error", data: { message } }`.

---

## 11. Stream translation (`translateChunk`)

Maps Mastra **fullStream** chunks to the marketmint NDJSON protocol:

| Mastra chunk type | Client event |
|-------------------|--------------|
| `text-start` / `text-delta` / `text-end` | Same types with `id` and `delta` |
| `reasoning-*` | Extended thinking stream (Anthropic) |
| `tool-call` | Intentionally **not** emitted (avoid generic “Running X” pills) |
| `tool-result` | For **`skill` / load-skills-and-read** only → **`agent-utility`** “Found and Read skill: …” |
| `step-finish` | If `payload.output` is an object with `type`, re-emits it (e.g. tool writer events) |
| `default` | Forwards `payload.output` or payload if it looks like `agent-utility`, `agent-task`, `image`, `video`, `action`, `suggestions` |

**Development:** Unhandled chunk types may be logged to console.

---

## 12. Tool execution patterns

### 12.1 `context.writer`

Most tools call `context.writer.write({ type: "agent-utility", id, data: { name, status, steps, ... } })` to drive UI cards (running → completed / failed). Some emit `image`, `video`, `error`, or `agent-task` (e.g. `display_plan`).

### 12.2 `directImageGen`

- Optional **brand memory** branch: `getBrandMemories` + `analyseBrandMemory` to rewrite prompt and add assets.
- Refreshes signed URLs for S3/marketmint URLs.
- **`createIntelligentImages`** (`src/lib/direct-image-workflow.ts`): Creative Director (Gemini) produces variations, then concurrent Gemini image generation — aligned with Python `direct_image_gen` workflow.
- On success, **`notifyPythonStoreGeneratedAssets`** notifies the Python backend for credits/asset storage when `chatId` / `responseMessageId` exist.

### 12.3 `executeWorkflow`

- Resolves `selected_template_prompt_id` from `requestContext` into `workflow_inputs` when present.
- Injects **brand_memory** object into inputs when `directGenBm` and memories exist.
- Ensures default **`model_selection`** (e.g. `gemini-2.5-flash-image`) if missing.
- Streams from Python backend: **`POST ${BACKEND_BASE_URL}/internal/trigger/execute/stream`** with user Bearer token.
- Parses NDJSON lines; forwards Trigger-style events through **`v2Writer`** (progress → master `agent-utility` card with steps); **`__result__`** line returns final result object.
- After success, calls **`POST .../credits/workflow/v2/execute`** for billing (best-effort).

### 12.4 `analyzeBrandFull`

- Loads brand memory from DB; optionally resolves URL via Tavily when only `query` is set; scrapes with Firecrawl; analyzes with Gemini JSON extraction.
- Streams step-by-step **`agent-utility`** updates.

### 12.5 `displayPlan`

- Simulates staged “Generating a plan” steps with delays.
- Emits **`agent-task`** with widget `plan` (todos from markdown bullets, auto-proceed seconds).
- Returns instructions for the model **not** to repeat the plan in prose.

### 12.6 `finisherTool`

- Gets **`finisherAgent`** from `context.mastra`.
- **`finisherAgent.stream(...)`** → pipes **`fullStream`** to the same `writer` (nested agent stream).
- Parses bullet lines for **`suggestions`** event.

### 12.7 Search / Shopify / video tools

- **Tavily / Firecrawl / Gemini** — API keys from env (`TAVILY_API_KEY`, Firecrawl via `scrapeUrl`, `GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`).
- **Shopify** — `searchShopifyCatalog` uses storefront MCP helpers in `src/lib/shopify-storefront.ts`.
- **Image search** — Firecrawl `searchQuery` with image sources.
- **Image edit** — LangSmith prompt `workflows-image-edit` when available; else inline fallback; **`generateOneImage`**.

---

## 13. Skill router (`src/skills/skill-decider.ts`)

`decideSkillsToLoad(userMessage, skillsList)` uses Gemini with a long system prompt (garment vs non-garment, marketing vs image gen, template hidden blocks, etc.). **Used only by the optional `load-skills-and-read` tool**, not by the Mastra workspace `skill_search` implementation.

---

## 14. Database touchpoints (Drizzle)

| Area | Tables / queries |
|------|------------------|
| Messages | `createMessage`, `createOrUpdateMessage` — content merge by part `id` |
| Chats | `lastUpdated` on send |
| Credits | `getCreditsBalance` before stream |
| Brand | `getBrandMemories` in tools |
| Attachments | `user_attachments` select + insert |

---

## 15. Environment variables (representative)

- **Database:** `DATABASE_URL`
- **Clerk:** `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWKS_URI`
- **CDN:** `CDN_URL` (attachment key derivation)
- **Backend:** `BACKEND_BASE_URL` (Trigger stream + credits for workflows)
- **Google:** `GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`, optional Vertex (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`)
- **Tavily:** `TAVILY_API_KEY`
- **Firecrawl:** (via `scrapeUrl` / `searchQuery` implementation in `lib/firecrawl`)

---

## 16. Parity with Python `marketmint_agent_v2`

The TypeScript route and tools are explicitly designed to match Python v2:

- Same NDJSON-style events (`start`, text/reasoning, `agent-utility`, `finish`, heartbeat).
- Brand memory block behavior and `analyze_brand_full` first when toggle on.
- Attachment catalog and enrichment.
- Creative generation + workflow execution patterns.
- `markdown-doc` for TEXT_* tags in final assistant text.

---

## 17. Operational checklist

1. **Auth:** Clerk must validate production traffic; JWT fallback is for **local dev only** (no signature check).
2. **Two chat paths:** Confirm whether the client calls `/api/v2/chat` or `/v2/chat` on your deployment.
3. **`load-skills-and-read`:** Not in `allToolsV2`; skill loading is via **Mastra workspace** tools per `SYSTEM_PROMPT`.
4. **Sub-agents:** `brandAnalyzerAgent` is registered but not used in `chatRoute`; only `finisherTool` invokes `finisherAgent`.
5. **Resume field:** Accepted in JSON but not implemented in the handler yet.

---

## 18. File index (quick reference)

| Concern | File |
|---------|------|
| Mastra bootstrap | `src/mastra/index.ts` |
| Hono server | `src/server.ts` |
| Main agent | `src/mastra/agents/marketmint-agent.ts` |
| System prompt | `src/mastra/agents/prompts/tool-based-orchestrator.ts` |
| Memory | `src/mastra/memory/index.ts` |
| Workspace | `src/mastra/workspace.ts` |
| Tools export | `src/mastra/tools/index.ts` |
| Chat HTTP + stream | `src/routes/chat.ts` |
| Stream types | `src/types/stream-events.ts` |
| Skills on disk | `skills_v2/*/SKILL.md` |
| Skill loader (decider tool) | `src/skills/skill-loader.ts`, `src/skills/skill-decider.ts` |

---

*Generated from codebase review of `marketmint-agent-ts`. When Mastra APIs change, verify `Agent`, `Memory`, `Workspace`, and `stream` options against current `@mastra/core` documentation.*
