import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string(),
  MASTRA_DATABASE_URL: z.string(),

  // Clerk
  CLERK_SECRET_KEY: z.string(),
  CLERK_PUBLISHABLE_KEY: z.string(),

  // AWS / S3
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_ACCESS_KEY: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SECRET_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  S3_ASSET_BUCKET: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  CDN_URL: z.string().optional(),

  // AI providers
  OPENAI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  PERPLEXITY_API_KEY: z.string().optional(),
  APIFY_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),

  // Internal services
  BACKEND_BASE_URL: z.string().optional(),
  ASSETS_SERVICE_WEBHOOK_URL: z.string().optional(),
  CREDITS_BACKEND_BASE_URL: z.string().optional(),
  ACCOUNTS_BASE_URL: z.string().optional(),
  FRONT_END_BASE_URL: z.string().optional(),
  SERVER_URL: z.string().optional(),
  VIDEO_COPILOT_SERVICE_URL: z.string().optional(),
  /** Gateway auth: sent as `X-API-Key` on Video Copilot HTTP calls. */
  VIDEO_COPILOT_SERVICE_AUTH_KEY: z.string().optional(),
  VIDEO_COPILOT_TIMEOUT_SECONDS: z.coerce.number().optional(),
  ASSET_MANAGER_SERVICE_AUTH_KEY: z.string().optional(),
  ASSET_MANAGER_SERVICE_API_KEY: z.string().optional(),
  BRAND_MEMORY_SERVICE_URL: z.string().optional(),
  BRAND_MEMORY_SERVICE_AUTH_KEY: z.string().optional(),

  SPACES_SERVICE_URL: z.string(),
  SPACES_SERVICE_AUTH_KEY: z.string(),

  // Trigger.dev
  SPACES_TRIGGER_SECRET_KEY: z.string().optional(),
  TRIGGER_SECRET_KEY: z.string().optional(),
  TRIGGER_PREVIEW_BRANCH: z.string().optional(),

  // LangSmith
  LANGSMITH_ENDPOINT: z.string().optional(),
  LANGSMITH_API_KEY: z.string().optional(),

  // Nango (connectors)
  NANGO_SECRET_KEY: z.string().optional(),
  NANGO_HOST_URL: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  // Meta Login for Business config id (passed as `config_id` OAuth param)
  META_LOGIN_CONFIG_ID: z.string().optional(),

  // Misc
  STAGE: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),

  // Server
  ALLOWED_ORIGINS: z.string().optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().optional(),
  EXTERNAL_API_TIMEOUT_MS: z.coerce.number().optional(),

  // Database pool
  DB_POOL_MAX: z.coerce.number().optional(),

  // Cloudflare AI Gateway
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  GATEWAY_NAME: z.string().optional(),
  CF_AIG_TOKEN: z.string().optional(),

  // Image generation model
  GEMINI_IMAGE_MODEL: z.string().optional(),

  CO_WORK_SERVER_URL: z.string().optional(),
  CO_WORK_AUTH_KEY: z.string().optional(),

  NOTIFICATION_SERVICE_URL: z.string().optional(),
  NOTIFICATION_SERVICE_AUTH_KEY: z.string().optional(),

  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().optional(),
  REDIS_AUTH_TOKEN: z.string().optional(),
  REDIS_USE_TLS: z.coerce.boolean().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.issues);
  throw new Error("Invalid environment variables");
}

export const env = parsed.data;
