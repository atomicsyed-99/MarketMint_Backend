import { uploadToS3, refreshSignedUrl } from "@/lib/s3";
import { notifyPythonStoreGeneratedAssets } from "@/lib/call-python-assets-credits";
import {
  stringFromRequestContext,
  workspaceIdFromRequestContext,
} from "@/lib/request-context-workspace";
import { createLogger } from "@/lib/logger";
import {
  ARTIFACT_FILE_CONFIG,
  MAX_FALLBACK_CONTENT_BYTES,
  type ArtifactKind,
  type ArtifactMetadata,
  type ArtifactEventData,
} from "@/types/artifacts";

const log = createLogger("artifact-upload");

/** Map common language names to file extensions. */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: "py",
  javascript: "js",
  typescript: "ts",
  java: "java",
  go: "go",
  rust: "rs",
  ruby: "rb",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  csharp: "cs",
  cpp: "cpp",
  c: "c",
  html: "html",
  css: "css",
  sql: "sql",
  bash: "sh",
  shell: "sh",
  yaml: "yaml",
  toml: "toml",
  xml: "xml",
};

/** Convert a title to a URL-safe slug for filenames. */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

/** Build a filename from title, kind, and optional metadata. */
export function buildArtifactFilename(
  title: string,
  kind: ArtifactKind,
  metadata?: Pick<ArtifactMetadata, "language" | "filename">,
): string {
  if (metadata?.filename) {
    // Sanitize: strip path separators to prevent directory traversal in S3 keys
    return metadata.filename.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
  }

  const slug = titleToSlug(title);
  let extension: string;

  if (kind === "code" && metadata?.language) {
    const langKey = metadata.language.toLowerCase();
    extension =
      LANGUAGE_EXTENSIONS[langKey] ??
      langKey.replace(/[^a-z0-9]/g, "");
  } else {
    extension = ARTIFACT_FILE_CONFIG[kind].extension;
  }

  return `${slug}.${extension}`;
}

/** Resolve the mimeType for a given artifact kind. */
export function resolveArtifactMimeType(kind: ArtifactKind): string {
  return ARTIFACT_FILE_CONFIG[kind].contentType;
}

/** Validate content for structured kinds. Throws on invalid content. */
export function validateArtifactContent(kind: ArtifactKind, content: string): void {
  if (kind === "json") {
    try {
      JSON.parse(content);
    } catch {
      throw new Error("Invalid JSON content — failed to parse");
    }
  }
  if (kind === "csv") {
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length === 0) {
      throw new Error("CSV content is empty");
    }
    if (!lines[0].includes(",")) {
      throw new Error("CSV content missing comma-separated header row");
    }
  }
}

const textEncoder = new TextEncoder();

/** Check whether content is small enough to use as error fallback (when S3 upload fails). */
export function canUseFallbackContent(content: string): boolean {
  return textEncoder.encode(content).byteLength <= MAX_FALLBACK_CONTENT_BYTES;
}

/** Extract typed request context fields from a Mastra tool context. */
export function extractRequestContext(context: unknown): {
  chatId?: string;
  messageId?: string;
  workspaceId?: string;
  userEmail?: string;
  userId?: string;
  userAccessToken?: string;
  executionSource?: string;
  jobId?: string;
  runId?: string;
  /** Agent job title when executionSource is scheduled_job. */
  jobName?: string;
} {
  const reqCtx = (context as { requestContext?: unknown })?.requestContext;
  const ws = workspaceIdFromRequestContext(reqCtx);
  return {
    chatId: stringFromRequestContext(reqCtx, "chatId"),
    messageId: stringFromRequestContext(reqCtx, "responseMessageId"),
    workspaceId: ws || undefined,
    userEmail: stringFromRequestContext(reqCtx, "email"),
    userId: stringFromRequestContext(reqCtx, "userId"),
    userAccessToken: stringFromRequestContext(reqCtx, "userAccessToken"),
    executionSource: stringFromRequestContext(reqCtx, "executionSource"),
    jobId: stringFromRequestContext(reqCtx, "jobId"),
    runId: stringFromRequestContext(reqCtx, "runId"),
    jobName: stringFromRequestContext(reqCtx, "jobName"),
  };
}

export interface UploadArtifactOptions {
  title: string;
  kind: ArtifactKind;
  /** String content for text artifacts; Buffer for binary (pptx). */
  content: string | Buffer;
  metadata?: ArtifactMetadata;
  /** Chat context for asset service registration. */
  chatId?: string;
  messageId?: string;
  workspaceId?: string;
  toolName: string;
  userEmail?: string;
  userId?: string;
  userAccessToken?: string;
  executionSource?: string;
  jobId?: string;
  runId?: string;
  jobName?: string;
}

export interface UploadArtifactResult {
  url: string;
  filename: string;
  s3Key: string;
  /** Fallback content string (only used if caller needs to handle S3 upload failure). */
  fallbackContent?: string;
}

/**
 * Upload an artifact file to S3, get CDN URL, and notify the Asset Manager Service.
 * Returns the CDN URL. Fallback content is provided for error recovery only.
 *
 * IMPORTANT: notifyPythonStoreGeneratedAssets is misleadingly named — it calls the
 * standalone Asset Manager Service (ASSETS_SERVICE_WEBHOOK_URL), NOT the Python pro-backend.
 */
export async function uploadArtifact(
  opts: UploadArtifactOptions,
): Promise<UploadArtifactResult> {
  // Validate structured content before uploading
  if (typeof opts.content === "string") {
    validateArtifactContent(opts.kind, opts.content);
  }

  const filename = buildArtifactFilename(opts.title, opts.kind, opts.metadata);
  const config = ARTIFACT_FILE_CONFIG[opts.kind];

  const fileBytes =
    typeof opts.content === "string"
      ? textEncoder.encode(opts.content)
      : opts.content;

  // Upload to S3 with UUID prefix to prevent filename collisions under concurrent load
  const uniquePrefix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const s3Key = await uploadToS3(
    fileBytes,
    `artifacts/${uniquePrefix}/${filename}`,
    config.contentType,
  );

  // Get CDN URL
  const url = await refreshSignedUrl(s3Key);

  // Register with Asset Manager Service (fire-and-forget)
  const assetId = crypto.randomUUID();
  notifyPythonStoreGeneratedAssets({
    chatId: opts.chatId ?? "",
    messageId: opts.messageId ?? "",
    workspaceId: opts.workspaceId,
    toolName: opts.toolName,
    assetData: [
      {
        url,
        id: assetId,
        type: "artifact",
        metadata: {
          artifactKind: opts.kind,
          filename,
          mimeType: config.contentType,
          ...opts.metadata,
        },
      },
    ],
    userEmail: opts.userEmail,
    userId: opts.userId,
    userAccessToken: opts.userAccessToken,
    executionSource: opts.executionSource,
    jobId: opts.jobId,
    runId: opts.runId,
    jobName: opts.jobName,
  }).catch((err: unknown) => {
    log.error({ err }, "asset service notification failed");
  });

  // Provide fallback content for error recovery
  let fallbackContent: string | undefined;
  if (typeof opts.content === "string" && canUseFallbackContent(opts.content)) {
    fallbackContent = opts.content;
  }

  return { url, filename, s3Key, fallbackContent };
}

/**
 * Build the artifact event data payload for SSE emission.
 */
export function buildArtifactEventData(
  artifactId: string,
  kind: ArtifactKind,
  status: "loading" | "completed" | "failed",
  title: string,
  opts?: {
    description?: string;
    url?: string;
    content?: string;
    metadata?: ArtifactMetadata;
    widget?: ArtifactEventData["widget"];
    error?: string;
  },
): ArtifactEventData {
  return {
    id: artifactId,
    kind,
    status,
    title,
    description: opts?.description ?? title,
    ...(opts?.content !== undefined ? { content: opts.content } : {}),
    ...(opts?.url !== undefined ? { url: opts.url } : {}),
    ...(opts?.metadata !== undefined ? { metadata: opts.metadata } : {}),
    ...(opts?.widget !== undefined ? { widget: opts.widget } : {}),
  };
}
