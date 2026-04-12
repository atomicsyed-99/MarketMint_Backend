import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import type { Context, MiddlewareHandler } from "hono";

export type AuthUser = {
  id: string;
  email: string;
  orgId: string;
  accessToken?: string;
};

declare module "hono" {
  interface ContextVariableMap {
    /** Set when signed in; omit or undefined on optional-auth routes. */
    authUser: AuthUser;
  }
}

/** `null` = authenticated and `authUser` set; otherwise return that response. */
export async function requireClerkAuth(c: Context): Promise<Response | null> {
  const clerkMw = clerkMiddleware();
  await clerkMw(c, async () => {});

  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("authUser", {
    id: auth.userId,
    email: (auth.sessionClaims as any)?.email!,
    orgId: auth.orgId!,
    accessToken: c.req.header("authorization")?.replace(/^Bearer\s+/i, ""),
  });

  return null;
}

/**
 * Same as middleware chain but returns the handler `Response` (for routes that
 * cannot use nested `app.fetch()` because they need root `Context` vars).
 */
export async function withClerkAuth(
  c: Context,
  handler: (c: Context) => Promise<Response>,
): Promise<Response> {
  const denied = await requireClerkAuth(c);
  if (denied) return denied;
  return handler(c);
}

/**
 * Composed middleware: runs Clerk's session verification, then
 * maps the auth state to the `authUser` context variable.
 */
export const clerkAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const denied = await requireClerkAuth(c);
  if (denied) return denied;
  return await next();
};

/**
 * Runs Clerk verification but does not 401 when anonymous; used for public
 * shared-chat reads where signed-in users get workspace-scoped access.
 */
export const clerkOptionalAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const clerkMw = clerkMiddleware();
  await clerkMw(c, async () => {});

  const auth = getAuth(c);
  if (auth?.userId) {
    c.set("authUser", {
      id: auth.userId,
      email: (auth.sessionClaims as any)?.email,
      orgId: auth.orgId ?? undefined,
      accessToken: c.req.header("authorization")?.replace(/^Bearer\s+/i, ""),
    });
  }

  return await next();
};

export const auth = clerkAuthMiddleware;
