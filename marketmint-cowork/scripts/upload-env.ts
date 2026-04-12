/**
 * Script to upload environment variables to AWS Secrets Manager.
 *
 * Usage:
 *   npx tsx scripts/upload-env.ts <stage>
 *
 * Example:
 *   npx tsx scripts/upload-env.ts dev
 *   npx tsx scripts/upload-env.ts stg
 *   npx tsx scripts/upload-env.ts prod
 *
 * Reads env vars from .env.<stage> (e.g. .env.dev, .env.stg, .env.prod),
 * filters to only the keys defined in the env schema, and uploads them
 * to `marketmint-pro-cowork-service/<stage>` in AWS Secrets Manager.
 * If the secret doesn't exist, it creates it. Otherwise, it updates it.
 *
 * Requires AWS credentials configured via environment, profile, or IAM role.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";

const SECRET_PREFIX = "marketmint-pro-cowork-service";

// Mirror of the schema in src/env.ts — single source of truth for env var keys
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
  APIFY_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),

  // Internal services
  BACKEND_BASE_URL: z.string().optional(),
  ASSETS_SERVICE_WEBHOOK_URL: z.string().optional(),
  CREDITS_BACKEND_BASE_URL: z.string().optional(),
  ACCOUNTS_BASE_URL: z.string().optional(),
  SERVER_URL: z.string().optional(),
  VIDEO_COPILOT_SERVICE_URL: z.string().optional(),
  VIDEO_COPILOT_SERVICE_AUTH_KEY: z.string().optional(),
  VIDEO_COPILOT_TIMEOUT_SECONDS: z.coerce.number().optional(),
  BRAND_MEMORY_SERVICE_URL: z.string().optional(),
  BRAND_MEMORY_SERVICE_AUTH_KEY: z.string().optional(),

  // Trigger.dev
  SPACES_TRIGGER_SECRET_KEY: z.string().optional(),
  TRIGGER_SECRET_KEY: z.string().optional(),
  TRIGGER_PREVIEW_BRANCH: z.string().optional(),

  // LangSmith
  LANGSMITH_ENDPOINT: z.string().optional(),
  LANGSMITH_API_KEY: z.string().optional(),

  // Misc
  STAGE: z.string().optional(),
  ASSET_MANAGER_SERVICE_AUTH_KEY: z.string().optional(),
});

const ENV_KEYS = Object.keys(envSchema.shape) as (keyof typeof envSchema.shape)[];

function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  const vars: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const stripped = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eqIndex = stripped.indexOf("=");
    if (eqIndex === -1) continue;

    const key = stripped.slice(0, eqIndex).trim();
    let value = stripped.slice(eqIndex + 1).trim();

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) vars[key] = value;
  }

  return vars;
}

async function secretExists(
  client: SecretsManagerClient,
  secretName: string
): Promise<Record<string, string> | null> {
  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );
    if (response.SecretString) {
      return JSON.parse(response.SecretString) as Record<string, string>;
    }
    return null;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === "ResourceNotFoundException"
    ) {
      return null;
    }
    throw err;
  }
}

async function main() {
  const stage = process.argv[2];

  if (!stage) {
    console.error("Usage: npx tsx scripts/upload-env.ts <stage>");
    console.error("Example: npx tsx scripts/upload-env.ts dev");
    process.exit(1);
  }

  const envFile = resolve(import.meta.dirname!, "..", `.env.${stage}`);

  if (!existsSync(envFile)) {
    console.error(`❌ File not found: ${envFile}`);
    process.exit(1);
  }

  console.log(`📄 Reading env vars from ${envFile}`);
  const allVars = parseEnvFile(envFile);

  // Filter to only keys defined in the env schema
  const vars: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    if (key in allVars) {
      vars[key] = allVars[key];
    }
  }

  const varCount = Object.keys(vars).length;

  if (varCount === 0) {
    console.error(`❌ No matching env vars found in .env.${stage}`);
    process.exit(1);
  }

  console.log(`   Found ${varCount} variables (filtered to schema keys)`);

  const secretName = `${SECRET_PREFIX}/${stage}`;
  console.log(`🔐 Target secret: ${secretName}`);

  const client = new SecretsManagerClient({});
  const existing = await secretExists(client, secretName);

  const secretString = JSON.stringify(vars, null, 2);

  if (existing) {
    console.log(`   Secret exists — updating...`);
    await client.send(
      new UpdateSecretCommand({
        SecretId: secretName,
        SecretString: secretString,
      })
    );
  } else {
    console.log(`   Secret not found — creating...`);
    await client.send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: secretString,
      })
    );
  }

  console.log(`✅ Uploaded ${varCount} env vars to ${secretName}`);
}

main().catch((err) => {
  console.error("❌ Failed to upload secrets:", err);
  process.exit(1);
});
