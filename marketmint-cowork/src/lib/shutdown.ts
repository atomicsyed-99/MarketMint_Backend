import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { closeDb } from "@/db/client";
import { flushSentry } from "@/lib/sentry";

const log = createLogger("shutdown");

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

    log.info({ signal, activeStreams: activeStreams.size, timeoutMs }, "shutdown started");

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
      log.warn({ remaining: activeStreams.size }, "forcing shutdown with active streams");
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
      log.info("database connections closed");
    } catch (err) {
      log.error({ err }, "failed to close database connections");
    }

    // 4. Flush Sentry
    try {
      await flushSentry(2000);
    } catch {
      // Best-effort flush
    }

    log.info("shutdown complete");
    process.exit(0);
  };

  // Force exit after timeout + 5s grace
  const forceShutdown = (signal: string) => {
    shutdown(signal).catch(() => {});
    setTimeout(() => {
      log.error("forced shutdown — timeout exceeded");
      process.exit(1);
    }, timeoutMs + 5000).unref();
  };

  process.on("SIGTERM", () => forceShutdown("SIGTERM"));
  process.on("SIGINT", () => forceShutdown("SIGINT"));
}
