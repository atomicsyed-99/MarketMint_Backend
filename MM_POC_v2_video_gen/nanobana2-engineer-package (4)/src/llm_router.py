import os
import io
from typing import List, Dict, Any, Optional

import pydantic
from google import genai
from google.genai import types
from PIL import Image as PILImage


ENHANCEMENT_PROMPT_TEMPLATE = """\
Classify this image generation request.
{image_instruction}
User Query: "{query}"

When a product/garment/object image could reasonably be either "subject" or "style_reference", choose "subject".
Only use "style_reference" for images that are clearly inspiration for lighting, mood, color, or general aesthetic and are NOT the asset that must be preserved.

**ad_copy** — only if the user explicitly asks for text, a headline, tagline, or copy to appear in the image. Extract their exact words only — no additions, no font names, no sizing or placement instructions. Separate multiple text elements with a newline. Leave empty otherwise."""


def _pil_to_part(img: PILImage.Image) -> "types.Part":
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG")
    return types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg")


class ImageClassification(pydantic.BaseModel):
    index: int
    role: str  # "subject" | "character" | "scene" | "style_reference"


class EnhancementModel(pydantic.BaseModel):
    image_classifications: List[ImageClassification] = pydantic.Field(
        default_factory=list
    )
    ad_copy: str = pydantic.Field(
        default="",
        description=(
            "Only when the user explicitly asks for text, a headline, tagline, or copy to appear in the image. "
            "Return the exact words the user specified, word-for-word, with no additions, font names, sizes, placements, or styling. "
            "If multiple text elements, separate with a newline. "
            "Leave empty if the user has not explicitly asked for text."
        ),
    )


class LLMRouter:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = (
            api_key
            or os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
        )
        if self.api_key:
            self.client = genai.Client(api_key=self.api_key)
        else:
            self.client = None
            print(
                "Warning: Gemini client not initialized. GEMINI_API_KEY or GOOGLE_API_KEY not set. Using fallback stubs."
            )

    def generate_enhancement(
        self,
        query: str,
        uploaded_images: Optional[List[PILImage.Image]] = None,
        system_prompt: str = "You are a creative director for commercial photography.",
    ) -> Dict[str, Any]:
        if uploaded_images is None:
            uploaded_images = []

        if not self.client:
            return {
                "image_classifications": [
                    {"index": i, "role": "subject"} for i in range(len(uploaded_images))
                ],
                "ad_copy": "",
            }

        image_instruction = ""
        if uploaded_images:
            image_instruction = (
                f"\n{len(uploaded_images)} image(s) are provided above (0-indexed). "
                "Classify each with the most specific role that applies:\n"
                '- "subject": a product, garment, object, or asset to preserve exactly in the output\n'
                '- "character": a person — use this specific individual as the model\n'
                '- "scene": a background or environment to use as the setting\n'
                '- "style_reference": a mood or aesthetic reference only; do not use this if the image contains the asset that must remain unchanged\n'
            )

        prompt = ENHANCEMENT_PROMPT_TEMPLATE.format(
            query=query,
            image_instruction=image_instruction,
        )

        if uploaded_images:
            contents = [_pil_to_part(img) for img in uploaded_images] + [
                types.Part.from_text(text=prompt)
            ]
        else:
            contents = prompt

        response = self.client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                response_schema=EnhancementModel,
                temperature=0.6,
            ),
        )
        result = EnhancementModel.model_validate_json(response.text)
        return result.model_dump()
