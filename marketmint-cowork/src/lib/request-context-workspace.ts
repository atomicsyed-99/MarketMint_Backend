/**
 * Read any value from chat-style plain objects or Mastra `RequestContext` (Map + `.get`).
 */
export function valueFromRequestContext(
  requestContext: unknown,
  key: string,
): unknown {
  if (!requestContext || typeof requestContext !== "object") return undefined;
  const rc = requestContext as { get?: (k: string) => unknown };
  if (typeof rc.get === "function") {
    return rc.get(key);
  }
  return (requestContext as Record<string, unknown>)[key];
}

/**
 * Write a flag/value on Mastra `RequestContext` (`.set`) or a plain object.
 */
export function setRequestContextValue(
  requestContext: unknown,
  key: string,
  value: unknown,
): void {
  if (!requestContext || typeof requestContext !== "object") return;
  const rc = requestContext as { set?: (k: string, v: unknown) => void };
  if (typeof rc.set === "function") {
    rc.set(key, value);
    return;
  }
  (requestContext as Record<string, unknown>)[key] = value;
}

/**
 * Read a string field from chat-style plain objects or Mastra `RequestContext` (Map + `.get`).
 */
export function stringFromRequestContext(
  requestContext: unknown,
  key: string,
): string | undefined {
  const v = valueFromRequestContext(requestContext, key);
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

/** Workspace id for Nango / assets: prefer `workspaceId`, then `orgId`. */
export function workspaceIdFromRequestContext(requestContext: unknown): string {
  return (
    stringFromRequestContext(requestContext, "workspaceId") ||
    stringFromRequestContext(requestContext, "orgId") ||
    ""
  );
}
