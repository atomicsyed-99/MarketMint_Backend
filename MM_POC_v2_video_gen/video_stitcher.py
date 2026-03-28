"""
Video stitching and music overlay using FFmpeg.

Concatenates per-scene video clips and overlays a royalty-free music track.
"""

import os
import shutil
import subprocess
import tempfile
from typing import Optional


def _check_ffmpeg():
    """Verify ffmpeg is available on the system."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "ffmpeg not found. Install it with:\n"
            "  Ubuntu/Debian: sudo apt install ffmpeg\n"
            "  macOS: brew install ffmpeg\n"
            "  Arch: sudo pacman -S ffmpeg"
        )


def _get_video_duration(video_path: str) -> float:
    """Get duration of a video file in seconds using ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            video_path,
        ],
        capture_output=True, text=True,
    )
    try:
        return float(result.stdout.strip())
    except (ValueError, AttributeError):
        return 0.0


def stitch_videos(video_paths: list[str], output_path: str) -> str:
    """
    Concatenate video clips into a single video using FFmpeg concat demuxer.

    Args:
        video_paths: Ordered list of video file paths to concatenate.
        output_path: Path for the output stitched video.

    Returns:
        Path to the stitched video file.
    """
    _check_ffmpeg()

    if not video_paths:
        raise ValueError("No video paths provided for stitching")

    if len(video_paths) == 1:
        # Single video — just copy it
        shutil.copy2(video_paths[0], output_path)
        return output_path

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # First, re-encode all clips to a common format for reliable concat
    tmp_dir = tempfile.mkdtemp(prefix="stitch_")
    normalized_paths = []

    try:
        for i, vpath in enumerate(video_paths):
            norm_path = os.path.join(tmp_dir, f"norm_{i:02d}.mp4")
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", vpath,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-c:a", "aac", "-ar", "44100", "-ac", "2",
                    "-r", "30",  # normalize framerate
                    "-pix_fmt", "yuv420p",
                    norm_path,
                ],
                capture_output=True, text=True, check=True,
            )
            normalized_paths.append(norm_path)

        # Write concat list file
        concat_file = os.path.join(tmp_dir, "concat_list.txt")
        with open(concat_file, "w") as f:
            for norm_path in normalized_paths:
                f.write(f"file '{norm_path}'\n")

        # Concatenate
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_file,
                "-c", "copy",
                output_path,
            ],
            capture_output=True, text=True, check=True,
        )

        total_duration = _get_video_duration(output_path)
        print(f"  Stitched {len(video_paths)} clips → {output_path} ({total_duration:.1f}s)")
        return output_path

    finally:
        # Clean up temp files
        shutil.rmtree(tmp_dir, ignore_errors=True)


def overlay_music(
    video_path: str,
    music_path: str,
    output_path: str,
    music_volume_db: float = -12,
) -> str:
    """
    Overlay a music track on a video, mixing with existing audio (narration).

    The music is looped/trimmed to match the video duration and ducked below
    the existing audio track.

    Args:
        video_path: Path to the input video (with narration audio).
        music_path: Path to the music file (MP3, WAV, etc.).
        output_path: Path for the output video with music.
        music_volume_db: Music volume adjustment in dB (negative = quieter).

    Returns:
        Path to the output video file.
    """
    _check_ffmpeg()

    video_duration = _get_video_duration(video_path)
    if video_duration <= 0:
        raise ValueError(f"Could not determine duration of {video_path}")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Use ffmpeg filter_complex to:
    # 1. Take video stream from input video
    # 2. Take audio from input video (narration)
    # 3. Loop/trim music to match video duration, apply volume
    # 4. Mix narration + music audio
    filter_complex = (
        f"[1:a]aloop=loop=-1:size=2e+09,atrim=duration={video_duration},"
        f"volume={music_volume_db}dB[music];"
        f"[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]"
    )

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", music_path,
            "-filter_complex", filter_complex,
            "-map", "0:v",
            "-map", "[aout]",
            "-c:v", "copy",
            "-c:a", "aac", "-ar", "44100",
            "-shortest",
            output_path,
        ],
        capture_output=True, text=True, check=True,
    )

    print(f"  Music overlay → {output_path}")
    return output_path


def select_music_track(music_direction: str, music_dir: str = None) -> Optional[str]:
    """
    Select the best-matching bundled music track based on the storyboard's music_direction.

    Args:
        music_direction: LLM-generated music direction text.
        music_dir: Directory containing bundled music files.

    Returns:
        Path to the selected music file, or None if no tracks available.
    """
    if music_dir is None:
        music_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music")

    if not os.path.isdir(music_dir):
        print(f"  Warning: Music directory not found: {music_dir}")
        return None

    # Scan for music files
    tracks = {}
    for fname in sorted(os.listdir(music_dir)):
        if fname.lower().endswith((".mp3", ".wav", ".ogg", ".m4a", ".flac")):
            tracks[fname.lower()] = os.path.join(music_dir, fname)

    if not tracks:
        print(f"  Warning: No music files found in {music_dir}")
        return None

    # Simple keyword matching to select the best track
    direction_lower = music_direction.lower()

    mood_keywords = {
        "upbeat": ["upbeat", "energetic", "happy", "lively", "fun", "pop", "dance"],
        "cinematic": ["cinematic", "epic", "dramatic", "orchestral", "sweeping", "grand"],
        "chill": ["chill", "calm", "relaxing", "ambient", "soft", "gentle", "peaceful", "acoustic"],
        "corporate": ["corporate", "professional", "business", "modern", "clean", "minimal"],
    }

    best_mood = None
    best_score = 0
    for mood, keywords in mood_keywords.items():
        score = sum(1 for kw in keywords if kw in direction_lower)
        if score > best_score:
            best_score = score
            best_mood = mood

    # Try to find a track matching the mood
    if best_mood:
        for fname, fpath in tracks.items():
            if best_mood in fname:
                print(f"  Selected music: {os.path.basename(fpath)} (matched mood: {best_mood})")
                return fpath

    # Fallback: return the first available track
    first_track = next(iter(tracks.values()))
    print(f"  Selected music: {os.path.basename(first_track)} (default)")
    return first_track


def assemble_final(
    video_paths: list[str],
    output_path: str,
    music_path: Optional[str] = None,
    music_direction: str = "",
    music_volume_db: float = -12,
) -> str:
    """
    Full assembly pipeline: stitch scene videos + overlay music.

    Args:
        video_paths: Ordered list of scene video paths.
        output_path: Final output video path.
        music_path: Optional explicit music file path. If None, auto-selects from bundled tracks.
        music_direction: Storyboard music direction for auto-selection.
        music_volume_db: Music volume in dB.

    Returns:
        Path to the final assembled video.
    """
    _check_ffmpeg()

    # Step 1: Stitch scene videos
    if music_path or music_direction:
        # We'll overlay music, so stitch to a temp file first
        stitched_path = output_path.replace(".mp4", "_stitched.mp4")
    else:
        stitched_path = output_path

    print("\n[Video Assembly] Stitching scene videos...")
    stitch_videos(video_paths, stitched_path)

    # Step 2: Overlay music (if available)
    if not music_path and music_direction:
        music_path = select_music_track(music_direction)

    if music_path and os.path.exists(music_path):
        print("\n[Video Assembly] Overlaying background music...")
        try:
            overlay_music(stitched_path, music_path, output_path, music_volume_db)
            # Clean up temp stitched file
            if stitched_path != output_path and os.path.exists(stitched_path):
                os.remove(stitched_path)
        except subprocess.CalledProcessError as e:
            print(f"  Warning: Music overlay failed: {e.stderr[:200] if e.stderr else 'unknown error'}")
            print("  Using stitched video without music overlay")
            if stitched_path != output_path:
                os.rename(stitched_path, output_path)
    else:
        if stitched_path != output_path:
            os.rename(stitched_path, output_path)
        if music_direction:
            print("  No music track available, skipping music overlay")

    return output_path
