import { getNango } from "./client";
import { createLogger } from "@/lib/logger";

const log = createLogger("nango-proxy");

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface ProxyOptions {
  params?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  retries?: number;
  baseUrlOverride?: string;
}

export class NangoProxyError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "NangoProxyError";
    this.status = status;
  }
}

/**
 * Proxy API calls through Nango, which handles OAuth token refresh automatically.
 */
export async function nangoProxy(
  providerConfigKey: string,
  connectionId: string,
  method: HttpMethod,
  endpoint: string,
  options?: ProxyOptions,
) {
  const nango = getNango();
  if (!nango) {
    throw new NangoProxyError("Nango client not initialized (NANGO_SECRET_KEY missing)");
  }

  try {
    const res = await nango.proxy({
      providerConfigKey,
      connectionId,
      method,
      endpoint,
      params: options?.params,
      data: options?.body,
      headers: options?.headers,
      retries: options?.retries ?? 3,
      baseUrlOverride: options?.baseUrlOverride,
    });
    return res.data;
  } catch (error: any) {
    const resData = error?.response?.data;
    const message =
      resData?.error?.message ||
      resData?.message ||
      (typeof resData === "string" ? resData : null) ||
      error?.message ||
      "Nango proxy request failed";
    const status = error?.response?.status;
    const detail = resData?.error?.details ?? resData?.errors ?? resData?.error_description;
    log.error({ method, endpoint, status, detail }, message);
    throw new NangoProxyError(
      detail ? `${message} — ${JSON.stringify(detail)}` : message,
      status,
    );
  }
}
