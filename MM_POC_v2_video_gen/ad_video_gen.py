#!/usr/bin/env python3
"""
Ad Video Generation Pipeline
=============================
Generates professional ad videos by:
1. Planning a storyboard with LLM (Gemini) — auto-classifies intent, enhances prompts,
   and generates micro-action choreography for realistic human motion
2. Generating keyframe images via NanoBanana 2 (Gemini 3.1 Flash Image)
   with subject consistency (previous keyframe fed as style reference)
   and pose-aware starting frames matched to the motion plan
3. Generating per-scene videos via selectable backend:
   - Google Veo 3.1 Fast (default) or Veo 3.1 Standard
   - xAI Grok Imagine Video

Each run is stored in runs/run_NNN/ to preserve history.

Run via uv from the nanobana2-engineer-package (4)/ venv:
    uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py --query "Create a luxury ad for a gold watch"
    uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py --query "Make a product ad" --images watch.jpg --video-model veo
    uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py -q "Cinematic reveal for headphones" -f 5 -d 15 --video-model grok --mode spicy
    uv run --project "nanobana2-engineer-package (4)" python ad_video_gen.py -q "Fashion ad" --video-model veo-standard --resolution 1080p
"""

import argparse
import json
import os
import re
import shutil
import sys
import time

# Add NanoBanana 2 source to path for src.* imports
_NB2_ROOT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "nanobana2-engineer-package (4)"
)
sys.path.insert(0, _NB2_ROOT)

from dotenv import load_dotenv
from PIL import Image as PILImage

from prompt_safety import (
    normalize_aspect_ratio,
    sanitize_generation_prompt,
    validate_video_aspect_ratio,
)
from storyboard_planner import StoryboardPlanner, AdDirector
from scene_video_generator import generate_all_scene_videos, generate_ugc_video_chain
from video_stitcher import assemble_final
from cost_tracker import estimate_run_cost, print_cost_summary, save_cost_json


# ---------------------------------------------------------------------------
# Run versioning
# ---------------------------------------------------------------------------


def _resolve_run_dir(output_dir_override: str | None) -> tuple[str, int]:
    """Resolve the run directory, auto-incrementing if no override provided.

    Returns:
        (run_dir_path, run_number)
    """
    if output_dir_override is not None:
        # Explicit --output-dir: use as-is, no versioning
        os.makedirs(output_dir_override, exist_ok=True)
        return output_dir_override, 0

    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")
    os.makedirs(base, exist_ok=True)

    # Find highest existing run number
    max_num = 0
    for name in os.listdir(base):
        m = re.match(r"^run_(\d+)$", name)
        if m:
            max_num = max(max_num, int(m.group(1)))

    run_num = max_num + 1
    run_dir = os.path.join(base, f"run_{run_num:03d}")
    os.makedirs(run_dir, exist_ok=True)
    return run_dir, run_num


# ---------------------------------------------------------------------------
# Template announcement banner
# ---------------------------------------------------------------------------


def _print_template_banner(planner, storyboard):
    """Print a detailed banner showing all matched templates."""
    catalog = planner.catalog
    W = 62

    print("\n" + "=" * W)
    print("  MATCHED TEMPLATES")
    print("=" * W)

    # NanoBanana image templates
    uc = catalog.get("use_cases", {}).get(storyboard.use_case, {})
    st = catalog.get("styles", {}).get(storyboard.style, {})
    su = catalog.get("subjects", {}).get(storyboard.subject, {})

    if uc:
        print(f"\n  Use Case: {uc.get('label', storyboard.use_case)}")
        if uc.get("structure"):
            print(f"    Structure:   {uc['structure'][:70]}...")
        if uc.get("camera_hint"):
            print(f"    Camera:      {uc['camera_hint']}")
        if uc.get("lighting_hint"):
            print(f"    Lighting:    {uc['lighting_hint']}")

    if st:
        print(f"\n  Style: {st.get('label', storyboard.style)}")
        if st.get("directives"):
            print(f"    Directives:  {st['directives'][:70]}...")
        if st.get("camera_defaults"):
            print(f"    Camera:      {st['camera_defaults']}")

    if su:
        print(f"\n  Subject: {su.get('label', storyboard.subject)}")
        if su.get("framing_hint"):
            print(f"    Framing:     {su['framing_hint']}")
        if su.get("focus_hint"):
            print(f"    Focus:       {su['focus_hint']}")

    # Grok video templates
    vmt = catalog.get("video_motion_types", {}).get(storyboard.video_motion_type, {})
    vcam = catalog.get("video_camera", {}).get(storyboard.video_camera_technique, {})
    vst = catalog.get("video_styles", {}).get(storyboard.video_style, {})

    if vmt or vcam or vst:
        print(f"\n  --- Video Templates ---")
    if vmt:
        print(
            f"  Motion:  {vmt.get('label', storyboard.video_motion_type)} — {vmt.get('motion_hint', '')[:60]}..."
        )
    if vcam:
        print(
            f"  Camera:  {vcam.get('label', storyboard.video_camera_technique)} — {vcam.get('technique_hint', '')[:60]}..."
        )
    if vst:
        print(
            f"  Style:   {vst.get('label', storyboard.video_style)} — {vst.get('style_hint', '')[:60]}..."
        )

    # Script skills
    print(f"\n  --- Script Skills ---")
    print(f"  Framework: {storyboard.script_framework}")
    print(f"  Format:    {storyboard.commercial_format}")
    print(f"  Trigger:   {storyboard.emotional_trigger}")
    print(f"  Domain:    {storyboard.domain}")

    # Per-scene video hints (when director is active)
    has_per_scene = any(s.video_motion_type for s in storyboard.scenes)
    if has_per_scene:
        print(f"\n  --- Per-Scene Video Hints ---")
        for s in storyboard.scenes:
            label = f"Scene {s.scene_number}"
            if s.scene_type:
                label += f" ({s.scene_type})"
            if s.video_motion_type:
                print(
                    f"  {label}: motion={s.video_motion_type}, "
                    f"camera={s.video_camera_technique}, style={s.video_style}"
                )

    # Subject identity + outfit
    if storyboard.subject_identity:
        print(f"\n  --- Subject Lock ---")
        print(
            f"  Identity: {storyboard.subject_identity[:120]}{'...' if len(storyboard.subject_identity) > 120 else ''}"
        )
    if storyboard.subject_outfit:
        print(
            f"  Outfit:   {storyboard.subject_outfit[:120]}{'...' if len(storyboard.subject_outfit) > 120 else ''}"
        )

    print("=" * W)


# ---------------------------------------------------------------------------
# Image loading and keyframe generation
# ---------------------------------------------------------------------------


def _load_images(image_paths: list[str]) -> list[PILImage.Image]:
    """Load image files into PIL Images, skipping any that fail."""
    images = []
    for path in image_paths:
        try:
            img = PILImage.open(path).convert("RGB")
            images.append(img)
            print(f"  Loaded: {path} ({img.size[0]}x{img.size[1]})")
        except Exception as e:
            print(f"  Warning: Failed to load {path}: {e}")
    return images


def _generate_keyframe(
    scene_prompt: str,
    uploaded_images: list[PILImage.Image],
    output_path: str,
    scene_number: int,
    aspect_ratio: str = "16:9",
    previous_keyframe_path: str | None = None,
    save_pinterest_dir: str | None = None,
    character_image: PILImage.Image | None = None,
    disable_pinterest: bool = False,
) -> str | None:
    """Generate a single keyframe image using NanoBanana 2 pipeline.

    Args:
        previous_keyframe_path: If provided, the previous scene's keyframe is
            passed as an extra style reference. This is opt-in because it can
            amplify AI artifacts and asset drift across scenes.
        save_pinterest_dir: If provided, any Pinterest reference image scraped
            during generation will be saved to this directory.
        character_image: If provided, passed as the character reference to
            anchor the model's appearance across all scenes.
        disable_pinterest: If True, skip Pinterest style reference scraping.
    """
    from src.pipeline import PromptCompiler
    from src.llm_router import LLMRouter

    compiler = PromptCompiler(LLMRouter())

    # Anti-collage directive: keyframes for video must be single continuous images
    anti_collage = (
        "CRITICAL: Generate a single continuous photograph for this scene. "
        "Do NOT create a collage, grid, multi-panel layout, split image, or montage. "
        "The output must be ONE seamless image depicting ONE moment in time. "
        "Keep the background visible and readable; do not blur it into strong portrait bokeh. "
    )
    asset_preservation = ""
    if uploaded_images:
        asset_preservation = (
            "ASSET PRESERVATION: Treat the attached subject/product reference image as authoritative. "
            "Retain the exact asset shape, color, proportions, materials, construction details, pattern placement, "
            "and branding visible in the reference. Do not redesign, simplify, embellish, or substitute the asset. "
        )
    scene_prompt = sanitize_generation_prompt(
        anti_collage + asset_preservation + scene_prompt,
        aspect_ratio,
    )

    print(f"\n  [Scene {scene_number}] Generating keyframe...")
    print(f"    Prompt: {scene_prompt[:100]}{'...' if len(scene_prompt) > 100 else ''}")

    # Load previous keyframe as style reference for consistency
    extra_styles = []
    if previous_keyframe_path:
        try:
            prev_img = PILImage.open(previous_keyframe_path).convert("RGB")
            extra_styles.append(prev_img)
            print(f"    Chaining from: {os.path.basename(previous_keyframe_path)}")
        except Exception as e:
            print(f"    Warning: Could not load previous keyframe: {e}")

    result = compiler.generate(
        user_query=scene_prompt,
        uploaded_images=uploaded_images if uploaded_images else None,
        output_path=output_path,
        extra_style_images=extra_styles if extra_styles else None,
        aspect_ratio=aspect_ratio,
        save_pinterest_dir=save_pinterest_dir,
        disable_pinterest=disable_pinterest,
        character_image=character_image,
    )

    status = result.get("status", "")
    if "success" in status:
        img_path = result.get("image_path", output_path)
        gen_time = result.get("generation_time_ms", 0)
        print(f"    Saved: {img_path} ({gen_time}ms)")
        if result.get("pinterest_save_path"):
            print(f"    Pinterest ref: {result['pinterest_save_path']}")
        return img_path
    else:
        print(f"    Failed: {status}")
        return None


def _generate_character_portrait(
    subject_identity: str,
    output_path: str,
    aspect_ratio: str = "9:16",
) -> PILImage.Image | None:
    """Generate a standalone character portrait from the subject identity description.

    This portrait is used as a character reference image for all scene keyframes
    to ensure consistent model appearance (ethnicity, face, hair, skin tone).
    """
    from src.image_generator import NanoBananaGenerator

    portrait_prompt = (
        "CRITICAL: Generate a single clean portrait photograph of this person. "
        "No collage, no grid, no text overlays. "
        f"Portrait of {subject_identity}. "
        "Clean, well-lit headshot to mid-body portrait against a simple neutral background. "
        "Natural pose, soft even lighting, sharp focus on the face. "
        "This is a character reference photo — prioritize accurate and clear facial features, "
        "skin tone, hair, and expression over artistic style."
    )

    print(f"\n  [Character Portrait] Generating model reference...")
    print(
        f"    Identity: {subject_identity[:100]}{'...' if len(subject_identity) > 100 else ''}"
    )

    generator = NanoBananaGenerator()
    result = generator.generate_image(
        final_prompt=portrait_prompt,
        subject_images=[],
        style_images=[],
        user_character_image=None,
        scene_image=None,
        seed=7,
        output_path=output_path,
        aspect_ratio=aspect_ratio,
    )

    status = result.get("status", "")
    if "success" in status:
        gen_time = result.get("generation_time_ms", 0)
        print(f"    Saved: {output_path} ({gen_time}ms)")
        try:
            return PILImage.open(output_path).convert("RGB")
        except Exception as e:
            print(f"    Warning: Could not reload portrait: {e}")
            return None
    else:
        print(f"    Failed: {status}")
        return None


# ---------------------------------------------------------------------------
# Resume helper — regenerate videos from an existing run's keyframes
# ---------------------------------------------------------------------------


def _resolve_resume_dir(resume_arg: str) -> str:
    """Resolve --resume-run value to an absolute run directory path."""
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runs")
    # Numeric shorthand: "12" -> runs/run_012
    if resume_arg.isdigit():
        return os.path.join(base, f"run_{int(resume_arg):03d}")
    # Relative path like "runs/run_012"
    if not os.path.isabs(resume_arg):
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), resume_arg)
    return resume_arg


def _resume_videos_from_run(args) -> None:
    """Load storyboard + keyframes from an existing run and regenerate videos."""
    from storyboard_planner import Storyboard

    run_dir = _resolve_resume_dir(args.resume_run)
    storyboard_path = os.path.join(run_dir, "storyboard.json")
    keyframe_dir = os.path.join(run_dir, "keyframes")
    scene_video_dir = os.path.join(run_dir, "scene_videos")
    output_path = args.output or os.path.join(run_dir, "final.mp4")

    if not os.path.exists(storyboard_path):
        print(f"Error: No storyboard.json found in {run_dir}")
        sys.exit(1)
    if not os.path.isdir(keyframe_dir):
        print(f"Error: No keyframes/ directory found in {run_dir}")
        sys.exit(1)

    with open(storyboard_path, encoding="utf-8") as f:
        storyboard = Storyboard.model_validate_json(f.read())

    keyframe_paths = sorted(
        [
            os.path.join(keyframe_dir, fn)
            for fn in os.listdir(keyframe_dir)
            if fn.endswith(".png")
        ]
    )

    video_model_label = {
        "grok": "Grok Imagine Video (xAI)",
        "veo": "Veo 3.1 Fast (Google)",
        "veo-standard": "Veo 3.1 Standard (Google)",
    }.get(args.video_model, args.video_model)

    print("=" * 62)
    print("  Ad Video Generation Pipeline  [RESUME]")
    print(f"  Run dir:    {run_dir}/")
    print("=" * 62)
    print(f"  Storyboard: {len(storyboard.scenes)} scenes loaded")
    print(f"  Keyframes:  {len(keyframe_paths)} images found")
    print(f"  Resolution: {args.resolution}")
    print(f"  Video:      {video_model_label}")
    print(f"  Aspect:     {args.aspect_ratio}")
    print(f"  Output:     {output_path}")
    print("=" * 62)

    if not keyframe_paths:
        print("Error: No keyframe images found in keyframes/")
        sys.exit(1)

    pipeline_start = time.time()

    # Step 4: Generate videos
    if storyboard.commercial_format == "ugc":
        print(f"\n[Step 4/6] Generating UGC extension chain with Veo 3.1 Fast...")
        scene_video_paths = generate_ugc_video_chain(
            storyboard=storyboard,
            keyframe_path=keyframe_paths[0],
            output_dir=scene_video_dir,
            aspect_ratio=args.aspect_ratio,
            resolution=args.resolution,
        )
    else:
        print(f"\n[Step 4/6] Generating per-scene videos with {video_model_label}...")
        scene_video_paths = generate_all_scene_videos(
            storyboard=storyboard,
            keyframe_paths=keyframe_paths,
            output_dir=scene_video_dir,
            aspect_ratio=args.aspect_ratio,
            resolution=args.resolution,
            mode=args.mode,
            disable_video_hints=args.no_grok_skills,
            video_model=args.video_model,
        )

    if not scene_video_paths:
        print("\nError: No scene videos were generated.")
        sys.exit(1)

    # Update storyboard with video prompts
    with open(storyboard_path, "w", encoding="utf-8") as f:
        f.write(storyboard.model_dump_json(indent=2))

    # Step 5: Stitch
    print(f"\n[Step 5/6] Assembling final video...")
    music_path = args.music_file if not args.no_music else None
    music_direction = storyboard.music_direction if not args.no_music else ""

    final_path = assemble_final(
        video_paths=scene_video_paths,
        output_path=output_path,
        music_path=music_path,
        music_direction=music_direction,
        music_volume_db=args.music_volume,
    )

    total_time = time.time() - pipeline_start
    print("\n" + "=" * 62)
    print("  Resume Complete")
    print("=" * 62)
    if os.path.exists(final_path):
        size_mb = os.path.getsize(final_path) / (1024 * 1024)
        print(f"  Video:       {final_path} ({size_mb:.1f} MB)")
    else:
        print(f"  Video:       FAILED — output not found")
    print(f"  Scene clips: {scene_video_dir}/ ({len(scene_video_paths)} videos)")
    print(f"  Total time:  {total_time:.1f}s")
    print("=" * 62)

    scene_durations = [max(1, min(15, int(s.duration_hint))) for s in storyboard.scenes]
    costs = estimate_run_cost(
        num_scenes=len(storyboard.scenes),
        scene_durations=scene_durations,
        video_model=args.video_model,
        resolution=args.resolution,
        used_director=False,
    )
    print_cost_summary(costs, video_model=args.video_model)
    save_cost_json(costs, run_dir)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Generate ad videos using NanoBanana 2 images + Grok/Veo video generation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--query",
        "-q",
        required=False,
        default=None,
        help="Ad request (e.g. 'Create a luxury ad for a gold watch'). "
        "Not required when using --resume-run.",
    )
    parser.add_argument(
        "--images",
        "-i",
        nargs="*",
        default=[],
        help="Reference image paths (product photos, style references, etc.)",
    )
    parser.add_argument(
        "--model-image",
        default=None,
        help="Path to a model/character reference image. When provided, this is used as the person reference and no synthetic character portrait is generated.",
    )
    parser.add_argument(
        "--chain-keyframes",
        action="store_true",
        help="Reuse the previous generated keyframe as a style reference for the next scene (disabled by default)",
    )
    parser.add_argument(
        "--duration",
        "-d",
        type=int,
        default=30,
        help="Total video duration in seconds (1-60, default: 30)",
    )
    parser.add_argument(
        "--aspect-ratio",
        "-a",
        default="16:9",
        help="Video aspect ratio (default: 16:9)",
    )
    parser.add_argument(
        "--resolution",
        "-r",
        default="720p",
        choices=["480p", "720p", "1080p", "4k"],
        help="Video resolution (default: 720p). Grok supports 480p/720p. Veo supports 720p/1080p/4k.",
    )
    parser.add_argument(
        "--mode",
        "-m",
        default="normal",
        choices=["fun", "normal", "spicy"],
        help="Grok motion intensity (default: normal)",
    )
    parser.add_argument(
        "--frames",
        "-f",
        type=int,
        default=5,
        help="Number of storyboard frames/scenes (1-7, default: 5)",
    )
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="Output video path (default: {run_dir}/final.mp4)",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory for run output (default: auto-versioned runs/run_NNN/)",
    )
    parser.add_argument(
        "--skip-enhance",
        action="store_true",
        help="Skip prompt enhancement (use raw query for all scenes)",
    )
    parser.add_argument(
        "--storyboard-only",
        action="store_true",
        help="Only plan the storyboard, don't generate images or video",
    )
    parser.add_argument(
        "--images-only",
        action="store_true",
        help="Generate storyboard + keyframe images, but skip video generation",
    )
    parser.add_argument(
        "--music-file",
        default=None,
        help="Path to a custom background music file (overrides auto-select)",
    )
    parser.add_argument(
        "--music-volume",
        type=float,
        default=-12,
        help="Background music volume in dB relative to narration (default: -12)",
    )
    parser.add_argument(
        "--no-music", action="store_true", help="Skip background music overlay"
    )
    parser.add_argument(
        "--no-director",
        action="store_true",
        help="Skip the Ad Director step (no clarifying questions, auto-classify everything)",
    )
    parser.add_argument(
        "--no-grok-skills",
        action="store_true",
        help="Disable video template hints (motion, camera, style) — raw prompts only",
    )
    parser.add_argument(
        "--video-model",
        default="veo",
        choices=["grok", "veo", "veo-standard"],
        help="Video generation backend: 'grok' (xAI Grok Imagine Video), "
        "'veo' (Google Veo 3.1 Fast, default), 'veo-standard' (Google Veo 3.1 Standard)",
    )
    parser.add_argument(
        "--resume-run",
        default=None,
        help="Resume video generation from an existing run directory or run number "
        "(e.g. 'runs/run_012' or '12'). Loads storyboard.json + keyframes, "
        "skips planning and image generation. Use with --resolution/--video-model to change settings.",
    )

    args = parser.parse_args()

    # Validate: --query is required unless --resume-run is set
    if not args.resume_run and not args.query:
        parser.error("--query / -q is required unless --resume-run is specified")

    # Load environment
    env_path = os.path.join(_NB2_ROOT, ".env")
    load_dotenv(env_path)

    local_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(local_env):
        load_dotenv(local_env, override=True)

    duration = max(1, min(60, args.duration))
    num_frames = max(1, min(7, args.frames))
    args.aspect_ratio = normalize_aspect_ratio(args.aspect_ratio)

    try:
        validate_video_aspect_ratio(args.video_model, args.aspect_ratio)
    except ValueError as e:
        parser.error(str(e))

    # ---------------------------------------------------------------
    # --resume-run: jump straight to video generation
    # ---------------------------------------------------------------
    if args.resume_run:
        _resume_videos_from_run(args)
        return

    # ---------------------------------------------------------------
    # Resolve run directory
    # ---------------------------------------------------------------
    run_dir, run_num = _resolve_run_dir(args.output_dir)
    keyframe_dir = os.path.join(run_dir, "keyframes")
    scene_video_dir = os.path.join(run_dir, "scene_videos")
    os.makedirs(keyframe_dir, exist_ok=True)

    output_path = args.output or os.path.join(run_dir, "final.mp4")

    print("=" * 62)
    print("  Ad Video Generation Pipeline")
    if run_num:
        print(f"  Run #{run_num:03d} -> {run_dir}/")
    print("=" * 62)
    video_model_label = {
        "grok": "Grok Imagine Video (xAI)",
        "veo": "Veo 3.1 Fast (Google)",
        "veo-standard": "Veo 3.1 Standard (Google)",
    }.get(args.video_model, args.video_model)

    print(f"  Query:      {args.query}")
    print(f"  Frames:     {num_frames}")
    print(f"  Duration:   {duration}s")
    print(f"  Resolution: {args.resolution}")
    print(f"  Aspect:     {args.aspect_ratio}")
    print(f"  Video:      {video_model_label}")
    print(f"  Mode:       {args.mode}")
    print(f"  Output:     {run_dir}/")
    if args.images:
        print(f"  Images:     {len(args.images)}")
    if args.model_image:
        print("  Model ref:  provided")
    print(f"  Chain KFs:  {'on' if args.chain_keyframes else 'off'}")
    print("=" * 62)

    pipeline_start = time.time()

    # ---------------------------------------------------------------
    # Step 1: Load reference images + copy to run dir
    # ---------------------------------------------------------------
    uploaded_images = []
    model_image = None
    if args.images:
        print("\n[Step 1/6] Loading reference images...")
        uploaded_images = _load_images(args.images)
        # Save copies of reference images in the run directory
        ref_dir = os.path.join(run_dir, "reference_images")
        os.makedirs(ref_dir, exist_ok=True)
        for img_path in args.images:
            if os.path.exists(img_path):
                dest = os.path.join(ref_dir, os.path.basename(img_path))
                try:
                    shutil.copy2(img_path, dest)
                except Exception:
                    pass
    else:
        print("\n[Step 1/6] No reference images provided (text-only mode)")

    if args.model_image:
        print("\n[Step 1.1/6] Loading model reference image...")
        model_images = _load_images([args.model_image])
        if model_images:
            model_image = model_images[0]
            model_ref_dir = os.path.join(run_dir, "reference_images")
            os.makedirs(model_ref_dir, exist_ok=True)
            try:
                shutil.copy2(
                    args.model_image,
                    os.path.join(model_ref_dir, os.path.basename(args.model_image)),
                )
            except Exception:
                pass
        else:
            print(
                "  Warning: Could not load model reference image; falling back to generated portrait"
            )

    # ---------------------------------------------------------------
    # Step 1.5: Ad Director — analyze product + ask clarifying questions
    # ---------------------------------------------------------------
    planner = StoryboardPlanner()
    director_brief = None

    if not args.skip_enhance and not args.no_director:
        print("\n[Step 1.5/6] Ad Director — analyzing product...")
        director = AdDirector(
            client=planner.client, script_loader=planner.script_loader
        )
        director_brief = director.analyze_and_recommend(
            user_query=args.query,
            uploaded_images=uploaded_images if uploaded_images else None,
        )
        director_brief = director.ask_user(
            director_brief,
            user_query=args.query,
            uploaded_images=uploaded_images if uploaded_images else None,
        )

        # Save director brief to run directory
        brief_path = os.path.join(run_dir, "director_brief.json")
        with open(brief_path, "w", encoding="utf-8") as f:
            f.write(director_brief.model_dump_json(indent=2))
        print(f"  Director brief saved: {brief_path}")

    # ---------------------------------------------------------------
    # Step 2: Plan storyboard
    # ---------------------------------------------------------------
    print("\n[Step 2/6] Planning storyboard...")

    if args.skip_enhance:
        from storyboard_planner import Storyboard, StoryboardScene

        storyboard = Storyboard(
            aspect_ratio=args.aspect_ratio,
            use_case="product_marketing",
            style="photography",
            subject="product",
            subject_identity="",
            subject_outfit="",
            scenes=[
                StoryboardScene(
                    scene_number=1,
                    description=args.query,
                    image_prompt=args.query,
                    duration_hint=float(duration),
                )
            ],
            narration_script="",
            music_direction="upbeat background music",
            video_prompt=args.query,
            video_motion_type="cinematic",
            video_camera_technique="dolly_in",
            video_style="cinematic_video",
            script_framework="none",
            commercial_format="lifestyle",
            emotional_trigger="aspiration",
            domain="general",
        )
    else:
        storyboard = planner.plan(
            user_query=args.query,
            uploaded_images=uploaded_images if uploaded_images else None,
            num_frames=num_frames,
            duration=duration,
            aspect_ratio=args.aspect_ratio,
            director_brief=director_brief,
        )

    # Print detailed template banner
    _print_template_banner(planner, storyboard)

    print(
        f"\n  Narration: {storyboard.narration_script[:120]}{'...' if len(storyboard.narration_script) > 120 else ''}"
    )
    print(f"  Music:     {storyboard.music_direction}")

    # Save storyboard JSON to run directory
    storyboard_path = os.path.join(run_dir, "storyboard.json")
    with open(storyboard_path, "w", encoding="utf-8") as f:
        f.write(storyboard.model_dump_json(indent=2))
    print(f"\n  Storyboard saved: {storyboard_path}")

    if args.storyboard_only:
        print("\n[--storyboard-only] Stopping after storyboard planning.")
        _print_storyboard(storyboard)
        return

    # ---------------------------------------------------------------
    # Step 2.5: Generate character portrait for subject consistency
    # ---------------------------------------------------------------
    character_image = model_image
    if model_image is not None:
        print(
            "\n[Step 2.5/6] Using provided model reference image; skipping character portrait generation."
        )
    elif storyboard.subject_identity:
        portrait_path = os.path.join(run_dir, "character_portrait.png")
        character_image = _generate_character_portrait(
            subject_identity=storyboard.subject_identity,
            output_path=portrait_path,
            aspect_ratio=args.aspect_ratio,
        )
        if character_image:
            print(f"  Character portrait saved: {portrait_path}")
        else:
            print(
                "  Warning: Character portrait generation failed, proceeding without it"
            )

    # ---------------------------------------------------------------
    # Step 3: Generate keyframe images
    # ---------------------------------------------------------------
    is_new_ugc = storyboard.commercial_format == "ugc"

    if is_new_ugc:
        # New UGC: only generate ONE keyframe (scene 1) — the rest use video extension
        print(f"\n[Step 3/6] Generating 1 keyframe image (UGC extension chain mode)...")
        scene_1 = storyboard.scenes[0]
        frame_path = os.path.join(keyframe_dir, f"scene_{scene_1.scene_number:02d}.png")

        img_path = _generate_keyframe(
            scene_prompt=scene_1.image_prompt,
            uploaded_images=uploaded_images,
            output_path=frame_path,
            scene_number=scene_1.scene_number,
            aspect_ratio=args.aspect_ratio,
            previous_keyframe_path=None,
            character_image=character_image,
            disable_pinterest=True,
        )
        if not img_path:
            print("\nError: Keyframe generation failed. Cannot proceed.")
            sys.exit(1)

        keyframe_paths = [img_path]
        print(f"\n  Generated keyframe: {img_path}")
    else:
        # Lifestyle / UGC Legacy: generate one keyframe per scene
        print(f"\n[Step 3/6] Generating {len(storyboard.scenes)} keyframe images...")

        keyframe_paths = []
        previous_keyframe = None

        for scene in storyboard.scenes:
            frame_path = os.path.join(keyframe_dir, f"scene_{scene.scene_number:02d}.png")

            # The action's starting pose is already injected into image_prompt
            # by _enhance_with_templates via the poses catalog
            scene_prompt = scene.image_prompt

            img_path = _generate_keyframe(
                scene_prompt=scene_prompt,
                uploaded_images=uploaded_images,
                output_path=frame_path,
                scene_number=scene.scene_number,
                aspect_ratio=args.aspect_ratio,
                previous_keyframe_path=previous_keyframe if args.chain_keyframes else None,
                character_image=character_image,
                disable_pinterest=True,
            )
            if img_path:
                keyframe_paths.append(img_path)
                previous_keyframe = img_path
            else:
                print(
                    f"    Warning: Scene {scene.scene_number} keyframe generation failed, skipping"
                )

        if not keyframe_paths:
            print("\nError: No keyframe images were generated. Cannot proceed to video.")
            sys.exit(1)

        print(f"\n  Generated {len(keyframe_paths)} keyframe images in {keyframe_dir}/")

    if args.images_only:
        print("\n[--images-only] Stopping after image generation.")
        _print_storyboard(storyboard)
        return

    # ---------------------------------------------------------------
    # Step 4: Generate per-scene videos
    # ---------------------------------------------------------------
    if is_new_ugc:
        # New UGC: extension-chained video via Veo 3.1 with GPT prompt refinement
        _print_storyboard(storyboard)
        print(f"\n[Step 4/6] Generating UGC extension chain with Veo 3.1 Fast...")
        print(f"  Scenes: {len(storyboard.scenes)} | Keyframe: {keyframe_paths[0]}")

        scene_video_paths = generate_ugc_video_chain(
            storyboard=storyboard,
            keyframe_path=keyframe_paths[0],
            output_dir=scene_video_dir,
            aspect_ratio=args.aspect_ratio,
            resolution=args.resolution,
        )
    else:
        # Lifestyle / UGC Legacy: per-scene independent video generation
        print(f"\n[Step 4/6] Generating per-scene videos with {video_model_label}...")
        print(f"  Keyframes: {len(keyframe_paths)} | Scenes: {len(storyboard.scenes)}")

        scene_video_paths = generate_all_scene_videos(
            storyboard=storyboard,
            keyframe_paths=keyframe_paths,
            output_dir=scene_video_dir,
            aspect_ratio=args.aspect_ratio,
            resolution=args.resolution,
            mode=args.mode,
            disable_video_hints=args.no_grok_skills,
            video_model=args.video_model,
        )

    if not scene_video_paths:
        print("\nError: No scene videos were generated. Cannot proceed to stitching.")
        sys.exit(1)

    # Re-save storyboard with video prompts logged per scene
    with open(storyboard_path, "w", encoding="utf-8") as f:
        f.write(storyboard.model_dump_json(indent=2))
    print(f"  Storyboard updated with video prompts: {storyboard_path}")

    # ---------------------------------------------------------------
    # Step 5: Stitch videos + overlay music
    # ---------------------------------------------------------------
    print(f"\n[Step 5/6] Assembling final video...")

    music_path = args.music_file if not args.no_music else None
    music_direction = storyboard.music_direction if not args.no_music else ""

    final_path = assemble_final(
        video_paths=scene_video_paths,
        output_path=output_path,
        music_path=music_path,
        music_direction=music_direction,
        music_volume_db=args.music_volume,
    )

    # ---------------------------------------------------------------
    # Step 6: Summary
    # ---------------------------------------------------------------
    total_time = time.time() - pipeline_start
    print("\n" + "=" * 62)
    print("  Pipeline Complete")
    if run_num:
        print(f"  Run #{run_num:03d}")
    print("=" * 62)

    if os.path.exists(final_path):
        size_mb = os.path.getsize(final_path) / (1024 * 1024)
        print(f"  Video:       {final_path} ({size_mb:.1f} MB)")
    else:
        print(f"  Video:       FAILED — output not found")

    print(f"  Scene clips: {scene_video_dir}/ ({len(scene_video_paths)} videos)")
    print(f"  Keyframes:   {keyframe_dir}/ ({len(keyframe_paths)} images)")
    print(f"  Storyboard:  {storyboard_path}")
    print(f"  Total time:  {total_time:.1f}s")
    print(f"  Use case:    {storyboard.use_case}")
    print(f"  Style:       {storyboard.style}")
    print(f"  Subject:     {storyboard.subject}")
    print(f"  Framework:   {storyboard.script_framework}")
    print(f"  Format:      {storyboard.commercial_format}")
    print(f"  Domain:      {storyboard.domain}")
    print("=" * 62)

    # ---------------------------------------------------------------
    # Cost estimation
    # ---------------------------------------------------------------
    scene_durations = [max(1, min(15, int(s.duration_hint))) for s in storyboard.scenes]
    costs = estimate_run_cost(
        num_scenes=len(storyboard.scenes),
        scene_durations=scene_durations,
        video_model=args.video_model,
        resolution=args.resolution,
        used_director=(not args.skip_enhance and not args.no_director),
    )
    print_cost_summary(costs, video_model=args.video_model)
    cost_path = save_cost_json(costs, run_dir)
    print(f"  Saved: {cost_path}")


def _print_storyboard(storyboard):
    """Print full storyboard details."""
    print("\n--- Full Storyboard ---")
    if storyboard.subject_identity:
        print(f"\n  Subject Identity:\n    {storyboard.subject_identity}")
    if storyboard.subject_outfit:
        print(f"  Subject Outfit:\n    {storyboard.subject_outfit}")
    for scene in storyboard.scenes:
        print(f"\n  Scene {scene.scene_number} ({scene.duration_hint}s) [{scene.scene_type or 'generic'}]:")
        print(f"    {scene.description}")
        if scene.narration_segment:
            print(f"    Narration: \"{scene.narration_segment}\"")
        if scene.action:
            print(f"    Action: {scene.action}")
        if scene.scene_outfit:
            print(f"    Outfit override: {scene.scene_outfit}")
        print(f"    Image prompt: {scene.image_prompt[:200]}...")
    print(f"\n  Narration: {storyboard.narration_script}")
    print(f"  Music: {storyboard.music_direction}")
    print(f"\n  Video Prompt:\n    {storyboard.video_prompt}")


if __name__ == "__main__":
    main()
