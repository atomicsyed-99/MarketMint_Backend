import * as Sentry from "@sentry/node";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("sentry");

let initialized = false;

export function initSentry() {
  if (initialized) return;
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    log.info("Sentry disabled — SENTRY_DSN not set");
    return;
  }

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? "development",
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["Authorization"];
      }
      return event;
    },
  });

  initialized = true;
  log.info({ environment: env.SENTRY_ENVIRONMENT ?? "development" }, "Sentry initialized");
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
