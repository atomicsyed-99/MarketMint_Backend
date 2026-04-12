/**
 * Bun script to fetch secrets from AWS Secrets Manager
 * and write them to a .env file for other processes to consume.
 *
 * Usage:
 *   bun run scripts/load-env.ts
 *
 * Writes secrets to /tmp/.env as shell-safe export statements.
 * The entrypoint.sh sources this file and then deletes it.
 * If STAGE is not set, it skips secret loading entirely.
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const ENV_FILE_PATH = "/tmp/.env";
const ENV_VAR_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellEscape(value: string): string {
  // Safe single-quote escaping for POSIX shells.
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function loadSecretsFromAWS(): Promise<Record<string, string>> {
  const stage = process.env.STAGE;

  if (!stage) {
    console.log("ℹ️  STAGE not set, skipping AWS Secrets Manager.");
    return {};
  }

  const secretName = `marketmint-pro-cowork-service/${stage}`;
  console.log(`🔐 Loading secrets from AWS Secrets Manager: ${secretName}`);

  const client = new SecretsManagerClient({});
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret "${secretName}" value is empty`);
  }

  const secrets: Record<string, string> = {};
  const parsed = JSON.parse(response.SecretString) as Record<string, string>;

  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined && value !== null) {
      secrets[key] = String(value);
    }
  }

  console.log(`✅ Loaded ${Object.keys(secrets).length} secrets from AWS`);
  return secrets;
}

const GCP_CREDS_PATH = "/tmp/gcp_creds.json";

async function writeGcpCredentials(secrets: Record<string, string>): Promise<string | null> {
  const gcpServiceAccount = secrets.GCP_SERVICE_ACCOUNT || process.env.GCP_SERVICE_ACCOUNT;

  if (!gcpServiceAccount) {
    console.log("ℹ️  GCP_SERVICE_ACCOUNT not set, skipping GCP credentials file.");
    return null;
  }

  const decoded = Buffer.from(gcpServiceAccount, "base64").toString("utf-8");
  await Bun.write(GCP_CREDS_PATH, decoded);
  console.log(`📝 Written GCP service account credentials to ${GCP_CREDS_PATH}`);
  return GCP_CREDS_PATH;
}

// --- Main ---

const secrets = await loadSecretsFromAWS();
const gcpCredsPath = await writeGcpCredentials(secrets);

if (Object.keys(secrets).length > 0 || gcpCredsPath) {
  const entries = Object.entries(secrets).filter(([key]) => {
    if (ENV_VAR_NAME_REGEX.test(key)) {
      return true;
    }

    console.warn(`⚠️  Skipping invalid env var name: ${key}`);
    return false;
  });

  // Add GOOGLE_APPLICATION_CREDENTIALS pointing to the written file
  if (gcpCredsPath) {
    entries.push(["GOOGLE_APPLICATION_CREDENTIALS", gcpCredsPath]);
  }

  const envContent = entries
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`)
    .join("\n");

  await Bun.write(ENV_FILE_PATH, `${envContent}\n`);
  console.log(`📄 Written env exports to ${ENV_FILE_PATH}`);
}
