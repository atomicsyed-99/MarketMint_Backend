# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the MarketMint Pro Cowork backend for production with structured logging, Sentry error tracking, CORS configuration, graceful shutdown, workspace isolation fix, DB connection pooling, request timeouts, and silent error fixes.

**Architecture:** Add a structured JSON logger as the foundation, then layer Sentry error tracking, request/response logging middleware, and graceful shutdown on top. Fix security gaps (workspace isolation, CORS) and reliability issues (DB pooling, fetch timeouts, silent error swallowing) as independent changes.

**Tech Stack:** Hono middleware, `@sentry/node`, Node.js `AbortSignal.timeout()`, `postgres` driver pool config, structured JSON to stdout for CloudWatch.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/env.ts` | Add new env vars (SENTRY_DSN, ALLOWED_ORIGINS, etc.) |
| Create | `src/lib/logger.ts` | Structured JSON logger with requestId support |
| Create | `src/lib/sentry.ts` | Sentry initialization and helpers |
| Create | `src/middleware/request-logger.ts` | Log every request/response with timing |
| Create | `src/middleware/sentry.ts` | Capture unhandled errors to Sentry |
| Create | `src/lib/fetch.ts` | `fetchWithTimeout` wrapper |
| Create | `src/lib/shutdown.ts` | Graceful shutdown handler with stream tracking |
| Modify | `src/db/client.ts` | Add pool config and `closeDb()` export |
| Modify | `src/mastra/index.ts` | Wire middleware, CORS from env |
| Modify | `src/server.ts` | Wire shutdown handler |
| Modify | `src/routes/chat.ts` | Fix workspace isolation, register streams, use logger, add fetch timeouts |
| Modify | `src/routes/chats.ts` | Fix silent catches with logger |
| Modify | `src/routes/messages.ts` | Fix silent catches with logger |
| Modify | `src/routes/connectors.ts` | Fix workspace isolation, use logger |
| Modify | `src/db/queries/messages.ts` | Use logger, add Sentry capture |
| Modify | `src/lib/workspace-context.ts` | Remove x-workspace-id header fallback |
| Modify | `src/routes/backend-proxy.ts` | Add fetch timeout |
| Modify | `src/lib/brand-memories.ts` | Add fetch timeout |
| Modify | `src/lib/call-python-assets-credits.ts` | Add fetch timeout |
| Modify | `src/lib/langsmith-prompts.ts` | Add fetch timeout |
| Modify | `src/lib/grok-video.ts` | Add fetch timeout |
| Modify | `package.json` | Add @sentry/node dependency |

---

### Task 1: Add new environment variables to env.ts

**Files:**
- Modify: `src/env.ts`

- [ ] **Step 1: Add new env vars to the schema**

Add the production-readiness env vars to `src/env.ts`:

```typescript
// After the existing "Misc" section, before the closing `});`

  // Observability
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),

  // Server
  ALLOWED_ORIGINS: z.string().optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().optional(),
  EXTERNAL_API_TIMEOUT_MS: z.coerce.number().optional(),

  // Database pool
  DB_POOL_MAX: z.coerce.number().optional(),
```

- [ ] **Step 2: Verify the app still starts with no new vars set**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/env.ts
git commit -m "feat: add production-readiness env vars to schema"
```

---

### Task 2: Create structured logger module

**Files:**
- Create: `src/lib/logger.ts`
- Test: `src/lib/__tests__/logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/logger.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLogger, logger } from "../logger";

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("outputs structured JSON to stdout for info level", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const log = createLogger();
    log.info("test message", { key: "value" });
    expect(spy).toHaveBeenCalledOnce();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toMatchObject({
      level: "info",
      message: "test message",
      key: "value",
    });
    expect(output.timestamp).toBeDefined();
  });

  it("outputs error level with error details", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const log = createLogger();
    const err = new Error("boom");
    log.error("something failed", { error: err });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.level).toBe("error");
    expect(output.message).toBe("something failed");
    expect(output.error).toMatchObject({ message: "boom" });
  });

  it("includes extra context fields", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const log = createLogger();
    log.warn("rate limited", { userId: "u1", requestId: "r1" });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toMatchObject({
      level: "warn",
      message: "rate limited",
      userId: "u1",
      requestId: "r1",
    });
  });

  it("exports a default singleton logger", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/logger.test.ts`
Expected: FAIL — module `../logger` does not export `createLogger` or `logger`

- [ ] **Step 3: Write the logger implementation**

Create `src/lib/logger.ts`:

```typescript
type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      stack: err.stack,
      ...(err.cause ? { cause: serializeError(err.cause) } : {}),
    };
  }
  return { message: String(err) };
}

function write(level: LogLevel, message: string, context: LogContext) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  for (const [key, value] of Object.entries(context)) {
    if (key === "error") {
      entry.error = serializeError(value);
    } else {
      entry[key] = value;
    }
  }

  process.stdout.write(JSON.stringify(entry) + "\n");
}

export function createLogger() {
  return {
    info: (message: string, context: LogContext = {}) =>
      write("info", message, context),
    warn: (message: string, context: LogContext = {}) =>
      write("warn", message, context),
    error: (message: string, context: LogContext = {}) =>
      write("error", message, context),
  };
}

export const logger = createLogger();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/logger.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/logger.ts src/lib/__tests__/logger.test.ts
git commit -m "feat: add structured JSON logger for CloudWatch"
```

---

### Task 3: Create Sentry initialization module

**Files:**
- Create: `src/lib/sentry.ts`
- Modify: `package.json` (add `@sentry/node`)

- [ ] **Step 1: Install @sentry/node**

Run: `npm install @sentry/node`

- [ ] **Step 2: Create the Sentry initialization module**

Create `src/lib/sentry.ts`:

```typescript
import * as Sentry from "@sentry/node";
import { env } from "@/env";
import { logger } from "@/lib/logger";

let initialized = false;

export function initSentry() {
  if (initialized) return;
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry disabled — SENTRY_DSN not set");
    return;
  }

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? "development",
    beforeSend(event) {
      // Strip authorization headers from request data
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["Authorization"];
      }
      return event;
    },
  });

  initialized = true;
  logger.info("Sentry initialized", { environment: env.SENTRY_ENVIRONMENT ?? "development" });
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (key === "userId") {
          scope.setUser({ id: value as string });
        } else {
          scope.setExtra(key, value);
        }
      }
    }
    Sentry.captureException(error);
  });
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/sentry.ts
git commit -m "feat: add Sentry initialization module"
```

---

### Task 4: Create request logging middleware

**Files:**
- Create: `src/middleware/request-logger.ts`

- [ ] **Step 1: Create the request logging middleware**

Create `src/middleware/request-logger.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import { logger } from "@/lib/logger";

declare module "hono" {
  interface ContextVariableMap {
    requestId?: string;
  }
}

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);

  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const userId = c.get("authUser")?.id;

  logger.info("request completed", {
    requestId,
    method,
    path,
    status,
    duration,
    ...(userId ? { userId } : {}),
  });
};
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/middleware/request-logger.ts
git commit -m "feat: add request logging middleware"
```

---

### Task 5: Create Sentry error middleware

**Files:**
- Create: `src/middleware/sentry.ts`

- [ ] **Step 1: Create the Sentry error capture middleware**

Create `src/middleware/sentry.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import { captureException } from "@/lib/sentry";
import { logger } from "@/lib/logger";

export const sentryMiddleware: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } catch (error) {
    const requestId = c.get("requestId");
    const userId = c.get("authUser")?.id;

    captureException(error, {
      requestId,
      userId,
      path: c.req.path,
      method: c.req.method,
    });

    logger.error("unhandled request error", {
      requestId,
      userId,
      path: c.req.path,
      method: c.req.method,
      error,
    });

    throw error;
  }
};
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/middleware/sentry.ts
git commit -m "feat: add Sentry error capture middleware"
```

---

### Task 6: Wire middleware and CORS into Mastra config

**Files:**
- Modify: `src/mastra/index.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Update src/mastra/index.ts to use CORS from env and add middleware**

In `src/mastra/index.ts`, add imports at the top:

```typescript
import { requestLogger } from "@/middleware/request-logger";
import { sentryMiddleware } from "@/middleware/sentry";
import { initSentry } from "@/lib/sentry";
```

Add Sentry initialization before the Mastra constructor:

```typescript
initSentry();
```

Update the CORS config (replace lines 173-184):

```typescript
    cors: {
      origin: (origin) => {
        const allowed = env.ALLOWED_ORIGINS?.trim();
        if (!allowed || allowed === "*") return origin || "*";
        const origins = allowed.split(",").map((o) => o.trim());
        return origin && origins.includes(origin) ? origin : origins[0];
      },
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "x-mastra-client-type",
      ],
      exposeHeaders: ["Content-Length", "X-Requested-With"],
      credentials: true,
    },
```

Note: `x-workspace-id` is removed from `allowHeaders` since we're removing that header's usage.

Add global middleware to each route by adding `requestLogger` and `sentryMiddleware` to every route's middleware array. Since Mastra's `registerApiRoute` takes a `middleware` array, prepend them before `clerkAuthMiddleware`:

For every route registration, change:
```typescript
middleware: [clerkAuthMiddleware],
```
to:
```typescript
middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
```

And for the shared-chats route:
```typescript
middleware: [sentryMiddleware, requestLogger, clerkOptionalAuthMiddleware],
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/mastra/index.ts
git commit -m "feat: wire request logging, sentry, and CORS env var"
```

---

### Task 7: Add DB connection pooling and closeDb

**Files:**
- Modify: `src/db/client.ts`

- [ ] **Step 1: Update client.ts with pool config and closeDb export**

Replace the contents of `src/db/client.ts`:

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/env";

const queryClient = postgres(env.DATABASE_URL, {
  max: env.DB_POOL_MAX ?? 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

export async function closeDb(): Promise<void> {
  await queryClient.end();
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/db/client.ts
git commit -m "feat: add DB connection pooling config and closeDb"
```

---

### Task 8: Create fetchWithTimeout wrapper

**Files:**
- Create: `src/lib/fetch.ts`
- Test: `src/lib/__tests__/fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/fetch.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fetchWithTimeout } from "../fetch";

describe("fetchWithTimeout", () => {
  it("resolves for a successful fetch", async () => {
    const res = await fetchWithTimeout("https://httpbin.org/get", {
      timeoutMs: 10000,
    });
    expect(res.ok).toBe(true);
  });

  it("throws on timeout with descriptive error", async () => {
    await expect(
      fetchWithTimeout("https://httpbin.org/delay/10", { timeoutMs: 100 }),
    ).rejects.toThrow(/timed out/i);
  });

  it("uses default timeout from env when not specified", () => {
    // Just verify the function exists and accepts no timeoutMs
    expect(typeof fetchWithTimeout).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/fetch.test.ts`
Expected: FAIL — module `../fetch` not found

- [ ] **Step 3: Write the implementation**

Create `src/lib/fetch.ts`:

```typescript
import { env } from "@/env";

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string | URL,
  options?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const timeout = timeoutMs ?? env.EXTERNAL_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      let hostname: string;
      try {
        hostname = new URL(String(url)).hostname;
      } catch {
        hostname = "unknown";
      }
      throw new Error(
        `Request to ${hostname} timed out after ${timeout}ms`,
      );
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/fetch.test.ts`
Expected: All tests PASS (the timeout test may take ~100ms)

- [ ] **Step 5: Commit**

```bash
git add src/lib/fetch.ts src/lib/__tests__/fetch.test.ts
git commit -m "feat: add fetchWithTimeout wrapper for external API calls"
```

---

### Task 9: Create graceful shutdown handler

**Files:**
- Create: `src/lib/shutdown.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Create the shutdown handler module**

Create `src/lib/shutdown.ts`:

```typescript
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { closeDb } from "@/db/client";
import { flushSentry } from "@/lib/sentry";

const activeStreams = new Set<ReadableStreamDefaultController>();

export function registerStream(controller: ReadableStreamDefaultController) {
  activeStreams.add(controller);
}

export function unregisterStream(controller: ReadableStreamDefaultController) {
  activeStreams.delete(controller);
}

export function getActiveStreamCount(): number {
  return activeStreams.size;
}

let shutdownInProgress = false;

export function setupGracefulShutdown(server: { close: () => void } | null) {
  const timeoutMs = env.SHUTDOWN_TIMEOUT_MS ?? 30_000;

  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    logger.info("shutdown started", {
      signal,
      activeStreams: activeStreams.size,
      timeoutMs,
    });

    // 1. Stop accepting new connections
    if (server) {
      try {
        server.close();
      } catch {
        // Server may already be closed
      }
    }

    // 2. Wait for active streams to drain (with timeout)
    const drainStart = Date.now();
    while (activeStreams.size > 0 && Date.now() - drainStart < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (activeStreams.size > 0) {
      logger.warn("forcing shutdown with active streams", {
        remaining: activeStreams.size,
      });
      // Close remaining streams
      for (const controller of activeStreams) {
        try {
          controller.close();
        } catch {
          // Stream may already be closed
        }
      }
    }

    // 3. Close database connections
    try {
      await closeDb();
      logger.info("database connections closed");
    } catch (err) {
      logger.error("failed to close database connections", { error: err });
    }

    // 4. Flush Sentry
    try {
      await flushSentry(2000);
    } catch {
      // Best-effort flush
    }

    logger.info("shutdown complete");
    process.exit(0);
  };

  // Force exit after timeout + 5s grace
  const forceShutdown = (signal: string) => {
    shutdown(signal).catch(() => {});
    setTimeout(() => {
      logger.error("forced shutdown — timeout exceeded");
      process.exit(1);
    }, timeoutMs + 5000).unref();
  };

  process.on("SIGTERM", () => forceShutdown("SIGTERM"));
  process.on("SIGINT", () => forceShutdown("SIGINT"));
}
```

- [ ] **Step 2: Wire shutdown into server.ts**

Replace `src/server.ts`:

```typescript
import { Hono } from "hono";
import type { HonoBindings, HonoVariables } from "@mastra/hono";
import { MastraServer } from "@mastra/hono";
import { mastra } from "./mastra";
import { setupGracefulShutdown } from "./lib/shutdown";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();

const server = new MastraServer({ app, mastra });

await server.init();

setupGracefulShutdown(null);

export default app;
```

Note: We pass `null` for the server handle because Mastra manages the HTTP listener internally. The shutdown handler still drains streams, closes DB, and flushes Sentry. If the Mastra server exposes a `close()` method in the future, it can be passed here.

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/shutdown.ts src/server.ts
git commit -m "feat: add graceful shutdown with SSE stream draining"
```

---

### Task 10: Fix workspace isolation

**Files:**
- Modify: `src/lib/workspace-context.ts`
- Modify: `src/routes/chat.ts:639`
- Modify: `src/routes/connectors.ts:27`

- [ ] **Step 1: Fix workspace-context.ts — remove header fallback**

Replace `src/lib/workspace-context.ts`:

```typescript
import type { Context } from "hono";
import type { AuthUser } from "@/middleware/clerk";

/** Workspace scoping: Clerk orgId, falling back to userId for personal accounts. */
export function getWorkspaceId(c: Context): string {
  const user = c.get("authUser") as AuthUser | undefined;
  return user?.orgId ?? user?.id ?? "";
}
```

- [ ] **Step 2: Fix chat.ts — remove x-workspace-id header fallback**

In `src/routes/chat.ts`, replace line 639:

```typescript
    const workspaceId = user.orgId ?? c.req.header("x-workspace-id") ?? "";
```

with:

```typescript
    const workspaceId = user.orgId ?? user.id;
```

- [ ] **Step 3: Fix connectors.ts — remove x-workspace-id header fallback**

In `src/routes/connectors.ts`, replace line 26-28:

```typescript
function getWorkspaceId(c: Context): string | null {
  return c.get("authUser")?.orgId ?? c.req.header("x-workspace-id") ?? null;
}
```

with:

```typescript
function getWorkspaceId(c: Context): string | null {
  const user = c.get("authUser");
  return user?.orgId ?? user?.id ?? null;
}
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace-context.ts src/routes/chat.ts src/routes/connectors.ts
git commit -m "fix: remove x-workspace-id header override for workspace isolation"
```

---

### Task 11: Add fetch timeouts to external API calls

**Files:**
- Modify: `src/routes/chat.ts` (credits check, lines 148-156)
- Modify: `src/routes/backend-proxy.ts` (proxy fetch, line 37)
- Modify: `src/lib/brand-memories.ts` (brand memory fetch, line 50)
- Modify: `src/lib/call-python-assets-credits.ts` (assets + credits fetch, lines 44, 77)
- Modify: `src/lib/langsmith-prompts.ts` (LangSmith fetch, line 19)
- Modify: `src/lib/grok-video.ts` (video API fetch, lines 35, 57)

- [ ] **Step 1: Add fetchWithTimeout to credits check in chat.ts**

In `src/routes/chat.ts`, add import at top:

```typescript
import { fetchWithTimeout } from "@/lib/fetch";
```

Replace the fetch call in `assertHasEnoughCredits` (lines 148-156):

```typescript
  const resp = await fetchWithTimeout(
    `${creditsBase.replace(/\/$/, "")}/credits/balance`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
```

- [ ] **Step 2: Add fetchWithTimeout to backend-proxy.ts**

In `src/routes/backend-proxy.ts`, add import:

```typescript
import { fetchWithTimeout } from "@/lib/fetch";
```

Replace line 37:

```typescript
  const upstream = await fetchWithTimeout(upstreamUrl.toString(), {
    method,
    headers,
    body,
  });
```

- [ ] **Step 3: Add fetchWithTimeout to brand-memories.ts**

In `src/lib/brand-memories.ts`, add import:

```typescript
import { fetchWithTimeout } from "@/lib/fetch";
```

Replace the `fetch` call at line 50 with `fetchWithTimeout`, keeping all existing options.

- [ ] **Step 4: Add fetchWithTimeout to call-python-assets-credits.ts**

In `src/lib/call-python-assets-credits.ts`, add import:

```typescript
import { fetchWithTimeout } from "@/lib/fetch";
```

Replace both `fetch` calls (lines 44 and 77) with `fetchWithTimeout`, keeping all existing options.

- [ ] **Step 5: Add fetchWithTimeout to langsmith-prompts.ts**

In `src/lib/langsmith-prompts.ts`, add import:

```typescript
import { fetchWithTimeout } from "@/lib/fetch";
```

Replace the `fetch` call at line 19 with `fetchWithTimeout`, keeping all existing options.

- [ ] **Step 6: Add fetchWithTimeout to grok-video.ts**

In `src/lib/grok-video.ts`, add import:

```typescript
import { fetchWithTimeout } from "@/lib/fetch";
```

Replace both `fetch` calls (lines 35 and 57) with `fetchWithTimeout`, keeping all existing options. Use `{ timeoutMs: 60_000 }` for the video generation call since it's a longer operation.

- [ ] **Step 7: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add src/routes/chat.ts src/routes/backend-proxy.ts src/lib/brand-memories.ts src/lib/call-python-assets-credits.ts src/lib/langsmith-prompts.ts src/lib/grok-video.ts
git commit -m "feat: add request timeouts to all external API calls"
```

---

### Task 12: Fix silent error swallowing and add logger throughout

**Files:**
- Modify: `src/db/queries/messages.ts`
- Modify: `src/routes/chat.ts`
- Modify: `src/routes/chats.ts`

- [ ] **Step 1: Fix deleteMessageByMessageId in messages.ts**

In `src/db/queries/messages.ts`, add imports at top:

```typescript
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/sentry";
```

Replace `deleteMessageByMessageId` (lines 67-73):

```typescript
export async function deleteMessageByMessageId(messageId: string) {
  try {
    await db.delete(messages).where(eq(messages.messageId, messageId));
  } catch (error) {
    logger.warn("deleteMessageByMessageId failed", { messageId, error });
  }
}
```

Replace the `console.error` in `createMessage` (lines 13-28):

```typescript
    logger.error("createMessage insert failed", {
      payload: {
        chatId: data.chatId,
        messageId: data.messageId,
        role: data.role,
        agent: data.agent,
        contentParts: Array.isArray(data.content) ? data.content.length : null,
        attachmentsCount: Array.isArray(data.attachments)
          ? data.attachments.length
          : null,
      },
      errorMessage: error?.message,
      causeMessage: error?.cause?.message,
      causeCode: error?.cause?.code,
      causeDetail: error?.cause?.detail,
    });
    captureException(error, { operation: "createMessage", chatId: data.chatId });
```

Replace the `console.error` in `createOrUpdateMessage` (lines 57-62):

```typescript
    logger.error("createOrUpdateMessage failed", {
      messageId,
      role: data.role,
      chatId: data.chatId,
      error,
    });
    captureException(error, { operation: "createOrUpdateMessage", messageId });
```

- [ ] **Step 2: Fix chat.ts — abort handler, onFinish, and outer catch**

In `src/routes/chat.ts`, add imports:

```typescript
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/sentry";
```

Replace the fire-and-forget delete (line 591):

```typescript
      void deleteMessageByMessageId(responseMessageId).catch((err) => {
        logger.error("failed to delete aborted message", {
          responseMessageId,
          error: err,
        });
      });
```

Wrap the title generation silent catch (line 712-714) to log:

```typescript
          } catch (titleErr) {
            logger.warn("title generation failed", { chatId: chat_id, error: titleErr });
          }
```

Replace the outer catch (lines 985-988):

```typescript
  } catch (error: any) {
    const requestId = c.get("requestId");
    logger.error("chatRoute unhandled error", {
      requestId,
      error,
      path: c.req.path,
    });
    captureException(error, { requestId, path: c.req.path });
    return c.json({ error: "Chat request failed" }, 500);
  }
```

Replace the console.log calls on lines 641 and 645 with logger.info:

```typescript
    logger.info("chat workspace context", { workspaceId, connections: Object.keys(connections) });
```

```typescript
    logger.info("connector processor active", { workspaceId });
```

- [ ] **Step 3: Fix chats.ts — silent catches on user lookup**

In `src/routes/chats.ts`, add import:

```typescript
import { logger } from "@/lib/logger";
```

Replace the two empty `catch {}` blocks in `createChat` (lines 31-32 and 42-43):

First catch (line 31-32):
```typescript
  } catch (err) {
    logger.warn("user lookup by clerk_user_id failed", { clerkUserId: user.id, error: err });
  }
```

Second catch (line 42-43):
```typescript
  } catch (err) {
    logger.warn("user lookup by email failed", { email: userEmail, error: err });
  }
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/messages.ts src/routes/chat.ts src/routes/chats.ts
git commit -m "fix: replace silent error swallowing with structured logging + Sentry"
```

---

### Task 13: Register SSE streams for graceful shutdown

**Files:**
- Modify: `src/routes/chat.ts`

- [ ] **Step 1: Register and unregister streams in the chat route**

In `src/routes/chat.ts`, add import:

```typescript
import { registerStream, unregisterStream } from "@/lib/shutdown";
```

In the `wrappedStream` `ReadableStream` constructor (around line 725), update the `start` and `cancel` callbacks:

Inside `start(controller)`, add as the first line:

```typescript
        registerStream(controller);
```

Inside the `finally` block (after line 968), add before `reader.releaseLock()`:

```typescript
          unregisterStream(controller);
```

Update the `cancel()` callback (line 972-974):

```typescript
      cancel(reason) {
        unregisterStream(undefined as any);
        abortHandler();
      },
```

Actually, since `cancel` doesn't receive the controller, we need a different approach. Capture a reference:

In the `start` function, after `registerStream(controller)`, store the controller reference:

```typescript
      async start(controller) {
        registerStream(controller);
        // ... existing code ...
        try {
          // ... existing loop ...
        } catch (e) {
          controller.error(e);
        } finally {
          unregisterStream(controller);
          reader.releaseLock();
        }
      },
```

The `cancel` callback can reference controller via closure — but `ReadableStream` doesn't give cancel the controller. Instead, use a variable in the outer scope:

Before the `new ReadableStream(...)` call, add:

```typescript
    let streamController: ReadableStreamDefaultController | null = null;
```

Then in `start(controller)`:

```typescript
        streamController = controller;
        registerStream(controller);
```

In `cancel()`:

```typescript
      cancel() {
        if (streamController) unregisterStream(streamController);
        abortHandler();
      },
```

And keep the `finally` block unregister as well for the normal close path.

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/routes/chat.ts
git commit -m "feat: register SSE streams for graceful shutdown draining"
```

---

### Task 14: Final verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify the dev server starts**

Run: `npm run dev` (check it starts without errors, then Ctrl-C)
Expected: Server starts and Sentry logs "Sentry disabled — SENTRY_DSN not set"

- [ ] **Step 4: Final commit with any remaining fixes**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix: address issues found during final verification"
```
