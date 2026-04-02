# Ad Video Generation Pipeline (MM POC v2)

AI-powered pipeline that generates professional ad videos from a text prompt and optional reference images. Includes two sub-projects:

1. **`ad_video_gen.py`** — CLI pipeline that plans, generates, and stitches ad videos end-to-end
2. **`ad-swipe-file/`** — Next.js web app for archiving, analyzing, and searching ad creatives

---

## 1. Video Generation Pipeline (`ad_video_gen.py`)

### How It Works

1. **Ad Director** (optional) — Analyzes the product/query and asks clarifying questions to refine the creative brief
2. **Storyboard Planning** — Gemini auto-classifies intent, selects templates (use case, style, subject, motion, camera, script framework), and generates a multi-scene storyboard with narration
3. **Character Portrait** — Generates a consistent model reference portrait (or uses a provided `--model-image`)
4. **Keyframe Generation** — NanoBanana 2 (Gemini 3.1 Flash Image) generates per-scene keyframe images with subject consistency and pose-aware starting frames
5. **Video Generation** — Per-scene videos via selectable backend (see pipelines below)
6. **Stitching** — Scene clips are assembled into a final video with optional background music

Each run is stored in `runs/run_NNN/` to preserve history.

### Video Generation Pipelines

The pipeline auto-selects between three video generation strategies based on the `commercial_format` field set by the storyboard planner:

#### Lifestyle Pipeline (`commercial_format: lifestyle`)

Used for polished product ads, cinematic commercials, and brand content.

- Generates **one keyframe per scene** via NanoBanana 2
- GPT describes each keyframe image (vision) and refines scene descriptions + template hints into optimized video prompts
- Per-scene **image-to-video** generation — each scene independently rendered from its keyframe
- Supports all video backends: Veo 3.1 Fast, Veo 3.1 Standard, and Grok Imagine Video
- Uses video template hints (motion type, camera technique, style) unless `--no-grok-skills` is set

#### UGC Pipeline (`commercial_format: ugc`)

Used for UGC-style content — talking head, unboxing, testimonial, before/after formats.

- Generates **only one keyframe** (scene 1) — the rest are produced via video extension
- GPT describes the keyframe and refines narration segments into Veo-optimized prompts
- Scene 1 is generated as image-to-video, then **Veo 3.1 extension chaining** continues each subsequent scene from the end of the previous clip
- This produces natural temporal continuity (no jump cuts between scenes)
- Always uses **Veo 3.1 Fast** regardless of `--video-model` flag
- Scene durations default to [6, 8, 8] seconds and are snapped to nearest valid Veo duration (4, 6, 8)

#### Legacy Pipeline (fallback)

Per-scene independent video generation using raw template-based prompts. Used when the format doesn't match UGC or lifestyle.

### Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) package manager
- API keys set in `.env` (inside `nanobana2-engineer-package (4)/` or project root):
  - `GOOGLE_API_KEY` — for Gemini (storyboard planning + image gen) and Veo (video gen)
  - `OPENAI_API_KEY` — for GPT-based structured calls (storyboard refinement, video prompt optimization)
  - `XAI_API_KEY` — only if using `--video-model grok`
- `ffmpeg` installed (used by video stitcher)

### Usage

All commands are run via `uv` from this directory:

```bash
# Basic: generate a full ad video from a text prompt
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  -q "Create a luxury ad for a gold watch"

# With reference images
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  -q "Make a product ad for this kurti for the Pongal sale" \
  -i asset_image/kurti.jpg

# With a model/character reference image
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  -q "Fashion ad for ethnic wear" \
  -i asset_image/kurti.jpg \
  --model-image asset_image/model.png

# Vertical video (9:16) for Reels/Shorts
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  -q "UGC-style kurti unboxing" \
  -i asset_image/kurti.jpg \
  --aspect-ratio 9:16

# Use Grok video backend with spicy motion
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  -q "Cinematic reveal for headphones" \
  -f 5 -d 15 --video-model grok --mode spicy

# High-resolution Veo Standard
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  -q "Premium watch commercial" \
  --video-model veo-standard --resolution 1080p

# Storyboard only (no image/video generation) — useful for previewing the plan
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  -q "Summer fashion collection launch" \
  --storyboard-only

# Images only (storyboard + keyframes, skip video)
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  -q "Minimalist product showcase" \
  --images-only

# Resume video generation from an existing run (reuses storyboard + keyframes)
uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py \
  --resume-run 34 --video-model grok --resolution 720p --aspect-ratio 9:16
```

### CLI Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--query` | `-q` | *(required)* | Ad request prompt. Not required with `--resume-run`. |
| `--images` | `-i` | none | Reference image paths (product photos, style refs) |
| `--model-image` | | none | Model/character reference image (skips synthetic portrait) |
| `--frames` | `-f` | 5 | Number of storyboard scenes (1-7) |
| `--duration` | `-d` | 30 | Total video duration in seconds (1-60) |
| `--aspect-ratio` | `-a` | 16:9 | Video aspect ratio |
| `--resolution` | `-r` | 720p | Video resolution: 480p, 720p, 1080p, 4k |
| `--video-model` | | veo | Backend: `veo` (fast), `veo-standard`, `grok` |
| `--mode` | `-m` | normal | Grok motion intensity: fun, normal, spicy |
| `--output` | `-o` | `{run_dir}/final.mp4` | Output video path |
| `--output-dir` | | `runs/run_NNN/` | Custom run output directory |
| `--chain-keyframes` | | off | Reuse previous keyframe as style reference for next scene |
| `--music-file` | | auto | Custom background music file path |
| `--music-volume` | | -12 | Music volume in dB relative to narration |
| `--no-music` | | false | Skip background music overlay |
| `--no-director` | | false | Skip Ad Director (no clarifying questions) |
| `--no-grok-skills` | | false | Disable video template hints (raw prompts only) |
| `--skip-enhance` | | false | Skip prompt enhancement (use raw query) |
| `--storyboard-only` | | false | Only plan storyboard, skip generation |
| `--images-only` | | false | Generate storyboard + keyframes, skip video |
| `--resume-run` | | none | Resume from existing run dir or number (e.g. `34` or `runs/run_034`) |

### Run Output Structure

Each run produces:

```
runs/run_NNN/
  storyboard.json        # Full storyboard with scene prompts, narration, templates
  director_brief.json    # Ad Director analysis and recommendations
  cost_estimate.json     # Estimated API costs for the run
  character_portrait.png # Generated character reference (if no --model-image)
  reference_images/      # Copies of input reference images
  keyframes/             # Generated per-scene keyframe images
    scene_01.png
    scene_02.png
    ...
  scene_videos/          # Generated per-scene video clips
    scene_01.mp4
    scene_02.mp4
    ...
  final.mp4              # Stitched final ad video
```

---

## 2. Ad Swipe File (`ad-swipe-file/`)

A Next.js web app that serves as a searchable ad creative library and analysis tool. It lets you archive, organize, tag, and semantically search ad creatives (images and videos) with AI-powered analysis.

### Features

- **Creative Library** — Store and browse ad creatives in a grid view with filtering
- **AI Analysis** — Each creative is auto-analyzed by Gemini 2.5 Flash for layout, imagery, headlines, offers, hooks, target audience, emotional appeal, platform fit, and CTA
- **Semantic Search** — Search via natural language using vector embeddings (weighted: 60% visual, 40% text)
- **Metadata Tagging** — Filter by platform (Meta, TikTok, YouTube, Google, Snapchat), format (static, carousel, video, story, reel, UGC), hook angle (problem/solution, testimonial, before/after, curiosity, urgency, social proof), and CTA
- **Batch Import** — Sync and analyze images from a source directory with duplicate detection (SHA256)
- **Manual Upload** — Drag-and-drop single creative uploader with metadata form

### Pages

| Route | Description |
|-------|-------------|
| `/search` | Main dashboard — grid of creatives with filtering, search, and detail panel |
| `/import` | Single creative uploader with drag-and-drop and metadata form |
| `/ad/[id]` | Detailed ad view — edit metadata, view full AI analysis, see embedding status |

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
cd ad-swipe-file

# Install dependencies
npm install

# Create .env.local with required keys
cat > .env.local << 'EOF'
GEMINI_API_KEY=your_gemini_api_key_here
IMPORT_SOURCE_DIR=/path/to/your/source/images
EOF

# Run development server
npm run dev
```

Open http://localhost:3000 to access the app.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key — used for creative analysis and embedding generation |
| `IMPORT_SOURCE_DIR` | Path to folder containing ad creatives to import (PNG, JPG, WEBP, MP4, MOV) |

### How It Works

1. **Import** — Click "Sync & Analyze" on the search page (or upload via `/import`)
2. **Scanning** — Lists all supported files from `IMPORT_SOURCE_DIR`
3. **Deduplication** — SHA256 hashing prevents duplicate creatives
4. **Asset Storage** — New files are copied to `data/assets/` with the hash as filename
5. **AI Analysis** — Gemini 2.5 Flash analyzes each creative (layout, imagery, headlines, hooks, audience, etc.)
6. **Embedding Generation** — Two vectors per creative: visual embedding from image, text embedding from analysis
7. **Search** — Natural language queries are embedded and scored via weighted cosine similarity against all indexed creatives

### Data Storage

```
ad-swipe-file/data/
  swipefile.db    # SQLite database (WAL mode)
  assets/         # Stored creatives by SHA256 hash
```

---

## Project Structure (Source Files)

```
MM_POC_v2_video_gen/
  ad_video_gen.py          # Main entry point / CLI
  storyboard_planner.py    # LLM-based storyboard + Ad Director
  scene_video_generator.py # Per-scene video generation (lifestyle, UGC, legacy pipelines)
  video_client.py          # Video backend router (Grok / Veo)
  grok_video_client.py     # xAI Grok Imagine Video client
  veo_video_client.py      # Google Veo 3.1 client
  video_stitcher.py        # ffmpeg-based video assembly
  cost_tracker.py          # API cost estimation
  prompt_safety.py         # Input sanitization and validation
  openai_client.py         # OpenAI/GPT structured call wrapper
  script_skill_loader.py   # YAML skill/template loader
  prompt_templates/        # Image + video generation YAML templates
  ad_script_skills/        # Ad script framework YAML definitions
  nanobana2-engineer-package (4)/  # NanoBanana 2 image generation package
  ad-swipe-file/           # Next.js ad creative library & analysis tool
  Template_images/         # Source images for ad swipe file import
  Veo_prompting_guide.md   # Veo prompt reference
  Grok_imagine_prompting_guide.md  # Grok Imagine prompt reference
```
