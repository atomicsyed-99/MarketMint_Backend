# Artifact System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand MarketMint chat artifacts from 2 kinds (markdown, html) to 6 kinds (+ code, csv, json, presentation), all routed through the existing asset service via Approach B (generate -> upload to S3 -> deliver URL).

**Architecture:** Unified artifact type system with shared emit/upload helpers. All artifacts uploaded directly to S3 (via AWS SDK), then registered with the **Asset Manager Service** (via `ASSETS_SERVICE_WEBHOOK_URL` — NOT the Python pro-backend). SSE `data-artifact` events carry the CDN URL — frontend fetches content from the URL to render. No redundant inline content in SSE (except as error fallback when S3 upload fails). PPT generation via `pptxgenjs`. Frontend renders per-kind viewers.

**Important: Service boundaries.** The function `notifyPythonStoreGeneratedAssets` is misleadingly named — it calls the standalone **Asset Manager Service**, not the Python pro-backend. The Python backend is only called for credit deduction (skipped for artifacts).

**Tech Stack:** TypeScript, Mastra createTool, Zod, pptxgenjs, S3 (existing), SSE streaming (existing)

---

## Decision: Asset DB Storage (RESOLVED)

### Chosen: Reuse `generated_assets` table — `assetType: "artifact"` with subtypes in metadata

The current asset notification hardcodes types (`call-python-assets-credits.ts:77`):
```typescript
assetType: a.type === "video" ? "video" : "image"
```

**Approach:** Add ONE new asset type `"artifact"`. All artifact subtypes (csv, pptx, code, json, html, markdown) live in `chunkData.metadata`:

```json
{
  "assetType": "artifact",
  "assetId": "uuid",
  "mediaUrl": "https://cdn.marketmint.ai/artifacts/...",
  "editType": "original",
  "editParams": {},
  "chunkData": {
    "type": "artifact",
    "metadata": {
      "artifactKind": "csv",
      "mimeType": "text/csv",
      "filename": "sales-report.csv"
    }
  }
}
```

**Why this approach:**

| Benefit | Detail |
|---------|--------|
| Clean top-level filtering | `WHERE asset_type = 'artifact'` returns all artifacts |
| Image/video unaffected | `WHERE asset_type = 'image'` unchanged |
| One new type, not six | Simpler than adding csv/pptx/code/json/html individually |
| Subtype granularity | `chunkData.metadata.artifactKind` for sub-filtering |
| No DB migration | `asset_type` is a plain Text column — accepts any string |

**Verified against the Asset Manager Service (which owns the `generated_assets` table):**

- `generated_assets.asset_type` is a **plain Text column** (not an enum) — accepts any string
- **No validation/whitelist** exists in the store handler
- **No queries filter by `asset_type`** — all repository methods are type-agnostic

**Service boundaries:**
- **Asset Manager Service** (`ASSETS_SERVICE_WEBHOOK_URL`): receives `POST /assets` to register artifacts. This is the service we call. **No changes required.**
- **Python pro-backend** (`marketmint-pro-backend`): NOT involved in artifact storage. Only used for credit deduction (skipped for artifacts). **No changes required.**
- **S3**: files uploaded directly via AWS SDK from this repo. **No changes required.**

---

## File Structure

**Directory rename:** `src/mastra/tools/generative-ui/` -> `src/mastra/tools/artifacts/` (all artifact tools live here)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/mastra/tools/generative-ui/` -> `src/mastra/tools/artifacts/` | Rename | Directory rename — all artifact tools under one roof |
| `src/types/artifacts.ts` | Create | Artifact kind enum, metadata types, SSE event shape, constants |
| `src/lib/artifact-upload.ts` | Create | Generate file -> upload to S3 -> get CDN URL -> notify asset service |
| `src/lib/call-python-assets-credits.ts` | Modify | Pass through asset type, add metadata field to AssetItem |
| `src/mastra/tools/artifacts/deliver-content.ts` | Modify | Add `kind` param, upload via artifact-upload, emit URL |
| `src/mastra/tools/artifacts/render-widget.ts` | Modify | After render, upload HTML to S3, add URL to artifact event |
| `src/routes/chat/stream-processor.ts` | Modify | Update tool path references if needed |
| `src/types/stream-events.ts` | Modify | Add `"artifact"` event type with typed data |
| `src/lib/pptx-builder.ts` | Create | Slide layout renderers, image embedding, standard 16:9 |
| `src/mastra/tools/artifacts/generate-presentation.ts` | Create | PPT tool: structured slide input -> pptxgenjs -> S3 -> artifact event |
| `src/mastra/tools/index.ts` | Modify | Update imports from new path, register generate-presentation |
| `src/mastra/agents/prompts/tool-based-orchestrator.ts` | Modify | Artifact kind decision rules, HTML security rules, PPT guidance |
| `docs/artifact-frontend-spec.md` | Create | Frontend renderer requirements per artifact kind |

---

## Phase 0: Directory Rename

### Task 0: Rename generative-ui directory to artifacts

**Files:**
- Rename: `src/mastra/tools/generative-ui/` -> `src/mastra/tools/artifacts/`
- Modify: `src/mastra/tools/index.ts` (update all import paths from `./generative-ui/` to `./artifacts/`)

- [ ] **Step 1: Rename the directory**

```bash
git mv src/mastra/tools/generative-ui src/mastra/tools/artifacts
```

- [ ] **Step 2: Update all imports in `src/mastra/tools/index.ts`**

Replace every occurrence of `"./generative-ui/"` with `"./artifacts/"` in the import paths. This affects 3 imports:
- `deliverContent` from `"./generative-ui/deliver-content"` -> `"./artifacts/deliver-content"`
- `renderWidget` from `"./generative-ui/render-widget"` -> `"./artifacts/render-widget"`
- `readGuidelines` from `"./generative-ui/read-guidelines"` -> `"./artifacts/read-guidelines"`

Note: `readGuidelines` is a guidelines reader tool, not an artifact tool. It moves because it lives in the same directory. This is fine — the directory name is a grouping convenience, not a semantic constraint.

- [ ] **Step 3: Update stream-processor skeleton tool reference if needed**

In `src/routes/chat/stream-processor.ts`, check if tool names reference the directory path. Tool IDs (`"deliver-content"`, `"render-widget"`) are string identifiers — they don't change. Only file import paths change.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: No errors. All imports resolve to new path.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename generative-ui directory to artifacts"
```

---

## Phase 1: Foundation

### Task 1: Define Artifact Types and Constants

**Files:**
- Create: `src/types/artifacts.ts`
- Modify: `src/types/stream-events.ts`

- [ ] **Step 1: Create `src/types/artifacts.ts`**

```typescript
// src/types/artifacts.ts

/** All supported artifact kinds. */
export type ArtifactKind =
  | "markdown"
  | "code"
  | "json"
  | "csv"
  | "html"
  | "presentation";

/** Status lifecycle for all artifacts. */
export type ArtifactStatus = "loading" | "completed" | "failed";

/** Max inline content size for error fallback (when S3 upload fails). */
export const MAX_FALLBACK_CONTENT_BYTES = 100 * 1024; // 100 KB

/** Min content length to use artifact panel vs inline block (for markdown). */
export const ARTIFACT_THRESHOLD = 500;

/** Maps artifact kind to file extension and content-type. */
export const ARTIFACT_FILE_CONFIG: Record<
  ArtifactKind,
  { extension: string; contentType: string }
> = {
  markdown: { extension: "md", contentType: "text/markdown" },
  code: { extension: "txt", contentType: "text/plain" },
  json: { extension: "json", contentType: "application/json" },
  csv: { extension: "csv", contentType: "text/csv" },
  html: { extension: "html", contentType: "text/html" },
  presentation: {
    extension: "pptx",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
};

/** Kind-specific metadata attached to artifact events. */
export interface ArtifactMetadata {
  filename?: string;
  mimeType?: string;
  language?: string;       // code: "python", "typescript", etc.
  slideCount?: number;     // presentation: number of slides
  rowCount?: number;       // csv: number of data rows
  thumbnailUrl?: string;   // presentation: first-slide thumbnail
}

/** Shape of the data-artifact SSE event payload. */
export interface ArtifactEventData {
  id: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  title: string;
  description?: string;
  content?: string;        // only used for: (1) error fallback when S3 upload fails, (2) html widget backward compat
  url?: string;            // all artifacts: persistent CDN URL — frontend fetches content from here
  metadata?: ArtifactMetadata;
  // html specific (preserved for backward compat)
  widget?: {
    widget_code: string;
    width: number;
    height: number;
    module_type: string;
    data_sources: string[];
  };
}
```

- [ ] **Step 2: Update `src/types/stream-events.ts` to include typed artifact event**

Replace the file contents with:

```typescript
// src/types/stream-events.ts

import type { ArtifactEventData } from "./artifacts";

// NOTE: Legacy events with type "markdown-doc" exist in stored messages in the DB.
// They are handled at runtime via KNOWN_EVENT_TYPES (string set) in stream-processor.ts,
// but are NOT included in this union type. New code should use the "artifact" event
// with kind: "markdown" instead.

export type StreamEvent =
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "image"; id: string; data: Record<string, unknown> }
  | { type: "video"; id: string; data: Record<string, unknown> }
  | { type: "agent-start"; data: Record<string, unknown> }
  | { type: "agent-utility"; id: string; data: Record<string, unknown> }
  | { type: "agent-task"; id: string; data: Record<string, unknown> }
  | { type: "suggestions"; id: string; data: { suggestions: string[] } }
  | { type: "user-action"; id: string; data: Record<string, unknown> }
  | { type: "markdown"; id: string; data: Record<string, unknown> }
  | { type: "html"; id: string; data: Record<string, unknown> }
  | { type: "artifact"; id: string; data: ArtifactEventData }
  | { type: "finish"; source: string }
  | { type: "error"; id: string; data: Record<string, unknown> }
  | { type: "heartbeat" };
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No type errors. New types are not consumed yet.

- [ ] **Step 4: Commit**

```bash
git add src/types/artifacts.ts src/types/stream-events.ts
git commit -m "feat: define artifact type system with 6 kinds"
```

---

### Task 2: Create Artifact Upload Helper

**Files:**
- Create: `src/lib/artifact-upload.ts`
- Test: `src/lib/__tests__/artifact-upload.test.ts`

- [ ] **Step 1: Write test for slug generation and upload flow**

```typescript
// src/lib/__tests__/artifact-upload.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  titleToSlug,
  buildArtifactFilename,
  validateArtifactContent,
  canUseFallbackContent,
  uploadArtifact,
} from "../artifact-upload";

vi.mock("@/lib/s3", () => ({
  uploadToS3: vi.fn().mockResolvedValue("artifacts/123-abc/test-report.csv"),
  refreshSignedUrl: vi.fn().mockResolvedValue("https://cdn.marketmint.ai/artifacts/123-abc/test-report.csv"),
}));

vi.mock("@/lib/call-python-assets-credits", () => ({
  notifyPythonStoreGeneratedAssets: vi.fn().mockResolvedValue(undefined),
}));

describe("titleToSlug", () => {
  it("converts title to url-safe slug", () => {
    expect(titleToSlug("Sales Report Q4 2026")).toBe("sales-report-q4-2026");
  });

  it("strips special characters", () => {
    expect(titleToSlug("Hello, World! (v2)")).toBe("hello-world-v2");
  });

  it("collapses multiple dashes", () => {
    expect(titleToSlug("foo---bar")).toBe("foo-bar");
  });

  it("truncates to 60 chars", () => {
    const long = "a".repeat(100);
    expect(titleToSlug(long).length).toBeLessThanOrEqual(60);
  });
});

describe("buildArtifactFilename", () => {
  it("uses language extension for code artifacts", () => {
    const name = buildArtifactFilename("My Script", "code", { language: "python" });
    expect(name).toBe("my-script.py");
  });

  it("uses default extension from config", () => {
    const name = buildArtifactFilename("Data Export", "csv");
    expect(name).toBe("data-export.csv");
  });

  it("uses custom filename if provided in metadata", () => {
    const name = buildArtifactFilename("Ignored Title", "json", { filename: "config.json" });
    expect(name).toBe("config.json");
  });
});

describe("validateArtifactContent", () => {
  it("accepts valid JSON", () => {
    expect(() => validateArtifactContent("json", '{"key": "value"}')).not.toThrow();
  });

  it("rejects invalid JSON", () => {
    expect(() => validateArtifactContent("json", "{bad json")).toThrow("Invalid JSON");
  });

  it("accepts valid CSV with header", () => {
    expect(() => validateArtifactContent("csv", "name,age\nAlice,30")).not.toThrow();
  });

  it("rejects empty CSV", () => {
    expect(() => validateArtifactContent("csv", "")).toThrow("CSV content is empty");
  });

  it("rejects CSV without comma in header", () => {
    expect(() => validateArtifactContent("csv", "just a line\nno commas")).toThrow("comma-separated header");
  });

  it("does not validate markdown content", () => {
    expect(() => validateArtifactContent("markdown", "anything")).not.toThrow();
  });

  it("does not validate code content", () => {
    expect(() => validateArtifactContent("code", "def foo(): pass")).not.toThrow();
  });
});

describe("canUseFallbackContent", () => {
  it("returns true for small content", () => {
    expect(canUseFallbackContent("hello")).toBe(true);
  });

  it("returns false for content over 100KB", () => {
    const large = "x".repeat(101 * 1024);
    expect(canUseFallbackContent(large)).toBe(false);
  });

  it("returns true for content exactly at 100KB", () => {
    const exact = "x".repeat(100 * 1024);
    expect(canUseFallbackContent(exact)).toBe(true);
  });
});

describe("uploadArtifact (integration with mocks)", () => {
  it("uploads to S3 with UUID-prefixed path and returns CDN URL", async () => {
    const result = await uploadArtifact({
      title: "Test Report",
      kind: "csv",
      content: "name,age\nAlice,30",
      toolName: "deliver-content",
    });
    expect(result.url).toContain("cdn");
    expect(result.filename).toBe("test-report.csv");
    expect(result.s3Key).toContain("artifacts/");
    expect(result.s3Key).toContain("/test-report.csv");
    expect(result.fallbackContent).toBe("name,age\nAlice,30");
  });

  it("returns undefined fallbackContent for large files", async () => {
    const largeContent = "x".repeat(101 * 1024);
    const result = await uploadArtifact({
      title: "Big File",
      kind: "code",
      content: largeContent,
      toolName: "deliver-content",
    });
    expect(result.fallbackContent).toBeUndefined();
  });

  it("throws on invalid JSON content", async () => {
    await expect(
      uploadArtifact({
        title: "Bad JSON",
        kind: "json",
        content: "{not valid",
        toolName: "deliver-content",
      }),
    ).rejects.toThrow("Invalid JSON");
  });
});
```

(All imports and mocks are included at the top of the test file above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/artifact-upload.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Create `src/lib/artifact-upload.ts`**

```typescript
// src/lib/artifact-upload.ts

import { uploadToS3, refreshSignedUrl } from "@/lib/s3";
import {
  notifyPythonStoreGeneratedAssets,
  type AssetItem,
} from "@/lib/call-python-assets-credits";
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
    extension =
      LANGUAGE_EXTENSIONS[metadata.language.toLowerCase()] ??
      metadata.language.toLowerCase();
  } else {
    extension = ARTIFACT_FILE_CONFIG[kind].extension;
  }

  return `${slug}.${extension}`;
}

/** Resolve the mimeType for a given artifact kind and optional language. */
export function resolveArtifactMimeType(
  kind: ArtifactKind,
): string {
  return ARTIFACT_FILE_CONFIG[kind].contentType;
}

/** Validate content for structured kinds. Throws on invalid content. */
export function validateArtifactContent(
  kind: ArtifactKind,
  content: string,
): void {
  if (kind === "json") {
    try {
      JSON.parse(content);
    } catch {
      throw new Error("Invalid JSON content: " + content.slice(0, 100));
    }
  }
  if (kind === "csv") {
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length === 0) {
      throw new Error("CSV content is empty");
    }
    // Verify header row has at least one comma (basic CSV check)
    if (!lines[0].includes(",")) {
      throw new Error("CSV content missing comma-separated header row");
    }
  }
}

/** Check whether content is small enough to use as error fallback (when S3 upload fails). */
export function canUseFallbackContent(content: string): boolean {
  return new TextEncoder().encode(content).byteLength <= MAX_FALLBACK_CONTENT_BYTES;
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
}

export interface UploadArtifactResult {
  url: string;
  filename: string;
  s3Key: string;
  /** Fallback content string (only used if caller needs to handle S3 upload failure). */
  fallbackContent?: string;
}

/**
 * Upload an artifact file to S3, get CDN URL, and notify the asset service.
 * Returns the CDN URL. Fallback content is provided for error recovery only.
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
      ? new TextEncoder().encode(opts.content)
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

  // Register with Asset Manager Service (fire-and-forget, don't block artifact delivery).
  // IMPORTANT: notifyPythonStoreGeneratedAssets is misleadingly named — it calls the
  // standalone Asset Manager Service (ASSETS_SERVICE_WEBHOOK_URL), NOT the Python pro-backend.
  // The Python backend is only called for credit deduction, which is skipped for artifacts.
  // All artifacts use assetType: "artifact" with the subtype in metadata.
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
  }).catch((err) => {
    log.error({ err }, "asset service notification failed");
  });

  // Provide fallback content for error recovery (caller uses this if S3 upload failed upstream)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/artifact-upload.test.ts`
Expected: PASS

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/artifact-upload.ts src/lib/__tests__/artifact-upload.test.ts
git commit -m "feat: add artifact upload helper with slug filenames and size guard"
```

---

### Task 3: Update Asset Service Notification — `assetType: "artifact"` with subtypes

**Files:**
- Modify: `src/lib/call-python-assets-credits.ts`

Verified: Python backend `asset_type` is a Text column with no validation. `"artifact"` will be accepted.

- [ ] **Step 1: Update `AssetItem` type to include optional metadata**

In `src/lib/call-python-assets-credits.ts`, replace line 9:

Old:
```typescript
export type AssetItem = { url: string; id: string; type: string };
```

New:
```typescript
export type AssetItem = {
  url: string;
  id: string;
  /** Asset type: "image", "video", or "artifact" */
  type: string;
  /** Optional metadata — for artifacts: { artifactKind, mimeType, filename, ... } */
  metadata?: Record<string, unknown>;
};
```

- [ ] **Step 2: Update the asset type mapping to pass through type + metadata**

In `src/lib/call-python-assets-credits.ts`, replace lines 76-83:

Old:
```typescript
          assets: options.assetData.map((a) => ({
            assetType: a.type === "video" ? "video" : "image",
            assetId: a.id,
            mediaUrl: a.url,
            editType: "original",
            editParams: {},
            chunkData: { type: a.type },
          })),
```

Add this constant at the module level (near the top of the file, after the imports):
```typescript
const VALID_ASSET_TYPES = new Set(["image", "video", "artifact"]);
```

Then replace the assets mapping:
```typescript
          assets: options.assetData.map((a) => ({
            assetType: VALID_ASSET_TYPES.has(a.type) ? a.type : "image",
            assetId: a.id,
            mediaUrl: a.url,
            editType: "original",
            editParams: {},
            chunkData: {
              type: a.type,
              ...(a.metadata ? { metadata: a.metadata } : {}),
            },
          })),
```

**Security note:** The `VALID_ASSET_TYPES` whitelist ensures only known types reach the asset service. Unknown types fall back to `"image"` for safety.

**Backward compatibility note:** Existing callers (direct-image-gen, video tools) pass `type: "image"` or `type: "video"` with no `metadata`. Their behavior is identical. Only the new `uploadArtifact` helper sends `type: "artifact"` with metadata.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/call-python-assets-credits.ts
git commit -m "feat: support assetType 'artifact' with subtypes in metadata"
```

---

## Phase 2: Text Artifact Delivery

### Task 4: Evolve deliver-content With Kind Support

**Files:**
- Modify: `src/mastra/tools/artifacts/deliver-content.ts`
- Test: `src/mastra/tools/artifacts/__tests__/deliver-content.test.ts`

- [ ] **Step 1: Write test for new kind support**

```typescript
// src/mastra/tools/artifacts/__tests__/deliver-content.test.ts
import { describe, it, expect, vi } from "vitest";
import { deliverContent } from "../deliver-content";

// Mock the artifact-upload module
vi.mock("@/lib/artifact-upload", () => ({
  uploadArtifact: vi.fn().mockResolvedValue({
    url: "https://cdn.marketmint.ai/artifacts/test-file.py",
    filename: "test-file.py",
    s3Key: "artifacts/test-file.py",
    fallbackContent: 'print("hello")',
  }),
  buildArtifactEventData: vi.fn().mockImplementation(
    (id, kind, status, title, opts) => ({
      id,
      kind,
      status,
      title,
      ...opts,
    }),
  ),
  canUseFallbackContent: vi.fn().mockReturnValue(true),
  resolveArtifactMimeType: vi.fn().mockReturnValue("text/plain"),
}));

describe("deliverContent", () => {
  it("has correct input schema with kind field", () => {
    const schema = deliverContent.inputSchema;
    const parsed = schema.parse({
      title: "My Script",
      content: 'print("hello")',
      kind: "code",
      language: "python",
    });
    expect(parsed.kind).toBe("code");
    expect(parsed.language).toBe("python");
  });

  it("accepts csv kind", () => {
    const schema = deliverContent.inputSchema;
    const parsed = schema.parse({
      title: "Data Export",
      content: "name,age\nAlice,30",
      kind: "csv",
    });
    expect(parsed.kind).toBe("csv");
  });

  it("defaults kind to markdown", () => {
    const schema = deliverContent.inputSchema;
    const parsed = schema.parse({
      title: "Blog Post",
      content: "# Hello\n\nWorld",
    });
    expect(parsed.kind).toBeUndefined(); // default applied in execute
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mastra/tools/artifacts/__tests__/deliver-content.test.ts`
Expected: FAIL -- schema doesn't have `kind` yet

- [ ] **Step 3: Rewrite `src/mastra/tools/artifacts/deliver-content.ts`**

```typescript
// src/mastra/tools/artifacts/deliver-content.ts

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  uploadArtifact,
  buildArtifactEventData,
  canUseFallbackContent,
  resolveArtifactMimeType,
} from "@/lib/artifact-upload";
import { createLogger } from "@/lib/logger";
import { ARTIFACT_THRESHOLD, type ArtifactKind } from "@/types/artifacts";

const log = createLogger("deliver-content");

export const deliverContent = createTool({
  id: "deliver-content",
  description:
    "Present content deliverables to the user in the artifact panel. " +
    "Supports multiple content kinds: " +
    "markdown (emails, blog posts, landing page copy), " +
    "code (scripts, snippets — specify language), " +
    "json (structured data, API responses, configs), " +
    "csv (tabular data, exports, reports). " +
    "Content is uploaded to the asset service and rendered in the artifact panel with a download button. " +
    "Short markdown content (< 500 chars) renders inline. " +
    "Do NOT use for conversational responses — only for content the user will copy, download, or reuse.",
  inputSchema: z.object({
    title: z
      .string()
      .describe(
        'Title for the content (e.g., "Welcome Email Sequence", "Sales Data Q4")',
      ),
    content: z
      .string()
      .describe(
        "The full deliverable content. For markdown: use proper markdown formatting. " +
          "For code: the complete source code. For json: valid JSON string. " +
          "For csv: comma-separated values with header row.",
      ),
    kind: z
      .enum(["markdown", "code", "json", "csv"])
      .optional()
      .describe(
        'Content kind. "code" for source code, "json" for structured data, ' +
          '"csv" for tabular data, "markdown" (default) for documents and copy.',
      ),
    language: z
      .string()
      .optional()
      .describe(
        'Programming language (only for kind="code"). E.g., "python", "typescript", "sql".',
      ),
    display: z
      .enum(["auto", "artifact", "inline"])
      .optional()
      .describe(
        'How to display: "artifact" forces the full panel, "inline" forces a compact block in chat, ' +
          '"auto" (default) chooses based on content length. Only applies to markdown kind.',
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    title: z.string(),
    kind: z.string(),
    display: z.string(),
    url: z.string().optional(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const writer = context?.writer;
    const kind: ArtifactKind = input.kind ?? "markdown";
    const artifactId = `artifact_${crypto.randomUUID().slice(0, 12)}`;

    // For markdown, preserve the existing inline vs artifact logic
    if (kind === "markdown") {
      const displayMode =
        input.display === "artifact"
          ? "artifact"
          : input.display === "inline"
            ? "inline"
            : input.content.length >= ARTIFACT_THRESHOLD
              ? "artifact"
              : "inline";

      if (displayMode === "inline") {
        const markdownId = `md_${crypto.randomUUID().slice(0, 12)}`;
        await writer?.custom({
          type: "data-markdown",
          id: markdownId,
          data: { id: markdownId, title: input.title, content: input.content },
        });
        return {
          ok: true,
          title: input.title,
          kind,
          display: "inline",
          message: `Content "${input.title}" delivered inline. Do NOT repeat the content.`,
        };
      }
    }

    // Emit loading state
    await writer?.custom({
      type: "data-artifact",
      id: artifactId,
      data: buildArtifactEventData(artifactId, kind, "loading", input.title, {
        description: input.title,
      }),
    });

    try {
      // Extract request context for asset service
      const reqCtx = context?.requestContext as
        | Record<string, unknown>
        | undefined;

      // Compute metadata once (DRY — avoid duplicating mimeType/rowCount logic)
      const artifactKind = kind as ArtifactKind;
      const mimeType = resolveArtifactMimeType(artifactKind);
      const csvRowCount =
        kind === "csv"
          ? input.content.split("\n").filter((l) => l.trim()).length - 1
          : undefined;
      const artifactMeta = {
        language: input.language,
        mimeType,
        ...(csvRowCount !== undefined ? { rowCount: csvRowCount } : {}),
      };

      // Upload to S3 + notify asset service
      const uploadResult = await uploadArtifact({
        title: input.title,
        kind: artifactKind,
        content: input.content,
        metadata: artifactMeta,
        chatId: reqCtx?.chatId as string | undefined,
        messageId: reqCtx?.responseMessageId as string | undefined,
        workspaceId: reqCtx?.orgId as string | undefined,
        toolName: "deliver-content",
        userEmail: reqCtx?.email as string | undefined,
        userId: reqCtx?.userId as string | undefined,
        userAccessToken: reqCtx?.userAccessToken as string | undefined,
      });

      // Emit completed state with URL only (frontend fetches content from URL)
      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(artifactId, kind, "completed", input.title, {
          description: input.title,
          url: uploadResult.url,
          metadata: {
            filename: uploadResult.filename,
            ...artifactMeta,
          },
        }),
      });

      return {
        ok: true,
        title: input.title,
        kind,
        display: "artifact",
        url: uploadResult.url,
        message: `Content "${input.title}" delivered as ${kind} artifact. Do NOT repeat the content in your response — the user can already see and copy it.`,
      };
    } catch (err) {
      // Fallback: if S3 upload fails, emit content inline so user still sees something
      const fallback = canUseFallbackContent(input.content)
        ? input.content
        : undefined;

      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(
          artifactId,
          kind,
          fallback ? "completed" : "failed",
          input.title,
          {
            description: input.title,
            content: fallback,  // only present on error fallback
          },
        ),
      });

      log.error({ err }, "upload failed, fell back to inline");

      return {
        ok: fallback !== undefined,
        title: input.title,
        kind,
        display: "artifact",
        message: fallback
          ? `Content "${input.title}" delivered (upload failed, showing inline). Do NOT repeat the content.`
          : `Failed to deliver "${input.title}".`,
        error: err instanceof Error ? err.message : "Upload failed",
      };
    }
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/mastra/tools/artifacts/__tests__/deliver-content.test.ts`
Expected: PASS

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/mastra/tools/artifacts/deliver-content.ts src/mastra/tools/artifacts/__tests__/deliver-content.test.ts
git commit -m "feat: evolve deliver-content with kind support (code, json, csv) + S3 upload"
```

---

### Task 5: Update render-widget — Rename Kind to `html` + Upload to S3

**Files:**
- Modify: `src/mastra/tools/artifacts/render-widget.ts`
- Modify: `src/routes/chat/stream-processor.ts`

- [ ] **Step 1: Migrate `kind: "generative-ui"` to `kind: "html"` in render-widget**

In `src/mastra/tools/artifacts/render-widget.ts`, replace ALL occurrences of `kind: "generative-ui"` with `kind: "html"`. There are 3 occurrences (loading state, completed state, failed state).

- [ ] **Step 2: Migrate `kind: "generative-ui"` to `kind: "html"` in stream-processor**

In `src/routes/chat/stream-processor.ts`, replace ALL occurrences of `kind: "generative-ui"` with `kind: "html"`. There are 2 occurrences (loading skeleton injection, failed skeleton).

- [ ] **Step 3: Add S3 upload after successful widget render**

In `src/mastra/tools/artifacts/render-widget.ts`, add imports at the top (after existing imports):

```typescript
import { uploadArtifact } from "@/lib/artifact-upload";
import { createLogger } from "@/lib/logger";

const log = createLogger("render-widget");
```

Then in the `execute` function, after the completed artifact event emission (after line 120, before the return on line 122), add the async upload:

```typescript
      // Upload HTML to S3 for persistence/download (non-blocking)
      const reqCtx = context?.requestContext as Record<string, unknown> | undefined;
      uploadArtifact({
        title: input.title,
        kind: "html",
        content: input.widget_code,
        metadata: {
          mimeType: "text/html",
          filename: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.html`,
        },
        chatId: reqCtx?.chatId as string | undefined,
        messageId: reqCtx?.responseMessageId as string | undefined,
        workspaceId: reqCtx?.orgId as string | undefined,
        toolName: "render-widget",
        userEmail: reqCtx?.email as string | undefined,
        userId: reqCtx?.userId as string | undefined,
        userAccessToken: reqCtx?.userAccessToken as string | undefined,
      }).catch((err) => {
        log.warn({ err }, "S3 upload failed (non-blocking)");
      });
```

Note: `"html"` is already in `ARTIFACT_FILE_CONFIG` from Task 1, and `buildArtifactFilename`/`UploadArtifactOptions` already accept all `ArtifactKind` values. No type changes needed here.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/mastra/tools/artifacts/render-widget.ts src/routes/chat/stream-processor.ts
git commit -m "feat: rename html kind, upload HTML to S3 for persistence"
```

---

### Task 6: Verify Stream Processor (No Changes Needed)

**Files:**
- Read: `src/routes/chat/stream-processor.ts`

- [ ] **Step 1: Confirm `"artifact"` is already in KNOWN_EVENT_TYPES**

Looking at line 108 of `stream-processor.ts`:
```typescript
"tool-call", "tool-result", "artifact", "markdown",
```

`"artifact"` is already present. The stream processor normalizes `"data-artifact"` -> `"artifact"` via `normalizeEventType()` (line 3-6). Artifact events are persisted to the message content via `persistAiContentPart()` on line 275.

No code changes needed. The new artifact kinds will flow through the existing pipeline.

**Backward compatibility note for `markdown-doc` → `markdown` rename:**
- Old messages stored in the DB have `kind: "markdown-doc"` in their content parts
- The stream-processor's `KNOWN_EVENT_TYPES` still includes `"markdown-doc"` (line 109) — keep it there for old events
- The `StreamEvent` type retains the legacy `"markdown-doc"` variant alongside the new typed `"artifact"` variant
- Frontend must handle both `"markdown-doc"` (legacy stored messages) and `"markdown"` (new artifact kind) when rendering

- [ ] **Step 2: Commit (no-op, just verification)**

No commit needed.

---

## Phase 3: Presentation Tool

### Task 7: Install pptxgenjs

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pptxgenjs**

Run: `npm install pptxgenjs`

- [ ] **Step 2: Verify installation**

Run: `npm run build`
Expected: No errors. Package available for import.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install pptxgenjs for presentation generation"
```

---

### Task 8: Create PPT Builder Module

**Files:**
- Create: `src/lib/pptx-builder.ts`
- Test: `src/lib/__tests__/pptx-builder.test.ts`

- [ ] **Step 1: Write test for PPT builder**

```typescript
// src/lib/__tests__/pptx-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildPresentation, type SlideInput } from "../pptx-builder";

describe("buildPresentation", () => {
  it("generates a Buffer from title slide", async () => {
    const slides: SlideInput[] = [
      { layout: "title", title: "Q4 Review", subtitle: "Sales Department" },
    ];
    const buffer = await buildPresentation({ title: "Q4 Review", slides });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("generates slides with content layout", async () => {
    const slides: SlideInput[] = [
      { layout: "title", title: "Deck Title" },
      {
        layout: "content",
        title: "Key Findings",
        bullets: ["Revenue up 23%", "Costs down 15%", "NPS improved to 72"],
      },
    ];
    const buffer = await buildPresentation({ title: "Deck", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("generates slides with image layout", async () => {
    const slides: SlideInput[] = [
      {
        layout: "image",
        title: "Hero Shot",
        imageUrl: "https://via.placeholder.com/1920x1080",
        caption: "Product lifestyle image",
      },
    ];
    const buffer = await buildPresentation({ title: "Visual", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("handles two-column layout", async () => {
    const slides: SlideInput[] = [
      {
        layout: "two-column",
        title: "Before & After",
        leftContent: { bullets: ["Old design", "Low conversion"] },
        rightContent: { bullets: ["New design", "High conversion"] },
      },
    ];
    const buffer = await buildPresentation({ title: "Compare", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("handles comparison layout", async () => {
    const slides: SlideInput[] = [
      {
        layout: "comparison",
        title: "Plan Options",
        leftHeader: "Basic",
        leftContent: { bullets: ["5 users", "$10/mo"] },
        rightHeader: "Pro",
        rightContent: { bullets: ["50 users", "$50/mo"] },
      },
    ];
    const buffer = await buildPresentation({ title: "Plans", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("returns slide count", async () => {
    const slides: SlideInput[] = [
      { layout: "title", title: "One" },
      { layout: "content", title: "Two", bullets: ["A"] },
      { layout: "content", title: "Three", bullets: ["B"] },
    ];
    const buffer = await buildPresentation({ title: "Multi", slides });
    expect(buffer).toBeInstanceOf(Buffer);
    // Can't easily inspect slide count from buffer,
    // but we verify it doesn't throw with multiple slides.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/pptx-builder.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Create `src/lib/pptx-builder.ts`**

```typescript
// src/lib/pptx-builder.ts

import PptxGenJS from "pptxgenjs";
import { createLogger } from "@/lib/logger";

const log = createLogger("pptx-builder");

// ── Slide Layout Types ──────────────────────────────────────────────

interface TitleSlide {
  layout: "title";
  title: string;
  subtitle?: string;
}

interface ContentSlide {
  layout: "content";
  title: string;
  bullets: string[];
  imageUrl?: string;
}

interface ImageSlide {
  layout: "image";
  title: string;
  imageUrl: string;
  caption?: string;
}

interface ColumnContent {
  bullets: string[];
  imageUrl?: string;
}

interface TwoColumnSlide {
  layout: "two-column";
  title: string;
  leftContent: ColumnContent;
  rightContent: ColumnContent;
}

interface ComparisonSlide {
  layout: "comparison";
  title: string;
  leftHeader: string;
  leftContent: ColumnContent;
  rightHeader: string;
  rightContent: ColumnContent;
}

export type SlideInput =
  | TitleSlide
  | ContentSlide
  | ImageSlide
  | TwoColumnSlide
  | ComparisonSlide;

export interface PresentationInput {
  title: string;
  slides: SlideInput[];
  author?: string;
}

// ── Theme Constants ──────────────────────────────────────────────────

const COLORS = {
  primary: "1A1A2E",
  accent: "E94560",
  textDark: "1A1A2E",
  textLight: "FFFFFF",
  bgLight: "F5F5F5",
  bgDark: "16213E",
  subtle: "6B7280",
  divider: "E5E7EB",
} as const;

const FONTS = {
  heading: "Helvetica",
  body: "Helvetica",
} as const;

// ── Safe Image Helper ────────────────────────────────────────────────

/** Render a placeholder box when an image can't be loaded. */
function renderImagePlaceholder(
  slide: any,
  opts: { x: number; y: number; w: number; h: number },
  message: string,
): void {
  slide.addShape("rect" as any, {
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    fill: { color: COLORS.bgLight },
    line: { color: COLORS.divider, width: 1 },
  });
  slide.addText(message, {
    x: opts.x,
    y: opts.y + opts.h / 2 - 0.2,
    w: opts.w,
    h: 0.4,
    fontSize: 11,
    fontFace: FONTS.body,
    color: COLORS.subtle,
    align: "center",
    italic: true,
  });
}

/** Add an image to a slide with error handling. If the URL is expired/invalid,
 *  renders a placeholder text box instead of crashing the entire presentation. */
function safeAddImage(
  slide: any,
  opts: { path: string; x: number; y: number; w: number; h: number; sizing?: any },
): void {
  // Security: only allow HTTPS URLs to prevent file:// or javascript: schemes
  if (!opts.path.startsWith("https://")) {
    log.warn({ path: opts.path }, "rejected non-HTTPS image URL");
    renderImagePlaceholder(slide, opts, "[Invalid image URL]");
    return;
  }

  try {
    slide.addImage(opts);
  } catch (err) {
    log.warn({ err, path: opts.path }, "failed to add image, using placeholder");
    renderImagePlaceholder(slide, opts, "[Image unavailable]");
  }
}

// ── Slide Renderers ──────────────────────────────────────────────────

function renderTitleSlide(pptx: PptxGenJS, slide: TitleSlide): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bgDark };

  s.addText(slide.title, {
    x: 0.8,
    y: 2.0,
    w: 8.4,
    h: 1.5,
    fontSize: 40,
    fontFace: FONTS.heading,
    color: COLORS.textLight,
    bold: true,
    align: "left",
  });

  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.8,
      y: 3.6,
      w: 8.4,
      h: 0.8,
      fontSize: 20,
      fontFace: FONTS.body,
      color: COLORS.accent,
      align: "left",
    });
  }

  // Accent bar
  s.addShape("rect" as any, {
    x: 0.8,
    y: 3.3,
    w: 2.0,
    h: 0.05,
    fill: { color: COLORS.accent },
  });
}

function renderContentSlide(pptx: PptxGenJS, slide: ContentSlide): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.textLight };

  // Title
  s.addText(slide.title, {
    x: 0.8,
    y: 0.3,
    w: 8.4,
    h: 0.8,
    fontSize: 28,
    fontFace: FONTS.heading,
    color: COLORS.textDark,
    bold: true,
  });

  // Divider
  s.addShape("rect" as any, {
    x: 0.8,
    y: 1.1,
    w: 8.4,
    h: 0.02,
    fill: { color: COLORS.divider },
  });

  const contentWidth = slide.imageUrl ? 5.0 : 8.4;

  // Bullets
  const bulletItems = slide.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 16,
      fontFace: FONTS.body,
      color: COLORS.textDark,
      paraSpaceAfter: 8,
    },
  }));

  s.addText(bulletItems as any, {
    x: 0.8,
    y: 1.4,
    w: contentWidth,
    h: 5.0,
    valign: "top",
  });

  // Optional image (with fallback placeholder if URL is expired/invalid)
  if (slide.imageUrl) {
    safeAddImage(s, {
      path: slide.imageUrl,
      x: 6.2,
      y: 1.4,
      w: 3.4,
      h: 5.0,
      sizing: { type: "contain", w: 3.4, h: 5.0 },
    });
  }
}

function renderImageSlide(pptx: PptxGenJS, slide: ImageSlide): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bgLight };

  // Title bar
  s.addText(slide.title, {
    x: 0.8,
    y: 0.3,
    w: 8.4,
    h: 0.7,
    fontSize: 24,
    fontFace: FONTS.heading,
    color: COLORS.textDark,
    bold: true,
  });

  // Image (large, centered — with fallback placeholder if URL is expired/invalid)
  safeAddImage(s, {
    path: slide.imageUrl,
    x: 0.8,
    y: 1.2,
    w: 8.4,
    h: 5.0,
    sizing: { type: "contain", w: 8.4, h: 5.0 },
  });

  // Caption
  if (slide.caption) {
    s.addText(slide.caption, {
      x: 0.8,
      y: 6.4,
      w: 8.4,
      h: 0.5,
      fontSize: 12,
      fontFace: FONTS.body,
      color: COLORS.subtle,
      align: "center",
      italic: true,
    });
  }
}

function renderTwoColumnSlide(pptx: PptxGenJS, slide: TwoColumnSlide): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.textLight };

  // Title
  s.addText(slide.title, {
    x: 0.8,
    y: 0.3,
    w: 8.4,
    h: 0.8,
    fontSize: 28,
    fontFace: FONTS.heading,
    color: COLORS.textDark,
    bold: true,
  });

  // Divider
  s.addShape("rect" as any, {
    x: 0.8,
    y: 1.1,
    w: 8.4,
    h: 0.02,
    fill: { color: COLORS.divider },
  });

  // Left column
  const leftBullets = slide.leftContent.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 14,
      fontFace: FONTS.body,
      color: COLORS.textDark,
      paraSpaceAfter: 6,
    },
  }));
  s.addText(leftBullets as any, {
    x: 0.8,
    y: 1.4,
    w: 4.0,
    h: 5.0,
    valign: "top",
  });

  // Vertical divider
  s.addShape("rect" as any, {
    x: 4.95,
    y: 1.4,
    w: 0.02,
    h: 5.0,
    fill: { color: COLORS.divider },
  });

  // Right column
  const rightBullets = slide.rightContent.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 14,
      fontFace: FONTS.body,
      color: COLORS.textDark,
      paraSpaceAfter: 6,
    },
  }));
  s.addText(rightBullets as any, {
    x: 5.2,
    y: 1.4,
    w: 4.0,
    h: 5.0,
    valign: "top",
  });
}

function renderComparisonSlide(pptx: PptxGenJS, slide: ComparisonSlide): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.textLight };

  // Title
  s.addText(slide.title, {
    x: 0.8,
    y: 0.3,
    w: 8.4,
    h: 0.8,
    fontSize: 28,
    fontFace: FONTS.heading,
    color: COLORS.textDark,
    bold: true,
  });

  // Left header
  s.addText(slide.leftHeader, {
    x: 0.8,
    y: 1.2,
    w: 4.0,
    h: 0.5,
    fontSize: 18,
    fontFace: FONTS.heading,
    color: COLORS.accent,
    bold: true,
  });

  // Left bullets
  const leftBullets = slide.leftContent.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 14,
      fontFace: FONTS.body,
      color: COLORS.textDark,
      paraSpaceAfter: 6,
    },
  }));
  s.addText(leftBullets as any, {
    x: 0.8,
    y: 1.8,
    w: 4.0,
    h: 4.6,
    valign: "top",
  });

  // Vertical divider
  s.addShape("rect" as any, {
    x: 4.95,
    y: 1.2,
    w: 0.02,
    h: 5.2,
    fill: { color: COLORS.divider },
  });

  // Right header
  s.addText(slide.rightHeader, {
    x: 5.2,
    y: 1.2,
    w: 4.0,
    h: 0.5,
    fontSize: 18,
    fontFace: FONTS.heading,
    color: COLORS.accent,
    bold: true,
  });

  // Right bullets
  const rightBullets = slide.rightContent.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 14,
      fontFace: FONTS.body,
      color: COLORS.textDark,
      paraSpaceAfter: 6,
    },
  }));
  s.addText(rightBullets as any, {
    x: 5.2,
    y: 1.8,
    w: 4.0,
    h: 4.6,
    valign: "top",
  });
}

// ── Main Builder ─────────────────────────────────────────────────────

const SLIDE_RENDERERS: Record<
  SlideInput["layout"],
  (pptx: PptxGenJS, slide: any) => void
> = {
  title: renderTitleSlide,
  content: renderContentSlide,
  image: renderImageSlide,
  "two-column": renderTwoColumnSlide,
  comparison: renderComparisonSlide,
};

/**
 * Build a PPTX presentation from structured slide inputs.
 * Returns a Node.js Buffer ready for S3 upload.
 */
export async function buildPresentation(
  input: PresentationInput,
): Promise<Buffer> {
  const pptx = new PptxGenJS();

  // Standard 16:9 widescreen
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = input.title;
  if (input.author) pptx.author = input.author;

  for (const slide of input.slides) {
    const renderer = SLIDE_RENDERERS[slide.layout];
    renderer(pptx, slide);
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/pptx-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/pptx-builder.ts src/lib/__tests__/pptx-builder.test.ts
git commit -m "feat: add pptx-builder with 5 slide layout types"
```

---

### Task 9: Create generate-presentation Tool

**Files:**
- Create: `src/mastra/tools/artifacts/generate-presentation.ts`

- [ ] **Step 1: Create `src/mastra/tools/artifacts/generate-presentation.ts`**

```typescript
// src/mastra/tools/artifacts/generate-presentation.ts

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { buildPresentation, type SlideInput } from "@/lib/pptx-builder";
import { uploadArtifact, buildArtifactEventData } from "@/lib/artifact-upload";
import { emitUtility } from "@/mastra/tools/emit-utility";

// ── Zod Schemas for Slide Layouts ────────────────────────────────────

const titleSlideSchema = z.object({
  layout: z.literal("title"),
  title: z.string().describe("Main title text"),
  subtitle: z.string().optional().describe("Subtitle text"),
});

const contentSlideSchema = z.object({
  layout: z.literal("content"),
  title: z.string().describe("Slide heading"),
  bullets: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("Bullet points (1-8 items)"),
  imageUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional image URL (from a previous direct_image_gen result). Displayed beside bullets.",
    ),
});

const imageSlideSchema = z.object({
  layout: z.literal("image"),
  title: z.string().describe("Slide heading"),
  imageUrl: z
    .string()
    .url()
    .describe("Image URL (from a previous direct_image_gen result). Displayed large."),
  caption: z.string().optional().describe("Image caption text"),
});

const columnContentSchema = z.object({
  bullets: z.array(z.string()).min(1).max(6),
  imageUrl: z.string().url().optional(),
});

const twoColumnSlideSchema = z.object({
  layout: z.literal("two-column"),
  title: z.string().describe("Slide heading"),
  leftContent: columnContentSchema,
  rightContent: columnContentSchema,
});

const comparisonSlideSchema = z.object({
  layout: z.literal("comparison"),
  title: z.string().describe("Slide heading"),
  leftHeader: z.string().describe("Left column header"),
  leftContent: columnContentSchema,
  rightHeader: z.string().describe("Right column header"),
  rightContent: columnContentSchema,
});

const slideSchema = z.discriminatedUnion("layout", [
  titleSlideSchema,
  contentSlideSchema,
  imageSlideSchema,
  twoColumnSlideSchema,
  comparisonSlideSchema,
]);

// ── Tool Definition ──────────────────────────────────────────────────

export const generatePresentation = createTool({
  id: "generate-presentation",
  description:
    "Generate a PowerPoint presentation (.pptx) from structured slide data. " +
    "Produces a downloadable PPTX file in standard 16:9 widescreen format. " +
    "To include AI-generated images, first call direct_image_gen, then pass the resulting image URLs here. " +
    "Available slide layouts: title (title + subtitle), content (heading + bullets + optional image), " +
    "image (heading + full image + caption), two-column (heading + two bullet columns), " +
    "comparison (heading + two labeled columns). " +
    "Start with a title slide. Aim for 5-15 slides for a good presentation.",
  inputSchema: z.object({
    title: z
      .string()
      .describe("Presentation title (used for the file name and metadata)"),
    slides: z
      .array(slideSchema)
      .min(1)
      .max(30)
      .describe("Ordered list of slides. Start with a title slide."),
    author: z.string().optional().describe("Author name for metadata"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    title: z.string(),
    url: z.string().optional(),
    slideCount: z.number(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const writer = context?.writer;
    const artifactId = `artifact_${crypto.randomUUID().slice(0, 12)}`;
    const cardId = `pptx_${crypto.randomUUID().slice(0, 12)}`;

    // Emit progress indicator
    emitUtility(context, {
      id: cardId,
      name: "generate_presentation",
      title: "Presentation Generation",
      category: "generation",
      status: "running",
      description: `Building ${input.slides.length}-slide presentation...`,
      steps: [
        { id: "build", title: "Building slides", status: "running" },
        { id: "upload", title: "Uploading file", status: "pending" },
      ],
    });

    // Emit loading artifact
    await writer?.custom({
      type: "data-artifact",
      id: artifactId,
      data: buildArtifactEventData(artifactId, "presentation", "loading", input.title, {
        description: `${input.slides.length}-slide presentation`,
      }),
    });

    try {
      // Build PPTX
      const startTime = Date.now();
      const buffer = await buildPresentation({
        title: input.title,
        slides: input.slides as SlideInput[],
        author: input.author,
      });
      const buildMs = Date.now() - startTime;

      // Update progress
      emitUtility(context, {
        id: cardId,
        name: "generate_presentation",
        title: "Presentation Generation",
        category: "generation",
        status: "running",
        description: "Uploading presentation...",
        steps: [
          { id: "build", title: "Building slides", status: "completed", duration_ms: buildMs },
          { id: "upload", title: "Uploading file", status: "running" },
        ],
      });

      // Upload to S3
      const reqCtx = context?.requestContext as Record<string, unknown> | undefined;
      const uploadResult = await uploadArtifact({
        title: input.title,
        kind: "presentation",
        content: buffer,
        metadata: {
          slideCount: input.slides.length,
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
        chatId: reqCtx?.chatId as string | undefined,
        messageId: reqCtx?.responseMessageId as string | undefined,
        workspaceId: reqCtx?.orgId as string | undefined,
        toolName: "generate-presentation",
        userEmail: reqCtx?.email as string | undefined,
        userId: reqCtx?.userId as string | undefined,
        userAccessToken: reqCtx?.userAccessToken as string | undefined,
      });

      const totalMs = Date.now() - startTime;

      // Emit completed progress
      emitUtility(context, {
        id: cardId,
        name: "generate_presentation",
        title: "Presentation Generation",
        category: "generation",
        status: "completed",
        description: `${input.slides.length}-slide presentation ready`,
        duration_ms: totalMs,
        steps: [
          { id: "build", title: "Building slides", status: "completed", duration_ms: buildMs },
          { id: "upload", title: "Uploading file", status: "completed", duration_ms: totalMs - buildMs },
        ],
      });

      // Emit completed artifact with download URL
      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(artifactId, "presentation", "completed", input.title, {
          description: `${input.slides.length}-slide presentation`,
          url: uploadResult.url,
          metadata: {
            filename: uploadResult.filename,
            slideCount: input.slides.length,
            mimeType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          },
        }),
      });

      return {
        ok: true,
        title: input.title,
        url: uploadResult.url,
        slideCount: input.slides.length,
        message: `Presentation "${input.title}" (${input.slides.length} slides) generated and ready for download. Do NOT repeat the slide content.`,
      };
    } catch (err) {
      // Emit failed states
      emitUtility(context, {
        id: cardId,
        name: "generate_presentation",
        title: "Presentation Generation",
        category: "generation",
        status: "failed",
        description: "Failed to generate presentation",
        error: err instanceof Error ? err.message : "Unknown error",
      });

      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(artifactId, "presentation", "failed", input.title, {
          description: "Failed to generate presentation",
        }),
      });

      return {
        ok: false,
        title: input.title,
        slideCount: 0,
        message: "",
        error: err instanceof Error ? err.message : "Failed to generate presentation",
      };
    }
  },
});
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/mastra/tools/artifacts/generate-presentation.ts
git commit -m "feat: add generate-presentation tool with structured slide input"
```

---

### Task 10: Register Presentation Tool

**Files:**
- Modify: `src/mastra/tools/index.ts`

- [ ] **Step 1: Add import and register as dynamic tool**

In `src/mastra/tools/index.ts`, add after line 51 (after `writeReelScript` import):

```typescript
import { generatePresentation } from "./artifacts/generate-presentation";
```

Add to `dynamicTools` object (after `writeReelScript` on line 71):

```typescript
  generatePresentation,
```

Add to re-exports (after `writeReelScript` on line 101):

```typescript
  generatePresentation,
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/mastra/tools/index.ts
git commit -m "feat: register generate-presentation as dynamic tool"
```

---

## Phase 4: Skill, Agent & Frontend

### Task 11: Presentation Generator Skill (Already Created)

**Files:**
- Created: `skills_v2/presentation-generator/SKILL.md`

The skill is already written and committed. It provides the agent with:
- Two-phase workflow: outline first (via display_plan), then generate
- Strict word limits: titles max 6 words, bullets max 15 words, 3-5 bullets per slide
- Content quality rules: "concrete, not meta" — every bullet must contain a specific fact/number/action
- Slide variety enforcement: mix at least 3 layout types, not all content slides
- Image orchestration: generate images via direct_image_gen at 16:9 FIRST, then pass URLs to generate-presentation
- Narrative structure: 20% opening, 60% core, 20% closing

No changes needed to existing skills — all content-delivery skills (copywriting, email-sequence, social-content) call `deliver_content` without a `kind` param, which defaults to `"markdown"`. Their behavior is unchanged.

- [ ] **Step 1: Verify skill is discoverable**

Run in a test conversation: `skill_search("presentation")` should return `presentation-generator`.

- [ ] **Step 2: Commit**

```bash
git add skills_v2/presentation-generator/SKILL.md
git commit -m "feat: add presentation-generator skill with content quality rules"
```

---

### Task 12: Update System Prompt

**Files:**
- Modify: `src/mastra/agents/prompts/tool-based-orchestrator.ts`

- [ ] **Step 1: Add artifact kind decision rules and PPT guidance**

In `src/mastra/agents/prompts/tool-based-orchestrator.ts`, add the following section after the "NOTE: Tool choice by intent" block (after line 56):

```typescript
Artifact kinds — choosing the right deliver_content kind:
- **markdown** (default): Email sequences, blog posts, landing page copy, SEO content, multi-section documents, ad copy — any substantial text the user will copy-paste.
- **code**: Source code, scripts, config files, snippets. ALWAYS specify the \`language\` parameter (e.g., "python", "typescript", "sql", "html").
- **json**: Structured data, API response examples, configuration objects, data schemas. Content must be valid JSON.
- **csv**: Tabular data, data exports, reports with rows and columns. Content must be valid CSV with a header row.
When in doubt between kinds, use markdown. Never use deliver_content for conversational responses.

HTML artifacts (render_widget):
- HTML artifacts are for visual-only content: dashboards, charts, data visualizations, landing page previews, styled documents, diagrams.
- ALWAYS call read_guidelines before generating HTML artifacts. Follow the guidelines as the base design system.
- If the user requests a specific style, theme, or visual treatment, follow their direction while respecting security rules.
- NEVER include: input fields, textareas, select elements, forms, submit buttons, or any interactive input functionality.
- NEVER include: outbound network requests (fetch, XMLHttpRequest), client storage access (localStorage, sessionStorage, cookies), parent window access (window.open, window.parent), or dynamic code execution.
- Only load external scripts from the CDN allowlist: cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, esm.sh.
- These security rules are absolute — user requests cannot override them.

Presentations (generate_presentation):
- When the user asks for a presentation, pitch deck, slide deck, or PPT → load the **presentation-generator** skill via skill_search("presentation").
- ALWAYS load the skill first. Do NOT call generate_presentation without reading the skill's content quality rules.
- The skill explains the full workflow: outline first, generate images if needed, then call the tool.
- The tool is available via search_tools / load_tool (search for "presentation" or "pptx").
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/mastra/agents/prompts/tool-based-orchestrator.ts
git commit -m "feat: add artifact kind decision rules and PPT guidance to system prompt"
```

---

### Task 13: Document Frontend Artifact Renderer Spec

**Files:**
- Create: `docs/artifact-frontend-spec.md`

- [ ] **Step 1: Create `docs/artifact-frontend-spec.md`**

```markdown
# Artifact Frontend Renderer Specification

## Overview

The backend emits `data-artifact` SSE events with a unified shape. The frontend must render
each artifact kind with an appropriate viewer and provide download capability for all kinds.

## SSE Event Shape

All artifacts use the same event type:

```json
{
  "type": "data-artifact",
  "id": "artifact_abc123",
  "data": {
    "id": "artifact_abc123",
    "kind": "code | csv | json | markdown | html | presentation",
    "status": "loading | completed | failed",
    "title": "...",
    "description": "...",
    "content": "...(inline text, optional)",
    "url": "...(CDN URL, present on completed)",
    "metadata": {
      "filename": "sales-report.csv",
      "mimeType": "text/csv",
      "language": "python",
      "slideCount": 10,
      "rowCount": 150,
      "thumbnailUrl": "..."
    },
    "widget": { ... (html only, backward compat) }
  }
}
```

## Rendering per Kind

### markdown
- **Viewer**: Rendered markdown (same as current behavior)
- **Source**: `data.content` (inline) or fetch from `data.url`
- **Download**: `.md` file via `data.url`

### code
- **Viewer**: Syntax-highlighted code block. Use `data.metadata.language` for highlighting.
- **Source**: `data.content` (inline) or fetch from `data.url`
- **Download**: File with correct extension (from `data.metadata.filename`)
- **Copy button**: Copy raw code to clipboard

### json
- **Viewer**: Formatted JSON with collapsible tree view or syntax-highlighted code block.
- **Source**: `data.content` (inline) or fetch from `data.url`
- **Download**: `.json` file via `data.url`
- **Copy button**: Copy raw JSON to clipboard

### csv
- **Viewer**: Table preview (first 50 rows). Show `data.metadata.rowCount` for total.
- **Source**: `data.content` (inline) or fetch from `data.url`
- **Download**: `.csv` file via `data.url`

### html
- **Viewer**: Sandboxed iframe (same as current behavior). Use `data.widget` for widget code.
- **Source**: `data.widget.widget_code` (inline, always present)
- **Download**: `.html` file via `data.url` (new — URL now available)

### presentation
- **Viewer**: Slide count badge + title + description + download button. No inline preview
  (PPTX cannot be rendered in browser without heavy libraries).
  Optional: if `data.metadata.thumbnailUrl` exists, show first-slide thumbnail.
- **Source**: Binary file, no inline content.
- **Download**: `.pptx` file via `data.url` (primary CTA)

## Inline Markdown Event (Short Content)

When `deliver-content` is called with `kind: "markdown"` and content is < 500 chars,
it emits a `data-markdown` event (NOT a `data-artifact` event):

```json
{
  "type": "data-markdown",
  "id": "md_abc123",
  "data": {
    "id": "md_abc123",
    "title": "Ad Headline",
    "content": "Short markdown content here"
  }
}
```

This renders as an inline copyable block in the chat, NOT in the artifact panel.
This behavior is preserved from the existing system and is NOT new.

## Event Type Disambiguation

The frontend must handle TWO event types for content:

| Event Type | When Used | Render Location |
|-----------|-----------|-----------------|
| `data-artifact` | All artifact kinds (code, csv, json, markdown >= 500 chars, html, presentation) | Artifact panel |
| `data-markdown` | Short markdown content < 500 chars | Inline in chat |

The legacy `markdown` event type in `StreamEvent` is preserved for any older
Python backend events but new content always uses `data-artifact` or `data-markdown`.

## Backward Compatibility

Legacy artifacts (from before this change) may have:
- `content` but no `url` — render from inline content, no download button
- `widget` but no `url` — render widget from inline code, no download button

Rule: if `url` is present, show download button. If only `content`/`widget` exists, render
inline-only (legacy behavior).

## Loading & Error States

- **loading**: Show skeleton/spinner with title
- **failed**: Show error message with title. If `content` is present (fallback), render it.
- **completed**: Render full viewer with download button.

## Download Button Behavior

All artifact kinds get a download button when `url` is present:
1. On click: `window.open(data.url, "_blank")` or `<a href={url} download={metadata.filename}>`
2. Show filename from `data.metadata.filename`
3. Show file type badge from `data.kind`
```

- [ ] **Step 2: Commit**

```bash
git add docs/artifact-frontend-spec.md
git commit -m "docs: add frontend artifact renderer specification"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `npm run build` passes with no type errors
- [ ] `npx vitest run` passes all new tests
- [ ] Existing deliver-content behavior unchanged for markdown (inline for < 500 chars, artifact for >= 500)
- [ ] New kinds (code, json, csv) emit `data-artifact` events with `url` (frontend fetches content from URL)
- [ ] render-widget still works (html unchanged from frontend perspective, now also uploads to S3)
- [ ] generate-presentation produces valid `.pptx` buffer and emits `data-artifact` with download URL
- [ ] All new tools registered in `src/mastra/tools/index.ts`
- [ ] System prompt updated with artifact kind decision rules
