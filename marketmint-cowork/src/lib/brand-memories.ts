import { env } from "@/env";
import { fetchWithTimeout } from "@/lib/fetch";

type RemoteBrandMemory = {
  id?: string;
  url?: string | null;
  data?: unknown;
  execution_data?: unknown;
};

type NormalizedBrandMemory = {
  id: string;
  userId: string;
  content: Record<string, unknown>;
};

function normalizeContent(item: RemoteBrandMemory): Record<string, unknown> {
  // Match Python workflow format expectation: top-level url + structured data fields.
  const data =
    item.data && typeof item.data === "object"
      ? (item.data as Record<string, unknown>)
      : {};
  return {
    url: item.url ?? null,
    ...data,
    execution_data:
      item.execution_data && typeof item.execution_data === "object"
        ? item.execution_data
        : undefined,
  };
}

export async function getBrandMemories(
  userId: string,
  workspaceId?: string,
): Promise<NormalizedBrandMemory[]> {
  const baseUrl = env.BRAND_MEMORY_SERVICE_URL;
  const apiKey = env.BRAND_MEMORY_SERVICE_AUTH_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "BRAND_MEMORY_SERVICE_URL/BRAND_MEMORY_SERVICE_AUTH_KEY are required for brand memory.",
    );
  }

  if (!workspaceId) {
    return [];
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const url = `${normalizedBase}/brand-memory/users/workspace/${workspaceId}/brand-memories`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brand memory service error: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as RemoteBrandMemory[];
  if (!Array.isArray(payload)) return [];

  return payload.map((item) => ({
    id: item.id ?? crypto.randomUUID(),
    userId,
    content: normalizeContent(item),
  }));
}

