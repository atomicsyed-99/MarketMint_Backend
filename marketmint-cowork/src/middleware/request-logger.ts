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

  log.info({
    requestId,
    method,
    path,
    status,
    duration,
    ...(userId ? { userId } : {}),
  }, "request completed");
};
