import { Nango } from "@nangohq/node";
import { env } from "@/env";

let _nango: Nango | null = null;

/**
 * Lazy-initialized Nango client.
 * Returns null when NANGO_SECRET_KEY is not set (connectors disabled).
 * Uses NANGO_HOST_URL for self-hosted Nango instances.
 */
export function getNango(): Nango | null {
  if (!env.NANGO_SECRET_KEY) return null;
  if (!_nango) {
    _nango = new Nango({
      secretKey: env.NANGO_SECRET_KEY,
      ...(env.NANGO_HOST_URL ? { host: env.NANGO_HOST_URL } : {}),
    });
  }
  return _nango;
}
