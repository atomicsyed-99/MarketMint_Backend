# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start Mastra dev server (hot reload)
npm run build        # Production build via Mastra
npm run start        # Run production build: node .mastra/output/index.mjs
npm run db:generate  # Generate Drizzle migrations
npm run db:push      # Push schema changes to database
npm test             # Run tests via Vitest
```

## Architecture

This is a **Mastra-based AI agent** backend serving a chat API for **Marketmint**. It uses Hono as the HTTP framework, Drizzle ORM for PostgreSQL, and Clerk for authentication.

### Request Flow

`POST /cowork/v3/chat` → Clerk middleware → chat route handler → `handleChatStream` → `marketMintAgent` (Claude Sonnet) → tool calls → streamed response

### Core Layers

- **`src/mastra/index.ts`** — Mastra instance. Registers agents, storage, and the chat API route with Clerk auth middleware.
- **`src/mastra/agents/`** — Supervisor `marketMintAgent` (orchestrator: routing + **on-agent** image/video/workflow tools) + sub-agents: `performanceMarketingAgent`, `shopifyStoreManagerAgent`, `emailCrmManagerAgent`, `geoOptimizerAgent`, `agentsJobManagerAgent`. Plus `finisherAgent` and `brandAnalyzerAgent`. There is **no** separate Creative Director agent in this fork.
- **`src/mastra/tools/`** — ~22 tools organized by domain: `generation/`, `discovery/`, `search/`, `shopify/`, `workflow/`, `video/`. Each uses `createTool()` with Zod input/output schemas.
- **`src/routes/chat.ts`** — Chat endpoint handler. Validates input, enriches attachments from DB, builds brand memory context, calls `handleChatStream`, returns SSE stream.
- **`src/lib/`** — Utility modules for external services (S3, Gemini, Firecrawl, Trigger.dev, Grok video, LangSmith) and domain logic (brand memory, attachments, URL validation).
- **`src/db/`** — Drizzle schema and queries. Tables: `chats`, `messages`, `brand-memories`, `userAttachments`.

### Skills System

Agent capabilities are defined as markdown files in `src/mastra/skills/` (49 skills). Each agent has its own scoped workspace (defined in `src/mastra/agents/shared/agent-workspaces.ts`) that only exposes the skills relevant to that agent. The workspace base path uses `import.meta.url` — this is important for `mastra dev` to resolve paths correctly.

### Environment Variables

All env vars are validated via Zod in `src/env.ts`. Import `env` from `@/env` — never use `process.env` directly. Required vars: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`.

### Tool Streaming Pattern

Tools emit real-time UI events via `context?.writer?.custom()` with the `data-agent-utility` event type. Events include status (running/completed/failed), step progress, and duration. This powers the frontend's live feedback cards.

### Mastra Skill

Before writing or modifying any Mastra code (agents, tools, workflows), read `.agents/skills/mastra/SKILL.md` and follow its documentation lookup workflow. Never rely on internal knowledge for Mastra APIs — always verify against the installed version's embedded docs first.

### Key Conventions

- **Path alias**: `@/*` maps to `src/*` (configured in tsconfig.json).
- **Schemas**: Request validation schemas live in `src/schemas/`.
- **Constants**: Shared constants live in `src/constants.ts`.
- **Auth**: Clerk middleware sets `c.get("authUser")` with `{ id, email, orgId }`. Tools access user context via `context?.requestContext`.
- **Asset pipeline**: Generated images go through S3 (`src/lib/s3.ts`) with CDN URL support. Credits are deducted via the Python backend (`src/lib/call-python-assets-credits.ts`).
- **Workflows**: Long-running generation workflows are dispatched to Trigger.dev and streamed back via SSE (`src/lib/trigger-dev-client.ts`).
