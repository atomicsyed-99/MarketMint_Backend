import { env } from "@/env";

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string | URL,
  options?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs, ...fetchOptions } = options ?? {};
  const timeout = timeoutMs ?? env.EXTERNAL_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      let hostname: string;
      try {
        hostname = new URL(String(url)).hostname;
      } catch {
        hostname = "unknown";
      }
      throw new Error(
        `Request to ${hostname} timed out after ${timeout}ms`,
      );
    }
    throw error;
  }
}
