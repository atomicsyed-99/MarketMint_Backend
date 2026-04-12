import { createLogger } from "@/lib/logger";

const log = createLogger("url-safety");

/** Maximum image size in bytes (10 MB). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Check if a hostname resolves to a private/internal network. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  );
}

/**
 * Validate a URL for safe server-side fetching.
 * Returns null if the URL is safe, or an error reason string if it should be rejected.
 */
export function validateFetchUrl(url: string): string | null {
  if (!url.startsWith("https://")) {
    return "non-HTTPS URL";
  }

  try {
    const u = new URL(url);
    if (isPrivateHost(u.hostname)) {
      return "internal network URL";
    }
  } catch {
    return "malformed URL";
  }

  return null;
}

/**
 * Safely fetch an image from a URL with SSRF protection, redirect rejection, and size limits.
 * Returns the image as a Buffer, or null if the fetch fails for any reason.
 */
export async function safeFetchImage(url: string): Promise<Buffer | null> {
  const rejection = validateFetchUrl(url);
  if (rejection) {
    log.warn({ url, reason: rejection }, "rejected image URL");
    return null;
  }

  try {
    const res = await fetch(url, { redirect: "error" });
    if (!res.ok) {
      log.warn({ url, status: res.status }, "image fetch returned non-OK status");
      return null;
    }

    // Size limit: check Content-Length header first (early rejection)
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
      log.warn({ url, contentLength }, "rejected oversized image (header)");
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      log.warn({ url, size: arrayBuffer.byteLength }, "rejected oversized image (body)");
      return null;
    }

    return Buffer.from(arrayBuffer);
  } catch (err) {
    log.warn({ err, url }, "failed to fetch image");
    return null;
  }
}
