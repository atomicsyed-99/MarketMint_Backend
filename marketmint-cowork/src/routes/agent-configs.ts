import type { Context } from "hono";
import {
  UpdateAgentConfigSchema,
  ListAgentConfigsQuerySchema,
} from "@/schemas/agent-configs";
import * as agentConfigService from "@/services/agent-configs";
import { NotFoundError, ForbiddenError } from "@/services/agent-jobs";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent-configs");

function getWorkspaceId(c: Context): string | null {
  const user = c.get("authUser");
  return user?.orgId ?? user?.id ?? null;
}

export async function listAgentConfigsHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const configs = await agentConfigService.listAgentConfigs(workspaceId);
    return c.json(configs, 200);
  } catch (err) {
    log.error({ err }, "listAgentConfigs failed");
    return c.json({ error: "Failed to list agent configs" }, 500);
  }
}

export async function getAgentConfigByKeyHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const key = c.req.param("key");
    if (!key) return c.json({ error: "Key required" }, 400);

    const config = await agentConfigService.getAgentConfigByKey(workspaceId, key);
    return c.json(config, 200);
  } catch (err) {
    log.error({ err }, "getAgentConfigByKey failed");
    return c.json({ error: "Failed to get agent config by key" }, 500);
  }
}

export async function updateAgentConfigHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const configId = c.req.param("configId");
    if (!configId) return c.json({ error: "Config ID required" }, 400);

    const raw = await c.req.json().catch(() => ({}));
    const parsed = UpdateAgentConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
    }

    const updated = await agentConfigService.updateAgentConfig(configId, workspaceId, parsed.data);
    return c.json(updated, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "updateAgentConfig failed");
    return c.json({ error: "Failed to update agent config" }, 500);
  }
}

export async function disableAgentConfigHandler(c: Context) {
  try {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: "Workspace required" }, 422);

    const configId = c.req.param("configId");
    if (!configId) return c.json({ error: "Config ID required" }, 400);

    const updated = await agentConfigService.disableAgentConfig(configId, workspaceId);
    return c.json(updated, 200);
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    log.error({ err }, "disableAgentConfig failed");
    return c.json({ error: "Failed to disable agent config" }, 500);
  }
}
