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

Your job is to build N production-ready Veo 3.1 prompts — one per scene — \
that together produce a seamless, continuous UGC video of a person speaking to \
camera about a product, as if recorded by an influencer.

DIALOGUE — THE MOST IMPORTANT RULE:
- Each scene has a narration_segment provided. You MUST use that narration \
VERBATIM as the spoken dialogue in the prompt. Do NOT paraphrase, reword, \
shorten, or rephrase it. Copy it EXACTLY as given.
- Place the exact narration text inside quotes in a Dialogue line.
- If the narration is too long for the scene duration, you may TRIM from the \
end (cut trailing words) but NEVER rewrite or substitute words.
- Dialogue that gets cut off mid-sentence causes audio hallucination artifacts. \
If you must trim, cut to the last complete sentence or clause.

PROMPT STRUCTURE:
- For each scene, build a Veo prompt with these elements:
  Subject, Action, Style, Camera, Composition, Focus, Ambiance, Dialogue.
- Use parenthetical action cues before dialogue for delivery style \
(e.g., "(smiling, looking down at the fabric)").

OTHER CRITICAL RULES:
- SUBJECT CONTINUITY: ALL scenes must describe the SAME person with the SAME \
appearance, clothing, and setting as the reference image. Never change who they \
are or what they wear between scenes.
- REALISTIC MOTION: Describe natural body language — subtle hand gestures, \
slight head tilts, natural eye contact with camera. Avoid dramatic or \
exaggerated movements. The person should move like a real human filming a \
selfie/tripod video.
- SEAMLESS TRANSITIONS: Each scene must pick up exactly where the previous one \
ends. The last action/pose of scene N should flow into the first action of scene N+1.
- AUDIO CONTINUITY: Include ambient sound cues (soft room tone, etc.) that \
stay consistent across all scenes. No music unless the user asked for it.
- EXTENSION FORMAT: Scenes 2+ MUST be prefixed with "Extend this video with" \
as shown in the Veo prompting guide's extension section.
- The stitched video must feel like ONE unbroken take of a person telling a story.

Output ONLY valid JSON with this exact structure:
{
  "prompts": [
    {"scene": 1, "prompt": "..."},
    {"scene": 2, "prompt": "Extend this video with ..."},
    ...
  ],
  "reasoning": "Brief explanation of refinement choices"
}"""


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


def _refine_ugc_prompts(
    oai_client,
    model: str,
    veo_guide: str,
    image_description: str,
    scenes: list[StoryboardScene],
    scene_durations: list[int],
) -> list[str]:
    """Use GPT to refine narration segments into Veo-optimized extension prompts."""
    segments_text = ""
    for i, scene in enumerate(scenes):
        dur = scene_durations[i] if i < len(scene_durations) else scene_durations[-1]
        label = "image-to-video" if scene.scene_number == 1 else "video extension"
        narration = scene.narration_segment or scene.description
        segments_text += (
            f"Scene {scene.scene_number} ({label}, {dur} seconds):\n"
            f"  EXACT DIALOGUE: \"{narration}\"\n"
        )

    duration_note = ", ".join(f"Scene {i+1}: {d}s" for i, d in enumerate(scene_durations))

    user_message = f"""## Veo Prompting Guide
{veo_guide}

## Reference Image Description (Generated by Nano Banana)
{image_description}

## Narration Segments (USE VERBATIM — do NOT paraphrase or reword)
{segments_text}

## Video Durations
{duration_note}
The EXACT DIALOGUE text above must appear word-for-word in quotes in each prompt. \
If a line is too long for the duration, trim from the end at a sentence boundary, \
but NEVER substitute different words.

Build {len(scenes)} Veo 3.1 prompts. Output ONLY the JSON."""

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
    prompts = [entry["prompt"] for entry in parsed["prompts"]]
    reasoning = parsed.get("reasoning", "")

    if reasoning:
        print(f"  GPT reasoning: {reasoning}")

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

    # Step 1c: Refine narration into Veo prompts
    print(f"  Refining {len(scenes)} narration segments into Veo prompts...")
    refined_prompts = _refine_ugc_prompts(
        oai_client, STORYBOARD_MODEL, veo_guide,
        image_description, scenes, durations,
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

    # Save refinement artifacts
    artifacts = {
        "image_description": image_description,
        "scene_durations": durations,
        "scenes": [
            {
                "scene_number": s.scene_number,
                "duration": durations[i],
                "narration": s.narration_segment or s.description,
                "refined_prompt": refined_prompts[i],
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
