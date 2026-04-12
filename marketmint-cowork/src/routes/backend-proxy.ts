import type { Context } from "hono";
import { fetchWithTimeout } from "@/lib/fetch";

const PROXY_PREFIXES = ["/credits"];

export function isProxyPath(pathname: string): boolean {
  return PROXY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxyToPythonBackend(c: Context) {
  const backendBase = process.env.BACKEND_BASE_URL;
  if (!backendBase) {
    return c.json({ error: "BACKEND_BASE_URL is not configured" }, 500);
  }

  const shouldProxy = isProxyPath(c.req.path);
  if (!shouldProxy) {
    return c.json({ error: "Not found" }, 404);
  }

  const incomingUrl = new URL(c.req.url);
  const upstreamUrl = new URL(
    `${c.req.path}${incomingUrl.search || ""}`,
    backendBase,
  );

  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");

  const method = c.req.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await c.req.raw.arrayBuffer();

  const upstream = await fetchWithTimeout(upstreamUrl.toString(), {
    method,
    headers,
    body,
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

