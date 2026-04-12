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
    "kind": "code | csv | json | markdown | html | presentation | pdf",
    "status": "loading | completed | failed",
    "title": "...",
    "description": "...",
    "url": "...(CDN URL, present on completed)",
    "content": "...(only on error fallback or html widget)",
    "metadata": {
      "filename": "sales-report.csv",
      "mimeType": "text/csv",
      "language": "python",
      "slideCount": 10,
      "rowCount": 150,
      "pageCount": 5
    },
    "widget": { "widget_code": "...", "width": 900, "height": 600, "module_type": "...", "data_sources": [] }
  }
}
```

**Normal path:** `url` is present, `content` is absent. Frontend fetches from URL.
**Error fallback:** `url` is absent, `content` is present. Frontend renders inline (no download).
**html kind:** Both `url` (for download) and `widget` (for iframe rendering) are present.

## Rendering per Kind

### markdown
- **Viewer**: Rendered markdown
- **Source**: Fetch from `data.url`
- **Download**: `.md` file via `data.url`

### code
- **Viewer**: Syntax-highlighted code block. Use `data.metadata.language` for highlighting.
- **Source**: Fetch from `data.url`
- **Download**: File with correct extension (from `data.metadata.filename`)
- **Copy button**: Copy raw code to clipboard

### json
- **Viewer**: Formatted JSON with collapsible tree view or syntax-highlighted code block.
- **Source**: Fetch from `data.url`
- **Download**: `.json` file via `data.url`
- **Copy button**: Copy raw JSON to clipboard

### csv
- **Viewer**: Table preview (first 50 rows). Show `data.metadata.rowCount` for total.
- **Source**: Fetch from `data.url`
- **Download**: `.csv` file via `data.url`

### html
- **Viewer**: Sandboxed iframe (same as current behavior). Use `data.widget` for widget code.
- **Source**: `data.widget.widget_code` (inline, always present for iframe rendering)
- **Download**: `.html` file via `data.url` (new — URL now available)

### presentation
- **Viewer**: Slide count badge + title + description + download button. No inline preview
  (PPTX cannot be rendered in browser without heavy libraries).
- **Source**: Binary file, no inline content.
- **Download**: `.pptx` file via `data.url` (primary CTA)

### pdf
- **Viewer**: Embedded PDF viewer using `<iframe src={data.url}>` or `<embed>` tag.
  Show `data.metadata.pageCount` as page count badge. Most browsers render PDFs natively
  in iframes. Fallback: show page count badge + title + download button.
- **Source**: Binary file. Frontend embeds via `data.url` directly (no fetch needed).
- **Download**: `.pdf` file via `data.url`
- **Note**: PDF is an on-demand artifact — only generated when the user explicitly requests it.

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

## Event Type Disambiguation

| Event Type | When Used | Render Location |
|-----------|-----------|-----------------|
| `data-artifact` | All artifact kinds — loading/completed/failed lifecycle | Artifact panel |
| `data-artifact-delta` | Progressive content streaming for html, code, json, csv, markdown | Artifact panel (appended) |
| `data-markdown` | Short markdown content < 500 chars | Inline in chat |

## Progressive Content Streaming

For `html` (render-widget) and text artifacts (deliver-content with code/json/csv/markdown), the backend
streams content token-by-token as the LLM generates it. The frontend receives three event types in sequence:

```
1. { type: "data-artifact", status: "loading", id: "artifact_x", ... }     ← show skeleton
2. { type: "data-artifact-delta", id: "artifact_x", data: { delta: "<st" }} ← append content
   { type: "data-artifact-delta", id: "artifact_x", data: { delta: "yle>" }}
   { type: "data-artifact-delta", id: "artifact_x", data: { delta: ".da" }}
   ...                                                                       ← keep appending
3. { type: "data-artifact", status: "completed", id: "artifact_x", url: "..." } ← final state
```

### Frontend Implementation Guide

**Step 1: Track artifact state by ID**

```typescript
// Store accumulating content per artifact ID
const artifactBuffers = useRef<Map<string, string>>(new Map());

function handleSSEEvent(event: StreamEvent) {
  if (event.type === "data-artifact" && event.data.status === "loading") {
    // Show skeleton/loading state
    artifactBuffers.current.set(event.id, "");
  }

  if (event.type === "data-artifact-delta") {
    // Append delta to buffer and re-render
    const current = artifactBuffers.current.get(event.id) ?? "";
    artifactBuffers.current.set(event.id, current + event.data.delta);
    // Trigger re-render with accumulated content
  }

  if (event.type === "data-artifact" && event.data.status === "completed") {
    // Final state — switch to URL-based rendering, show download button
    artifactBuffers.current.delete(event.id);
  }
}
```

**Step 2: Render progressively per artifact kind**

| Kind | How to Render Streaming Content |
|------|-------------------------------|
| `html` | Write accumulated HTML into iframe via `srcdoc` or `contentDocument.write()`. Update on each delta. The HTML streams in order: `<style>` → HTML → `<script>`, so early deltas render partial styles/structure. |
| `code` | Append to a `<pre><code>` block. Apply syntax highlighting on completed (not during streaming — too expensive). During streaming, show plain monospace text. |
| `markdown` | Append to a markdown renderer. Most renderers handle partial markdown gracefully. |
| `json` | Append to a `<pre>` block with monospace styling. Format/highlight on completed. |
| `csv` | Append to a raw text buffer. Render table preview only on completed (partial CSV rows are meaningless). Show character count during streaming. |

**Step 3: Transition to final state on completed**

When `data-artifact` with `status: "completed"` arrives:
1. Stop using the streaming buffer
2. Switch to the CDN `url` for the canonical content
3. Show the download button
4. For html: the `widget` field has the complete code — use it for the final iframe render
5. For text types: fetch from `url` for the final render (or use the accumulated buffer if URL fetch fails)

### iframe Streaming for HTML Artifacts

```typescript
// React component for streaming HTML artifact
function StreamingHtmlArtifact({ artifactId }: { artifactId: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const content = useArtifactBuffer(artifactId); // hook into the buffer

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;

    // Rewrite the entire document on each delta
    // (browsers handle this efficiently for incremental HTML)
    iframe.contentDocument.open();
    iframe.contentDocument.write(content);
    iframe.contentDocument.close();
  }, [content]);

  return <iframe ref={iframeRef} sandbox="allow-scripts allow-same-origin" />;
}
```

### Important Notes

- `data-artifact-delta` events are ONLY emitted for `render-widget` and `deliver-content` tools
- Binary artifacts (presentation, pdf) do NOT stream — they go straight from loading → completed
- The `delta` field contains decoded content (JSON escapes already resolved by the backend)
- The `id` field matches between loading, delta, and completed events — use it to correlate
- If no delta events arrive (e.g., tool fails quickly), the frontend falls back to loading → failed

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
