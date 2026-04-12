import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import {
  agentConfigs,
  type NewAgentConfig,
} from "../schema/agent-configs";

export async function listAgentConfigsByWorkspace(
  workspaceId: string
) {
  return db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.workspaceId, workspaceId))
    .orderBy(desc(agentConfigs.createdAt));
}

export async function getAgentConfigById(id: string) {
  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.id, id));
  return config ?? null;
}

export async function getAgentConfigByKey(
  workspaceId: string,
  key: string,
) {
  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(
      and(
        eq(agentConfigs.workspaceId, workspaceId),
        eq(agentConfigs.key, key),
      ),
    );
  return config ?? null;
}

export async function upsertAgentConfigs(configs: NewAgentConfig[]) {
  if (configs.length === 0) return [];

  return db
    .insert(agentConfigs)
    .values(configs)
    .onConflictDoUpdate({
      target: [agentConfigs.id],
      set: {
        name: agentConfigs.name,
        role: agentConfigs.role,
        enabled: agentConfigs.enabled,
        avatarColor: agentConfigs.avatarColor,
        avatarSrc: agentConfigs.avatarSrc,
        description: agentConfigs.description,
        connectors: agentConfigs.connectors,
        jobs: agentConfigs.jobs,
        soulMd: agentConfigs.soulMd,
        howToUse: agentConfigs.howToUse,
        updatedAt: new Date(),
      },
    })
    .returning();
}

export async function updateAgentConfig(
  id: string,
  data: Partial<Omit<NewAgentConfig, "id" | "workspaceId" | "key" | "createdAt">>,
) {
  const [updated] = await db
    .update(agentConfigs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agentConfigs.id, id))
    .returning();
  return updated ?? null;
}
