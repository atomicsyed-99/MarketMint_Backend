# Pino.js Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom JSON logger with Pino.js and consolidate all `console.*` calls into structured Pino logging.

**Architecture:** Drop-in replacement of `src/lib/logger.ts` with Pino. The module exports `logger` (root instance) and `createLogger(name)` (child factory). Every file that currently uses `console.log/warn/error` or the custom logger switches to Pino. `pino-pretty` provides human-readable output in dev.

**Tech Stack:** pino, pino-pretty (devDependency), Vitest (tests)

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pino and pino-pretty**

```bash
npm install pino && npm install -D pino-pretty
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('pino'); console.log('pino OK')"
```

Expected: `pino OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pino and pino-pretty dependencies"
```

---

### Task 2: Rewrite logger module (TDD)

**Files:**
- Modify: `src/lib/logger.ts`
- Modify: `src/lib/__tests__/logger.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the contents of `src/lib/__tests__/logger.test.ts` with:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import { createLogger, logger } from "../logger";

function createSinkLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("exports a pino logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("createLogger returns a child with module binding", () => {
    const child = createLogger("test-module");
    expect(child).toBeDefined();
    // Pino child loggers expose bindings()
    const bindings = (child as any).bindings();
    expect(bindings.module).toBe("test-module");
  });

  it("outputs structured JSON with level as string", () => {
    const { lines, stream } = createSinkLogger();
    const testLogger = pino(
      {
        level: "info",
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      stream,
    );

    testLogger.info({ key: "value" }, "test message");
    stream.end();

    const output = JSON.parse(lines[0]);
    expect(output.level).toBe("info");
    expect(output.msg).toBe("test message");
    expect(output.key).toBe("value");
    expect(output.time).toBeDefined();
  });

  it("serializes errors with stack and cause", () => {
    const { lines, stream } = createSinkLogger();
    const testLogger = pino(
      {
        level: "info",
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
        serializers: { err: pino.stdSerializers.err },
      },
      stream,
    );

    const cause = new Error("root cause");
    const err = new Error("boom", { cause });
    testLogger.error({ err }, "something failed");
    stream.end();

    const output = JSON.parse(lines[0]);
    expect(output.err.message).toBe("boom");
    expect(output.err.stack).toBeDefined();
    expect(output.err.cause.message).toBe("root cause");
  });

  it("respects log level — debug suppressed at info level", () => {
    const { lines, stream } = createSinkLogger();
    const testLogger = pino({ level: "info" }, stream);

    testLogger.debug("should not appear");
    testLogger.info("should appear");
    stream.end();

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).msg).toBe("should appear");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/logger.test.ts
```

Expected: FAIL — tests that import from `../logger` will fail because the module still exports the old custom logger (no `debug` method, no `bindings()` on children).

- [ ] **Step 3: Rewrite the logger module**

Replace the contents of `src/lib/logger.ts` with:

```typescript
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: isDev ? "debug" : "info",
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
  },
});

export function createLogger(name: string) {
  return logger.child({ module: name });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/logger.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logger.ts src/lib/__tests__/logger.test.ts
git commit -m "feat: replace custom logger with Pino.js"
```

---

### Task 3: Update existing logger consumers

These files already import `{ logger }` from `@/lib/logger`. The import stays the same — we just need to adjust the call signatures because Pino uses `logger.info({ context }, "message")` instead of `logger.info("message", { context })`.

**Files:**
- Modify: `src/middleware/request-logger.ts`
- Modify: `src/middleware/sentry.ts`
- Modify: `src/lib/sentry.ts`
- Modify: `src/lib/shutdown.ts`
- Modify: `src/routes/chat.ts`
- Modify: `src/routes/chats.ts`
- Modify: `src/db/queries/messages.ts`
- Modify: `src/mastra/index.ts`

**Important Pino calling convention:** Pino uses `logger.info({ key: "value" }, "message")` — the object comes FIRST, then the message string. This is the opposite of the current custom logger which uses `logger.info("message", { context })`.

- [ ] **Step 1: Update `src/middleware/request-logger.ts`**

Replace import and usage. Change `logger` to a named child logger:

```typescript
import type { MiddlewareHandler } from "hono";
import { createLogger } from "@/lib/logger";

const log = createLogger("http");

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

  log.info(
    {
      requestId,
      method,
      path,
      status,
      duration,
      ...(userId ? { userId } : {}),
    },
    "request completed",
  );
};
```

- [ ] **Step 2: Update `src/middleware/sentry.ts`**

```typescript
import type { MiddlewareHandler } from "hono";
import { captureException } from "@/lib/sentry";
import { createLogger } from "@/lib/logger";

const log = createLogger("sentry-middleware");

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

    log.error(
      {
        err: error,
        requestId,
        userId,
        path: c.req.path,
        method: c.req.method,
      },
      "unhandled request error",
    );

    throw error;
  }
};
```

Note: Use `err` key (not `error`) so Pino's error serializer kicks in automatically.

- [ ] **Step 3: Update `src/lib/sentry.ts`**

Change the import from `{ logger }` to `{ createLogger }` and create a named child:

```typescript
import { createLogger } from "@/lib/logger";
```

Replace `const log = ...` usage — find and replace these calls:

- `logger.info("Sentry disabled — SENTRY_DSN not set")` → `log.info("Sentry disabled — SENTRY_DSN not set")`
- `logger.info("Sentry initialized", { environment: ... })` → `log.info({ environment: env.SENTRY_ENVIRONMENT ?? "development" }, "Sentry initialized")`

Add at top of file (after imports): `const log = createLogger("sentry");`

- [ ] **Step 4: Update `src/lib/shutdown.ts`**

Change import to `{ createLogger }` and add `const log = createLogger("shutdown");`

Replace all calls — argument order flips (object first, message second):

- `logger.info("shutdown started", { signal, activeStreams: activeStreams.size, timeoutMs })` → `log.info({ signal, activeStreams: activeStreams.size, timeoutMs }, "shutdown started")`
- `logger.warn("forcing shutdown with active streams", { remaining: activeStreams.size })` → `log.warn({ remaining: activeStreams.size }, "forcing shutdown with active streams")`
- `logger.info("database connections closed")` → `log.info("database connections closed")`
- `logger.error("failed to close database connections", { error: err })` → `log.error({ err }, "failed to close database connections")`
- `logger.info("shutdown complete")` → `log.info("shutdown complete")`
- `logger.error("forced shutdown — timeout exceeded")` → `log.error("forced shutdown — timeout exceeded")`

- [ ] **Step 5: Update `src/routes/chat.ts`**

Change import to `{ createLogger }`. Add `const log = createLogger("chat");`. Find all `logger.info/warn/error` calls and flip argument order. Use `err` key for error objects.

- [ ] **Step 6: Update `src/routes/chats.ts`**

Same pattern: import `{ createLogger }`, create `const log = createLogger("chats");`, flip argument order on all calls.

- [ ] **Step 7: Update `src/db/queries/messages.ts`**

Change import to `{ createLogger }`. Add `const log = createLogger("db");`. Flip argument order on all calls. Use `err` key for error objects.

- [ ] **Step 8: Update `src/mastra/index.ts`**

Change import to `{ createLogger }`. Add `const log = createLogger("mastra");`. Flip argument order on all calls.

- [ ] **Step 9: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new type errors from the logger changes.

- [ ] **Step 10: Run tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/middleware/request-logger.ts src/middleware/sentry.ts src/lib/sentry.ts src/lib/shutdown.ts src/routes/chat.ts src/routes/chats.ts src/db/queries/messages.ts src/mastra/index.ts
git commit -m "refactor: migrate existing logger consumers to Pino"
```

---

### Task 4: Migrate console.* in connectors

**Files:**
- Modify: `src/routes/connectors.ts`
- Modify: `src/connectors/build-toolset.ts`
- Modify: `src/connectors/nango/proxy.ts`
- Modify: `src/connectors/nango/connections.ts`
- Modify: `src/connectors/tools/google-ads.ts`
- Modify: `src/connectors/tools/refresh-connections.ts`

- [ ] **Step 1: Update `src/routes/connectors.ts`**

Add at top (after existing imports):
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("connectors");
```

Replace all `console.*` calls:
- `console.log("[connectors] Creating connect session for workspace:", workspaceId, "user:", c.get("authUser")?.id)` → `log.info({ workspaceId, userId: c.get("authUser")?.id }, "creating connect session")`
- `console.error("[connectors] connect-session error:", err)` → `log.error({ err }, "connect-session error")`
- `console.warn("[connectors] DB batch upsert failed (non-blocking):", err)` → `log.warn({ err }, "DB batch upsert failed (non-blocking)")`
- `console.error("[connectors] list-connections error:", err)` → `log.error({ err }, "list-connections error")`
- `console.warn("[connectors] DB soft-delete failed (non-blocking):", err)` → `log.warn({ err }, "DB soft-delete failed (non-blocking)")`
- `console.error("[connectors] disconnect error:", err)` → `log.error({ err }, "disconnect error")`

- [ ] **Step 2: Update `src/connectors/build-toolset.ts`**

Add at top (after existing imports):
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("build-toolset");
```

Replace all `console.log` calls:
- Line 90: `console.log("[build-toolset] Cache HIT for", ...)` → `log.debug({ workspaceId, hash: newHash }, "cache HIT — reusing processor")`
- Line 93: `console.log("[build-toolset] Cache MISS for", ...)` → `log.debug({ workspaceId, oldHash: cached?.connectionsHash, newHash }, "cache MISS — rebuilding")`
- Line 99: `console.log("[build-toolset] Built tools:", ...)` → `log.debug({ total: Object.keys(allTools).length, dynamic: Object.keys(dynamicTools).length, connector: Object.keys(connectorTools).length }, "built tools")`

Note: These are debug-level since they're cache diagnostics — visible in dev, suppressed in prod.

- [ ] **Step 3: Update `src/connectors/nango/proxy.ts`**

Add at top (after existing imports):
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("nango-proxy");
```

Replace:
- `` console.error(`[nangoProxy] ${method} ${endpoint} failed (${status}):`, message, detail ?? "") `` → `log.error({ method, endpoint, status, detail }, message)`

- [ ] **Step 4: Update `src/connectors/nango/connections.ts`**

Add at top (after existing imports):
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("nango-connections");
```

Replace:
- Line 91: `console.log(...)` → `log.debug({ provider: conn.providerConfigKey, apiKeyFields: Object.keys(apiKeys) }, "API-key credentials fetched")`
- Line 94: `console.warn(...)` → `log.warn({ err, provider: conn.providerConfigKey }, "failed to fetch credentials")`
- Line 128: `console.warn(...)` → `log.warn({ err }, "failed to fetch connections, continuing without connectors")`

- [ ] **Step 5: Update `src/connectors/tools/google-ads.ts`**

Add at top (after existing imports):
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("google-ads");
```

Replace:
- `console.warn("[google-ads] GOOGLE_ADS_DEVELOPER_TOKEN not set — ...")` → `log.warn("GOOGLE_ADS_DEVELOPER_TOKEN not set — Google Ads API calls will fail")`

- [ ] **Step 6: Update `src/connectors/tools/refresh-connections.ts`**

Add at top (after existing imports):
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("refresh-connections");
```

Replace:
- `console.warn("[refreshConnections] Failed to inject tools mid-stream:", e)` → `log.warn({ err: e }, "failed to inject tools mid-stream")`

- [ ] **Step 7: Commit**

```bash
git add src/routes/connectors.ts src/connectors/build-toolset.ts src/connectors/nango/proxy.ts src/connectors/nango/connections.ts src/connectors/tools/google-ads.ts src/connectors/tools/refresh-connections.ts
git commit -m "refactor: migrate connector console.* calls to Pino"
```

---

### Task 5: Migrate console.* in libs

**Files:**
- Modify: `src/lib/langsmith-prompts.ts`
- Modify: `src/lib/brand-memory-analysis.ts`
- Modify: `src/lib/s3.ts`
- Modify: `src/lib/call-python-assets-credits.ts`

- [ ] **Step 1: Update `src/lib/langsmith-prompts.ts`**

Add import and child logger:
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("langsmith");
```

Replace:
- `console.warn("[langsmith-prompts] fetch failed:", e)` → `log.warn({ err: e }, "fetch failed")`

- [ ] **Step 2: Update `src/lib/brand-memory-analysis.ts`**

Add import and child logger:
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("brand-memory-analysis");
```

Replace:
- `console.warn("[analyseBrandMemory] OPENAI_API_KEY not set; returning passthrough.")` → `log.warn("OPENAI_API_KEY not set; returning passthrough")`

- [ ] **Step 3: Update `src/lib/s3.ts`**

Add import and child logger:
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("s3");
```

Replace:
- `console.warn("S3_ASSET_BUCKET / S3_BUCKET is not set. ...")` → `log.warn("S3_ASSET_BUCKET / S3_BUCKET is not set — signed URL generation will fail")`

Remove the `// eslint-disable-next-line no-console` comment above it.

- [ ] **Step 4: Update `src/lib/call-python-assets-credits.ts`**

Add import and child logger:
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("assets-credits");
```

Replace all `console.*` calls (7 total):
- Line 33: `console.warn("[notifyPythonStoreGeneratedAssets] ASSETS_SERVICE_WEBHOOK_URL not set, ...")` → `log.warn("ASSETS_SERVICE_WEBHOOK_URL not set, skipping assets store")`
- Line 36: `console.warn("[notifyPythonStoreGeneratedAssets] CREDITS_BACKEND_BASE_URL not set, ...")` → `log.warn("CREDITS_BACKEND_BASE_URL not set, skipping credits")`
- Line 57-59: `console.warn("[notifyPythonStoreGeneratedAssets] No userAccessToken; ...")` → `log.warn("no userAccessToken; assets POST /assets will likely return 401")`
- Line 88-92: `console.error("[notifyPythonStoreGeneratedAssets] assets store failed", ...)` → `log.error({ status: assetsRes.status, body: text.slice(0, 500) }, "assets store failed")`
- Line 101-103: `console.warn("[notifyPythonStoreGeneratedAssets] Missing ...")` → `log.warn("missing userEmail/workspaceId/ASSET_MANAGER_SERVICE_AUTH_KEY; skipping credits deduction")`
- Line 128-132: `console.error("[notifyPythonStoreGeneratedAssets] credits deduction failed", ...)` → `log.error({ status: creditsRes.status, body: text.slice(0, 500) }, "credits deduction failed")`
- Line 138: `console.error("[notifyPythonStoreGeneratedAssets] request error", e)` → `log.error({ err: e }, "request error")`

- [ ] **Step 5: Commit**

```bash
git add src/lib/langsmith-prompts.ts src/lib/brand-memory-analysis.ts src/lib/s3.ts src/lib/call-python-assets-credits.ts
git commit -m "refactor: migrate lib console.* calls to Pino"
```

---

### Task 6: Migrate console.* in tools

**Files:**
- Modify: `src/mastra/tools/generation/direct-image-gen.ts`
- Modify: `src/mastra/tools/generation/generate-video-single-shot.ts`
- Modify: `src/mastra/tools/workflow/execute-workflow.ts`

- [ ] **Step 1: Update `src/mastra/tools/generation/direct-image-gen.ts`**

Add import and child logger:
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("direct-image-gen");
```

Replace:
- Line 137: `console.warn("[directImageGen] Brand memory fetch/analyze failed", e)` → `log.warn({ err: e }, "brand memory fetch/analyze failed")`
- Line 284: `console.error("[directImageGen] Image generation failed", { error: e, ... })` → `log.error({ err: e, userId, prompt: input.user_prompt, numVariations: input.num_variations ?? 3, aspectRatio: input.aspect_ratio ?? "1:1" }, "image generation failed")`

If line 255 has a `console.info`, replace with: `log.info({ ... }, "image generation succeeded")`

- [ ] **Step 2: Update `src/mastra/tools/generation/generate-video-single-shot.ts`**

Add import and child logger:
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("video-single-shot");
```

Replace:
- Line 108: `console.warn("[generate_video_single_shot] S3 upload failed, using temp URL:", e)` → `log.warn({ err: e }, "S3 upload failed, using temp URL")`

- [ ] **Step 3: Update `src/mastra/tools/workflow/execute-workflow.ts`**

Add import and child logger:
```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("execute-workflow");
```

Replace:
- Line 264-267: `console.warn("[executeWorkflow] Failed to fetch/attach brand_memory", e)` → `log.warn({ err: e }, "failed to fetch/attach brand_memory")`
- Line 323: `console.error("[executeWorkflow] notifyPythonStoreGeneratedAssets failed", e)` → `log.error({ err: e }, "notifyPythonStoreGeneratedAssets failed")`
- Line 341-345: `console.error("[executeWorkflow] Workflow execution failed", { error: e, ... })` → `log.error({ err: e, workflowId: input.workflow_id, useCaseId: input.use_case_id }, "workflow execution failed")`

- [ ] **Step 4: Commit**

```bash
git add src/mastra/tools/generation/direct-image-gen.ts src/mastra/tools/generation/generate-video-single-shot.ts src/mastra/tools/workflow/execute-workflow.ts
git commit -m "refactor: migrate tool console.* calls to Pino"
```

---

### Task 7: Final verification

**Note:** `src/env.ts` line 85 (`console.error("Invalid environment variables:", ...)`) is intentionally NOT migrated. The logger imports `env` from `@/env`, so importing logger in `env.ts` would create a circular dependency. This `console.error` runs only on startup failure and is fine as-is.

- [ ] **Step 1: Verify no remaining console.* calls (except env.ts)**

```bash
grep -rn "console\.\(log\|warn\|error\)" src/ --include="*.ts" | grep -v "node_modules" | grep -v "env.ts" | grep -v "__tests__"
```

Expected: no output (all migrated).

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no new type errors from the migration.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Smoke-test dev output**

```bash
NODE_ENV=development node -e "const { logger, createLogger } = require('./src/lib/logger'); const log = createLogger('test'); log.info({ foo: 'bar' }, 'hello'); log.error({ err: new Error('boom') }, 'oops');"
```

Expected: colorized, human-readable output from pino-pretty with level as string, ISO timestamp, module field.

If this fails due to ESM, test via:
```bash
npm run dev
```
Then send a request and observe the terminal output is colorized and structured.

- [ ] **Step 5: Commit any remaining fixes**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix: resolve remaining Pino migration issues"
```
