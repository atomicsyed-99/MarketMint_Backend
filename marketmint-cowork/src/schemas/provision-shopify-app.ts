import { z } from "zod";

export const ProvisionShopifyAppBodySchema = z.object({
  client_id: z.string().min(1, "client_id is required"),
  client_secret: z.string().min(1, "client_secret is required"),
  store_domain: z
    .string()
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.myshopify\.com$/i,
      "store_domain must be a valid myshopify.com subdomain",
    ),
});

export type ProvisionShopifyAppBody = z.infer<typeof ProvisionShopifyAppBodySchema>;
