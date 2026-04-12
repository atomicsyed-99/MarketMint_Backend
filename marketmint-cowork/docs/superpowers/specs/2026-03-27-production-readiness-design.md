# Production Readiness Design

## Context

MarketMint Pro Cowork is a Mastra-based AI agent backend serving a chat API. It uses Hono, Drizzle ORM for PostgreSQL, Clerk for auth, and deploys to AWS ECS. The codebase has solid foundations (strict TypeScript, Zod validation, parameterized queries, multi-stage Docker build, CI/CD via OIDC) but lacks production hardening for observability, error handling, security, and connection management.

**Target scale:** Hundreds of concurrent users, single region.
**Deployment:** AWS ECS behind ELB, single region.
**Observability stack:** CloudWatch (structured logs) + Sentry (error tracking).

---

## Implemented Changes

### 1. Structured Logging + Request Logging

**Logger module** (`src/lib/logger.ts`):
- Thin wrapper over `console` that outputs JSON to stdout (CloudWatch ingests natively from ECS).
- Consistent fields on every log: `timestamp`, `level`, `message`, `requestId`, `userId`, `path`, `duration`, `error`.
- No heavy dependency (no pino/winston) -- just structured JSON.
- `requestId` (UUID) generated per request and threaded via Hono context (`c.set("requestId", id)`).

**Request logging middleware** (`src/middleware/request-logger.ts`):
- Runs on every inbound request.
- Logs on response completion: `method`, `path`, `status`, `duration_ms`, `userId`, `requestId`.
- Logs request body size (not content -- no PII in logs).

**Error logging:**
- All `catch` blocks updated to use `logger.error()` with `requestId` and structured error details.
- Silent `catch {}` blocks fixed to log warnings at minimum.

### 2. Sentry Error Tracking

**Setup** (`src/lib/sentry.ts`):
- Initialize Sentry with DSN from `SENTRY_DSN` env var (optional -- if unset, Sentry is disabled).
- Environment set via `SENTRY_ENVIRONMENT` (defaults to `development`).

**Hono middleware** (`src/middleware/sentry.ts`):
- Captures unhandled errors with context: `requestId`, `userId`, `path`, `method`.
- Attaches Clerk user info (`id`, `email`, `orgId`) to Sentry scope.
- Strips sensitive headers (authorization) before sending.

**Integration points:**
- Chat route outer `catch` sends to Sentry with full context.
- Silent `catch {}` blocks get Sentry capture alongside logger fixes.
- SSE stream errors captured with chat context attached.

**Env vars added:**
- `SENTRY_DSN` (optional string)
- `SENTRY_ENVIRONMENT` (optional string, defaults to `development`)

### 3. CORS Configuration via Env Var

- Add `ALLOWED_ORIGINS` to `src/env.ts` (optional string, defaults to `*`).
- `src/mastra/index.ts` CORS config reads from `env.ALLOWED_ORIGINS`.
- Supports comma-separated origins (e.g., `https://app.marketmint.ai,http://localhost:3000`) or `*` for allow-all.
- Current behavior preserved -- defaults to `*`.

**Env var:** `ALLOWED_ORIGINS` (optional string, defaults to `*`)

### 4. Graceful Shutdown

Critical for a chat app where users have open SSE streams.

**Shutdown handler** (`src/lib/shutdown.ts`):
- Listens for `SIGTERM` (ECS task stop) and `SIGINT`.
- Maintains a `Set` of active SSE response streams, registered/unregistered by the chat route.
- On signal:
  1. Log "shutting down, draining N active connections".
  2. Stop accepting new requests (close the Hono server).
  3. Wait for active SSE streams to finish (hard timeout configurable via `SHUTDOWN_TIMEOUT_MS`, defaults to 30s).
  4. Close the database connection pool.
  5. Flush Sentry (`Sentry.close()`).
  6. `process.exit(0)`.
- If hard timeout fires, force exit with `process.exit(1)`.

**Integration points:**
- `src/routes/chat.ts`: Register each SSE stream on creation, unregister on close/error/abort.
- `src/mastra/index.ts` or `src/server.ts`: Wire up shutdown handler after server starts.
- `src/db/client.ts`: Export `closeDb()` for shutdown handler.

**Env var:** `SHUTDOWN_TIMEOUT_MS` (optional number, defaults to `30000`)

### 5. Workspace Isolation Fix

**Problem:** `x-workspace-id` header can override `user.orgId`, allowing authenticated users to access other orgs' data.

**Fix in `src/routes/chat.ts`:**
- Remove `x-workspace-id` header fallback.
- `workspaceId` always comes from `user.orgId` (Clerk auth).
- If `orgId` is null/empty (user not in an org), use `user.id` as workspace scope.

### 6. DB Connection Pooling

**Changes in `src/db/client.ts`:**
- Configure `postgres` driver: `max: 20` (via `DB_POOL_MAX` env var), `idle_timeout: 30s`, `connect_timeout: 10s`.
- Export `closeDb()` that calls `sql.end()` -- used by graceful shutdown.

**Env var:** `DB_POOL_MAX` (optional number, defaults to `20`)

### 7. Request Timeouts on External API Calls

**Wrapper** (`src/lib/fetch.ts`):
- `fetchWithTimeout` using `AbortSignal.timeout()`.
- Default timeout: `30000ms` (via `EXTERNAL_API_TIMEOUT_MS` env var).
- On timeout, throws descriptive error with URL hostname (not full URL -- may contain tokens).

**Integration:**
- Replace bare `fetch()` in: credits check, Python backend calls, attachment URL fetching, connector API calls.
- LLM/agent calls excluded -- Mastra/AI SDK manage their own timeouts.
- Per-call timeout override supported for longer operations.

**Env var:** `EXTERNAL_API_TIMEOUT_MS` (optional number, defaults to `30000`)

### 8. Fix Silent Error Swallowing

- `src/routes/messages.ts:70` -- silent catch on stream abort cleanup: add `logger.warn()`.
- `src/routes/chats.ts:31` -- silent catch on user lookup: add `logger.warn()`.
- `src/routes/chat.ts:591` -- `void deleteMessageByMessageId(...)`: add `.catch(err => logger.error(...))`.
- `src/routes/chat.ts` `onFinish` callback -- DB queries in non-awaited context: wrap in try/catch with `logger.error()` + Sentry capture.

**Principle:** No empty `catch {}` blocks. At minimum, log a warning. Fire-and-forget errors get logged + Sentry but don't crash the request.

---

## New Env Vars Summary

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SENTRY_DSN` | No | (disabled) | Sentry error tracking DSN |
| `SENTRY_ENVIRONMENT` | No | `development` | Sentry environment tag |
| `ALLOWED_ORIGINS` | No | `*` | CORS allowed origins (comma-separated) |
| `SHUTDOWN_TIMEOUT_MS` | No | `30000` | Graceful shutdown drain timeout (ms) |
| `DB_POOL_MAX` | No | `20` | Max DB connections in pool |
| `EXTERNAL_API_TIMEOUT_MS` | No | `30000` | Timeout for external API fetch calls |

---

## New Files

| File | Purpose |
|---|---|
| `src/lib/logger.ts` | Structured JSON logger |
| `src/lib/sentry.ts` | Sentry initialization |
| `src/lib/shutdown.ts` | Graceful shutdown handler |
| `src/lib/fetch.ts` | `fetchWithTimeout` wrapper |
| `src/middleware/request-logger.ts` | Request/response logging middleware |
| `src/middleware/sentry.ts` | Sentry error capture middleware |

---

## Roadmap (Not Implemented)

1. **Rate limiting** -- per-user, in-memory sliding window. Upgrade to Redis if scaling to multiple ECS tasks.
2. **Unit/integration tests** -- auth middleware, route validation, DB operations, tool execution, stream handling.
3. **DB indexes** -- `(chat_id, created_at DESC)` on messages, `(user_id, created_at DESC)` on chats.
4. **Migration validation** -- fail startup if migrations can't run, add rollback strategy.
5. **JSONB size limits** -- max size enforcement on `content`, `attachments`, `toolCalls` columns.
6. **Soft-delete enforcement** -- default `deleted_at IS NULL` filter on all chat queries.
7. **Audit logging** -- who changed what, when (compliance).
8. **Data cleanup jobs** -- archive old messages, purge soft-deleted chats (GDPR).
9. **OpenTelemetry** -- distributed tracing across services.
10. **Load testing** -- establish baseline capacity and breaking points.
11. **CI/CD hardening** -- pre-build type-check/lint, post-deploy smoke tests, `wait-for-service-stability: true`.
12. **Secrets rotation** -- handle credential expiry/rotation in entrypoint.
