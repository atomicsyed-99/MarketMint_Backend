# Artifact System — Implementation Approach

## Problem

MarketMint chat currently supports 2 artifact types: **markdown** (copyable text panel) and **html** (interactive HTML widgets). Users and product need support for **code**, **CSV**, **JSON**, and **presentations (PPTX)** — with download capability for all types.

## Goal

Expand artifacts to 6 kinds, all routed through the existing asset service, with a unified SSE event contract and per-kind frontend rendering.

| Kind | What | Example Use Case |
|------|------|-----------------|
| `markdown` | Long-form text, emails, blog posts | "Write me a welcome email sequence" |
| `code` | Source code with syntax highlighting | "Generate a Python script for data cleanup" |
| `json` | Structured data, configs | "Create an API response schema" |
| `csv` | Tabular data, exports | "Export my sales data as CSV" |
| `html` | Interactive HTML dashboards/charts | "Show me a revenue dashboard" (existing) |
| `presentation` | Downloadable PowerPoint (.pptx) | "Create a 10-slide pitch deck" |

---

## How It Works: Upload & Storage

### Service Architecture (Important)

There are **3 separate services** involved. Artifacts go to S3 and the Asset Service directly — **NOT through the Python pro-backend:**

```
marketmint-pro-cowork (this repo)
  │
  ├──→ S3 (direct upload via AWS SDK)
  │      uploadToS3() → file stored in S3 bucket
  │      refreshSignedUrl() → CDN URL returned
  │
  ├──→ Asset Manager Service (ASSETS_SERVICE_WEBHOOK_URL)
  │      POST /assets → registers asset record in generated_assets table
  │      This is a standalone service, NOT the Python pro-backend
  │
  └──→ Python pro-backend (CREDITS_BACKEND_BASE_URL) — NOT used for artifacts
         POST /credits/deduct-credits → only for image/video billing
         Skipped entirely for artifacts (credits deferred)
```

The Python pro-backend (`marketmint-pro-backend`) is also a **client** of the same Asset Manager Service — it calls the same `POST /assets` endpoint from its own `AssetManagerService` class. But our cowork TS backend calls the Asset Manager Service directly. No request goes through the Python backend for artifact storage.

Note: The TS function is named `notifyPythonStoreGeneratedAssets` — this name is legacy/misleading. It actually calls the **Asset Manager Service**, not the Python backend. The only Python backend call is for credit deduction, which is skipped for artifacts.

### End-to-End Flow

```
1. Tool generates content (code string / CSV string / PPTX buffer)
2. Upload file to S3 directly     (uploadToS3 via AWS SDK — no intermediary)
3. Get CDN URL                    (refreshSignedUrl — local URL construction)
4. Register in Asset Service      (POST to ASSETS_SERVICE_WEBHOOK_URL/assets)
5. Emit SSE event with CDN URL    (data-artifact — already handled by stream processor)
6. Frontend fetches content from CDN URL + renders preview + download button
```

### Asset Service Registration

Every artifact becomes a row in the `generated_assets` table (managed by the Asset Manager Service). Same table, same S3 bucket, same CDN as images/videos. The only difference is the `assetType` value:

| Asset | `assetType` | How subtype is stored |
|-------|-------------|----------------------|
| Generated images | `"image"` | N/A |
| Generated videos | `"video"` | N/A |
| **All artifacts** | **`"artifact"`** | **`chunkData.metadata.artifactKind`** = `"csv"` / `"presentation"` / `"code"` / `"json"` / `"html"` / `"markdown"` |

**Payload sent to Asset Manager Service (`POST /assets`):**
```json
{
  "assetType": "artifact",
  "assetId": "uuid",
  "mediaUrl": "https://cdn.marketmint.ai/artifacts/1711792800-a1b2c3d4/sales-report.csv",
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

### Code Changes Required

**One TypeScript change (this repo):**
- `call-python-assets-credits.ts` currently hardcodes `assetType: a.type === "video" ? "video" : "image"`. We change the asset type mapping to pass through validated types so `"artifact"` reaches the Asset Manager Service. Existing callers still pass `"image"` or `"video"` — their behavior is unchanged.
- The `AssetItem` type gets an optional `metadata` field for artifact subtypes.

**Zero Asset Manager Service changes required:**
- `asset_type` is a plain Text column — no enum, no migration, accepts `"artifact"` immediately
- The existing `assetType: "markdown-doc"` path in the Asset Manager Service (which uses `textContent` instead of `mediaUrl`) remains untouched. Our artifacts use `assetType: "artifact"` — a completely separate type that takes the `mediaUrl` path. No conflict.

**Zero Python pro-backend changes required:**
- The pro-backend is not involved in artifact storage
- Credit deduction (the only pro-backend call) is skipped for artifacts — `billingImageCount` is not set
- Verified by reading the Python backend source directly (`marketmint-pro-backend`)

### What Gets Uploaded

**Every artifact kind gets uploaded to S3 as a file** — including markdown and HTML, which were previously inline-only:

| Kind | File Uploaded | Extension | Why Upload |
|------|--------------|-----------|------------|
| `markdown` | Full markdown text | `.md` | Download, persistence |
| `code` | Source code | `.py`, `.ts`, `.sql`, etc. | Download, persistence |
| `json` | JSON data | `.json` | Download, persistence |
| `csv` | CSV data | `.csv` | Download, persistence |
| `html` | Widget HTML | `.html` | Download (new), persistence |
| `presentation` | PPTX binary | `.pptx` | Download, persistence |

### SSE Event: URL Only (No Redundant Inline Content)

The SSE `data-artifact` event carries the **CDN URL** — the frontend fetches the content from the URL when it needs to render. We do NOT send the content inline in the SSE event alongside the URL. That would be redundant data over the wire.

| Kind | SSE Event Contains | Frontend Renders From |
|------|-------------------|----------------------|
| `markdown` | `url`, `metadata` | Fetches `.md` from URL, renders markdown |
| `code` | `url`, `metadata.language` | Fetches code from URL, syntax-highlights |
| `json` | `url`, `metadata` | Fetches JSON from URL, renders tree/block |
| `csv` | `url`, `metadata.rowCount` | Fetches CSV from URL, renders table preview |
| `html` | `url` + `widget` (inline HTML) | Renders from `widget.widget_code` in iframe; URL is for download only |
| `presentation` | `url`, `metadata.slideCount` | Shows metadata card + download button |

**Exception — html:** The `widget.widget_code` stays inline because the iframe sandbox needs the HTML directly to render scripts. The S3 URL is for download only.

**Exception — short markdown (< 500 chars):** Uses the existing `data-markdown` inline event, not `data-artifact`. No upload — these are tiny snippets shown inline in chat.

### Error Fallback

If S3 upload fails for text-based artifacts, the tool falls back to emitting the content inline in the SSE event so the user still sees the content (no download button in this case). This is a graceful degradation, not the normal path.

---

## HTML Artifact Rules (Security & Scope)

The `html` artifact kind (formerly generative-ui) renders in a sandboxed iframe. It is powerful but must be constrained to prevent security issues and maintain app integrity.

### What HTML Artifacts CAN Do

- Dashboards and data visualizations (charts, KPI cards, metrics)
- Landing pages and marketing page previews
- Visual reports and document layouts
- Diagrams, flowcharts, and infographics
- Styled content with CSS animations
- Use allowed CDN libraries (Chart.js, D3, Mermaid, etc.)
- User-specified styles, themes, and visual treatments when explicitly requested

### What HTML Artifacts MUST NOT Do

| Prohibited | Why |
|-----------|-----|
| Input fields, textareas, select elements | No user data collection inside artifacts |
| Forms and submit buttons | No data submission from sandboxed content |
| Outbound network requests (fetch, XMLHttpRequest) | No external API calls from the iframe |
| Client storage access (localStorage, sessionStorage, cookies) | No client-side storage manipulation |
| Parent window access (window.open, window.parent, postMessage to parent) | No sandbox escape attempts |
| Dynamic code execution (eval, Function constructor) | No arbitrary code injection |
| External scripts outside CDN allowlist | Only allowed CDNs: cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, esm.sh |

### Guidelines Integration

- The agent MUST call `read_guidelines` before generating HTML artifacts (existing behavior)
- Guidelines provide the base design system, layout rules, and CDN allowlist
- If the user requests a specific style, theme, or visual treatment, the agent follows the user's direction while still respecting the security rules above
- User style preferences override the default design system — security rules never get overridden

---

## Presentation Generation

### Library: pptxgenjs

- Node.js library, zero dependencies, 1.6M weekly downloads
- Outputs `Buffer` directly uploadable to S3
- Supports images from URLs (CDN URLs work directly)
- Native charts (bar, line, pie, etc.)
- Standard 16:9 widescreen layout

**Slide layout types (5):**

| Layout | Use Case |
|--------|----------|
| `title` | Opening/closing slides (title + subtitle) |
| `content` | Bullet points + optional image |
| `image` | Full-bleed hero image + caption |
| `two-column` | Side-by-side content |
| `comparison` | Labeled two-column (vs., before/after) |

**Integration with image generation:**

The agent orchestrates multi-step: generate images via `direct_image_gen` at 16:9 first, then passes resulting CDN URLs to the presentation tool. The pptx-builder embeds images from URLs at build time.

**Why pptxgenjs (not python-pptx or HTML):**
- Runs natively in our Node.js/Mastra backend — no Python subprocess needed
- Produces real .pptx files editable in PowerPoint/Google Slides
- Claude.ai uses HTML artifacts (not real PPT) — users can't edit those in enterprise workflows
- Manus/ChatGPT use python-pptx but they have full VM sandboxes — we don't

---

## Skill: presentation-generator

A new skill (`skills_v2/presentation-generator/SKILL.md`) guides the agent through:

1. **Gather context** — topic, audience, purpose, slide count
2. **Plan outline** — present slide structure via `display_plan`, get user approval
3. **Generate images** — call `direct_image_gen` at 16:9 if slides need visuals
4. **Generate presentation** — call `generate_presentation` with structured slide data

**Content quality rules baked into the skill:**
- Slide titles: max 6 words
- Bullet points: max 15 words each, 3-5 per slide
- "Concrete, not meta" — every bullet must contain a specific fact/number/action
- Mix at least 3 layout types — not all bullet slides
- Narrative structure: 20% opening, 60% core, 20% closing

These rules address the #1 LLM presentation failure mode: verbose, generic, wall-of-text slides.

---

## SSE Event Contract (Unified)

All 6 artifact kinds use the same event shape:

```
type: "data-artifact"
data: {
  id: "artifact_abc123"
  kind: "code" | "csv" | "json" | "markdown" | "html" | "presentation"
  status: "loading" | "completed" | "failed"
  title: "Sales Report Q4"
  description: "Quarterly sales breakdown"
  url: "https://cdn.marketmint.ai/artifacts/..." (CDN URL — always present on completed)
  content: "..." (only for error fallback when S3 upload fails, or html widget)
  widget: { ... } (html only — inline HTML for iframe rendering)
  metadata: {
    filename: "sales-report.csv"
    mimeType: "text/csv"
    language: "python" (code only)
    slideCount: 10 (presentation only)
    rowCount: 150 (csv only)
  }
}
```

**Normal path:** `url` is present, `content` is absent. Frontend fetches from URL.
**Error fallback:** `url` is absent, `content` is present. Frontend renders inline (no download).
**html:** Both `url` (for download) and `widget` (for iframe rendering) are present.

**Backward compatibility:**
- Legacy artifacts (no `url`, only `content`) render inline-only — no download button
- Legacy html (no `url`, only `widget`) renders in iframe — unchanged
- Short markdown (< 500 chars) still uses `data-markdown` event for inline display

---

## Frontend Rendering (Per Kind)

| Kind | Viewer | Renders From | Download Via |
|------|--------|-------------|-------------|
| `markdown` | Rendered markdown | Fetch from `url` | `url` (.md) |
| `code` | Syntax-highlighted block | Fetch from `url`, use `metadata.language` for highlighting | `url` (.py/.ts/.sql etc.) |
| `json` | Formatted JSON tree / highlighted block | Fetch from `url` | `url` (.json) |
| `csv` | Table preview (first 50 rows, show `metadata.rowCount`) | Fetch from `url` | `url` (.csv) |
| `html` | Sandboxed iframe (existing) | `widget.widget_code` (inline — needed for iframe) | `url` (.html) — new |
| `presentation` | Metadata card + slide count badge | N/A (binary, no preview) | `url` (.pptx) |

All kinds show a download button via the `url` field.

---

## What Changes Where

### Backend (this repo — marketmint-pro-cowork)

| Area | Change | Risk |
|------|--------|------|
| Directory rename | `src/mastra/tools/generative-ui/` -> `src/mastra/tools/artifacts/` — all artifact tools under one roof | Low — update import paths, tool IDs unchanged |
| New types file | `src/types/artifacts.ts` — artifact kinds, metadata, event shape, constants | None — additive |
| New upload helper | `src/lib/artifact-upload.ts` — generate file, upload to S3, notify asset service | Low — wraps existing functions |
| Asset notification | `src/lib/call-python-assets-credits.ts` — pass `type` through instead of hardcoding `"image"` | Low — existing callers pass `"image"`/`"video"` unchanged |
| Deliver-content tool | Add `kind` param (code/json/csv/markdown), upload to S3, emit artifact with URL | Medium — evolves existing tool, backward compatible via optional param |
| Render-widget tool | After successful render, upload HTML to S3 (non-blocking) | Low — fire-and-forget, existing behavior unchanged |
| New pptx-builder | `src/lib/pptx-builder.ts` — 5 layout renderers, image embedding, 16:9 | None — new module |
| New presentation tool | `src/mastra/tools/html/generate-presentation.ts` — structured slide input, pptx-builder, S3 upload | None — new tool |
| New skill | `skills_v2/presentation-generator/SKILL.md` — presentation workflow guidance | None — new file |
| System prompt | Add artifact kind decision rules, reference presentation skill | Low — additive text |
| Stream processor | No changes — `"artifact"` already in KNOWN_EVENT_TYPES | None |

### Python Backend (marketmint-pro-backend)

**No changes required.** Verified:
- `asset_type` is a Text column (no enum/migration needed)
- No validation/whitelist on asset types
- No queries filter by asset_type
- Finisher agent credit counting only affects image/video (correct)

### Frontend (marketmint-ui — separate PR)

- Add per-kind artifact renderers (code highlighting, CSV table, JSON tree, PPT card)
- Add download button for all kinds when `url` is present
- Handle backward compatibility (legacy artifacts without `url`)
- Handle `data-markdown` event for short inline content (existing)

---

## Safeguards

| Risk | Mitigation |
|------|------------|
| S3 upload fails | Text artifacts fall back to inline-only delivery. Binary artifacts show "failed" status. |
| Image URL expired in PPT builder | `safeAddImage` helper catches errors, renders `[Image unavailable]` placeholder instead of crashing |
| Invalid JSON/CSV content | Validated before upload — `JSON.parse()` for JSON, header comma check for CSV |
| Filename collision (concurrent users) | UUID prefix in S3 path: `artifacts/{timestamp}-{uuid}/{filename}` |
| Asset service notification fails | Fire-and-forget with error logging — never blocks content delivery |
| LLM generates bad slide content | Skill enforces word limits, layout variety, and "concrete not meta" rules |

---

## Phased Rollout

| Phase | Tasks | Deliverable |
|-------|-------|-------------|
| **0. Rename** | Rename `generative-ui/` to `artifacts/`, update imports | Clean directory structure |
| **1. Foundation** | Artifact types, upload helper, asset service update | Infrastructure ready, no user-facing change |
| **2. Text Artifacts** | Evolve deliver-content (code/json/csv), upload HTML to S3 | 4 artifact kinds working with download |
| **3. Presentations** | Install pptxgenjs, build pptx-builder, create presentation tool + skill | PPTX generation working |
| **4. Agent + Frontend** | System prompt update (incl. HTML security rules), frontend renderer spec | Agent knows when to use each kind, frontend team can implement |

Each phase is independently shippable and testable.

---

## What This Does NOT Include

- Artifact sharing/publishing (deprioritized)
- Artifact credit deduction (to be added later)
- Brand color theming in presentations (future iteration)
- First-slide thumbnail generation for PPT preview (future iteration)
- Artifact versioning/editing (out of scope)
- Rename `generative-ui` skill to `html` (follow-up — the skill name in `skills_v2/` and system prompt still says `generative-ui` while the artifact kind is now `html`)

---

## References

| Document | What It Contains |
|----------|-----------------|
| [`2026-03-30-artifact-system.md`](./2026-03-30-artifact-system.md) | **Full implementation plan** — 13 tasks with exact code, file paths, tests, Zod schemas, and commit steps. Use this for execution. |
| [`skills_v2/presentation-generator/SKILL.md`](../../skills_v2/presentation-generator/SKILL.md) | **Presentation skill** — agent workflow guidance, content quality rules, slide layout reference, error recovery. Already created. |
| `src/types/artifacts.ts` (to be created) | Artifact kind types, metadata interfaces, SSE event shape, constants |
| `src/lib/artifact-upload.ts` (to be created) | Upload helper — S3 upload, CDN URL, asset service notification, validation |
| `src/lib/pptx-builder.ts` (to be created) | PPTX generation — 5 slide layouts, safe image embedding, 16:9 format |
| `docs/artifact-frontend-spec.md` (to be created) | Frontend renderer spec — per-kind rendering, download button, backward compat, event disambiguation |
