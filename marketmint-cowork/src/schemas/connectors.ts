import { z } from "zod";

/** POST /api/v3/connectors/connect-session — request body */
export const ConnectSessionBodySchema = z.object({
  integrationId: z.string().optional(),
});

/** DELETE /api/v3/connectors/disconnect — request body */
export const DisconnectBodySchema = z.object({
  providerConfigKey: z.string().min(1),
  connectionId: z.string().min(1),
});

/** GET /api/v3/connectors/connections — no body needed, but typed response shapes for the frontend */
export const ConnectionSchema = z.object({
  providerConfigKey: z.string(),
  connectionId: z.string(),
  createdAt: z.string().nullable(),
});

export const AvailableConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  authType: z.enum(["oauth", "api-key"]),
  apiKeyFields: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        placeholder: z.string(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
});
