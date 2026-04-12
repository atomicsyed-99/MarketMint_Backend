import type { MiddlewareHandler } from "hono";
import { env } from "@/env";

export const apiKeyAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const key = c.req.header("x-api-key");

  if (!env.CO_WORK_AUTH_KEY || !key || key !== env.CO_WORK_AUTH_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return await next();
};
