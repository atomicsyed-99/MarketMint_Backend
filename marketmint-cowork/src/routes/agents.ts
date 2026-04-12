import type { Context } from "hono";
import type { Mastra } from "@mastra/core";
import { getUserConnections } from "@/connectors/nango/connections";

/**
 * POST /cowork/agents/:agentId/run
 *
 * Direct invocation of a sub-agent outside the supervisor flow.
 * Authenticated via Clerk middleware. Returns JSON (not SSE).
 *
 * Used for:
 * - Direct agent testing / debugging
 * - Future: cron job entry point (with API key auth)
 */
export async function agentRunRoute(c: Context) {
  const mastra = c.get("mastra") as Mastra;
  const user = c.get("authUser") as {
    id: string;
    email: string;
    orgId: string;
  };
  const agentId = c.req.param("agentId");

  const body = await c.req.json().catch(() => ({}));
  const { prompt } = body as { prompt?: string };

  if (!prompt || typeof prompt !== "string") {
    return c.json({ error: "prompt is required" }, 400);
  }

  let agent: ReturnType<typeof mastra.getAgent>;
  try {
    agent = mastra.getAgent(agentId as any);
  } catch {
    return c.json({ error: `Agent not found: ${agentId}` }, 404);
  }

  const workspaceId = user.orgId ?? "";
  const connections = await getUserConnections(workspaceId);

  const requestContext: Record<string, unknown> & {
    get: (k: string) => unknown;
    set: (k: string, v: unknown) => any;
  } = {
    userId: user.id,
    email: user.email,
    workspaceId,
    __connections: connections,
    get(key: string) {
      return (this as any)[key];
    },
    set(key: string, value: unknown) {
      (this as any)[key] = value;
      return this;
    },
  };
  // whats the fix here?
  const result = await agent.generate(prompt, {
    requestContext: requestContext as any,
    maxSteps: 15,
  });

  return c.json({
    text: result.text,
    toolResults: result.toolResults ?? [],
    usage: result.usage ?? null,
  });
}