import { ulid } from "ulid";
import {
  getAgentConfigById,
  listAgentConfigsByWorkspace,
  updateAgentConfig as dbUpdateAgentConfig,
  upsertAgentConfigs,
  getAgentConfigByKey as dbGetAgentConfigByKey,
} from "@/db/queries/agent-configs";
import { redis } from "@/lib/redis";
import type { NewAgentConfig } from "@/db/schema/agent-configs";
import { AgentConfigSchema, type AgentConfig, type UpdateAgentConfigBody } from "@/schemas/agent-configs";
import { AGENTS_CONFIG } from "@/data/agents_config";
import { NotFoundError, ForbiddenError } from "@/services/agent-jobs";

async function getAgentConfigOrThrow(configId: string, workspaceId: string) {
  const config = await getAgentConfigById(configId);
  if (!config) throw new NotFoundError("Agent config not found");
  if (config.workspaceId !== workspaceId)
    throw new ForbiddenError("Agent config belongs to another workspace");
  return config;
}

export async function listAgentConfigs(
  workspaceId: string,
) {
  let configs = await listAgentConfigsByWorkspace(workspaceId);
  if (configs.length === 0) {
    await seedAgentConfigsForWorkspace(workspaceId);
    configs = await listAgentConfigsByWorkspace(workspaceId);
  }
  return configs;
}

export async function getAgentConfig(configId: string, workspaceId: string) {
  return getAgentConfigOrThrow(configId, workspaceId);
}

async function getAgentConfigFromDb(workspaceId: string, key: string): Promise<AgentConfig> {
  const config = await dbGetAgentConfigByKey(workspaceId, key);
  if (!config) throw new NotFoundError("Agent config not found");
  return AgentConfigSchema.parse(config);
}

// Throws `NotFoundError` on miss — the nullable return type is legacy
// and callers should catch. Kept to avoid churning the broad call-site
// surface in one PR; see `stream-processor.ts` for the canonical catch.
export async function getAgentConfigByKey(workspaceId: string, key: string): Promise<AgentConfig | null> {
  const redisKey = `agent-config:${workspaceId}:${key}`;
  const config = await redis.get(redisKey);
  if (config) return JSON.parse(config);

  const data = await getAgentConfigFromDb(workspaceId, key);
  await redis.set(redisKey, JSON.stringify(data));
  return data;
}

export async function updateAgentConfig(
  configId: string,
  workspaceId: string,
  body: UpdateAgentConfigBody,
) {
  await getAgentConfigOrThrow(configId, workspaceId);
  const updated = await dbUpdateAgentConfig(configId, body);

  const redisKey = `agent-config:${workspaceId}:${updated.key}`;

  await redis.set(redisKey, JSON.stringify(updated));
  return updated;
}

export async function disableAgentConfig(
  configId: string,
  workspaceId: string,
) {
  await getAgentConfigOrThrow(configId, workspaceId);
  const updated = await dbUpdateAgentConfig(configId, { enabled: false });
  return updated;
}

export async function seedAgentConfigsForWorkspace(workspaceId: string) {
  const rows: NewAgentConfig[] = AGENTS_CONFIG.map((cfg) => ({
    id: ulid(),
    workspaceId,
    name: cfg.name,
    key: cfg.key,
    role: cfg.role,
    enabled: cfg.enabled,
    available: cfg.available,
    avatarColor: cfg.avatarColor,
    avatarSrc: cfg.avatarSrc,
    description: cfg.description ?? null,
    connectors: cfg.connectors.map((c) => ({
      providerKey: c.providerKey,
      label: c.label,
      available: c.available,
    })),
    jobs: cfg.jobs.map((j) => ({
      title: j.title,
      description: j.description ?? null,
      connectors: j.connectors,
    })),
    soulMd: cfg.soulMd ?? null,
    howToUse: cfg.howToUse,
  }));

  return upsertAgentConfigs(rows);
}
