"""
Standalone xAI Grok Imagine Video REST client.

Generates video from prompt + up to 7 storyboard images via the xAI API.
No framework dependencies — just httpx + PIL.
"""

import base64
import io
import os
import time
from typing import Optional

import httpx
from PIL import Image as PILImage

_BASE_URL = "https://api.x.ai/v1"
_DEFAULT_TIMEOUT = 300  # seconds
_POLL_INTERVAL = 5  # seconds
_POLL_INTERVAL_MAX = 30  # seconds


def _parse_retry_after(headers, default: int) -> int:
    raw = (headers or {}).get("Retry-After") or (headers or {}).get("retry-after")
    if not raw:
        return default
    try:
        return max(1, int(float(str(raw).strip())))
    except Exception:
        return default


def _image_to_data_uri(image_path: str, max_size: int = 1024) -> str:
    """Convert a local image file to a base64 data URI (JPEG)."""
    img = PILImage.open(image_path).convert("RGB")
    # Downscale if needed to stay within payload limits
    if max(img.size) > max_size:
        img.thumbnail((max_size, max_size), PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def generate_video(
    prompt: str,
    image_paths: Optional[list[str]] = None,
    duration: int = 10,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    mode: str = "normal",
    output_path: str = "output.mp4",
    api_key: Optional[str] = None,
    timeout: int = _DEFAULT_TIMEOUT,
) -> dict:
    """
    Generate a video via the Grok Imagine Video API.

    Args:
        prompt: Text prompt (max 5000 chars) including scene + AUDIO directions.
        image_paths: Up to 7 local image paths as visual storyboard.
        duration: Video length in seconds (1-15).
        aspect_ratio: e.g. "16:9", "9:16", "1:1".
        resolution: "480p" or "720p".
        mode: Motion intensity — "fun", "normal", or "spicy".
        output_path: Where to save the MP4.
        api_key: xAI API key (falls back to GROK_API_KEY env var).
        timeout: Max seconds to wait for video generation.

    Returns:
        dict with status, video_path, generation_time_ms, etc.
    """
    key = api_key or os.environ.get("GROK_API_KEY")
    if not key:
        return {"status": "failed", "error": "GROK_API_KEY not set"}

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    # Build request body
    body: dict = {
        "model": "grok-imagine-video",
        "prompt": prompt[:5000],
        "duration": max(1, min(15, duration)),
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "mode": mode,
    }

    # Attach image — xAI API expects {"url": "data:image/jpeg;base64,..."} for a single image
    if image_paths:
        # Find first valid image path
        data_uri = None
        for path in image_paths:
            if not os.path.exists(path):
                print(f"  Warning: image not found, skipping: {path}")
                continue
            data_uri = _image_to_data_uri(path)
            break

        if data_uri:
            body["image"] = {"url": data_uri}
            if len(image_paths) > 1:
                print(
                    f"  Note: API accepts 1 image per call; using first of {len(image_paths)}"
                )

    import json as _json

    payload_size = len(_json.dumps(body))
    print(f"\n[Grok Video] Submitting generation request...")
    print(
        f"  Duration: {body['duration']}s | Aspect: {aspect_ratio} | Resolution: {resolution} | Mode: {mode}"
    )
    print(f"  Payload size: {payload_size:,} bytes")
    if image_paths:
        print(f"  Storyboard images: {len(image_paths)}")

    start_time = time.time()

    try:
        with httpx.Client(timeout=60) as client:
            # Submit generation request
            resp = client.post(
                f"{_BASE_URL}/videos/generations", headers=headers, json=body
            )
            if resp.status_code != 200:
                print(f"  Error response: {resp.text[:500]}")
                return {
                    "status": "failed",
                    "error": f"API returned {resp.status_code}: {resp.text}",
                }

            result = resp.json()
            request_id = result.get("request_id") or result.get("id")
            if not request_id:
                # Some API versions return the video directly
                video_url = result.get("video_url") or result.get("url")
                if video_url:
                    return _download_video(video_url, output_path, start_time, headers)
                return {
                    "status": "failed",
                    "error": f"No request_id in response: {result}",
                }

            print(f"  Request ID: {request_id}")

            # Poll until done
            elapsed = 0
            poll_interval = _POLL_INTERVAL
            while elapsed < timeout:
                time.sleep(poll_interval)
                elapsed = time.time() - start_time

                poll_resp = client.get(
                    f"{_BASE_URL}/videos/{request_id}",
                    headers=headers,
                )
                if poll_resp.status_code == 202:
                    print(
                        f"  [{int(elapsed)}s] Status: queued/processing; next poll in {poll_interval}s"
                    )
                    poll_interval = min(
                        _POLL_INTERVAL_MAX, max(_POLL_INTERVAL, poll_interval)
                    )
                    continue

                if poll_resp.status_code == 429:
                    poll_interval = min(
                        _POLL_INTERVAL_MAX,
                        _parse_retry_after(
                            poll_resp.headers,
                            min(_POLL_INTERVAL_MAX, poll_interval * 2),
                        ),
                    )
                    print(
                        f"  [{int(elapsed)}s] Poll rate-limited (429); backing off to {poll_interval}s"
                    )
                    continue

                if poll_resp.status_code != 200:
                    print(
                        f"  [{int(elapsed)}s] Poll error {poll_resp.status_code}; retrying in {poll_interval}s"
                    )
                    poll_interval = min(
                        _POLL_INTERVAL_MAX, max(_POLL_INTERVAL, poll_interval + 2)
                    )
                    continue

                poll_data = poll_resp.json()
                status = poll_data.get("status", "unknown")
                print(f"  [{int(elapsed)}s] Status: {status}")
                poll_interval = _POLL_INTERVAL

                if status == "done":
                    video_url = (
                        (poll_data.get("video", {}) or {}).get("url")
                        or poll_data.get("video_url")
                        or poll_data.get("url")
                    )
                    if not video_url:
                        return {
                            "status": "failed",
                            "error": f"No video URL in completed response: {poll_data}",
                        }
                    return _download_video(video_url, output_path, start_time, headers)

                if status in ("failed", "expired"):
                    err = poll_data.get("error", f"Video generation {status}")
                    return {"status": "failed", "error": str(err)}

            return {"status": "failed", "error": f"Timed out after {timeout}s"}

    except Exception as e:
        return {"status": "failed", "error": str(e)}


def _download_video(
    video_url: str, output_path: str, start_time: float, headers: dict
) -> dict:
    """Download the generated video to a local file."""
    print(f"  Downloading video...")
    try:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with httpx.Client(timeout=120) as dl_client:
            with dl_client.stream("GET", video_url) as resp:
                resp.raise_for_status()
                with open(output_path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=8192):
                        f.write(chunk)

        elapsed_ms = int((time.time() - start_time) * 1000)
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"  Saved: {output_path} ({size_mb:.1f} MB)")
        return {
            "status": "success",
            "video_path": output_path,
            "generation_time_ms": elapsed_ms,
        }
    except Exception as e:
        return {"status": "failed", "error": f"Download failed: {e}"}


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()
    # Quick smoke test with text-only prompt
    result = generate_video(
        prompt="A golden watch rotating slowly on a black velvet surface. AUDIO: elegant piano music, soft ambient tones.",
        duration=5,
        output_path="test_video.mp4",
    )
    print(result)
