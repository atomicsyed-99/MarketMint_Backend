"""
Google Veo 3.1 video generation client.

Generates video from prompt + optional keyframe image via the Gemini API.
Supports both Veo 3.1 Standard and Veo 3.1 Fast.
Supports video extension (chaining scenes via extend_video).
"""

import os
import time
from typing import Optional

from google import genai
from google.genai import types

_DEFAULT_TIMEOUT = 360  # seconds
_POLL_INTERVAL = 10  # seconds

# Model IDs
VEO_STANDARD = "veo-3.1-generate-preview"
VEO_FAST = "veo-3.1-fast-generate-preview"

# Valid parameter ranges
_VALID_DURATIONS = (4, 6, 8)
_VALID_RESOLUTIONS = ("720p", "1080p", "4k")
_VALID_ASPECT_RATIOS = ("16:9", "9:16")


def generate_video(
    prompt: str,
    image_paths: Optional[list[str]] = None,
    duration: int = 8,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    output_path: str = "output.mp4",
    api_key: Optional[str] = None,
    timeout: int = _DEFAULT_TIMEOUT,
    fast: bool = True,
    person_generation: str = "allow_adult",
) -> dict:
    """
    Generate a video via Google Veo 3.1 API.

    Args:
        prompt: Text prompt describing the video scene.
        image_paths: Optional list of local image paths. First valid image is
            used as the starting keyframe (image-to-video).
        duration: Video length in seconds. Snapped to nearest valid value (4, 6, 8).
        aspect_ratio: "16:9" or "9:16".
        resolution: "720p", "1080p", or "4k".
        output_path: Where to save the MP4.
        api_key: Gemini API key (falls back to GEMINI_API_KEY / GOOGLE_API_KEY env).
        timeout: Max seconds to wait for video generation.
        fast: If True, use Veo 3.1 Fast; otherwise Veo 3.1 Standard.
        person_generation: Person generation policy ("allow_adult" for image-to-video).

    Returns:
        dict with status, video_path, generation_time_ms, etc.
    """
    key = (
        api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    )
    if not key:
        return {"status": "failed", "error": "GEMINI_API_KEY not set"}

    model_id = VEO_FAST if fast else VEO_STANDARD
    model_label = "Veo 3.1 Fast" if fast else "Veo 3.1 Standard"

    # Snap duration to nearest valid value
    snap_duration = min(_VALID_DURATIONS, key=lambda d: abs(d - duration))

    # Clamp aspect ratio
    if aspect_ratio not in _VALID_ASPECT_RATIOS:
        return {
            "status": "failed",
            "error": f"Unsupported aspect ratio for Veo: {aspect_ratio}. Supported: {', '.join(_VALID_ASPECT_RATIOS)}",
        }

    # Clamp resolution
    if resolution not in _VALID_RESOLUTIONS:
        resolution = "720p"

    print(f"\n[{model_label}] Submitting generation request...")
    print(
        f"  Duration: {snap_duration}s | Aspect: {aspect_ratio} | Resolution: {resolution}"
    )

    # Load keyframe image if provided
    image = None
    if image_paths:
        for path in image_paths:
            if not os.path.exists(path):
                print(f"  Warning: image not found, skipping: {path}")
                continue
            try:
                image = types.Image.from_file(location=path)
                print(f"  Keyframe image: {path}")
                if len(image_paths) > 1:
                    print(
                        f"  Note: Veo accepts 1 image per call; using first of {len(image_paths)}"
                    )
                break
            except Exception as e:
                print(f"  Warning: failed to load image {path}: {e}")
                continue

    start_time = time.time()

    try:
        client = genai.Client(api_key=key)

        # Build config
        config = types.GenerateVideosConfig(
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            duration_seconds=snap_duration,
            number_of_videos=1,
            person_generation=person_generation,
        )

        # Submit generation request
        kwargs = {
            "model": model_id,
            "prompt": prompt,
            "config": config,
        }
        if image is not None:
            kwargs["image"] = image

        operation = client.models.generate_videos(**kwargs)
        print(f"  Operation submitted, polling for completion...")

        # Poll until done
        elapsed = 0
        while not operation.done and elapsed < timeout:
            time.sleep(_POLL_INTERVAL)
            elapsed = time.time() - start_time
            operation = client.operations.get(operation)
            print(
                f"  [{int(elapsed)}s] Status: {'done' if operation.done else 'processing'}..."
            )

        if not operation.done:
            return {"status": "failed", "error": f"Timed out after {timeout}s"}

        # Check for errors
        if not operation.response or not operation.response.generated_videos:
            error_msg = "No video in response"
            if hasattr(operation, "error") and operation.error:
                error_msg = str(operation.error)
            return {"status": "failed", "error": error_msg}

        # Download and save
        generated_video = operation.response.generated_videos[0]
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        client.files.download(file=generated_video.video)
        generated_video.video.save(output_path)

        elapsed_ms = int((time.time() - start_time) * 1000)
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"  Saved: {output_path} ({size_mb:.1f} MB)")

        return {
            "status": "success",
            "video_path": output_path,
            "generation_time_ms": elapsed_ms,
            "_video_ref": generated_video.video,
        }

    except Exception as e:
        return {"status": "failed", "error": str(e)}


def extend_video(
    prompt: str,
    source_video,
    duration: int = 8,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    output_path: str = "output_extended.mp4",
    api_key: Optional[str] = None,
    timeout: int = _DEFAULT_TIMEOUT,
    fast: bool = True,
) -> dict:
    """
    Extend an existing video with a new prompt via Veo 3.1.

    This is used for UGC extension chaining — each call continues the previous
    video seamlessly with the next narration segment.

    Args:
        prompt: Text prompt describing the continuation scene.
        source_video: The video file object from a previous generate_videos
            response (operation.response.generated_videos[0].video).
        duration: Extension length in seconds. Snapped to nearest valid (4, 6, 8).
        aspect_ratio: "16:9" or "9:16".
        resolution: "720p", "1080p", or "4k".
        output_path: Where to save the extended MP4.
        api_key: Gemini API key (falls back to GEMINI_API_KEY / GOOGLE_API_KEY env).
        timeout: Max seconds to wait for video generation.
        fast: If True, use Veo 3.1 Fast; otherwise Veo 3.1 Standard.

    Returns:
        dict with status, video_path, generation_time_ms, and _video_ref
        (the raw video object for further chaining).
    """
    key = (
        api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    )
    if not key:
        return {"status": "failed", "error": "GEMINI_API_KEY not set"}

    model_id = VEO_FAST if fast else VEO_STANDARD
    model_label = "Veo 3.1 Fast" if fast else "Veo 3.1 Standard"

    snap_duration = min(_VALID_DURATIONS, key=lambda d: abs(d - duration))

    if aspect_ratio not in _VALID_ASPECT_RATIOS:
        return {
            "status": "failed",
            "error": f"Unsupported aspect ratio for Veo: {aspect_ratio}. Supported: {', '.join(_VALID_ASPECT_RATIOS)}",
        }

    if resolution not in _VALID_RESOLUTIONS:
        resolution = "720p"

    print(f"\n[{model_label}] Submitting extension request...")
    print(
        f"  Duration: {snap_duration}s | Aspect: {aspect_ratio} | Resolution: {resolution}"
    )

    start_time = time.time()

    try:
        client = genai.Client(api_key=key)

        config = types.GenerateVideosConfig(
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            duration_seconds=snap_duration,
            number_of_videos=1,
            person_generation="allow_all",
        )

        operation = client.models.generate_videos(
            model=model_id,
            prompt=prompt,
            video=source_video,
            config=config,
        )
        print(f"  Extension submitted, polling for completion...")

        elapsed = 0
        while not operation.done and elapsed < timeout:
            time.sleep(_POLL_INTERVAL)
            elapsed = time.time() - start_time
            operation = client.operations.get(operation)
            print(
                f"  [{int(elapsed)}s] Status: {'done' if operation.done else 'processing'}..."
            )

        if not operation.done:
            return {"status": "failed", "error": f"Timed out after {timeout}s"}

        if not operation.response or not operation.response.generated_videos:
            error_msg = "No video in response"
            if hasattr(operation, "error") and operation.error:
                error_msg = str(operation.error)
            return {"status": "failed", "error": error_msg}

        generated_video = operation.response.generated_videos[0]
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        client.files.download(file=generated_video.video)
        generated_video.video.save(output_path)

        elapsed_ms = int((time.time() - start_time) * 1000)
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"  Saved: {output_path} ({size_mb:.1f} MB)")

        return {
            "status": "success",
            "video_path": output_path,
            "generation_time_ms": elapsed_ms,
            "_video_ref": generated_video.video,
        }

    except Exception as e:
        return {"status": "failed", "error": str(e)}


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()
    result = generate_video(
        prompt="A golden watch rotating slowly on a black velvet surface, cinematic lighting, shallow depth of field.",
        duration=4,
        output_path="test_veo_video.mp4",
        fast=True,
    )
    print(result)
