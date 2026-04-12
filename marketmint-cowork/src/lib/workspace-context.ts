import type { Context } from "hono";
import type { AuthUser } from "@/middleware/clerk";

/** Workspace scoping: Clerk orgId. */
export function getWorkspaceId(c: Context): string {
  const user = c.get("authUser");
  return user.orgId;
}
