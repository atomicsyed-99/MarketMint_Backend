import { z } from "zod";

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ConnectorSchema = z.object({
  providerKey: z.string(),
  label: z.string().min(1),
  available: z.boolean(),
});

export const JobSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  connectors: z.array(z.string()),
});

export const AgentConfigSchema = z.object({
  id: z.ulid(),
  workspaceId: z.string(),
  name: z.string(),
  key: z.string(),
  role: z.string(),
  enabled: z.boolean(),
  available: z.boolean(),
  avatarColor: HexColorSchema,
  avatarSrc: z.string(),
  description: z.string().nullable(),
  connectors: z.array(ConnectorSchema),
  jobs: z.array(JobSchema),
  soulMd: z.string().nullable(),
  howToUse: z.array(z.string()),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateAgentConfigSchema = AgentConfigSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateAgentConfigSchema = CreateAgentConfigSchema.omit({
  key: true,
  workspaceId: true,
}).partial();

export type UpdateAgentConfigBody = z.infer<typeof UpdateAgentConfigSchema>;

export const ListAgentConfigsQuerySchema = z.object({
  enabledOnly: z.coerce.boolean().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;