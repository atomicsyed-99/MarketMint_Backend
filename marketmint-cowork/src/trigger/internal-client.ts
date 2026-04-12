export function getInternalApiUrl(path: string): string {
  const base = process.env.CO_WORK_SERVER_URL;
  if (!base) throw new Error("CO_WORK_SERVER_URL is not configured");
  return `${base.replace(/\/$/, "")}${path}`;
}

export function getApiKey(): string {
  const key = process.env.CO_WORK_AUTH_KEY;
  if (!key) throw new Error("CO_WORK_AUTH_KEY is not configured");
  return key;
}
