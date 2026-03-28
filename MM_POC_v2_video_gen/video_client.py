"""
Video generation client abstraction.

Routes to the correct backend (Grok Imagine Video or Google Veo 3.1)
based on a model selector string, presenting a unified interface.
"""

from typing import Optional

# Supported video model backends
SUPPORTED_MODELS = ("grok", "veo", "veo-standard")


def generate_video(
    video_model: str,
    prompt: str,
    image_paths: Optional[list[str]] = None,
    duration: int = 8,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    mode: str = "normal",
    output_path: str = "output.mp4",
    timeout: int = 360,
) -> dict:
    """
    Unified video generation entry point.

    Args:
        video_model: Backend to use — "grok", "veo" (fast), or "veo-standard".
        prompt: Scene description prompt.
        image_paths: Keyframe image path(s).
        duration: Target duration in seconds.
        aspect_ratio: Video aspect ratio.
        resolution: Video resolution.
        mode: Grok-specific motion intensity (ignored by Veo).
        output_path: Where to save the MP4.
        timeout: Max seconds to wait.

    Returns:
        dict with status, video_path, generation_time_ms, video_prompt (if set).
    """
    if video_model == "grok":
        from grok_video_client import generate_video as grok_generate
        return grok_generate(
            prompt=prompt,
            image_paths=image_paths,
            duration=duration,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            mode=mode,
            output_path=output_path,
            timeout=timeout,
        )

    elif video_model in ("veo", "veo-standard"):
        from veo_video_client import generate_video as veo_generate
        fast = video_model == "veo"
        return veo_generate(
            prompt=prompt,
            image_paths=image_paths,
            duration=duration,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            output_path=output_path,
            timeout=timeout,
            fast=fast,
        )

    else:
        return {
            "status": "failed",
            "error": f"Unknown video model '{video_model}'. Supported: {SUPPORTED_MODELS}",
        }
