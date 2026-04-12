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

    log.error({ err: error, requestId, userId, path: c.req.path, method: c.req.method }, "unhandled request error");

    throw error;
  }
};
