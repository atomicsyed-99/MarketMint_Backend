import os
import sys
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait
from PIL import Image as PILImage
from typing import Dict, Any, Optional, List

from src.llm_router import LLMRouter


_AD_KEYWORDS: frozenset = frozenset(
    {
        "ad",
        "banner",
        "campaign",
        "marketing",
        "headline",
        "tagline",
        "poster",
        "flyer",
        "promotional",
        "promotion",
        "promo",
    }
)
_EDITING_KEYWORDS: frozenset = frozenset(
    {
        "swap",
        "retouch",
        "skin enhancement",
        "background replacement",
        "remove background",
        "replace background",
    }
)
_TEXT_REQUEST_KEYWORDS = {
    "write",
    "text",
    "headline",
    "tagline",
    "cta",
    "label",
    "say",
    "caption",
    "add text",
    "display",
    "copy",
}
_STYLE_REQUEST_KEYWORDS = {
    "style",
    "aesthetic",
    "mood",
    "lighting",
    "look",
    "editorial",
    "cinematic",
    "inspired by",
    "reference",
    "tone",
}


def _is_ad_workflow(query: str) -> bool:
    return any(kw in query.lower() for kw in _AD_KEYWORDS)


def _is_editing_workflow(query: str) -> bool:
    return any(kw in query.lower() for kw in _EDITING_KEYWORDS)


def _user_requests_text(query: str) -> bool:
    return any(kw in query.lower() for kw in _TEXT_REQUEST_KEYWORDS)


def _user_requests_style_guidance(query: str) -> bool:
    lowered = query.lower()
    return any(kw in lowered for kw in _STYLE_REQUEST_KEYWORDS)


def assemble_image_prompt(
    *,
    user_query: str,
    has_subject_images: bool = False,
    has_character: bool = False,
    has_scene_image: bool = False,
    has_style_images: bool = False,
    use_style_guidance: bool = False,
    preserve_asset_framing: bool = False,
    ad_copy: str = "",
) -> str:
    """Assembles a natural-language prompt following the NanoBanana 2 technique.

    Formula: [user intent] + [attached image relationship clauses]
    """
    clauses = []
    if has_scene_image:
        clauses.append("Use the attached scene image for the background.")
    if has_character:
        clauses.append(
            "Use the person from the attached character reference as the model."
        )
    if has_subject_images:
        clauses.append(
            "Use the attached product image as the exact asset. Retain its shape, color, proportions, "
            "materials, visible construction details, pattern placement, and branding. Do not redesign, "
            "simplify, or embellish it."
        )
    if preserve_asset_framing:
        clauses.append(
            "For asset-only outputs with no person, preserve the asset layout 1:1 from the reference image. "
            "Keep neckline, hem, embroidery, motifs, label placement, and relative spacing in the same positions on the asset. "
            "Do not move lower design elements upward just to bring them into frame, and do not recompose the asset to make hidden details more visible."
        )
    if has_style_images and use_style_guidance:
        clauses.append(
            "Match only the lighting mood and overall visual tone of the attached style reference image. "
            "Do not copy its composition or alter the attached asset to fit the style reference."
        )
    clauses.append(
        "Keep the background clear and readable with natural depth; do not blur the background into a creamy studio bokeh."
    )

    prompt = user_query.rstrip()
    if clauses:
        if prompt and prompt[-1] not in ".!?,":
            prompt += "."
        prompt += " " + " ".join(clauses)
    if ad_copy:
        prompt += f"\n\nText to render:\n{ad_copy}"
    return prompt


class PromptCompiler:
    def __init__(self, llm_router: LLMRouter):
        self.llm_router = llm_router

    def generate(
        self,
        user_query: str,
        uploaded_images: Optional[List[PILImage.Image]] = None,
        output_path: str = "output_image.png",
        variation_index: int = 0,
        extra_style_images: Optional[List[PILImage.Image]] = None,
        aspect_ratio: Optional[str] = None,
        save_pinterest_dir: Optional[str] = None,
        disable_pinterest: bool = False,
        character_image: Optional[PILImage.Image] = None,
    ) -> Dict[str, Any]:
        """Full pipeline: classify → assemble prompt → Pinterest fallback → generate image."""
        from src.image_generator import NanoBananaGenerator

        prompt, context = self.build_nanobanana_prompt(
            user_query,
            uploaded_images=uploaded_images,
        )

        user_character_image = character_image or context.get("user_character_image")
        user_scene_image = context.get("user_scene_image")
        scene_image = user_scene_image
        use_style_guidance = context.get("use_style_guidance", False)

        # Pinterest style reference — fires when no scene image and not an editing workflow
        pinterest_imgs: List[PILImage.Image] = []
        pinterest_url: str = ""
        if (
            not disable_pinterest
            and user_query
            and scene_image is None
            and use_style_guidance
            and not context.get("style_images")
            and not _is_editing_workflow(user_query)
        ):
            try:
                from src.pinterest import scrape_style_images

                with ThreadPoolExecutor(max_workers=1) as ex:
                    fut = ex.submit(scrape_style_images, user_query, 1)
                    done, _ = futures_wait([fut], timeout=12)
                    if done:
                        results = fut.result()
                        if results:
                            pinterest_imgs = [results[0][0]]
                            pinterest_url = results[0][1]
                            prompt = (
                                prompt
                                + " Match only the lighting mood and overall visual tone of the attached style reference image."
                            )
                            # Save Pinterest image to disk if requested
                            if save_pinterest_dir:
                                try:
                                    os.makedirs(save_pinterest_dir, exist_ok=True)
                                    pin_path = os.path.join(
                                        save_pinterest_dir, "pinterest_ref.png"
                                    )
                                    pinterest_imgs[0].save(pin_path)
                                    print(f"  Pinterest ref saved: {pin_path}")
                                    print(f"  Pinterest URL: {pinterest_url}")
                                except Exception as e:
                                    print(
                                        f"  Warning: Could not save Pinterest image: {e}",
                                        file=sys.stderr,
                                    )
                    else:
                        print("Warning: Pinterest timed out (12s cap)", file=sys.stderr)
            except Exception as e:
                print(f"Warning: Pinterest scrape failed: {e}", file=sys.stderr)

        user_style_images = context.get("style_images", [])
        style_images = user_style_images + (extra_style_images or []) + pinterest_imgs
        if context.get("subject_images") and style_images:
            style_images = style_images[:1]

        # Typography hint when user requests text but no brand fonts exist
        if _user_requests_text(user_query):
            if user_style_images and use_style_guidance:
                prompt = (
                    prompt
                    + "\nTypography: match font style from the style reference image."
                )
            elif pinterest_url and use_style_guidance:
                prompt = (
                    prompt
                    + "\nTypography: if style reference contains text, match its font style."
                )

        generator = NanoBananaGenerator()
        result = generator.generate_image(
            prompt,
            subject_images=context.get("subject_images", []),
            style_images=style_images,
            user_character_image=user_character_image,
            scene_image=scene_image,
            seed=42 + variation_index,
            output_path=output_path,
            aspect_ratio=aspect_ratio,
        )
        result["pinterest_url"] = pinterest_url
        if save_pinterest_dir and pinterest_imgs:
            result["pinterest_save_path"] = os.path.join(
                save_pinterest_dir, "pinterest_ref.png"
            )
        return result

    def build_nanobanana_prompt(
        self,
        user_query: str,
        uploaded_images: Optional[List] = None,
    ):
        """Stages 1-2: classify uploaded images → assemble prompt.

        Returns:
            (prompt_str, context) where context contains:
                enhancement, subject_images, style_images,
                user_character_image, user_scene_image
        """
        if uploaded_images is None:
            uploaded_images = []

        # Stage 1 — LLM classifies uploaded images and extracts ad copy
        enhancement = self.llm_router.generate_enhancement(
            user_query,
            uploaded_images=uploaded_images,
        )
        use_style_guidance = _user_requests_style_guidance(user_query)

        # Route each uploaded image to the correct bucket by its classified role
        classifications = enhancement.get("image_classifications", [])
        subject_images, style_images = [], []
        user_character_image = None
        user_scene_image = None
        for c in classifications:
            idx = c.get("index", -1)
            if not (0 <= idx < len(uploaded_images)):
                continue
            img = uploaded_images[idx]
            role = c.get("role")
            if role == "subject":
                subject_images.append(img)
            elif role == "style_reference":
                style_images.append(img)
            elif role == "character" and user_character_image is None:
                user_character_image = img
            elif role == "scene" and user_scene_image is None:
                user_scene_image = img

        if uploaded_images:
            print("  Image roles:")
            for idx, _img in enumerate(uploaded_images):
                labels = []
                if idx < len(classifications):
                    labels = [
                        c.get("role", "unknown")
                        for c in classifications
                        if c.get("index") == idx
                    ]
                role_label = ", ".join(labels) if labels else "unclassified"
                print(f"    [{idx}] {role_label}")

        # Fallback: if images uploaded but LLM returned no classifications, treat all as subject
        if (
            uploaded_images
            and not subject_images
            and user_character_image is None
            and user_scene_image is None
        ):
            print(
                "Warning: LLM returned no classifications — defaulting all uploaded images to subject.",
                file=sys.stderr,
            )
            subject_images = list(uploaded_images)
            style_images = []

        if subject_images and not use_style_guidance:
            style_images = []

        preserve_asset_framing = bool(subject_images) and user_character_image is None

        if uploaded_images:
            print(
                "  Routed images: "
                f"subjects={len(subject_images)}, styles={len(style_images)}, "
                f"characters={1 if user_character_image is not None else 0}, "
                f"scenes={1 if user_scene_image is not None else 0}"
            )

        # Gate ad_copy on explicit text request keywords
        ad_copy = (
            enhancement.get("ad_copy", "") if _user_requests_text(user_query) else ""
        )

        # Stage 2 — Assemble the NanoBanana 2 prompt string
        prompt = assemble_image_prompt(
            user_query=user_query,
            has_subject_images=bool(subject_images),
            has_character=bool(user_character_image),
            has_scene_image=bool(user_scene_image),
            has_style_images=bool(style_images),
            use_style_guidance=use_style_guidance,
            preserve_asset_framing=preserve_asset_framing,
            ad_copy=ad_copy,
        )

        context = {
            "enhancement": enhancement,
            "subject_images": subject_images,
            "style_images": style_images,
            "use_style_guidance": use_style_guidance,
            "preserve_asset_framing": preserve_asset_framing,
            "user_character_image": user_character_image,
            "user_scene_image": user_scene_image,
        }
        return prompt, context


if __name__ == "__main__":
    compiler = PromptCompiler(LLMRouter())
    prompt, context = compiler.build_nanobanana_prompt(
        "Make a lifestyle photo of a yellow sneaker on a city street"
    )
    print(prompt)
