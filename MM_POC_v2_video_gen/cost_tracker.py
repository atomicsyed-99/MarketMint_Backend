"""
Cost estimation for ad video generation pipeline runs.

Tracks API costs across all pipeline stages:
- Storyboard planning (Gemini Flash text)
- Keyframe image generation (Gemini 3.1 Flash Image)
- Video generation (Veo 3.1 Fast / Standard, or Grok Imagine Video)

Prices are best-effort estimates as of March 2026. Update the constants
below when pricing changes.
"""

import json
import os


# ---------------------------------------------------------------------------
# Pricing constants (USD) — updated March 2026
# ---------------------------------------------------------------------------

# Gemini Flash text (storyboard planning + director)
# gemini-3-flash-preview: $0.50/1M input tokens, $3.00/1M output tokens
GEMINI_FLASH_INPUT_PER_1M = 0.50
GEMINI_FLASH_OUTPUT_PER_1M = 3.00
# Rough estimate: planning call uses ~4K input tokens, ~2K output tokens
EST_PLANNER_INPUT_TOKENS = 4000
EST_PLANNER_OUTPUT_TOKENS = 2000
# Director call is roughly the same
EST_DIRECTOR_INPUT_TOKENS = 3000
EST_DIRECTOR_OUTPUT_TOKENS = 1500

# Gemini 3.1 Flash Image (keyframe generation)
# ~$0.067 per image at 1024px (our typical keyframe resolution)
GEMINI_IMAGE_PER_IMAGE = 0.067

# Veo 3.1 video generation (per second of output video)
VEO_FAST_PER_SEC_720P = 0.15
VEO_FAST_PER_SEC_1080P = 0.15
VEO_FAST_PER_SEC_4K = 0.35
VEO_STANDARD_PER_SEC_720P = 0.40
VEO_STANDARD_PER_SEC_1080P = 0.40
VEO_STANDARD_PER_SEC_4K = 0.60

# Grok Imagine Video (per second of output video)
# $0.05/sec output + $0.01/sec input ≈ $0.06/sec effective
GROK_PER_SEC = 0.06


def _veo_rate(resolution: str, fast: bool) -> float:
    """Return per-second rate for Veo given resolution and tier."""
    if fast:
        if resolution == "4k":
            return VEO_FAST_PER_SEC_4K
        return VEO_FAST_PER_SEC_720P  # 720p and 1080p same price
    else:
        if resolution == "4k":
            return VEO_STANDARD_PER_SEC_4K
        return VEO_STANDARD_PER_SEC_720P


def estimate_run_cost(
    num_scenes: int,
    scene_durations: list[float],
    video_model: str = "veo",
    resolution: str = "720p",
    used_director: bool = True,
) -> dict:
    """
    Estimate total USD cost for a pipeline run.

    Args:
        num_scenes: Number of storyboard scenes.
        scene_durations: Duration in seconds for each scene.
        video_model: "grok", "veo", or "veo-standard".
        resolution: Video resolution.
        used_director: Whether the Ad Director step ran.

    Returns:
        dict with per-stage and total cost breakdowns.
    """
    costs = {}

    # 1. Storyboard planning (Gemini Flash text)
    planner_cost = (
        (EST_PLANNER_INPUT_TOKENS / 1_000_000) * GEMINI_FLASH_INPUT_PER_1M
        + (EST_PLANNER_OUTPUT_TOKENS / 1_000_000) * GEMINI_FLASH_OUTPUT_PER_1M
    )
    costs["storyboard_planning"] = round(planner_cost, 4)

    # 1.5. Director (if used)
    if used_director:
        director_cost = (
            (EST_DIRECTOR_INPUT_TOKENS / 1_000_000) * GEMINI_FLASH_INPUT_PER_1M
            + (EST_DIRECTOR_OUTPUT_TOKENS / 1_000_000) * GEMINI_FLASH_OUTPUT_PER_1M
        )
        costs["director"] = round(director_cost, 4)
    else:
        costs["director"] = 0.0

    # 3. Keyframe image generation (+1 for character portrait)
    image_cost = (num_scenes + 1) * GEMINI_IMAGE_PER_IMAGE
    costs["keyframe_images"] = round(image_cost, 4)

    # 4. Video generation
    total_video_seconds = sum(scene_durations)
    if video_model == "grok":
        rate = GROK_PER_SEC
        rate_label = f"${GROK_PER_SEC}/sec"
    elif video_model == "veo":
        rate = _veo_rate(resolution, fast=True)
        rate_label = f"${rate}/sec"
    elif video_model == "veo-standard":
        rate = _veo_rate(resolution, fast=False)
        rate_label = f"${rate}/sec"
    else:
        rate = 0.0
        rate_label = "unknown"

    video_cost = total_video_seconds * rate
    costs["video_generation"] = round(video_cost, 4)
    costs["video_rate"] = rate_label
    costs["video_seconds"] = round(total_video_seconds, 1)

    # Total
    costs["total"] = round(
        costs["storyboard_planning"]
        + costs["director"]
        + costs["keyframe_images"]
        + costs["video_generation"],
        4,
    )

    return costs


def print_cost_summary(costs: dict, video_model: str = "veo"):
    """Print a formatted cost breakdown to stdout."""
    model_labels = {
        "grok": "Grok Imagine Video",
        "veo": "Veo 3.1 Fast",
        "veo-standard": "Veo 3.1 Standard",
    }
    print("\n" + "-" * 50)
    print("  Estimated Run Cost (USD)")
    print("-" * 50)
    print(f"  Storyboard planning:   ${costs['storyboard_planning']:.4f}")
    if costs["director"] > 0:
        print(f"  Ad Director:           ${costs['director']:.4f}")
    print(f"  Keyframe images:       ${costs['keyframe_images']:.4f}")
    print(f"  Video generation:      ${costs['video_generation']:.4f}")
    print(f"    ({model_labels.get(video_model, video_model)} @ {costs['video_rate']} x {costs['video_seconds']}s)")
    print(f"  {'─' * 30}")
    print(f"  TOTAL:                 ${costs['total']:.4f}")
    print("-" * 50)


def save_cost_json(costs: dict, run_dir: str):
    """Save cost breakdown as JSON in the run directory."""
    path = os.path.join(run_dir, "cost_estimate.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(costs, f, indent=2)
    return path
