# Pino.js Logging Implementation Design

## Goal

Replace the custom JSON logger with Pino.js for performance, features (child loggers, level filtering, pretty-printing), and standardization. Consolidate all `console.*` calls across the codebase to use structured Pino logging.

## Approach

Drop-in replacement (Approach A). Same `logger.info/warn/error` API, no AsyncLocalStorage, no `pino-http`. Minimal disruption to existing import sites.

## Dependencies

- `pino` — production dependency
- `pino-pretty` — devDependency (human-readable output in local dev)

## Logger Module (`src/lib/logger.ts`)

Rewrite the custom logger with Pino:

- **Root logger** configured with:
  - `level`: `"debug"` when `NODE_ENV !== "production"`, `"info"` otherwise
  - `transport`: `pino-pretty` in dev (loaded dynamically via `target: "pino-pretty"`), raw JSON in prod
  - `formatters.level`: output level as string (`"info"`) not number (`30`)
  - `timestamp`: ISO string format via `pino.stdTimeFunctions.isoTime`
  - `serializers`: Pino's built-in `pino.stdSerializers.err` for error objects
- **`createLogger(name: string)`** — returns `logger.child({ module: name })` for module-scoped context
- **Export surface stays the same**: `import { logger, createLogger } from "@/lib/logger"`

## Request Logger Middleware (`src/middleware/request-logger.ts`)

Refactor to use Pino:

- Keep existing `requestId` generation via `crypto.randomUUID()`
- Create request-scoped child logger: `logger.child({ requestId })`
- Log request start at `debug` level (visible in dev, suppressed in prod)
- Log request completion at `info` level with: method, path, status, duration, userId
- Errors at `error` level
- No structural change to middleware shape

## Console.* Migration

Replace all ~20+ `console.log/warn/error` calls with Pino:

- Each file gets a child logger: `const log = createLogger("module-name")`
- Mapping: `console.log` -> `log.info`, `console.warn` -> `log.warn`, `console.error` -> `log.error`
- Existing bracket-prefixed messages like `[S3]` or `[LangSmith]` become the `module` field on the child logger
- No behavior change — same messages, same severity, structured context instead of raw strings

## Tests (`src/lib/__tests__/logger.test.ts`)

Rewrite existing test suite:

- Test `logger` is a Pino instance with correct default level
- Test `createLogger("foo")` returns child with `module: "foo"` in bindings
- Test error serialization (message, name, stack, cause)
- Test log level respects `NODE_ENV`
- Use `pino.destination()` with writable stream to capture output (no stdout mocking)

## Files Changed

| File | Change |
|---|---|
| `package.json` | Add `pino`, add `pino-pretty` (dev) |
| `src/lib/logger.ts` | Rewrite with Pino |
| `src/lib/__tests__/logger.test.ts` | Rewrite tests |
| `src/middleware/request-logger.ts` | Use Pino child logger |
| `src/middleware/sentry.ts` | Switch to Pino logger |
| `src/lib/shutdown.ts` | `createLogger("shutdown")` |
| `src/lib/sentry.ts` | `createLogger("sentry")` |
| `src/routes/chat.ts` | `createLogger("chat")` |
| `src/routes/chats.ts` | `createLogger("chats")` |
| `src/db/queries/messages.ts` | `createLogger("db")` |
| `src/mastra/index.ts` | `createLogger("mastra")` |
| ~10 files with `console.*` | Replace with `createLogger("module-name")` |

## Not in Scope

- No `LOG_LEVEL` env var (hardcoded by `NODE_ENV`)
- No AsyncLocalStorage / request context propagation
- No `pino-http` integration
- No new log statements — only replacing existing ones
