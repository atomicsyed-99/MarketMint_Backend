"""
LLM-based storyboard planner for ad video generation.

Takes a user query and optional reference images, then:
1. Classifies intent (use_case, style, subject) against the prompt template taxonomy
2. Classifies video motion, camera, and style against video taxonomy
3. Selects script framework, commercial format, emotional trigger, and domain
4. Generates subject_identity (face/body) and subject_outfit (default clothing)
5. Designs a multi-scene storyboard with per-scene image prompts
6. Assigns predefined actions from the action catalog (no hallucinated choreography)
7. Writes voiceover narration + music/SFX direction using script skills
8. Composes the final video prompt with AUDIO block

LLM: OpenAI GPT-5.4 (structured JSON output via Pydantic schema)
Image gen: NanoBanana 2 (unchanged)
Video gen: Grok / Veo (unchanged)
"""

import os
import re
import sys
from typing import Any, List, Optional

import pydantic
import yaml

# Add NanoBanana 2 source to path for src.* imports
_NB2_ROOT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "nanobana2-engineer-package (4)"
)
sys.path.insert(0, _NB2_ROOT)

from PIL import Image as PILImage

from openai_client import create_openai_client, openai_structured_call, STORYBOARD_MODEL
from prompt_safety import normalize_aspect_ratio, sanitize_generation_prompt
from script_skill_loader import AdScriptSkillLoader


# ---------------------------------------------------------------------------
# Pydantic models for structured LLM output
# ---------------------------------------------------------------------------


def _slugify_choice(value: str, fallback: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower()).strip("_")
    return value or fallback


class DirectorOption(pydantic.BaseModel):
    """One answer option for a clarifying question."""

    id: str = pydantic.Field(description="Stable option id for deterministic mapping")
    label: str = pydantic.Field(description="Short user-facing option label")
    description: str = pydantic.Field(
        default="", description="Optional short explanation shown to the user"
    )
    mappings: dict[str, Any] = pydantic.Field(
        default_factory=dict,
        description="Structured mapping payload used to drive deterministic planning",
    )


class DirectorQuestion(pydantic.BaseModel):
    """A clarifying question from the Ad Director to the user."""

    id: str = pydantic.Field(description="Stable question id for deterministic mapping")
    question: str = pydantic.Field(description="The question to ask the user")
    options: list[DirectorOption] = pydantic.Field(
        description="3-4 numbered options for the user to choose from. Should cover the most likely preferences for this decision."
    )

    @pydantic.model_validator(mode="before")
    @classmethod
    def _normalize_options(cls, data):
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        normalized["id"] = normalized.get("id") or _slugify_choice(
            normalized.get("question", "question"), "question"
        )

        raw_options = normalized.get("options", []) or []
        cooked_options = []
        for idx, option in enumerate(raw_options, 1):
            if isinstance(option, str):
                cooked_options.append(
                    {
                        "id": f"{normalized['id']}_option_{idx}",
                        "label": option,
                    }
                )
                continue

            if isinstance(option, dict):
                item = dict(option)
                label = str(item.get("label") or item.get("text") or "").strip()
                item["label"] = label or f"Option {idx}"
                item["id"] = item.get("id") or _slugify_choice(
                    item["label"], f"{normalized['id']}_option_{idx}"
                )
                cooked_options.append(item)

        normalized["options"] = cooked_options
        return normalized


class DirectorBrief(pydantic.BaseModel):
    """Output of the Ad Director's analysis — constrains the storyboard planner."""

    product_analysis: str = pydantic.Field(
        description="What the director observes about the product/service from images and query"
    )
    recommended_format: str = pydantic.Field(
        description="Recommended commercial format slug (lifestyle, ugc, ugc_legacy)"
    )
    format_reasoning: str = pydantic.Field(
        description="1-2 sentence explanation of why this format best fits the product and goal"
    )
    recommended_framework: str = pydantic.Field(
        description="Recommended copywriting framework slug for UGC (aida, pas, fab) or 'none' for framework-free formats like lifestyle"
    )
    target_platform: str = pydantic.Field(
        default="instagram_reels",
        description="Inferred or user-selected target platform",
    )
    domain: str = pydantic.Field(
        default="general",
        description="Product domain slug (luxury, tech, food, fashion, beauty, fitness, general)",
    )
    questions: list[DirectorQuestion] = pydantic.Field(
        description="2-3 targeted clarifying questions informed by the recommendation"
    )
    # Filled after user interaction
    user_answers: list[str] = pydantic.Field(
        default_factory=list, description="User's answers to the clarifying questions"
    )
    user_answer_option_ids: list[str] = pydantic.Field(
        default_factory=list,
        description="Selected option ids for deterministic answers; empty string for custom answers",
    )
    user_answer_mappings: list[dict[str, Any]] = pydantic.Field(
        default_factory=list,
        description="Resolved mapping payload for each selected option; empty for custom answers",
    )


class _LLMDirectorQuestion(pydantic.BaseModel):
    question: str = pydantic.Field(description="The question to ask the user")
    options: list[str] = pydantic.Field(
        description="3-4 numbered options for the user to choose from"
    )


class _LLMDirectorBrief(pydantic.BaseModel):
    product_analysis: str = pydantic.Field(
        description="What the director observes about the product/service from images and query"
    )
    recommended_format: str = pydantic.Field(
        description="Recommended commercial format slug (lifestyle, ugc)"
    )
    format_reasoning: str = pydantic.Field(
        description="1-2 sentence explanation of why this format best fits the product and goal"
    )
    recommended_framework: str = pydantic.Field(
        description="Recommended copywriting framework slug for UGC (aida, pas, fab) or 'none'"
    )
    target_platform: str = pydantic.Field(
        default="instagram_reels",
        description="Inferred or user-selected target platform",
    )
    domain: str = pydantic.Field(
        default="general",
        description="Product domain slug (luxury, tech, food, fashion, beauty, fitness, general)",
    )
    questions: list[_LLMDirectorQuestion] = pydantic.Field(
        default_factory=list,
        description="2-3 targeted clarifying questions informed by the recommendation",
    )


class StoryboardScene(pydantic.BaseModel):
    scene_number: int = pydantic.Field(description="1-indexed scene number")
    scene_type: str = pydantic.Field(
        default="",
        description="Scene type slug from the format's scene_types (e.g. 'ambient_entry', 'creator_open')",
    )
    description: str = pydantic.Field(
        description="Brief description of what happens in this scene — must be achievable in a single continuous shot with no cuts or costume changes"
    )
    image_prompt: str = pydantic.Field(
        description="Detailed image generation prompt for this scene's keyframe. "
        "Include subject, composition, lighting, camera angle, and style details. "
        "This will be fed to image generation."
    )
    duration_hint: float = pydantic.Field(
        description="Suggested duration in seconds for this scene (2-8s). Must fall within the action's duration_range."
    )
    narration_segment: str = pydantic.Field(
        default="",
        description="Voiceover narration text for this specific scene. "
        "Should flow naturally when heard in sequence with other scenes' segments. "
        "Together, all scene narration_segments should form the full narration_script.",
    )
    # Action slug from the actions catalog
    action: str = pydantic.Field(
        default="",
        description="Action slug from the ACTIONS catalog (e.g. 'talk_to_camera', 'gentle_twirl', 'hold_product_up'). "
        "MUST be one of the allowed_actions for this scene's scene_type. Do NOT invent actions.",
    )
    # Per-scene outfit override (if different from default subject_outfit)
    scene_outfit: str = pydantic.Field(
        default="",
        description="Per-scene outfit description. Only set this if this scene requires different "
        "clothing than the default subject_outfit. Leave empty to use the default.",
    )
    # Per-scene video hints (override storyboard-level globals when set)
    video_motion_type: str = pydantic.Field(
        default="",
        description="Per-scene motion type override (e.g. 'cinematic', 'slow_motion', 'action')",
    )
    video_camera_technique: str = pydantic.Field(
        default="",
        description="Per-scene camera technique override (e.g. 'dolly_in', 'handheld', 'orbit')",
    )
    video_style: str = pydantic.Field(
        default="",
        description="Per-scene video style override (e.g. 'cinematic_video', 'raw_video', 'editorial_video')",
    )
    # Logged after video generation — the actual video prompt sent to the API
    grok_video_prompt: str = pydantic.Field(
        default="",
        description="The actual prompt sent to the video generation API for this scene (logged post-generation)",
    )

    # --- Backward compatibility: accept old fields on load, ignore them ---
    motion_plan: str = pydantic.Field(default="", exclude=True)
    keyframe_pose: str = pydantic.Field(default="", exclude=True)
    pose: str = pydantic.Field(default="", exclude=True)


class Storyboard(pydantic.BaseModel):
    aspect_ratio: str = pydantic.Field(
        default="16:9",
        description="Exact aspect ratio requested by the user and used across image/video generation",
    )
    use_case: str = pydantic.Field(
        description="Matched use case slug from the taxonomy"
    )
    style: str = pydantic.Field(description="Matched style slug from the taxonomy")
    subject: str = pydantic.Field(description="Matched subject slug from the taxonomy")
    subject_identity: str = pydantic.Field(
        default="",
        description="Physical identity of the main subject that NEVER changes across scenes: "
        "face shape, skin tone, hair color/style/length, eye color, age range, body type, "
        "height build, distinguishing features. For products: exact shape, material, color, "
        "branding, dimensions. This is the ONLY part used for subject lock — no clothing here.",
    )
    subject_outfit: str = pydantic.Field(
        default="",
        description="Default outfit for the subject — the main product or clothing being advertised. "
        "Include specific garments, colors, fabric type, accessories. Scenes can override this "
        "via scene_outfit if needed.",
    )
    scenes: List[StoryboardScene] = pydantic.Field(
        description="Ordered list of scenes for the ad"
    )
    narration_script: str = pydantic.Field(
        description="Full voiceover narration text for the entire video. "
        "Write concise, compelling ad copy that flows across all scenes."
    )
    music_direction: str = pydantic.Field(
        description="Music and sound design direction (e.g. 'upbeat electronic, building energy, "
        "cymbal swell at climax, soft piano outro')"
    )
    video_prompt: str = pydantic.Field(
        description="Complete prompt for video generation. Describe the visual flow across "
        "all scenes, camera movements, and include an AUDIO block with the "
        "narration script and music direction."
    )

    # Video template classifications
    video_motion_type: str = pydantic.Field(
        default="cinematic",
        description="Matched video motion type slug (slow_motion, action, cinematic, reveal)",
    )
    video_camera_technique: str = pydantic.Field(
        default="dolly_in",
        description="Matched video camera technique slug (dolly_in, tracking, static, handheld, orbit)",
    )
    video_style: str = pydantic.Field(
        default="cinematic_video",
        description="Matched video style slug (cinematic_video, editorial_video, raw_video)",
    )

    # Script skill classifications
    script_framework: str = pydantic.Field(
        default="none",
        description="Matched copywriting framework slug for UGC (aida, pas, fab) or 'none' for framework-free formats like lifestyle",
    )
    commercial_format: str = pydantic.Field(
        default="lifestyle",
        description="Matched commercial format slug (lifestyle, ugc, ugc_legacy)",
    )
    emotional_trigger: str = pydantic.Field(
        default="aspiration",
        description="Matched emotional trigger slug (scarcity, social_proof, authority, aspiration, nostalgia, curiosity, belonging)",
    )
    domain: str = pydantic.Field(
        default="general",
        description="Matched domain slug (luxury, tech, food, fashion, beauty, fitness, general)",
    )

    # --- Backward compatibility ---
    @pydantic.model_validator(mode="before")
    @classmethod
    def _migrate_old_fields(cls, data):
        """Handle old storyboard JSON files that have subject_definition instead of split fields."""
        if isinstance(data, dict):
            if "subject_definition" in data and "subject_identity" not in data:
                data["subject_identity"] = data.pop("subject_definition")
                data["subject_outfit"] = data.get("subject_outfit", "")
            elif "subject_definition" in data:
                # Both present — drop the old one
                data.pop("subject_definition", None)
        return data


# ---------------------------------------------------------------------------
# Template catalog loader
# ---------------------------------------------------------------------------

_TEMPLATE_FILES = (
    "use_cases.yaml",
    "styles.yaml",
    "subjects.yaml",
    "video_motion_types.yaml",
    "video_camera.yaml",
    "video_styles.yaml",
    "veo_ad_skills.yaml",
)


def load_prompt_catalog(templates_dir: str = None) -> dict:
    """Load all YAML template files into a structured catalog."""
    if templates_dir is None:
        templates_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "prompt_templates"
        )

    catalog = {}
    for filename in _TEMPLATE_FILES:
        filepath = os.path.join(templates_dir, filename)
        if os.path.exists(filepath):
            with open(filepath, "r", encoding="utf-8") as f:
                entries = yaml.safe_load(f) or []
                key = filename.replace(".yaml", "")
                catalog[key] = {entry["slug"]: entry for entry in entries}
        else:
            catalog[filename.replace(".yaml", "")] = {}

    # Load poses catalog (nested by category: standing, sitting, pov, motion_ready)
    poses_path = os.path.join(templates_dir, "poses.yaml")
    if os.path.exists(poses_path):
        with open(poses_path, "r", encoding="utf-8") as f:
            poses_data = yaml.safe_load(f) or {}
        poses_flat = {}
        for category, entries in poses_data.items():
            if isinstance(entries, list):
                for entry in entries:
                    entry["category"] = category
                    poses_flat[entry["slug"]] = entry
        catalog["poses"] = poses_flat
    else:
        catalog["poses"] = {}

    # Load actions catalog (nested by category)
    actions_path = os.path.join(templates_dir, "actions.yaml")
    if os.path.exists(actions_path):
        with open(actions_path, "r", encoding="utf-8") as f:
            actions_data = yaml.safe_load(f) or {}
        actions_flat = {}
        for category, entries in actions_data.items():
            if isinstance(entries, list):
                for entry in entries:
                    entry["category"] = category
                    actions_flat[entry["slug"]] = entry
        catalog["actions"] = actions_flat
    else:
        catalog["actions"] = {}

    return catalog


def _catalog_to_taxonomy_text(catalog: dict) -> str:
    """Format the catalog into a text block for the LLM system prompt."""
    lines = []

    lines.append("## USE CASES (pick one slug):")
    for slug, entry in catalog.get("use_cases", {}).items():
        lines.append(f"  - {slug}: {entry['label']}")
        lines.append(f"    Structure: {entry.get('structure', '')}")
        lines.append(f"    Camera: {entry.get('camera_hint', '')}")
        lines.append(f"    Lighting: {entry.get('lighting_hint', '')}")

    lines.append("\n## STYLES (pick one slug):")
    for slug, entry in catalog.get("styles", {}).items():
        lines.append(f"  - {slug}: {entry['label']}")
        lines.append(f"    Directives: {entry.get('directives', '')}")
        lines.append(f"    Camera: {entry.get('camera_defaults', '')}")

    lines.append("\n## SUBJECTS (pick one slug):")
    for slug, entry in catalog.get("subjects", {}).items():
        lines.append(f"  - {slug}: {entry['label']}")
        lines.append(f"    Framing: {entry.get('framing_hint', '')}")
        lines.append(f"    Focus: {entry.get('focus_hint', '')}")

    # Video templates
    lines.append("\n## VIDEO MOTION TYPES (pick one slug):")
    for slug, entry in catalog.get("video_motion_types", {}).items():
        lines.append(f"  - {slug}: {entry['label']}")
        lines.append(f"    Motion: {entry.get('motion_hint', '')}")

    lines.append("\n## VIDEO CAMERA TECHNIQUES (pick one slug):")
    for slug, entry in catalog.get("video_camera", {}).items():
        lines.append(f"  - {slug}: {entry['label']}")
        lines.append(f"    Technique: {entry.get('technique_hint', '')}")

    lines.append("\n## VIDEO STYLES (pick one slug):")
    for slug, entry in catalog.get("video_styles", {}).items():
        lines.append(f"  - {slug}: {entry['label']}")
        lines.append(f"    Style: {entry.get('style_hint', '')}")

    # Actions catalog
    actions = catalog.get("actions", {})
    if actions:
        lines.append(
            "\n## ACTIONS (pick one slug per scene — must be in the scene_type's allowed_actions):"
        )
        current_cat = None
        for slug, entry in actions.items():
            cat = entry.get("category", "")
            if cat != current_cat:
                lines.append(f"  [{cat.upper()}]")
                current_cat = cat
            dr = entry.get("duration_range", [3, 6])
            lines.append(f"    - {slug}: {entry['label']} ({dr[0]}-{dr[1]}s)")
            lines.append(f"      Motion: {entry['motion_prompt'][:80]}...")
            lines.append(f"      Compatible: {', '.join(entry.get('scene_types', []))}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Template hint helpers
# ---------------------------------------------------------------------------


def _get_template_hints(catalog: dict, use_case: str, style: str, subject: str) -> str:
    """Extract the specific template hints for the matched classification."""
    hints = []

    uc = catalog.get("use_cases", {}).get(use_case)
    if uc:
        hints.append(f"[Use Case: {uc['label']}]")
        hints.append(f"  Structure: {uc.get('structure', '')}")
        hints.append(f"  Camera: {uc.get('camera_hint', '')}")
        hints.append(f"  Lighting: {uc.get('lighting_hint', '')}")
        hints.append(f"  Composition: {uc.get('composition_hint', '')}")

    st = catalog.get("styles", {}).get(style)
    if st:
        hints.append(f"[Style: {st['label']}]")
        hints.append(f"  Directives: {st.get('directives', '')}")
        hints.append(f"  Camera: {st.get('camera_defaults', '')}")
        hints.append(f"  Color: {st.get('color_palette_hint', '')}")

    su = catalog.get("subjects", {}).get(subject)
    if su:
        hints.append(f"[Subject: {su['label']}]")
        hints.append(f"  Framing: {su.get('framing_hint', '')}")
        hints.append(f"  Focus: {su.get('focus_hint', '')}")
        hints.append(f"  Composition: {su.get('composition_hint', '')}")

    return "\n".join(hints) if hints else ""


def _get_video_template_hints(
    catalog: dict, motion_type: str, camera_tech: str, video_style: str
) -> str:
    """Extract video template hints for the matched video classification."""
    hints = []

    vmt = catalog.get("video_motion_types", {}).get(motion_type)
    if vmt:
        hints.append(
            f"Motion: {vmt.get('motion_hint', '')}. Pacing: {vmt.get('pacing_hint', '')}"
        )

    vcam = catalog.get("video_camera", {}).get(camera_tech)
    if vcam:
        hints.append(f"Camera: {vcam.get('technique_hint', '')}")

    vst = catalog.get("video_styles", {}).get(video_style)
    if vst:
        hints.append(f"Video style: {vst.get('style_hint', '')}")

    return "\n".join(hints) if hints else ""


# ---------------------------------------------------------------------------
# Ad Director — lightweight pre-planning step
# ---------------------------------------------------------------------------

DIRECTOR_SYSTEM_PROMPT = """\
You are a senior ad creative director at a top agency. Your job is to analyze a product or service \
and recommend the best commercial format and copywriting framework for an ad video.

You will:
1. Analyze the product/service from the user's description and any reference images provided.
2. Recommend ONE commercial format from the available options.
3. Recommend ONE copywriting framework only when the format needs it. For lifestyle, set framework to 'none'.
4. Infer the most likely target platform.
5. Classify the product domain (fashion, beauty, food, tech, fitness, luxury, or general).
6. Generate 2-3 targeted clarifying questions that will help you produce a better ad. \
   Each question should have 3-4 concrete options relevant to the product and format.

Your questions should be informed by your format recommendation. For example:
- For a lifestyle ad: ask about the setting, daily-use moments, and mood
- For a UGC ad: ask about the creator persona, tone (excited vs. chill), and specific features to highlight

Keep questions concise and actionable. The user is a business owner, not a filmmaker — \
frame options in terms they understand.
"""

DIRECTOR_USER_PROMPT = """\
Available commercial formats:
{format_options}

Available copywriting frameworks:
{framework_options}

Use 'none' when the chosen format does not need a framework.

---

User Request: "{user_query}"

{image_context}

Analyze this request and recommend the best format and framework. \
Generate 2-3 clarifying questions with options. \
Return your response as structured JSON matching the DirectorBrief schema."""


class AdDirector:
    """Lightweight ad director that analyzes the product and asks clarifying questions."""

    def __init__(self, client=None, script_loader=None):
        self.client = client
        self.script_loader = script_loader or AdScriptSkillLoader()

    def analyze_and_recommend(
        self,
        user_query: str,
        uploaded_images: Optional[List] = None,
    ) -> DirectorBrief:
        """Analyze product and recommend format + framework with clarifying questions."""
        if not self.client:
            return DirectorBrief(
                product_analysis="Unable to analyze — no API key configured.",
                recommended_format="lifestyle",
                format_reasoning="Defaulting to lifestyle format.",
                recommended_framework="none",
                target_platform="instagram_reels",
                domain="general",
                questions=[],
            )

        format_labels = self.script_loader.get_format_labels()
        format_options = "\n".join(
            f"  - {slug}: {label}" for slug, label in format_labels.items()
        )

        frameworks = self.script_loader.skills_data.get("frameworks", {})
        framework_options = "\n".join(f"  - {slug}" for slug in frameworks)

        image_context = ""
        if uploaded_images:
            image_context = f"{len(uploaded_images)} reference image(s) of the product/service are provided. Study them carefully."

        user_prompt = DIRECTOR_USER_PROMPT.format(
            format_options=format_options,
            framework_options=framework_options,
            user_query=user_query,
            image_context=image_context,
        )

        # Build multimodal content
        if uploaded_images:
            contents = list(uploaded_images) + [user_prompt]
        else:
            contents = user_prompt

        print("\n[Ad Director] Analyzing product and planning ad approach...")

        llm_brief = openai_structured_call(
            client=self.client,
            system_prompt=DIRECTOR_SYSTEM_PROMPT,
            user_content=contents,
            response_model=_LLMDirectorBrief,
            temperature=0.5,
        )

        brief = DirectorBrief(
            product_analysis=llm_brief.product_analysis,
            recommended_format=llm_brief.recommended_format,
            format_reasoning=llm_brief.format_reasoning,
            recommended_framework=llm_brief.recommended_framework,
            target_platform=llm_brief.target_platform,
            domain=llm_brief.domain,
            questions=[
                DirectorQuestion.model_validate(
                    {"question": q.question, "options": q.options}
                )
                for q in llm_brief.questions
            ],
        )

        structured_questions = self._generate_questions_for_format(
            brief.recommended_format,
            brief.product_analysis,
            user_query=user_query,
            uploaded_images=uploaded_images,
            domain=brief.domain,
        )
        if structured_questions:
            brief.questions = structured_questions
        return brief

    def ask_user(
        self,
        brief: DirectorBrief,
        user_query: str = "",
        uploaded_images: Optional[List] = None,
    ) -> DirectorBrief:
        """Present recommendation, let user confirm/override format, then ask questions."""
        format_labels = self.script_loader.get_format_labels()

        print("\n" + "=" * 62)
        print("  AD DIRECTOR BRIEF")
        print("=" * 62)
        print(f"\n  Product Analysis:")
        print(f"    {brief.product_analysis}")
        print(f"\n  Recommended Framework: {brief.recommended_framework}")
        print(f"  Target Platform: {brief.target_platform}")

        # --- Step 1: Let user choose format ---
        print(f"\n  Ad Format (director recommends: {brief.recommended_format}):")
        print(f"    {brief.format_reasoning}")

        format_slugs = list(format_labels.keys())
        rec_idx = (
            format_slugs.index(brief.recommended_format) + 1
            if brief.recommended_format in format_slugs
            else 1
        )

        print(f"\n  Choose an ad format:")
        for j, slug in enumerate(format_slugs, 1):
            marker = " ← recommended" if slug == brief.recommended_format else ""
            print(f"    [{j}] {format_labels[slug]}{marker}")

        while True:
            raw = input(f"\n  Your choice (Enter={rec_idx} for recommended): ").strip()
            if not raw:
                chosen_slug = brief.recommended_format
                break
            try:
                choice = int(raw)
                if 1 <= choice <= len(format_slugs):
                    chosen_slug = format_slugs[choice - 1]
                    break
                else:
                    print(f"    Please enter 1-{len(format_slugs)}")
            except ValueError:
                raw_lower = raw.lower()
                matched = [
                    s
                    for s in format_slugs
                    if raw_lower in s or raw_lower in format_labels[s].lower()
                ]
                if matched:
                    chosen_slug = matched[0]
                    break
                print(f"    Couldn't match '{raw}'. Please enter a number.")

        print(f"    → {format_labels[chosen_slug]}")

        user_overrode_format = chosen_slug != brief.recommended_format
        brief.recommended_format = chosen_slug

        # --- Step 2: If user overrode, regenerate questions for new format ---
        if user_overrode_format and self.client:
            print(f"\n  Regenerating questions for {chosen_slug} format...")
            brief.questions = self._generate_questions_for_format(
                chosen_slug,
                brief.product_analysis,
                user_query,
                uploaded_images,
                domain=brief.domain,
            )

        # --- Step 3: Ask clarifying questions ---
        if not brief.questions:
            print("\n  No clarifying questions — proceeding.")
            print("=" * 62)
            return brief

        print(
            f"\n  {len(brief.questions)} question(s) to refine your {format_labels[chosen_slug]} ad:\n"
        )

        answers = []
        option_ids = []
        option_mappings = []
        for i, q in enumerate(brief.questions, 1):
            print(f"  Q{i}: {q.question}")
            for j, option in enumerate(q.options, 1):
                print(f"    [{j}] {option.label}")
                if option.description:
                    print(f"        {option.description}")
            print(f"    [0] Other (type your own)")

            while True:
                try:
                    raw = input(f"\n  Your choice (Q{i}): ").strip()
                    if not raw:
                        selected = q.options[0]
                        answers.append(selected.label)
                        option_ids.append(selected.id)
                        option_mappings.append(selected.mappings)
                        print(f"    → {selected.label}")
                        break
                    choice = int(raw)
                    if choice == 0:
                        custom = input("    Your answer: ").strip()
                        fallback = q.options[0]
                        answers.append(custom or fallback.label)
                        option_ids.append("")
                        option_mappings.append({})
                        break
                    elif 1 <= choice <= len(q.options):
                        selected = q.options[choice - 1]
                        answers.append(selected.label)
                        option_ids.append(selected.id)
                        option_mappings.append(selected.mappings)
                        print(f"    → {selected.label}")
                        break
                    else:
                        print(f"    Please enter 0-{len(q.options)}")
                except ValueError:
                    matched = next(
                        (
                            option
                            for option in q.options
                            if raw.lower() in {option.id.lower(), option.label.lower()}
                        ),
                        None,
                    )
                    if matched:
                        answers.append(matched.label)
                        option_ids.append(matched.id)
                        option_mappings.append(matched.mappings)
                        print(f"    → {matched.label}")
                        break
                    answers.append(raw)
                    option_ids.append("")
                    option_mappings.append({})
                    break

        brief.user_answers = answers
        brief.user_answer_option_ids = option_ids
        brief.user_answer_mappings = option_mappings
        print("\n" + "=" * 62)
        return brief

    def _generate_questions_for_format(
        self,
        format_slug: str,
        product_analysis: str,
        user_query: str = "",
        uploaded_images: Optional[List] = None,
        domain: str = "general",
    ) -> list[DirectorQuestion]:
        """Generate clarifying questions tailored to a specific format."""
        structured_questions = self.script_loader.get_question_set(format_slug, domain)
        if structured_questions:
            return [DirectorQuestion.model_validate(q) for q in structured_questions]

        if not self.client:
            return []

        format_labels = self.script_loader.get_format_labels()
        format_label = format_labels.get(format_slug, format_slug)

        scene_types = self.script_loader.get_format_scene_types(format_slug)
        scene_desc = ""
        if scene_types:
            scene_desc = "This format has these scene types:\n"
            for st in scene_types:
                scene_desc += f"  - {st['slug']} ({st['role']}): {st['visual']}\n"

        prompt = (
            f'The user wants a "{format_label}" ad for this product:\n'
            f"{product_analysis}\n\n"
            f'Original request: "{user_query}"\n\n'
            f"{scene_desc}\n"
            f"Generate 2-3 clarifying questions with 3-4 options each, "
            f"tailored specifically to making the best possible {format_label} ad. "
            f"Return as JSON matching the schema."
        )

        class _QuestionsOnly(pydantic.BaseModel):
            questions: list[_LLMDirectorQuestion]

        try:
            result = openai_structured_call(
                client=self.client,
                system_prompt=(
                    "You are a senior ad creative director. Generate 2-3 concise, "
                    "actionable clarifying questions with 3-4 options each. "
                    "Questions should be specific to the chosen ad format and product."
                ),
                user_content=prompt,
                response_model=_QuestionsOnly,
                temperature=0.5,
            )
            return [
                DirectorQuestion.model_validate(
                    {"question": q.question, "options": q.options}
                )
                for q in result.questions
            ]
        except Exception as e:
            print(f"    Warning: Could not generate format-specific questions: {e}")
            return []


# ---------------------------------------------------------------------------
# Storyboard planner
# ---------------------------------------------------------------------------

PLANNER_SYSTEM_PROMPT = """\
You are a practical ad storyboard planner. Build a believable, production-friendly multi-scene video storyboard.

You will:
1. Classify the request against the provided taxonomy (use_case, style, subject).
2. Classify video generation settings (video_motion_type, video_camera_technique, video_style).
3. Select the best script_framework, commercial_format, emotional_trigger, and domain for this ad. Use script_framework='none' for lifestyle and other framework-free formats. Use aida/pas/fab for UGC and ugc_legacy.
4. Write a short subject_identity that stays constant across all scenes. Include only stable visual traits \
   needed for continuity. Do NOT include clothing.
5. Write a subject_outfit describing the default product/outfit with concrete visual details.
6. Design {{num_frames}} scenes that tell a compelling ad story following the selected format. If script_framework is not 'none', use it to shape the narration only.
7. Write a detailed image generation prompt for each scene. Every scene's image_prompt MUST begin with \
   the subject_identity text to lock visual consistency, followed by the outfit for that scene.
   Use the exact user-requested aspect ratio {aspect_ratio} in every scene. Ignore any conflicting template ratio.
8. For each scene, select ONE action from the ACTIONS catalog. The action MUST be listed in the \
   scene_type's allowed_actions. Do NOT invent new actions or choreography.
9. Write a voiceover narration script following the selected commercial format and emotional trigger. \
   Write a narration_segment for each individual scene.
   FOR UGC FORMATS: The narration must sound like a REAL PERSON telling a genuine personal story \
   about discovering and loving a product — NOT a marketing script. \
   Use first-person "I" and "my", reference real situations (a gift, an event, a friend asking, \
   a moment of surprise), and express genuine emotion (surprise, delight, relief, excitement). \
   NEVER use generic marketing phrases like "good option", "stands out", "would recommend", \
   "check it out", "grab it". Instead use vivid personal language and mini-anecdotes. \
   TIMING CONSTRAINT — a normal person speaks at roughly 2.5 words per second. \
   Each narration_segment MUST be short enough for a human to say comfortably within the scene duration: \
   - 6-second scene: MAX 12 words (roughly 1 short sentence) \
   - 8-second scene: MAX 17 words (1-2 short sentences) \
   Count your words. If a narration_segment exceeds the limit, rewrite it shorter. \
   It is MUCH better to be under the limit than over it — dialogue that gets cut off ruins the video.
10. Write music/SFX direction.
11. Compose a complete video prompt that describes the visual flow and includes an AUDIO block.
12. If the format is lifestyle, favor about 5 short visual beats with quick real-life actions. If the format is UGC, each spoken scene must contain one complete thought that can finish naturally inside the clip.

{script_skills_text}

VIDEO MODEL CONSTRAINTS (you MUST respect these limitations):
- Each scene produces a SINGLE CONTINUOUS SHOT from one keyframe image (2-8 seconds)
- NO cuts, jump cuts, transitions, or scene changes within a single scene
- NO clothing changes, costume swaps, or appearance morphing mid-scene
- NO text overlays, title cards, or graphics (added in post-production)
- Subject appearance MUST remain EXACTLY as in the keyframe image throughout the video
- Camera can move smoothly (dolly, track, orbit) but cannot teleport or cut
- Environment stays structurally stable — no warping walls or disappearing furniture
- Maximum realistic motion per scene: walking ~5 steps, one gesture, one reaction
- Do NOT plan scenes that require editing tricks (before/after reveals, hand-over-lens transitions, split screens)
- Keep scenes simple and natural — one clear action per scene
- Prefer ordinary realism over glossy ad cliches
- Avoid dramatic bokeh; backgrounds should stay readable unless the user explicitly requests otherwise

VISUAL VARIETY RULES (CRITICAL — real ads use distinct visual cuts, not repeated similar shots):
- Each scene MUST use an action from a DIFFERENT motion category. The categories are: \
locomotion, garment_interaction, body_movement, expression, static_pose, product_focus, \
talking, lifestyle_action. No two scenes may share the same category.
- No action slug may be repeated across scenes. Every scene gets a unique action.
- Vary camera framing across scenes — the storyboard MUST include at least one full-body shot, \
one medium/waist-up shot, and one close-up or detail shot. Do NOT use the same framing for all scenes.
- Vary backgrounds/environments meaningfully — avoid placing every scene in the same room or angle. \
Use different areas (entrance, living room, outdoor, near a window, etc.) or change the composition \
(subject centered vs. off-center, facing camera vs. profile vs. three-quarter).
- Think like a real ad editor: each cut should surprise the viewer with a new visual angle, \
energy level, or subject distance. If two adjacent scenes would look similar as thumbnails, \
redesign one of them.

Guidelines for scene image prompts (following structured prompt patterns):
- Each scene prompt should be self-contained and detailed enough for standalone image generation
- MUST start with the subject_identity to ensure the same person appears consistently
- Use this structure for each scene's image_prompt:
  [SUBJECT LOCK] {{subject_identity}}
  [ASSET LOCK] {{scene_outfit or subject_outfit}}
  [DO NOT CHANGE] [exact asset/product construction, shape, pattern placement, materials, trims, branding]
  [OUTFIT] {{scene_outfit or subject_outfit}}
  ### Scene: [brief scene description]
  ### Subject: [what/who is in the frame, specific details]
  ### Lighting: [simple real-world light description]
  ### Camera: [framing, viewpoint, aspect ratio, minimal lens detail only if needed]
  ### Style: [short grounded visual direction]
  ### Negative prompts: [brief list of specific artifacts to avoid]
- Maintain visual consistency across scenes (same subject, coherent color palette, consistent style)
- Scene 1 should be a hook/attention grabber
- Final scene should be a CTA or memorable closing shot
- CRITICAL FOR VARIETY: Vary the Camera line aggressively across scenes. Use a mix of:
  * Full-body wide shot (subject head-to-toe, environment visible)
  * Medium shot (waist-up or thigh-up, some environment)
  * Close-up or detail shot (hands on fabric, face, product texture)
  * Three-quarter or profile angle (not always facing camera)
  Do NOT use the same framing for all scenes. If every scene is a full-body front-facing shot, \
  the ad will look repetitive regardless of different actions.

Guidelines for the video_prompt:
- Describe the visual narrative arc across all scenes
- Include camera movements (pan, zoom, dolly, tracking)
- Maintain the exact aspect ratio {aspect_ratio} throughout
- End with an AUDIO block like:
  AUDIO: [music direction]. Narrator: "[narration script]"

Ad video duration will be {duration} seconds total — distribute scene durations accordingly.
"""

PLANNER_USER_PROMPT = """\
{taxonomy_text}

{script_taxonomy_text}

---

User Request: "{user_query}"

{image_context}

{template_hints}

Maintain exact aspect ratio {aspect_ratio} across every scene and the final video prompt.

Design a {num_frames}-scene storyboard for a {duration}-second ad video. \
Return your response as structured JSON matching the Storyboard schema."""


class StoryboardPlanner:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if self.api_key:
            self.client = create_openai_client()
        else:
            self.client = None
            print("Warning: OpenAI client not initialized — OPENAI_API_KEY not set.")

        self.catalog = load_prompt_catalog()
        self.script_loader = AdScriptSkillLoader()

    def _collect_selected_controls(
        self, director_brief: Optional[DirectorBrief]
    ) -> dict[str, Any]:
        merged: dict[str, Any] = {
            "shared": {"_hints": []},
            "scenes": {},
            "selected": [],
        }
        if not director_brief:
            return merged

        questions = director_brief.questions or []
        answers = director_brief.user_answers or []
        option_ids = director_brief.user_answer_option_ids or []
        payloads = director_brief.user_answer_mappings or []

        for question, answer, option_id, payload in zip(
            questions, answers, option_ids, payloads
        ):
            if not option_id or not payload:
                continue

            selected = next(
                (option for option in question.options if option.id == option_id), None
            )
            if not selected:
                continue

            hint = selected.label
            if selected.description:
                hint = f"{hint} - {selected.description}"

            merged["selected"].append(
                {
                    "question_id": question.id,
                    "question": question.question,
                    "answer": answer,
                    "option_id": option_id,
                    "hint": hint,
                }
            )

            shared = payload.get("shared", {})
            if isinstance(shared, dict):
                for key, value in shared.items():
                    merged["shared"][key] = value
                merged["shared"]["_hints"].append(hint)

            scenes = payload.get("scenes", {})
            if isinstance(scenes, dict):
                for scene_type, scene_payload in scenes.items():
                    if not isinstance(scene_payload, dict):
                        continue
                    bucket = merged["scenes"].setdefault(scene_type, {"_hints": []})
                    for key, value in scene_payload.items():
                        bucket[key] = value
                    bucket["_hints"].append(hint)

        merged["shared"]["_hints"] = list(dict.fromkeys(merged["shared"]["_hints"]))
        for scene_payload in merged["scenes"].values():
            scene_payload["_hints"] = list(
                dict.fromkeys(scene_payload.get("_hints", []))
            )
        return merged

    def _format_structured_controls(self, controls: dict[str, Any]) -> list[str]:
        lines = []
        if controls.get("selected"):
            lines.append(
                "\nSTRUCTURED USER CONTROLS (treat these as locked planning inputs):"
            )
            for item in controls["selected"]:
                lines.append(f"- {item['question']}: {item['answer']}")

        scene_controls = controls.get("scenes", {})
        if scene_controls:
            lines.append("\nSCENE-LEVEL LOCKS FROM USER CHOICES:")
            for scene_type, payload in scene_controls.items():
                parts = []
                for key, value in payload.items():
                    if key == "_hints":
                        continue
                    parts.append(f"{key}={value}")
                if parts:
                    lines.append(f"- {scene_type}: {', '.join(parts)}")

        return lines

    def _humanize_control_value(self, value: Any) -> str:
        return str(value).replace("_", " ").strip()

    def _apply_structured_scene_controls(
        self, storyboard: Storyboard, controls: dict[str, Any]
    ) -> Storyboard:
        shared_hints = controls.get("shared", {}).get("_hints", [])
        for scene in storyboard.scenes:
            scene_controls = controls.get("scenes", {}).get(scene.scene_type, {})
            if not scene_controls:
                continue

            if scene_controls.get("action"):
                scene.action = scene_controls["action"]

            scene_hints = list(
                dict.fromkeys(shared_hints + scene_controls.get("_hints", []))
            )
            for hint in scene_hints:
                scene.image_prompt = self._append_tagged_detail(
                    scene.image_prompt, "### Locked user choice:", hint
                )

            tagged_fields = {
                "environment_template": "### Environment:",
                "scene_template": "### Scene intent:",
                "detail_focus": "### Product focus:",
                "motion_template": "### Motion beat:",
                "closing_template": "### Closing beat:",
            }
            for key, tag in tagged_fields.items():
                value = scene_controls.get(key)
                if value:
                    scene.image_prompt = self._append_tagged_detail(
                        scene.image_prompt, tag, self._humanize_control_value(value)
                    )

        return storyboard

    def _build_structured_ugc_segments(
        self, framework: str, answer_map: dict[str, str]
    ) -> dict[str, str]:
        highlight = answer_map.get(
            "ugc_main_highlight", "what makes it special"
        ).lower()
        cta_style = answer_map.get("ugc_cta_style", "soft recommendation").lower()

        cta_lines = {
            "soft recommendation": "Honestly, now it's the only thing I want to wear to every event this season.",
            "sale urgency": "My friend texted me saying the sale ends tomorrow, so I'm glad I didn't wait any longer.",
            "outfit compliment angle": "Three people stopped me at the last event to ask where I got it.",
            "direct buy-now push": "I already told my sister to get one before they sell out.",
        }
        cta_line = cta_lines.get(cta_style, cta_lines["soft recommendation"])

        families = {
            "aida": {
                # ugc_legacy scene types
                "creator_hook": f"My mom sent me this and I almost didn't try it on because I thought {highlight} would be too much.",
                "product_reveal": f"But the second I put it on I realized {highlight} makes it all the more festive.",
                "product_demo": "It just falls so nicely and feels like something you actually want to keep wearing.",
                "creator_cta": cta_line,
                # new ugc scene types
                "creator_open": f"My mom sent me this and I almost didn't try it on because I thought {highlight} would be too much.",
                "creator_body": f"But the second I put it on I realized {highlight} makes it all the more festive. It just falls so nicely.",
                "creator_close": cta_line,
            },
            "pas": {
                "creator_hook": "I always struggle to find something festive that doesn't feel like I'm trying too hard.",
                "product_reveal": f"This one just solved it because {highlight} gives it that dressed-up feel instantly.",
                "product_demo": "And it's so comfortable I forgot I was wearing something festive until someone complimented me.",
                "creator_cta": cta_line,
                "creator_open": "I always struggle to find something festive that doesn't feel like I'm trying too hard.",
                "creator_body": f"This one just solved it because {highlight} gives it that dressed-up feel. And it's actually comfortable.",
                "creator_close": cta_line,
            },
            "fab": {
                "creator_hook": f"When I first saw {highlight} I wasn't sure if it would work on me.",
                "product_reveal": "But it actually gives the whole outfit this elevated festive look without being over the top.",
                "product_demo": "The moment I wore it out, I felt put together with zero effort.",
                "creator_cta": cta_line,
                "creator_open": f"When I first saw {highlight} I wasn't sure if it would work on me.",
                "creator_body": "But it actually gives the whole outfit this elevated festive look. I felt put together with zero effort.",
                "creator_close": cta_line,
            },
        }
        return families.get(framework, families["aida"])

    def _apply_structured_ugc_controls(
        self,
        storyboard: Storyboard,
        controls: dict[str, Any],
        director_brief: Optional[DirectorBrief],
    ) -> Storyboard:
        storyboard = self._apply_structured_scene_controls(storyboard, controls)

        answer_map = {
            item["question_id"]: item["answer"] for item in controls.get("selected", [])
        }
        framework = controls.get("shared", {}).get("framework") or (
            director_brief.recommended_framework
            if director_brief
            else storyboard.script_framework
        )
        framework = framework if framework in {"aida", "pas", "fab"} else "aida"
        storyboard.script_framework = framework

        # New UGC: do NOT stamp hardcoded narration templates.
        # The LLM planner already generated narration from the user query;
        # GPT 5.4 will refine it during the video generation phase.
        # Only apply templates for ugc_legacy which relies on them.
        if storyboard.commercial_format == "ugc":
            return storyboard

        segments = self._build_structured_ugc_segments(framework, answer_map)
        for scene in storyboard.scenes:
            line = segments.get(scene.scene_type)
            if line:
                scene.narration_segment = line

        storyboard.narration_script = " ".join(
            scene.narration_segment.strip()
            for scene in storyboard.scenes
            if scene.narration_segment.strip()
        )
        return storyboard

    def plan(
        self,
        user_query: str,
        uploaded_images: Optional[List[PILImage.Image]] = None,
        num_frames: int = 4,
        duration: int = 10,
        aspect_ratio: str = "16:9",
        director_brief: Optional[DirectorBrief] = None,
    ) -> Storyboard:
        """Plan a full storyboard from a user query."""
        aspect_ratio = normalize_aspect_ratio(aspect_ratio)

        # If director brief provided, use the format's fixed scene count
        scene_types = []
        selected_controls = self._collect_selected_controls(director_brief)
        if director_brief:
            scene_types = self.script_loader.get_format_scene_types(
                director_brief.recommended_format,
                domain=director_brief.domain,
            )
            if scene_types:
                num_frames = len(scene_types)
                print(
                    f"  Director locked format: {director_brief.recommended_format} ({num_frames} scenes)"
                )

        num_frames = max(1, min(7, num_frames))

        if not self.client:
            return self._mock_storyboard(user_query, num_frames, duration, aspect_ratio)

        taxonomy_text = _catalog_to_taxonomy_text(self.catalog)
        script_taxonomy_text = self.script_loader.get_taxonomy_text()

        # Build script skills instruction text
        pacing_variant = self.script_loader.resolve_pacing_variant(duration)
        pacing_fragment = self.script_loader.get_fragment("pacing", pacing_variant)
        script_skills_text = (
            f"PACING RULES for {duration}s duration:\n{pacing_fragment}"
            if pacing_fragment
            else ""
        )

        # Build director constraints section
        director_constraints = ""
        if director_brief and scene_types:
            constraint_lines = [
                "\n\nDIRECTOR BRIEF (you MUST follow these constraints):",
                f"Product: {director_brief.product_analysis}",
                f"Format: {director_brief.recommended_format} (LOCKED — use this format's scene structure exactly)",
                f"Framework: {director_brief.recommended_framework} (LOCKED — use this for narration only when not 'none')",
                f"Target Platform: {director_brief.target_platform}",
            ]
            if director_brief.user_answers and director_brief.questions:
                constraint_lines.append("\nUser Preferences:")
                for q, a in zip(director_brief.questions, director_brief.user_answers):
                    constraint_lines.append(f"  Q: {q.question}")
                    constraint_lines.append(f"  A: {a}")
            constraint_lines.extend(self._format_structured_controls(selected_controls))

            constraint_lines.append(
                f"\nSCENE STRUCTURE (you MUST follow this exactly — {num_frames} scenes):"
            )
            for i, st in enumerate(scene_types, 1):
                constraint_lines.append(
                    f"Scene {i} — {st['slug']} ({st['role']}): {st['visual']}"
                )
                vh = st.get("video_hints", {})
                if vh:
                    constraint_lines.append(
                        f"  → Set video_motion_type={vh.get('motion', '')}, "
                        f"video_camera_technique={vh.get('camera', '')}, "
                        f"video_style={vh.get('style', '')}"
                    )
                constraint_lines.append(f'  → Set scene_type="{st["slug"]}"')
                # Show primary motion category for this scene type
                primary_cat = st.get("primary_category", "")
                if primary_cat:
                    constraint_lines.append(
                        f"  → Primary motion category: {primary_cat} (pick from this category first)"
                    )
                # Show allowed actions for this scene type
                allowed = st.get("allowed_actions", [])
                if allowed:
                    constraint_lines.append(
                        f"  → Allowed actions: {', '.join(allowed)}"
                    )

            constraint_lines.append(
                "\nGenerate exactly these scene types in this order. "
                "Set each scene's scene_type, video_motion_type, video_camera_technique, "
                "and video_style fields to match the values above. "
                "Each scene's action MUST be one of the allowed actions listed. "
                "CRITICAL: No two scenes may use the same action. No two scenes may use actions "
                "from the same motion category. Vary framing (full-body, medium, close-up) across scenes."
            )
            director_constraints = "\n".join(constraint_lines)

        image_context = ""
        if uploaded_images:
            image_context = f"{len(uploaded_images)} reference image(s) are provided. Use them as visual reference for the product/subject in your scene prompts and in your subject_identity/subject_outfit."

        system_prompt = PLANNER_SYSTEM_PROMPT.format(
            num_frames=num_frames,
            duration=duration,
            aspect_ratio=aspect_ratio,
            script_skills_text=script_skills_text + director_constraints,
        )

        user_prompt = PLANNER_USER_PROMPT.format(
            taxonomy_text=taxonomy_text,
            script_taxonomy_text=script_taxonomy_text,
            user_query=user_query,
            image_context=image_context,
            template_hints="(Select the best matching templates and incorporate their hints into the scene prompts.)",
            num_frames=num_frames,
            duration=duration,
            aspect_ratio=aspect_ratio,
        )

        # Build multimodal content
        if uploaded_images:
            contents = list(uploaded_images) + [user_prompt]
        else:
            contents = user_prompt

        print(
            f"\n[Storyboard Planner] Designing {num_frames}-scene storyboard via {STORYBOARD_MODEL}..."
        )
        print(f"  Query: {user_query[:80]}{'...' if len(user_query) > 80 else ''}")

        storyboard = openai_structured_call(
            client=self.client,
            system_prompt=system_prompt,
            user_content=contents,
            response_model=Storyboard,
            temperature=0.7,
        )

        # If director brief was used, lock the format and framework
        if director_brief:
            storyboard.commercial_format = director_brief.recommended_format
            storyboard.script_framework = director_brief.recommended_framework

        storyboard.aspect_ratio = aspect_ratio

        # Enhance scene prompts with matched template hints
        template_hints = _get_template_hints(
            self.catalog, storyboard.use_case, storyboard.style, storyboard.subject
        )
        if template_hints:
            storyboard = self._enhance_with_templates(
                storyboard, template_hints, aspect_ratio
            )
        else:
            storyboard = self._finalize_storyboard(storyboard, aspect_ratio)

        if storyboard.commercial_format == "lifestyle" and selected_controls.get(
            "scenes"
        ):
            storyboard = self._apply_structured_scene_controls(
                storyboard, selected_controls
            )
        elif storyboard.commercial_format in ("ugc", "ugc_legacy") and selected_controls.get(
            "selected"
        ):
            storyboard = self._apply_structured_ugc_controls(
                storyboard, selected_controls, director_brief
            )

        storyboard = self._normalize_scene_durations(storyboard, duration)

        print(f"  Scenes: {len(storyboard.scenes)}")
        for scene in storyboard.scenes:
            scene_info = f"[{scene.scene_number}] {scene.description[:55]}..."
            if scene.scene_type:
                scene_info += f" [{scene.scene_type}]"
            if scene.action:
                scene_info += f" → {scene.action}"
            scene_info += f" ({scene.duration_hint}s)"
            print(f"    {scene_info}")

        return storyboard

    def _build_asset_lock_block(
        self, storyboard: Storyboard, scene: StoryboardScene
    ) -> str:
        outfit = scene.scene_outfit or storyboard.subject_outfit
        if not outfit:
            return ""

        return (
            f"[ASSET LOCK] {outfit}\n"
            "[DO NOT CHANGE] Retain the exact asset color family, silhouette, material finish, "
            "pattern placement, proportions, and visible construction details. Do not add new trims, "
            "logos, embroidery, hardware, or alternate materials."
        )

    def _append_tagged_detail(self, prompt: str, tag: str, text: str) -> str:
        if not text:
            return prompt

        text = text.strip()
        prompt_lower = prompt.lower()
        if tag.lower() in prompt_lower or text.lower() in prompt_lower:
            return prompt
        return f"{prompt.rstrip()}\n{tag} {text}"

    def _estimate_spoken_seconds(self, text: str) -> float:
        words = len((text or "").split())
        if not words:
            return 0.0
        return round((words / 2.6) + 0.4, 1)

    def _normalize_scene_durations(
        self, storyboard: Storyboard, total_duration: int
    ) -> Storyboard:
        if not storyboard.scenes:
            return storyboard

        format_slug = storyboard.commercial_format or "lifestyle"
        scene_count = len(storyboard.scenes)
        target = total_duration / max(scene_count, 1)

        for scene in storyboard.scenes:
            if format_slug == "lifestyle":
                scene.duration_hint = round(min(3.0, max(2.0, target)), 1)
            elif format_slug in ("ugc", "ugc_legacy"):
                spoken = self._estimate_spoken_seconds(scene.narration_segment)
                baseline = max(target, spoken)
                if scene.scene_type and scene.scene_type.startswith("creator_") or scene.action in {
                    "talk_to_camera",
                    "excited_present",
                    "nod_and_point",
                    "wave_hello",
                }:
                    baseline = max(4.0, baseline)
                # New UGC uses Veo extension chaining — snap to Veo durations (4, 6, 8)
                if format_slug == "ugc":
                    baseline = max(8.0, baseline)
                    scene.duration_hint = 8.0
                else:
                    scene.duration_hint = round(min(5.0, max(3.5, baseline)), 1)
            else:
                scene.duration_hint = round(max(2.0, min(8.0, scene.duration_hint)), 1)

        return storyboard

    def _finalize_storyboard(
        self, storyboard: Storyboard, aspect_ratio: str
    ) -> Storyboard:
        aspect_ratio = normalize_aspect_ratio(aspect_ratio)
        storyboard.aspect_ratio = aspect_ratio

        for scene in storyboard.scenes:
            outfit = scene.scene_outfit or storyboard.subject_outfit
            if (
                storyboard.subject_identity
                and "[SUBJECT LOCK]" not in scene.image_prompt
            ):
                lock_block = f"[SUBJECT LOCK] {storyboard.subject_identity}"
                if outfit:
                    lock_block += f"\n[OUTFIT] {outfit}"
                scene.image_prompt = f"{lock_block}\n\n{scene.image_prompt}"

            asset_lock_block = self._build_asset_lock_block(storyboard, scene)
            if asset_lock_block and "[ASSET LOCK]" not in scene.image_prompt:
                insert_after = ""
                if "[OUTFIT]" in scene.image_prompt:
                    insert_after = "[OUTFIT]"
                if insert_after:
                    scene.image_prompt = scene.image_prompt.replace(
                        insert_after,
                        f"{asset_lock_block}\n{insert_after}",
                        1,
                    )
                else:
                    scene.image_prompt = f"{asset_lock_block}\n\n{scene.image_prompt}"

            scene.image_prompt = sanitize_generation_prompt(
                scene.image_prompt, aspect_ratio
            )

        storyboard.video_prompt = sanitize_generation_prompt(
            storyboard.video_prompt, aspect_ratio
        )
        return storyboard

    def _enhance_with_templates(
        self, storyboard: Storyboard, template_hints: str, aspect_ratio: str
    ) -> Storyboard:
        """Post-process scene prompts with structured template hints and subject lock."""
        uc = self.catalog.get("use_cases", {}).get(storyboard.use_case, {})
        st = self.catalog.get("styles", {}).get(storyboard.style, {})

        style_directive = st.get("directives", "")
        camera_hint = uc.get("camera_hint", "") or st.get("camera_defaults", "")

        for scene in storyboard.scenes:
            # Prepend subject identity + outfit (identity only for subject lock)
            if (
                storyboard.subject_identity
                and "[SUBJECT LOCK]" not in scene.image_prompt
            ):
                outfit = scene.scene_outfit or storyboard.subject_outfit
                lock_block = f"[SUBJECT LOCK] {storyboard.subject_identity}"
                if outfit:
                    lock_block += f"\n[OUTFIT] {outfit}"
                scene.image_prompt = f"{lock_block}\n\n{scene.image_prompt}"

            asset_lock_block = self._build_asset_lock_block(storyboard, scene)
            if asset_lock_block and "[ASSET LOCK]" not in scene.image_prompt:
                if "[OUTFIT]" in scene.image_prompt:
                    scene.image_prompt = scene.image_prompt.replace(
                        "[OUTFIT]",
                        f"{asset_lock_block}\n[OUTFIT]",
                        1,
                    )
                else:
                    scene.image_prompt = f"{asset_lock_block}\n\n{scene.image_prompt}"

            if style_directive:
                scene.image_prompt = self._append_tagged_detail(
                    scene.image_prompt,
                    "### Look:",
                    style_directive,
                )

            prompt_lower = scene.image_prompt.lower()
            if (
                camera_hint
                and "### camera:" not in prompt_lower
                and "mm" not in prompt_lower
            ):
                scene.image_prompt = self._append_tagged_detail(
                    scene.image_prompt,
                    "### Camera:",
                    camera_hint,
                )

            # Inject pose from action's starting_pose via the poses catalog
            if scene.action:
                action_entry = self.catalog.get("actions", {}).get(scene.action)
                if action_entry:
                    starting_pose_slug = action_entry.get("starting_pose", "")
                    if starting_pose_slug:
                        pose_entry = self.catalog.get("poses", {}).get(
                            starting_pose_slug
                        )
                        if pose_entry:
                            scene.image_prompt = self._append_tagged_detail(
                                scene.image_prompt,
                                "### Pose:",
                                pose_entry["prompt"],
                            )

        return self._finalize_storyboard(storyboard, aspect_ratio)

    def _mock_storyboard(
        self, user_query: str, num_frames: int, duration: int, aspect_ratio: str
    ) -> Storyboard:
        """Fallback when no API key is available."""
        per_scene = round(duration / num_frames, 1)
        scenes = []
        scene_labels = [
            "Hook / Attention Grabber",
            "Product Hero Shot",
            "Lifestyle / Benefit",
            "Call to Action",
        ]

        for i in range(num_frames):
            label = scene_labels[i] if i < len(scene_labels) else f"Scene {i + 1}"
            scenes.append(
                StoryboardScene(
                    scene_number=i + 1,
                    description=f"{label} for: {user_query[:50]}",
                    image_prompt=f"[MOCK] {label}: {user_query}",
                    duration_hint=per_scene,
                    narration_segment=f"[MOCK] Scene {i + 1} narration.",
                )
            )

        return Storyboard(
            aspect_ratio=normalize_aspect_ratio(aspect_ratio),
            use_case="product_marketing",
            style="photography",
            subject="product",
            subject_identity="",
            subject_outfit="",
            scenes=scenes,
            narration_script=f"[MOCK] Narration for: {user_query}",
            music_direction="[MOCK] Upbeat corporate music",
            video_prompt=f"[MOCK] Video prompt for: {user_query}",
            video_motion_type="cinematic",
            video_camera_technique="dolly_in",
            video_style="cinematic_video",
            script_framework="none",
            commercial_format="lifestyle",
            emotional_trigger="aspiration",
            domain="general",
        )
