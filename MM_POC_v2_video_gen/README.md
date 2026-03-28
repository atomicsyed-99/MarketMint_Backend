# Ad Video Generation Pipeline (MM POC v2)

AI-powered pipeline that generates professional ad videos from a text prompt and optional reference images.

## How It Works

1. **Ad Director** (optional) — Analyzes the product/query and asks clarifying questions to refine the creative brief
2. **Storyboard Planning** — LLM (Gemini) auto-classifies intent, selects templates (use case, style, subject, motion, camera, script framework), and generates a multi-scene storyboard with narration
3. **Keyframe Generation** — NanoBanana 2 (Gemini 3.1 Flash Image) generates per-scene keyframe images with subject consistency and pose-aware starting frames
4. **Video Generation** — Per-scene videos via selectable backend:
   - **Google Veo 3.1 Fast** (default) or **Veo 3.1 Standard**
   - **xAI Grok Imagine Video**
5. **Stitching** — Scene clips are assembled into a final video with optional background music

Each run is stored in `runs/run_NNN/` to preserve history.

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) package manager
- API keys set in `.env` (inside `nanobana2-engineer-package (4)/` or project root):
  - `GOOGLE_API_KEY` — for Gemini (storyboard planning + image gen) and Veo (video gen)
  - `OPENAI_API_KEY` — for GPT-based structured calls (storyboard refinement)
  - `XAI_API_KEY` — only if using `--video-model grok`
- `ffmpeg` installed (used by video stitcher)

## Usage

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

## CLI Options

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

## Run Output Structure

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

## Project Structure (Source Files)

```
MM_POC_v2_video_gen/
  ad_video_gen.py          # Main entry point / CLI
  storyboard_planner.py    # LLM-based storyboard + Ad Director
  scene_video_generator.py # Per-scene video generation orchestration
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
  Veo_prompting_guide.md   # Veo prompt reference
```
