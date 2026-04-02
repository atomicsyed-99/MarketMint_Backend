"""
Per-scene video generation — backend-agnostic.

Generates one short video per storyboard scene (single image + narration),
using predefined action prompts from the action catalog instead of
LLM-hallucinated choreography.

Supports: Grok Imagine Video (xAI), Google Veo 3.1 Fast / Standard.
New UGC mode: extension-chained video via Veo 3.1 with GPT 5.4 prompt refinement.
"""

import base64
import json
import os
import time
import re
from typing import Optional

from prompt_safety import sanitize_generation_prompt
from storyboard_planner import (
    Storyboard,
    StoryboardScene,
    load_prompt_catalog,
    _get_video_template_hints,
)
from video_client import generate_video


_CORE_RULES = (
    "RULES:"
    "\n- Single continuous shot from the input image. No cuts, transitions, or new compositions."
    "\n- Keep the subject, clothing, product details, and environment exactly as shown."
    "\n- Motion stays natural and physically plausible with stable anatomy and lighting."
)

_DIRECT_ADDRESS_ACTIONS = {
    "talk_to_camera",
    "excited_present",
    "nod_and_point",
    "wave_hello",
}

_GROK_PROMPT_MAX_CHARS = 3800
_VEO_PROMPT_MAX_CHARS = 1800


def _extract_tagged_block(prompt: str, tag: str) -> str:
    pattern = re.compile(rf"^\[{re.escape(tag)}\]\s*(.+)$", re.MULTILINE)
    match = pattern.search(prompt or "")
    return match.group(1).strip() if match else ""


def _extract_prompt_section(prompt: str, section: str) -> str:
    pattern = re.compile(rf"^###\s*{re.escape(section)}:\s*(.+)$", re.MULTILINE)
    match = pattern.search(prompt or "")
    return match.group(1).strip() if match else ""


def _collapse_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _shorten_text(text: str, limit: int) -> str:
    text = _collapse_whitespace(text)
    if len(text) <= limit:
        return text
    clipped = text[: max(0, limit - 3)].rstrip(" ,;:")
    return f"{clipped}..."


def _extract_freeform_scene_text(prompt: str) -> str:
    if not prompt:
        return ""

    text = prompt
    text = re.sub(r"^\[[^\]]+\]\s*.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^###\s*[^:]+:\s*.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"Aspect ratio:.*$", "", text, flags=re.MULTILINE)
    text = _collapse_whitespace(text)
    return _shorten_text(text, 280)


def _extract_hint(video_hints: str, prefix: str) -> str:
    for line in (video_hints or "").splitlines():
        if line.startswith(f"{prefix}:"):
            return line.split(":", 1)[1].strip().rstrip(".")
    return ""


def _compress_action(action_entry: dict) -> str:
    motion = (action_entry or {}).get("motion_prompt", "").strip()
    if not motion:
        return "Keep movement minimal and natural."
    first_clause = motion.split(",", 1)[0].strip()
    if not first_clause:
        return motion
    if len(first_clause) < 40 and first_clause.lower() != motion.lower():
        return f"{first_clause}; {motion}"
    return motion


def _build_asset_lock(scene: StoryboardScene) -> str:
    asset_lock = _extract_tagged_block(scene.image_prompt, "ASSET LOCK")
    do_not_change = _extract_tagged_block(scene.image_prompt, "DO NOT CHANGE")
    outfit = _extract_tagged_block(scene.image_prompt, "OUTFIT")

    primary = asset_lock or outfit
    parts = []
    if primary:
        parts.append(_shorten_text(primary, 260))
    if do_not_change:
        parts.append(_shorten_text(do_not_change, 140))
    return " ".join(parts).strip()


def _build_subject_lock(scene: StoryboardScene) -> str:
    subject_lock = _extract_tagged_block(scene.image_prompt, "SUBJECT LOCK")
    return _shorten_text(subject_lock, 180) if subject_lock else ""


def _build_scene_context(scene: StoryboardScene) -> str:
    scene_line = _extract_prompt_section(scene.image_prompt, "Scene")
    subject_line = _extract_prompt_section(scene.image_prompt, "Subject")

    if scene_line and subject_line:
        return _shorten_text(f"{scene_line} Subject in frame: {subject_line}", 420)
    if scene_line:
        return _shorten_text(scene_line, 320)
    if subject_line:
        return _shorten_text(subject_line, 320)

    fallback = _extract_freeform_scene_text(scene.image_prompt)
    if fallback:
        return fallback
    return _shorten_text(scene.description, 220)


def _shorten_audio_line(text: str, limit: int = 180) -> str:
    return _shorten_text(text, limit)


def _build_grok_lock_text(scene: StoryboardScene) -> str:
    subject_lock = _build_subject_lock(scene)
    asset_lock = _build_asset_lock(scene)

    parts = [
        "Keep the same subject, outfit, and product details exactly as shown in the keyframe"
    ]
    if subject_lock:
        parts.append(f"subject reference: {subject_lock}")
    if asset_lock:
        parts.append(f"outfit/product reference: {asset_lock}")
    return "; ".join(parts)


def _build_veo_lock_text(scene: StoryboardScene) -> str:
    subject_lock = _build_subject_lock(scene)
    asset_lock = _build_asset_lock(scene)

    parts = [
        "Use the input image as the source of truth for the subject, outfit, product, and layout"
    ]
    if subject_lock:
        parts.append(f"Subject: {subject_lock}")
    if asset_lock:
        parts.append(f"Outfit/product: {asset_lock}")
    return ". ".join(parts)


def _build_veo_audio_text(scene: StoryboardScene, storyboard_format: str) -> str:
    if storyboard_format == "lifestyle":
        return "Audio: light natural ambience only, no dialogue"

    line = _shorten_audio_line(scene.narration_segment, 120)
    if not line:
        return "Audio: natural room tone"

    if _is_direct_address_scene(scene):
        return f'Audio: subject says, "{line}"'
    return f'Audio: narrator says, "{line}"'


def _build_base_look_text(style_hint: str = "", camera_hint: str = "") -> str:
    baseline = [
        "available light",
        "natural color",
        "minimal processing",
        "authentic texture",
    ]

    style_lower = (style_hint or "").lower()
    camera_lower = (camera_hint or "").lower()
    if (
        any(token in style_lower for token in ("handheld", "raw", "ugc"))
        or "handheld" in camera_lower
    ):
        baseline.insert(2, "subtle handheld energy")

    if style_hint:
        baseline.insert(0, _shorten_text(style_hint, 110))

    return _shorten_text(
        ", ".join(dict.fromkeys(part.strip() for part in baseline if part.strip())),
        150,
    )


def _shared_video_invariants() -> list[str]:
    return [
        "Build each clip as one self-contained shot",
        "Single continuous shot from the input image with no cuts, transitions, or new compositions",
        "Keep the subject, clothing, product details, and environment exactly as shown",
        "Motion stays natural and physically plausible with stable anatomy and lighting",
    ]


def _direct_address_guidance(scene: StoryboardScene) -> list[str]:
    if not _is_direct_address_scene(scene):
        return []

    guidance = [
        "Subject may look into the lens naturally because this is a direct-to-camera moment"
    ]
    if scene.narration_segment:
        guidance.extend(
            [
                "Deliver one complete spoken thought and end on a natural resting beat",
                "Do not start a second line that will be cut off by the clip ending",
            ]
        )
    return guidance


def _build_veo_scene_prompt(
    scene: StoryboardScene,
    aspect_ratio: str,
    storyboard_format: str,
    video_hints: str = "",
    actions_catalog: dict = None,
) -> str:
    scene_context = _build_scene_context(scene)
    subject_lock = _build_subject_lock(scene)
    action_text = "keeps movement minimal and natural"
    camera_hint = _extract_hint(video_hints, "Camera")
    style_hint = _extract_hint(video_hints, "Video style")
    motion_hint = _extract_hint(video_hints, "Motion")

    if scene.action and actions_catalog:
        action_entry = actions_catalog.get(scene.action)
        if action_entry:
            action_text = _shorten_text(_compress_action(action_entry), 170)
            if not camera_hint and action_entry.get("camera_pairing"):
                camera_hint = action_entry["camera_pairing"].replace("_", " ")

    cinematography_parts = []
    if camera_hint:
        cinematography_parts.append(camera_hint)
    if motion_hint:
        cinematography_parts.append(motion_hint.replace("_", " "))
    cinematography = _shorten_text(
        ", ".join(part for part in cinematography_parts if part)
        or "natural camera movement",
        120,
    )

    subject_text = _shorten_text(
        subject_lock or "main subject from the input image", 140
    )
    context_text = _shorten_text(scene_context, 340)
    style_text = _build_base_look_text(style_hint, camera_hint)

    parts = [
        f"Cinematography: {cinematography}",
        f"Subject: {subject_text}",
        f"Action: {action_text}",
        f"Context: {context_text}",
        f"Style and ambiance: {style_text}",
        _build_veo_audio_text(scene, storyboard_format),
        _build_veo_lock_text(scene),
        *_direct_address_guidance(scene),
        *_shared_video_invariants(),
        f"Aspect ratio {aspect_ratio}",
    ]

    prompt = ". ".join(part.rstrip(" .") for part in parts if part).strip() + "."
    prompt = sanitize_generation_prompt(prompt, aspect_ratio)
    prompt = _collapse_whitespace(prompt)
    return _shorten_text(prompt, _VEO_PROMPT_MAX_CHARS)


def _build_grok_scene_prompt(
    scene: StoryboardScene,
    aspect_ratio: str,
    storyboard_format: str,
    video_hints: str = "",
    actions_catalog: dict = None,
) -> str:
    scene_context = _build_scene_context(scene)
    action_text = "Keep movement minimal and natural"
    camera_hint = _extract_hint(video_hints, "Camera")
    style_hint = _extract_hint(video_hints, "Video style")

    if scene.action and actions_catalog:
        action_entry = actions_catalog.get(scene.action)
        if action_entry:
            action_text = _shorten_text(_compress_action(action_entry), 180)
            if not camera_hint and action_entry.get("camera_pairing"):
                camera_hint = action_entry["camera_pairing"].replace("_", " ")

    look_text = _build_base_look_text(style_hint, camera_hint)

    parts = [
        _shorten_text(scene_context, 420),
        f"Action: {action_text}",
        f"Look: {look_text}",
        _build_grok_lock_text(scene),
        "Use the original keyframe composition and environment as the source of truth",
        *_direct_address_guidance(scene),
        *_shared_video_invariants(),
    ]

    if camera_hint:
        parts.append(f"Camera feel: {_shorten_text(camera_hint, 90)}")

    if storyboard_format == "lifestyle":
        parts.append("Audio: natural ambient sound only, no speech")
    elif scene.narration_segment:
        parts.append(
            f'Audio: narrator says "{_shorten_audio_line(scene.narration_segment, 120)}"'
        )

    parts.append(f"Aspect ratio {aspect_ratio}")
    prompt = ". ".join(part.rstrip(" .") for part in parts if part).strip() + "."
    prompt = sanitize_generation_prompt(prompt, aspect_ratio)
    prompt = prompt.replace("\n", " ")
    prompt = _collapse_whitespace(prompt)
    return _enforce_prompt_limit(prompt, "grok")


def _enforce_prompt_limit(prompt: str, video_model: str) -> str:
    prompt = prompt.strip()
    if video_model != "grok" or len(prompt) <= _GROK_PROMPT_MAX_CHARS:
        return prompt

    lines = [line for line in prompt.splitlines() if line.strip()]
    priorities = [
        "MODEL NOTES:",
        "AUDIO:",
        "GAZE:",
        "PHYSICS:",
        "ASSET LOCK:",
        "LOOK:",
    ]
    for prefix in priorities:
        if len("\n".join(lines)) <= _GROK_PROMPT_MAX_CHARS:
            break
        if prefix == "ASSET LOCK:":
            trimmed = []
            for line in lines:
                if line.startswith(prefix):
                    trimmed.append(
                        f"ASSET LOCK: {_shorten_text(line.split(':', 1)[1], 180)}"
                    )
                else:
                    trimmed.append(line)
            lines = trimmed
            continue
        lines = [line for line in lines if not line.startswith(prefix)]

    compacted = "\n".join(lines)
    if len(compacted) <= _GROK_PROMPT_MAX_CHARS:
        return compacted

    trimmed = []
    for line in lines:
        if line.startswith("SCENE:"):
            trimmed.append(f"SCENE: {_shorten_text(line.split(':', 1)[1], 240)}")
        elif line.startswith("ACTION:"):
            trimmed.append(f"ACTION: {_shorten_text(line.split(':', 1)[1], 220)}")
        else:
            trimmed.append(_shorten_text(line, 220))

    final_prompt = "\n".join(trimmed)
    return final_prompt[:_GROK_PROMPT_MAX_CHARS].rstrip()


def _build_product_physics(scene: StoryboardScene, asset_lock: str) -> str:
    scene_text = scene.image_prompt.lower()
    if not asset_lock and not any(
        token in scene_text
        for token in (
            "product",
            "fabric",
            "garment",
            "kurti",
            "dress",
            "shirt",
            "embroidery",
        )
    ):
        return ""

    return (
        "PHYSICS: Respect the product's starting placement and support points from the keyframe. "
        "If the item is folded, hanging, worn, or held, motion must begin from that exact setup. "
        "Gravity, tension, inertia, and fabric drape must react naturally to the movement. "
        "Only touched or lifted areas move first; the rest follows with believable delay. "
        "Embroidery, seams, trims, and motifs are fixed to the material and must not slide, float, or migrate to a new position in frame."
    )


def _get_model_context(catalog: dict, video_model: str) -> str:
    if video_model == "grok":
        return ""

    veo_skills = catalog.get("veo_ad_skills", {})
    selected = [
        "shot_formula",
        "image_to_video_consistency",
        "ad_focus",
        "camera_language",
        "audio_and_dialogue",
        "timed_beats",
    ]
    parts = []
    for slug in selected:
        entry = veo_skills.get(slug, {})
        hint = entry.get("hint", "")
        if hint:
            parts.append(hint)
    return " ".join(parts).strip()


def _resolve_scene_duration(
    scene: StoryboardScene,
    storyboard_format: str,
    video_model: str,
    resolution: str,
) -> int:
    duration = max(1, min(15, int(round(scene.duration_hint))))

    if storyboard_format == "lifestyle":
        # Veo 3.1 only accepts (4, 6, 8)s — 4 is the floor.
        # Grok accepts 1-15s freely, so 2-3s is possible.
        if video_model in ("veo", "veo-standard"):
            duration = 4
        else:
            duration = max(2, min(3, duration))
    elif storyboard_format in ("ugc", "ugc_legacy"):
        word_count = len((scene.narration_segment or "").split())
        spoken_target = max(4, min(5, int(round((word_count / 2.6) + 0.5))))
        duration = max(duration, spoken_target)
        if video_model in ("veo", "veo-standard"):
            duration = max(6, duration)

    if resolution == "1080p" and video_model in ("veo", "veo-standard"):
        duration = max(8, duration)

    return duration


def _is_direct_address_scene(scene: StoryboardScene) -> bool:
    return scene.action in _DIRECT_ADDRESS_ACTIONS


def _build_scene_prompt(
    scene: StoryboardScene,
    aspect_ratio: str,
    storyboard_format: str,
    video_model: str,
    video_hints: str = "",
    model_context: str = "",
    actions_catalog: dict = None,
) -> str:
    """Build a compact video prompt for a single scene."""
    if video_model == "grok":
        return _build_grok_scene_prompt(
            scene,
            aspect_ratio=aspect_ratio,
            storyboard_format=storyboard_format,
            video_hints=video_hints,
            actions_catalog=actions_catalog,
        )

    if video_model in {"veo", "veo-standard"}:
        return _build_veo_scene_prompt(
            scene,
            aspect_ratio=aspect_ratio,
            storyboard_format=storyboard_format,
            video_hints=video_hints,
            actions_catalog=actions_catalog,
        )

    parts = [f"SCENE: {_build_scene_context(scene)}"]

    asset_lock = _build_asset_lock(scene)
    if asset_lock:
        parts.append(f"ASSET LOCK: {asset_lock}")
    product_physics = _build_product_physics(scene, asset_lock)

    camera_hint = _extract_hint(video_hints, "Camera")
    style_hint = _extract_hint(video_hints, "Video style")
    motion_hint = _extract_hint(video_hints, "Motion")

    if scene.action and actions_catalog:
        action_entry = actions_catalog.get(scene.action)
        if action_entry:
            parts.append(f"ACTION: {_compress_action(action_entry)}")
            if not camera_hint and action_entry.get("camera_pairing"):
                camera_hint = action_entry["camera_pairing"].replace("_", " ")
    elif motion_hint:
        parts.append(f"ACTION: {motion_hint}")

    if camera_hint:
        parts.append(f"CAMERA: {camera_hint}")

    if style_hint:
        parts.append(f"LOOK: {style_hint}")

    if product_physics:
        parts.append(product_physics)

    if _is_direct_address_scene(scene):
        parts.append(
            "GAZE: Subject may look into the lens naturally because this is a direct-to-camera moment."
        )
    else:
        parts.append(
            "GAZE: Subject does not make eye contact with the camera. Keep gaze on the product, environment, or off-camera action unless direct address is explicitly required."
        )

    if storyboard_format in ("ugc", "ugc_legacy") and _is_direct_address_scene(scene):
        parts.append(
            "SPEECH: Deliver one complete spoken thought and end on a natural resting beat. Do not start a second line that will be cut off by the clip ending."
        )

    if model_context:
        parts.append(f"MODEL NOTES: {model_context}")

    parts.append(_CORE_RULES)

    if storyboard_format == "lifestyle":
        parts.append(
            "AUDIO: No speech, no voiceover, no dialogue. Natural ambient sound only."
        )
    elif scene.narration_segment:
        parts.append(
            f'AUDIO: Narrator: "{_shorten_audio_line(scene.narration_segment)}"'
        )

    prompt = sanitize_generation_prompt("\n".join(parts), aspect_ratio)
    return _enforce_prompt_limit(prompt, video_model)


def generate_scene_video(
    scene: StoryboardScene,
    image_path: str,
    output_path: str,
    storyboard_format: str = "lifestyle",
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    mode: str = "normal",
    api_key: Optional[str] = None,
    video_hints: str = "",
    video_model: str = "grok",
    model_context: str = "",
    actions_catalog: dict = None,
) -> dict:
    """Generate a video for a single storyboard scene."""
    prompt = _build_scene_prompt(
        scene,
        aspect_ratio=aspect_ratio,
        storyboard_format=storyboard_format,
        video_model=video_model,
        video_hints=video_hints,
        model_context=model_context,
        actions_catalog=actions_catalog,
    )
    duration = _resolve_scene_duration(
        scene, storyboard_format, video_model, resolution
    )

    model_label = {
        "grok": "Grok",
        "veo": "Veo 3.1 Fast",
        "veo-standard": "Veo 3.1",
    }.get(video_model, video_model)
    print(
        f"\n  [Scene {scene.scene_number}] Generating video ({duration}s) via {model_label}..."
    )
    print(f"    Prompt chars: {len(prompt)}")
    print(
        f"    Narration: {scene.narration_segment[:80]}{'...' if len(scene.narration_segment) > 80 else ''}"
    )
    if scene.action:
        print(f"    Action: {scene.action}")

    result = generate_video(
        video_model=video_model,
        prompt=prompt,
        image_paths=[image_path],
        duration=duration,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        mode=mode,
        output_path=output_path,
    )

    # Always attach the prompt that was sent for logging
    result["grok_video_prompt"] = prompt

    if result.get("status") == "success":
        print(
            f"    Saved: {result['video_path']} ({result.get('generation_time_ms', 0)}ms)"
        )
    else:
        print(f"    Failed: {result.get('error', 'unknown')}")

    return result


def generate_all_scene_videos(
    storyboard: Storyboard,
    keyframe_paths: list[str],
    output_dir: str = "scene_videos",
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    mode: str = "normal",
    api_key: Optional[str] = None,
    disable_video_hints: bool = False,
    video_model: str = "grok",
) -> list[str]:
    """Generate individual videos for each scene in the storyboard."""
    os.makedirs(output_dir, exist_ok=True)

    # Load catalogs
    catalog = load_prompt_catalog()
    actions_catalog = catalog.get("actions", {})

    # Build global video template hints as fallback
    model_context = _get_model_context(catalog, video_model)
    if disable_video_hints:
        global_hints = ""
        print("  Video hints: disabled (--no-grok-skills)")
    else:
        global_hints = _get_video_template_hints(
            catalog,
            storyboard.video_motion_type,
            storyboard.video_camera_technique,
            storyboard.video_style,
        )
        if global_hints:
            print(
                f"  Video hints (global fallback): motion={storyboard.video_motion_type}, "
                f"camera={storyboard.video_camera_technique}, style={storyboard.video_style}"
            )

    # Match scenes to keyframe paths
    scenes_with_images = []
    for scene in storyboard.scenes:
        expected_name = f"scene_{scene.scene_number:02d}.png"
        matched_path = None
        for kf_path in keyframe_paths:
            if os.path.basename(kf_path) == expected_name:
                matched_path = kf_path
                break
        if matched_path:
            scenes_with_images.append((scene, matched_path))
        else:
            print(
                f"  Warning: No keyframe found for scene {scene.scene_number}, skipping video generation"
            )

    if not scenes_with_images:
        print("  Error: No scenes matched with keyframe images")
        return []

    print(f"\n[Per-Scene Video] Generating {len(scenes_with_images)} scene videos...")

    video_paths = []
    for scene, image_path in scenes_with_images:
        # Per-scene video hints override global when set by director
        if disable_video_hints:
            scene_hints = ""
            hint_source = "disabled"
        elif (
            scene.video_motion_type or scene.video_camera_technique or scene.video_style
        ):
            scene_hints = _get_video_template_hints(
                catalog,
                scene.video_motion_type or storyboard.video_motion_type,
                scene.video_camera_technique or storyboard.video_camera_technique,
                scene.video_style or storyboard.video_style,
            )
            hint_source = "per-scene"
        else:
            scene_hints = global_hints
            hint_source = "global"

        # Log which hints are being used for this scene
        scene_label = f"scene_{scene.scene_number:02d}"
        if scene.scene_type:
            scene_label += f" ({scene.scene_type})"
        if scene.video_motion_type:
            print(
                f"  [{scene_label}] {hint_source} hints: "
                f"motion={scene.video_motion_type or storyboard.video_motion_type}, "
                f"camera={scene.video_camera_technique or storyboard.video_camera_technique}, "
                f"style={scene.video_style or storyboard.video_style}"
            )

        output_path = os.path.join(output_dir, f"scene_{scene.scene_number:02d}.mp4")
        result = generate_scene_video(
            scene=scene,
            image_path=image_path,
            output_path=output_path,
            storyboard_format=storyboard.commercial_format,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            mode=mode,
            api_key=api_key,
            video_hints=scene_hints,
            video_model=video_model,
            model_context=model_context,
            actions_catalog=actions_catalog,
        )
        # Log the actual prompt back into the storyboard scene
        if result.get("grok_video_prompt"):
            scene.grok_video_prompt = result["grok_video_prompt"]
        if result.get("status") == "success":
            video_paths.append(result["video_path"])

    print(f"\n  Generated {len(video_paths)}/{len(scenes_with_images)} scene videos")
    return video_paths


# ── Lifestyle: GPT-Refined Per-Scene Video Generation ───────────────────
#
# Mirrors the UGC prompt-refinement pattern but for lifestyle ads:
# N keyframes → GPT 5.4 describes each keyframe → GPT 5.4 refines scene
# prompts using the Grok Imagine prompting guide → per-scene image-to-video.

_GROK_PROMPTING_GUIDE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "Grok_imagine_prompting_guide.md",
)

_LIFESTYLE_REFINE_SYSTEM = """\
You are a Grok Imagine video prompt engineer specializing in lifestyle \
product advertisement videos.

You will receive:
1. The Grok Imagine prompting guide (rules for writing effective Grok video prompts)
2. The image generation prompt used to create each scene's keyframe (the starting frame)
3. N scene descriptions — one per scene, each with its own duration, action, \
and camera/motion/style hints.

Your job is to build N production-ready Grok Imagine image-to-video prompts — \
one per scene — that together produce a set of polished, cinematic lifestyle \
ad clips that will be stitched together.

KEY RULES FROM THE GROK GUIDE:
- Name your camera movement explicitly: "slow dolly in", "pan right", "static wide".
- Name your lighting: "golden hour backlight", "overcast diffused light", etc.
- Reference moods, not just adjectives: "Blade Runner mood" or "Studio Ghibli feel" \
gives Grok a rich visual library.
- Keep compositions focused: clear subject against defined background.
- Go wider for people in video: wider shots and slower movements are cleanest.

PROMPT DENSITY — CRITICAL:
- Write RICH, LAYERED prompts. Grok has the keyframe as visual context, but it \
needs detailed textual guidance on motion, atmosphere, and pacing to fill the \
full duration without inventing its own actions.
- Each prompt should describe MULTIPLE simultaneous layers of activity:
  (a) PRIMARY ACTION: what the subject is doing (slow, continuous gesture)
  (b) SECONDARY MICRO-MOTION: breathing, subtle weight shifts, fabric movement
  (c) CAMERA BEHAVIOR: exact movement type, speed, and trajectory over the full clip
  (d) ENVIRONMENTAL MOTION: breeze through hair/fabric, shifting light, \
      background activity (leaves, curtains, distant figures)
  (e) ATMOSPHERIC DETAIL: air quality (dust motes in light, humid haze), \
      light behavior (dappled shadows shifting, warm glow intensifying), \
      material responses (fabric catching light as it moves, metal glinting)
  (f) AUDIO LANDSCAPE: specific ambient sounds — not just "ambient sound" but \
      "distant temple bells with soft birdsong and a faint breeze through cotton"
- The more specific and layered the prompt, the less likely Grok is to hallucinate \
abrupt movements or unnatural action changes to fill the duration.

TEMPORAL PACING — THE MOST IMPORTANT RULE:
- Every action described must be ONGOING and CONTINUOUS throughout the entire \
clip duration. NEVER describe an action that completes, finishes, or resolves \
within the clip. The clip should feel like a slice cut from a longer, unbroken \
moment.
- BAD: "She brushes the embroidery and then looks up." — This completes two \
actions, forcing Grok to rush through them or invent a third action to fill time.
- BAD: "She walks to the doorway and stops." — The stop creates a dead moment \
where Grok invents new motion to fill remaining frames.
- GOOD: "She is mid-stride along the veranda, each step unhurried, kurta hem \
swaying gently with her gait, one hand trailing lightly along the stone railing \
as warm morning light shifts across the embroidery with each movement."
- GOOD: "Her fingers are already resting on the embroidered border, tracing \
slowly along the lotus motifs as the cotton weave catches and releases the \
sidelight, her breathing gently lifting the fabric at the neckline."
- Think of each scene as a WINDOW into an already-happening moment. The action \
was already in progress when the clip began and continues beyond when it ends.
- Use present continuous tense ("is walking", "is tracing") or mid-action \
phrasing ("mid-stride", "continues to brush") rather than imperative starts \
("walks", "traces", "begins to").
- NEVER use sequential conjunctions within a single scene: no "then", "next", \
"after that", "before", "and then". Every described element should be SIMULTANEOUS.
- For camera movement, describe it as continuous and gradual: "camera drifts \
steadily closer throughout" not "camera dollies in and holds".
- End-of-clip behavior: the last described state should be an ONGOING action, \
never a resolved pose. The clip should feel like it could continue for another \
10 seconds without anything changing.

LIFESTYLE AD RULES:
- NO speech, NO voiceover, NO dialogue. Audio is natural ambient sound ONLY.
- Each scene is a self-contained shot from its keyframe — no cuts, no transitions.
- Preserve the subject, clothing, product details, and environment EXACTLY as \
shown in the keyframe image.
- Motion must be natural and physically plausible with stable anatomy and lighting.
- Keep movement subtle and cinematic — lifestyle ads are about mood and aspiration, \
not action sequences.
- Product must remain clearly visible and recognizable throughout.

FACIAL EXPRESSION AND BODY LANGUAGE — CRITICAL:
- NEVER describe exaggerated, theatrical, or posed facial expressions. No "beaming \
smile", "wide grin", "eyes lighting up", or "excited expression". These cause \
uncanny, artificial faces in video generation.
- Instead, describe SUBTLE, RELAXED micro-expressions: "soft neutral expression", \
"hint of a smile", "calm gaze", "relaxed brow", "natural resting face with slight \
warmth". Think candid photo, not posed portrait.
- Body language must feel CANDID and UNPERFORMED. Describe movement as if the \
person does not know they are being filmed: "absently adjusts sleeve", "shifts \
weight naturally", "glances down at the fabric". Avoid choreographed-feeling \
descriptions like "confidently poses" or "strikes a stance".
- NEVER ask for direct eye contact with camera in lifestyle ads. The subject \
should look at the product, the environment, or off-frame — never into the lens.
- Hands and fingers must be described with restraint. Avoid specific finger \
positions ("index finger traces"). Use vague, natural phrasing: "hand brushes \
the fabric", "fingers lightly touch the embroidery". Over-specifying hand motion \
causes distorted fingers and unnatural gestures.
- For standing/pausing moments, describe the body as SETTLING into stillness \
rather than HOLDING a pose. "She slows to a stop" not "she holds a confident pose".

PROMPT STRUCTURE:
Camera + lighting + mood/style reference + subject mid-action + simultaneous \
secondary motion + environmental detail + material/light interaction + \
atmospheric texture + specific ambient audio.

CONTINUITY:
- While each scene is independently generated from its own keyframe, the overall \
ad must feel cohesive in tone, pacing, and visual language.
- Use consistent lighting references and mood language across scenes.
- Camera movements should build a visual narrative (e.g. start wide, go closer, \
end with product reveal).

EXAMPLE (for reference only — adapt to each scene):
"Slow dolly-in drifting steadily closer throughout, clean sidelight from a high \
window casting long warm shadows across terracotta tiles, polished editorial \
realism with a Vogue Living sensibility. She is mid-gesture, her hand already \
resting on the embroidered lower border and continuing to trace slowly along \
the lotus and foliage chain motifs, the white threadwork catching and releasing \
the sidelight as the cotton shifts under her fingertips. Her other hand rests \
naturally on her lap, thumb absently smoothing the fabric. Gentle breathing \
lifts the neckline subtly. A faint breeze from off-frame stirs the loose end \
of her dupatta draped over the chair behind her. Dust motes drift through the \
column of window light. The brass diya on the shelf behind glints as the camera \
angle shifts. Distant temple bells with soft birdsong and the faint rustle of \
cotton under her fingers."

Output ONLY valid JSON with this exact structure:
{
  "prompts": [
    {"scene": 1, "prompt": "..."},
    {"scene": 2, "prompt": "..."},
    ...
  ],
  "reasoning": "Brief explanation of refinement choices"
}"""


def _refine_lifestyle_prompts(
    oai_client,
    model: str,
    grok_guide: str,
    scene_descriptions: list[dict],
) -> list[str]:
    """Use GPT to refine scene descriptions into Grok-optimized lifestyle prompts."""
    scenes_text = ""
    for sd in scene_descriptions:
        scenes_text += (
            f"Scene {sd['scene_number']} ({sd['duration']}s):\n"
            f"  KEYFRAME IMAGE PROMPT: {sd['image_description']}\n"
            f"  SCENE DESCRIPTION: {sd['description']}\n"
            f"  ACTION: {sd.get('action', 'minimal natural movement')}\n"
            f"  CAMERA HINT: {sd.get('camera_hint', '')}\n"
            f"  MOTION HINT: {sd.get('motion_hint', '')}\n"
            f"  STYLE HINT: {sd.get('style_hint', '')}\n\n"
        )

    user_message = f"""## Grok Imagine Prompting Guide
{grok_guide}

## Scene Keyframes and Descriptions
{scenes_text}

Build {len(scene_descriptions)} Grok Imagine image-to-video prompts. \
Write RICH, DETAILED prompts with multiple layers (primary action, secondary micro-motion, \
camera trajectory, environmental motion, atmospheric texture, specific ambient audio). \
Every action must be ONGOING and MID-PROGRESS — never completing or resolving within the clip. \
No speech or dialogue. Output ONLY the JSON."""

    response = oai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _LIFESTYLE_REFINE_SYSTEM},
            {"role": "user", "content": user_message},
        ],
        temperature=0.5,
        response_format={"type": "json_object"},
    )

    raw = response.choices[0].message.content
    parsed = json.loads(raw)
    prompts = [entry["prompt"] for entry in parsed["prompts"]]
    reasoning = parsed.get("reasoning", "")

    if reasoning:
        print(f"  GPT reasoning: {reasoning}")

    return prompts


def generate_lifestyle_video_chain(
    storyboard: Storyboard,
    keyframe_paths: list[str],
    output_dir: str,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    mode: str = "normal",
    video_model: str = "veo",
    api_key: str | None = None,
    disable_video_hints: bool = False,
) -> list[str]:
    """
    Generate lifestyle ad videos with GPT prompt refinement.

    Pipeline:
      1. GPT 5.4 describes each keyframe image (vision)
      2. GPT 5.4 refines scene descriptions + template hints into
         Grok-optimized prompts using the Grok Imagine prompting guide
      3. User confirms each scene before generation
      4. Per-scene image-to-video generation (Grok or Veo)

    Args:
        storyboard: Storyboard with scenes.
        keyframe_paths: List of keyframe image paths (one per scene).
        output_dir: Directory to save scene_XX.mp4 files.
        aspect_ratio: "16:9" or "9:16".
        resolution: "720p", "1080p", etc.
        mode: Grok motion intensity.
        video_model: "grok", "veo", or "veo-standard".
        api_key: Optional API key override.
        disable_video_hints: Skip video template hints.

    Returns:
        List of generated video paths in scene order.
    """
    from openai import OpenAI
    from openai_client import STORYBOARD_MODEL

    os.makedirs(output_dir, exist_ok=True)

    scenes = sorted(storyboard.scenes, key=lambda s: s.scene_number)
    if not scenes:
        print("  Error: No scenes in storyboard")
        return []

    # Match scenes to keyframes
    scenes_with_images = []
    for scene in scenes:
        expected_name = f"scene_{scene.scene_number:02d}.png"
        matched_path = None
        for kf_path in keyframe_paths:
            if os.path.basename(kf_path) == expected_name:
                matched_path = kf_path
                break
        if matched_path:
            scenes_with_images.append((scene, matched_path))
        else:
            print(f"  Warning: No keyframe for scene {scene.scene_number}, skipping")

    if not scenes_with_images:
        print("  Error: No scenes matched with keyframe images")
        return []

    # Load catalogs for hint extraction
    catalog = load_prompt_catalog()

    # ── Phase 1: GPT 5.4 Prompt Refinement ──────────────────────────────
    print(f"\n{'='*60}")
    print("  Lifestyle Chain: Prompt Refinement")
    print(f"{'='*60}")

    oai_key = os.environ.get("OPENAI_API_KEY")
    if not oai_key:
        print("  Error: OPENAI_API_KEY not set — falling back to template-based prompts")
        return generate_all_scene_videos(
            storyboard=storyboard,
            keyframe_paths=keyframe_paths,
            output_dir=output_dir,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            mode=mode,
            api_key=api_key,
            disable_video_hints=disable_video_hints,
            video_model=video_model,
        )

    oai_client = OpenAI(api_key=oai_key)

    # Step 1a: Build scene descriptions from existing storyboard data
    # (Skip GPT vision keyframe description — the image_prompt that generated
    # the keyframe is a better description than reverse-engineering one from
    # the output image, and the keyframe itself is passed visually to Grok.)
    print(f"  Building scene context from {len(scenes_with_images)} storyboard scenes...")
    scene_descriptions = []
    for scene, kf_path in scenes_with_images:
        print(f"    Scene {scene.scene_number}: {os.path.basename(kf_path)}")
        print(f"      → {scene.image_prompt[:100]}...")

        # Extract template hints for this scene
        if disable_video_hints:
            camera_hint = ""
            motion_hint = ""
            style_hint = ""
        else:
            video_hints = _get_video_template_hints(
                catalog,
                scene.video_motion_type or storyboard.video_motion_type,
                scene.video_camera_technique or storyboard.video_camera_technique,
                scene.video_style or storyboard.video_style,
            )
            camera_hint = _extract_hint(video_hints, "Camera")
            motion_hint = _extract_hint(video_hints, "Motion")
            style_hint = _extract_hint(video_hints, "Video style")

        duration = _resolve_scene_duration(scene, "lifestyle", video_model, resolution)

        scene_descriptions.append({
            "scene_number": scene.scene_number,
            "image_description": scene.image_prompt,
            "description": scene.description,
            "action": scene.action or "minimal natural movement",
            "camera_hint": camera_hint,
            "motion_hint": motion_hint,
            "style_hint": style_hint,
            "duration": duration,
        })

    # Step 1b: Load Grok Imagine prompting guide
    if os.path.exists(_GROK_PROMPTING_GUIDE_PATH):
        with open(_GROK_PROMPTING_GUIDE_PATH) as f:
            grok_guide = f.read()
    else:
        print(f"  Warning: Grok guide not found at {_GROK_PROMPTING_GUIDE_PATH}")
        grok_guide = "(Guide not available)"

    # Step 1c: Refine scene descriptions into Grok-optimized prompts
    print(f"  Refining {len(scene_descriptions)} scenes into Grok-optimized prompts...")
    refined_prompts = _refine_lifestyle_prompts(
        oai_client, STORYBOARD_MODEL, grok_guide, scene_descriptions,
    )

    if len(refined_prompts) != len(scenes_with_images):
        print(
            f"  Warning: GPT returned {len(refined_prompts)} prompts for "
            f"{len(scenes_with_images)} scenes. Padding/truncating."
        )
        while len(refined_prompts) < len(scenes_with_images):
            scene, _ = scenes_with_images[len(refined_prompts)]
            refined_prompts.append(
                f"Subtle organic movement, camera slowly pulls back. "
                f"Natural ambient sound. {scene.description}"
            )
        refined_prompts = refined_prompts[:len(scenes_with_images)]

    for i, prompt in enumerate(refined_prompts):
        scene, _ = scenes_with_images[i]
        print(f"\n  [Scene {scene.scene_number}] ({scene_descriptions[i]['duration']}s)")
        print(f"    Grok prompt: {prompt[:200]}...")

    # Save refinement artifacts
    artifacts = {
        "guide_used": "Grok_imagine_prompting_guide.md",
        "video_model": video_model,
        "scenes": [
            {
                "scene_number": sd["scene_number"],
                "duration": sd["duration"],
                "keyframe_image_prompt": sd["image_description"],
                "scene_description": sd["description"],
                "refined_prompt": refined_prompts[i],
            }
            for i, sd in enumerate(scene_descriptions)
        ],
    }
    artifacts_path = os.path.join(output_dir, "lifestyle_prompt_refinement.json")
    with open(artifacts_path, "w") as f:
        json.dump(artifacts, f, indent=2)
    print(f"\n  Saved prompt refinement: {artifacts_path}")

    # ── Phase 2: Per-Scene Video Generation ─────────────────────────────
    model_label = {
        "grok": "Grok Imagine Video",
        "veo": "Veo 3.1 Fast",
        "veo-standard": "Veo 3.1 Standard",
    }.get(video_model, video_model)

    print(f"\n{'='*60}")
    print(f"  Lifestyle Chain: {model_label} Video Generation")
    print(f"    Scenes: {len(scenes_with_images)} | Resolution: {resolution} | Aspect: {aspect_ratio}")
    print(f"{'='*60}")

    video_paths = []
    for i, (scene, kf_path) in enumerate(scenes_with_images):
        prompt = refined_prompts[i]
        dur = scene_descriptions[i]["duration"]
        output_path = os.path.join(output_dir, f"scene_{scene.scene_number:02d}.mp4")

        # Log the refined prompt back to the storyboard scene
        scene.grok_video_prompt = prompt

        # ── Confirmation prompt ──
        print(f"\n  ┌─ Scene {scene.scene_number} ({dur}s) ──────────")
        for line in prompt.split(". "):
            stripped = line.strip().rstrip(".")
            if stripped:
                print(f"  │ {stripped}.")
        print(f"  └──────────────────────────────────────")
        while True:
            confirm = input(f"  Proceed with Scene {scene.scene_number}? [Y/n/skip] ").strip().lower()
            if confirm in ("", "y", "yes"):
                break
            elif confirm in ("n", "no"):
                print("  Aborting lifestyle chain generation.")
                return video_paths
            elif confirm == "skip":
                print(f"  Skipping scene {scene.scene_number}.")
                break
            else:
                print("  Enter Y to proceed, N to abort, or 'skip' to skip this scene.")

        if confirm == "skip":
            continue

        print(f"\n  [Scene {scene.scene_number}] Image-to-Video ({dur}s) via {model_label}")
        print(f"    Keyframe: {kf_path}")

        result = generate_video(
            video_model=video_model,
            prompt=prompt,
            image_paths=[kf_path],
            duration=dur,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            mode=mode,
            output_path=output_path,
        )

        result["grok_video_prompt"] = prompt

        if result.get("status") == "success":
            video_paths.append(result["video_path"])
            gen_time = result.get("generation_time_ms", 0)
            print(f"    Saved: {result['video_path']} ({gen_time / 1000:.0f}s)")
        else:
            print(f"    FAILED: {result.get('error', 'Unknown error')}")

    print(f"\n  Generated {len(video_paths)}/{len(scenes_with_images)} lifestyle videos")
    return video_paths


# ── New UGC: Extension-Chained Video Generation ────────────────────────
#
# Follows the prompting philosophy from the Veo prompting guide:
# one keyframe → GPT 5.4 refines narration into Veo-optimized prompts
# → image-to-video (scene 1) → extend with each subsequent scene.


_VEO_PROMPTING_GUIDE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "Veo_prompting_guide.md",
)

_IMAGE_DESCRIBE_SYSTEM = """\
You are a visual analyst. Describe the given image in detail for use as a \
reference image description for a video generation model. Focus on:
- The person: appearance, clothing, pose, expression, ethnicity cues
- The product: what it is, brand/label if visible, how it's held or positioned
- The setting: background, lighting, colors, environment
- Overall composition and framing

Be precise and factual. This description will be used as the "Input image" \
context for Veo 3.1 video generation with reference images."""

_UGC_REFINE_SYSTEM = """\
You are a Veo 3.1 video prompt engineer specializing in UGC (user-generated \
content) influencer-style product videos.

You will receive:
1. The Veo prompting guide (rules for writing good Veo prompts)
2. A description of the reference image (the starting frame)
3. N narration segments — one per scene, each with its own duration. \
Scene 1 is image-to-video, scenes 2+ are extensions.
4. Product and storyboard context (brand, outfit, setting, etc.)

Your job is to build N structured scene descriptors — one per scene — \
that together produce a seamless, continuous UGC video of a person speaking to \
camera about a product, as if recorded by an influencer.

DIALOGUE — THE MOST IMPORTANT RULE:
- Each scene has a narration_segment provided. This is what the creator \
actually SAYS OUT LOUD. Use it VERBATIM as the spoken dialogue. \
Do NOT paraphrase, reword, shorten, or rephrase it. Copy it EXACTLY as given.
- If the narration contains parenthetical cues like "(smiling wide)" or \
"(touching fabric)", those are NOT spoken words. Strip them from the dialogue \
and fold them into the scene description instead.
- If the narration is too long for the scene duration, you may TRIM from the \
end (cut trailing words) but NEVER rewrite or substitute words.
- Dialogue that gets cut off mid-sentence causes audio hallucination artifacts. \
If you must trim, cut to the last complete sentence or clause.

SCENE DESCRIPTION RULES:
- The "scene" field must describe what the person is DOING — their physical \
actions, facial expressions, body language, and interaction with the product. \
It should read like a short film direction.
- NEVER specify left or right hand. The keyframe determines which hand is \
raised or extended — use "her raised hand", "her extended arm", etc.
- For scenes 2+, the scene description MUST start with "Extend this video with" \
as required by Veo's extension API.

REALISM RULES:
- NATURAL MICRO-EXPRESSIONS: Include subtle head nods and gentle eye rolls \
like how people react when talking about something from the top of their head.
- NO STUTTERING: The narration script must be spoken faithfully and clearly \
throughout the entire video duration. No stuttering, repeated words, or stumbles.
- BODY LANGUAGE DEPTH: Describe fidgeting, holding both hands together, \
shifting weight back and forth, adjusting posture, briefly touching hair or face. \
These small restless movements make the person feel genuinely human and unscripted.
- SEAMLESS TRANSITIONS: Each scene picks up exactly where the previous one ends.

CAMERA RULES:
- shot: Describe the framing (e.g. "medium close-up", "waist-up", "close-up on hands and product")
- movement: Describe subtle camera motion (e.g. "slight push in", "static with minor handheld drift", "gentle pull back")

AUDIO RULES:
- voice: Describe the vocal delivery (tone, energy, pace) — NOT the words themselves
- soundtrack: Ambient audio. Keep consistent across all scenes. No music unless requested.

Output ONLY valid JSON with this exact structure:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "scene": "A young woman holds a product up to camera and smiles naturally.",
      "dialogue": ["First line of dialogue.", "Second line if any."],
      "durationSeconds": 6,
      "style": "UGC-style, casual, authentic influencer vibe",
      "camera": {
        "shot": "medium close-up",
        "movement": "slight push in"
      },
      "lighting": "soft natural window light with warm tone",
      "environment": "same as reference image",
      "audio": {
        "voice": "clear, friendly female voice, conversational tone",
        "soundtrack": "very subtle ambient room tone"
      }
    },
    {
      "sceneNumber": 2,
      "scene": "Extend this video with the woman looking down at the product...",
      "dialogue": ["Next line of dialogue."],
      ...
    }
  ],
  "product": {
    "brand": "Brand name if known",
    "name": "Product name or description"
  },
  "reasoning": "Brief explanation of refinement choices"
}

IMPORTANT: The "scene" field (description) is the CORE of the Veo prompt. \
Make it vivid and specific. The dialogue, camera, lighting, and audio fields \
add structure but the scene description carries the visual direction."""


def _load_image_base64(path: str) -> tuple[str, str]:
    """Load image as base64, return (b64_string, mime_type)."""
    ext = os.path.splitext(path)[1].lower()
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, "image/png")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return b64, mime


def _describe_keyframe(oai_client, image_path: str, model: str) -> str:
    """Use GPT vision to describe the reference keyframe image."""
    b64, mime = _load_image_base64(image_path)
    response = oai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _IMAGE_DESCRIBE_SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe this reference image:"},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"},
                    },
                ],
            },
        ],
        temperature=0.3,
    )
    return response.choices[0].message.content


def _strip_parentheticals(text: str) -> tuple[str, list[str]]:
    """Strip parenthetical cues from narration, return (clean_dialogue, [cues])."""
    import re
    cues = re.findall(r'\(([^)]+)\)', text)
    clean = re.sub(r'\s*\([^)]*\)\s*', ' ', text).strip()
    # Collapse double spaces left by removal
    clean = re.sub(r'\s{2,}', ' ', clean).strip()
    return clean, cues


def _compose_veo_prompt(scene_data: dict) -> str:
    """Flatten a structured scene descriptor into a Veo-compatible text prompt.

    Takes the structured JSON fields (scene, dialogue, camera, lighting, etc.)
    and composes them into a single coherent text prompt that Veo understands.
    """
    parts = []

    # Scene description is the core visual direction
    scene_desc = scene_data.get("scene", "")
    if scene_desc:
        parts.append(scene_desc)

    # Dialogue in quotes — Veo uses quoted text for speech
    dialogue = scene_data.get("dialogue", [])
    if dialogue:
        quoted = " ".join(f'"{line}"' for line in dialogue)
        parts.append(f"She speaks naturally: {quoted}")

    # Style
    style = scene_data.get("style", "")
    if style:
        parts.append(style)

    # Camera
    camera = scene_data.get("camera", {})
    if camera:
        cam_parts = []
        if camera.get("shot"):
            cam_parts.append(camera["shot"])
        if camera.get("movement"):
            cam_parts.append(camera["movement"])
        if cam_parts:
            parts.append(f"Camera: {', '.join(cam_parts)}.")

    # Lighting
    lighting = scene_data.get("lighting", "")
    if lighting:
        parts.append(f"Lighting: {lighting}.")

    # Environment
    environment = scene_data.get("environment", "")
    if environment:
        parts.append(f"Setting: {environment}.")

    # Audio
    audio = scene_data.get("audio", {})
    if audio:
        audio_parts = []
        if audio.get("voice"):
            audio_parts.append(audio["voice"])
        if audio.get("soundtrack"):
            audio_parts.append(audio["soundtrack"])
        if audio_parts:
            parts.append(f"Audio: {'; '.join(audio_parts)}.")

    return " ".join(parts)


def _refine_ugc_prompts(
    oai_client,
    model: str,
    veo_guide: str,
    image_description: str,
    scenes: list[StoryboardScene],
    scene_durations: list[int],
    storyboard: Storyboard = None,
) -> list[str]:
    """Use GPT to refine narration segments into structured Veo prompts.

    Returns a list of composed text prompts ready for Veo, plus saves the
    structured JSON for debugging/iteration.
    """
    segments_text = ""
    for i, scene in enumerate(scenes):
        dur = scene_durations[i] if i < len(scene_durations) else scene_durations[-1]
        label = "image-to-video" if scene.scene_number == 1 else "video extension"
        narration = scene.narration_segment or scene.description
        clean_dialogue, cues = _strip_parentheticals(narration)
        cue_text = f"  DELIVERY CUES (describe as actions, do NOT speak): {', '.join(cues)}\n" if cues else ""
        segments_text += (
            f"Scene {scene.scene_number} ({label}, {dur} seconds):\n"
            f"  EXACT DIALOGUE: \"{clean_dialogue}\"\n"
            f"{cue_text}"
        )

    duration_note = ", ".join(f"Scene {i+1}: {d}s" for i, d in enumerate(scene_durations))

    # Build product/storyboard context
    context_lines = []
    if storyboard:
        if storyboard.subject_identity:
            context_lines.append(f"Subject: {storyboard.subject_identity}")
        if storyboard.subject_outfit:
            context_lines.append(f"Outfit/Product: {storyboard.subject_outfit}")
        if storyboard.music_direction:
            context_lines.append(f"Music direction: {storyboard.music_direction}")
    context_text = "\n".join(context_lines) if context_lines else "(not provided)"

    user_message = f"""## Veo Prompting Guide
{veo_guide}

## Reference Image Description (Generated by Nano Banana)
{image_description}

## Product & Storyboard Context
{context_text}

## Narration Segments (USE VERBATIM — do NOT paraphrase or reword)
{segments_text}

## Video Durations
{duration_note}
The EXACT DIALOGUE text above must appear word-for-word in the dialogue array. \
If a line is too long for the duration, trim from the end at a sentence boundary, \
but NEVER substitute different words.

## Aspect Ratio
{storyboard.aspect_ratio if storyboard else '9:16'}

Build {len(scenes)} structured scene descriptors. Output ONLY the JSON."""

    response = oai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _UGC_REFINE_SYSTEM},
            {"role": "user", "content": user_message},
        ],
        temperature=0.5,
        response_format={"type": "json_object"},
    )

    raw = response.choices[0].message.content
    parsed = json.loads(raw)

    reasoning = parsed.get("reasoning", "")
    if reasoning:
        print(f"  GPT reasoning: {reasoning}")

    # Extract structured scenes and compose into Veo text prompts
    structured_scenes = parsed.get("scenes", [])
    prompts = []
    for scene_data in structured_scenes:
        prompt = _compose_veo_prompt(scene_data)
        prompts.append(prompt)

    # Store the full structured JSON for artifacts/debugging
    _refine_ugc_prompts._last_structured = parsed

    return prompts


_UGC_MAX_SCENES = 3
_UGC_DEFAULT_DURATIONS = [6, 8, 8]  # Scene 1 = 6s, scenes 2-3 = 8s


def generate_ugc_video_chain(
    storyboard: Storyboard,
    keyframe_path: str,
    output_dir: str,
    aspect_ratio: str = "16:9",
    resolution: str = "720p",
    scene_durations: Optional[list[int]] = None,
    api_key: Optional[str] = None,
) -> list[str]:
    """
    Generate a UGC video via Veo 3.1 extension chaining.

    Pipeline:
      1. GPT 5.4 describes the keyframe image (vision)
      2. GPT 5.4 refines narration segments into Veo-optimized prompts
      3. User confirms each scene before generation
      4. Veo 3.1 Fast generates scene 1 (image-to-video)
      5. Veo 3.1 Fast extends with each subsequent scene

    Args:
        storyboard: Storyboard with scenes containing narration_segments.
        keyframe_path: Path to the single keyframe image (scene 1).
        output_dir: Directory to save scene_XX.mp4 files.
        aspect_ratio: "16:9" or "9:16".
        resolution: "720p", "1080p", or "4k".
        scene_durations: Duration per scene in seconds [6, 8, 8].
            Defaults to [6, 8, 8]. Each value is snapped to nearest valid (4, 6, 8) by Veo.
        api_key: Optional Gemini API key override.

    Returns:
        List of generated video paths in scene order.
    """
    from openai import OpenAI
    from openai_client import STORYBOARD_MODEL
    from veo_video_client import generate_video as veo_generate, extend_video

    os.makedirs(output_dir, exist_ok=True)

    scenes = sorted(storyboard.scenes, key=lambda s: s.scene_number)
    # Cap to max scenes
    if len(scenes) > _UGC_MAX_SCENES:
        print(f"  Capping scenes from {len(scenes)} to {_UGC_MAX_SCENES}")
        scenes = scenes[:_UGC_MAX_SCENES]

    if not scenes:
        print("  Error: No scenes in storyboard")
        return []

    durations = scene_durations or _UGC_DEFAULT_DURATIONS
    # Extend durations list if fewer entries than scenes
    while len(durations) < len(scenes):
        durations.append(durations[-1])
    durations = durations[:len(scenes)]

    # ── Phase 1: GPT 5.4 Prompt Refinement ──────────────────────────────
    print(f"\n{'='*60}")
    print("  UGC Chain: GPT 5.4 Prompt Refinement")
    print(f"{'='*60}")

    oai_key = os.environ.get("OPENAI_API_KEY")
    if not oai_key:
        print("  Error: OPENAI_API_KEY not set — required for UGC prompt refinement")
        return []

    oai_client = OpenAI(api_key=oai_key)

    # Step 1a: Describe the keyframe
    print(f"  Describing keyframe: {keyframe_path}")
    image_description = _describe_keyframe(oai_client, keyframe_path, STORYBOARD_MODEL)
    print(f"  Image description: {image_description[:120]}...")

    # Step 1b: Load Veo prompting guide
    if os.path.exists(_VEO_PROMPTING_GUIDE_PATH):
        with open(_VEO_PROMPTING_GUIDE_PATH) as f:
            veo_guide = f.read()
    else:
        print(f"  Warning: Veo prompting guide not found at {_VEO_PROMPTING_GUIDE_PATH}")
        veo_guide = "(Guide not available)"

    # Step 1c: Refine narration into structured Veo prompts
    print(f"  Refining {len(scenes)} narration segments into structured Veo prompts...")
    refined_prompts = _refine_ugc_prompts(
        oai_client, STORYBOARD_MODEL, veo_guide,
        image_description, scenes, durations,
        storyboard=storyboard,
    )

    if len(refined_prompts) != len(scenes):
        print(
            f"  Warning: GPT returned {len(refined_prompts)} prompts for "
            f"{len(scenes)} scenes. Padding/truncating."
        )
        while len(refined_prompts) < len(scenes):
            refined_prompts.append(f"Extend this video with {scenes[len(refined_prompts)].description}")
        refined_prompts = refined_prompts[: len(scenes)]

    for i, prompt in enumerate(refined_prompts):
        scene = scenes[i]
        label = "Image-to-Video" if i == 0 else "Extension"
        print(f"\n  [{label} Scene {scene.scene_number}] ({durations[i]}s)")
        print(f"    Narration: {scene.narration_segment or scene.description}")
        print(f"    Veo prompt: {prompt[:200]}...")

    # Save refinement artifacts (including full structured JSON from GPT)
    structured_data = getattr(_refine_ugc_prompts, "_last_structured", {})
    artifacts = {
        "image_description": image_description,
        "scene_durations": durations,
        "structured_prompts": structured_data,
        "composed_prompts": [
            {
                "scene_number": s.scene_number,
                "duration": durations[i],
                "narration": s.narration_segment or s.description,
                "veo_prompt": refined_prompts[i],
            }
            for i, s in enumerate(scenes)
        ],
    }
    artifacts_path = os.path.join(output_dir, "ugc_prompt_refinement.json")
    with open(artifacts_path, "w") as f:
        json.dump(artifacts, f, indent=2)
    print(f"\n  Saved prompt refinement: {artifacts_path}")

    # ── Phase 2: Veo 3.1 Extension Chain ────────────────────────────────
    dur_display = " + ".join(f"{d}s" for d in durations)
    print(f"\n{'='*60}")
    print("  UGC Chain: Veo 3.1 Video Generation")
    print(f"    Scenes: {len(scenes)} | Durations: {dur_display}")
    print(f"    Resolution: {resolution} | Aspect: {aspect_ratio}")
    print(f"{'='*60}")

    video_paths = []
    video_ref = None  # The Veo video object for chaining

    for i, scene in enumerate(scenes):
        prompt = refined_prompts[i]
        dur = durations[i]
        output_path = os.path.join(output_dir, f"scene_{scene.scene_number:02d}.mp4")

        # Log the refined prompt back to the storyboard scene
        scene.grok_video_prompt = prompt

        label = "Image-to-Video" if i == 0 else "Extension"

        # ── Confirmation prompt ──
        print(f"\n  ┌─ Scene {scene.scene_number} ({label}, {dur}s) ──────────")
        # Print full prompt, wrapped with indent
        for line in prompt.split(". "):
            print(f"  │ {line.strip()}.")
        print(f"  └──────────────────────────────────────")
        while True:
            confirm = input(f"  Proceed with Scene {scene.scene_number}? [Y/n/skip] ").strip().lower()
            if confirm in ("", "y", "yes"):
                break
            elif confirm in ("n", "no"):
                print("  Aborting UGC chain generation.")
                return video_paths
            elif confirm == "skip":
                print(f"  Skipping scene {scene.scene_number}.")
                break
            else:
                print("  Enter Y to proceed, N to abort, or 'skip' to skip this scene.")

        if confirm == "skip":
            continue

        if i == 0:
            # Scene 1: image-to-video
            print(f"\n  [Scene {scene.scene_number}] Image-to-Video ({dur}s)")
            print(f"    Keyframe: {keyframe_path}")
            result = veo_generate(
                prompt=prompt,
                image_paths=[keyframe_path],
                duration=dur,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                output_path=output_path,
                api_key=api_key,
                fast=True,
                person_generation="allow_adult",
            )
        else:
            # Scenes 2+: extend previous video
            print(f"\n  [Scene {scene.scene_number}] Video Extension ({dur}s)")
            if video_ref is None:
                print(f"    Error: No video reference from previous scene, skipping")
                continue
            result = extend_video(
                prompt=prompt,
                source_video=video_ref,
                duration=dur,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                output_path=output_path,
                api_key=api_key,
                fast=True,
            )

        if result.get("status") == "success":
            video_paths.append(result["video_path"])
            video_ref = result.get("_video_ref")
            gen_time = result.get("generation_time_ms", 0)
            print(f"    Saved: {result['video_path']} ({gen_time / 1000:.0f}s)")
        else:
            print(f"    FAILED: {result.get('error', 'Unknown error')}")
            # For extension chain, failure of one scene breaks the chain
            print(f"    Extension chain broken at scene {scene.scene_number}")
            break

    print(f"\n  Generated {len(video_paths)}/{len(scenes)} UGC chain videos")
    return video_paths
