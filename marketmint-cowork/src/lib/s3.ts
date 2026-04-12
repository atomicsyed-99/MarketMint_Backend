import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("s3");

const accessKeyId = env.AWS_ACCESS_KEY_ID || env.AWS_ACCESS_KEY;
const secretAccessKey = env.AWS_SECRET_ACCESS_KEY || env.AWS_SECRET_KEY;

const s3 = new S3Client({
  region: env.AWS_REGION,
  ...(accessKeyId && secretAccessKey
    ? { credentials: { accessKeyId, secretAccessKey } }
    : {}),
});

const bucket = env.S3_ASSET_BUCKET || env.S3_BUCKET;
const cdnUrl = env.CDN_URL;

if (!bucket) {
  log.warn("S3_ASSET_BUCKET / S3_BUCKET is not set — signed URL generation will fail");
}

/** Extract S3 key from a full URL (presigned, CDN, or path-style). Mirrors Python get_s3_key_from_presigned_url / refresh_signed_url. */
function getS3KeyFromUrl(url: string): string | null {
  if (!url || !bucket) return null;
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (cdnUrl && url.includes(cdnUrl)) {
      const base = cdnUrl.replace(/\/$/, "");
      if (url.startsWith(base + "/")) return url.slice(base.length + 1).replace(/^\//, "");
      return path;
    }
    if (u.hostname.includes(".s3.") && path) return path;
    if (path.startsWith(bucket + "/")) return path.slice(bucket.length + 1);
    return path || null;
  } catch {
    return null;
  }
}

/** Given a full URL, return a fresh signed URL if it's our S3/CDN; otherwise return as-is. Matches Python refresh_signed_url(url). */
export async function refreshSignedUrlFromUrl(url: string): Promise<string> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return refreshSignedUrl(url);
  const key = getS3KeyFromUrl(url);
  if (!key) return url;
  return refreshSignedUrl(key);
}

export async function refreshSignedUrl(key: string) {
  if (!bucket) {
    throw new Error("S3_ASSET_BUCKET or S3_BUCKET is not configured");
  }

  // If caller passed a full URL already, return as-is
  if (key.startsWith("http://") || key.startsWith("https://")) {
    return key;
  }

  // If CDN_URL is configured, mirror Python's behavior and return a CDN URL
  // instead of a presigned S3 URL.
  if (cdnUrl) {
    const base = cdnUrl.replace(/\/$/, "");
    const normalizedKey = key.startsWith("/") ? key.slice(1) : key;
    return `${base}/${normalizedKey}`;
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: 60 * 60 }); // 1 hour
}

/**
 * Upload bytes to S3. Returns the object key (use refreshSignedUrl(key) for a URL).
 * Mirrors Python upload_to_s3(file_bytes=..., filename=..., content_type=...).
 */
export async function uploadToS3(
  fileBytes: Uint8Array | Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  if (!bucket) {
    throw new Error("S3_ASSET_BUCKET or S3_BUCKET is not configured");
  }

  const key = filename.includes("/") ? filename : `generated/${filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileBytes,
      ContentType: contentType,
    }),
  );

  return key;
}

