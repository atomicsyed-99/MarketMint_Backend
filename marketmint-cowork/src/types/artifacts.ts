/** All supported artifact kinds. */
export type ArtifactKind =
  | "markdown"
  | "code"
  | "json"
  | "csv"
  | "html"
  | "presentation"
  | "pdf";

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
  pdf: { extension: "pdf", contentType: "application/pdf" },
};

/** Kind-specific metadata attached to artifact events. */
export interface ArtifactMetadata {
  filename?: string;
  mimeType?: string;
  language?: string;       // code: "python", "typescript", etc.
  slideCount?: number;     // presentation: number of slides
  rowCount?: number;       // csv: number of data rows
  pageCount?: number;      // pdf: number of pages
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
