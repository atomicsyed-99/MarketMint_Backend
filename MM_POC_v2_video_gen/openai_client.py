"""
OpenAI client wrapper for structured LLM output.

Replaces the Gemini genai client for storyboard planning and ad direction.
Image generation (NanoBanana) and video generation (Grok/Veo) are unchanged.
"""

import base64
import io
import os

from openai import OpenAI
from PIL import Image as PILImage

STORYBOARD_MODEL = "gpt-5.4-2026-03-05"


def create_openai_client() -> OpenAI:
    """Create an OpenAI client using OPENAI_API_KEY from env."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set in environment")
    return OpenAI(api_key=api_key)


def _pil_to_openai_image(img: PILImage.Image) -> dict:
    """Convert a PIL image to an OpenAI vision content block."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
    }


def openai_structured_call(
    client: OpenAI,
    system_prompt: str,
    user_content,
    response_model,
    temperature: float = 0.7,
    model: str = None,
):
    """Call OpenAI with structured JSON output via Pydantic schema.

    Args:
        client: OpenAI client instance.
        system_prompt: System message text.
        user_content: Either a string or a list of content blocks
            (text strings and PIL images mixed).
        response_model: Pydantic model class for structured output.
        temperature: Sampling temperature.
        model: Model override (defaults to STORYBOARD_MODEL).

    Returns:
        Parsed Pydantic model instance.
    """
    model = model or STORYBOARD_MODEL

    # Build user message content
    if isinstance(user_content, str):
        user_msg = {"role": "user", "content": user_content}
    else:
        # Mixed content: PIL images + text
        parts = []
        for item in user_content:
            if isinstance(item, PILImage.Image):
                parts.append(_pil_to_openai_image(item))
            elif isinstance(item, str):
                parts.append({"type": "text", "text": item})
            elif isinstance(item, dict):
                # Already formatted content block
                parts.append(item)
            else:
                # Try to convert PIL-like objects
                try:
                    parts.append(_pil_to_openai_image(item))
                except Exception:
                    parts.append({"type": "text", "text": str(item)})
        user_msg = {"role": "user", "content": parts}

    messages = [
        {"role": "system", "content": system_prompt},
        user_msg,
    ]

    response = client.beta.chat.completions.parse(
        model=model,
        messages=messages,
        response_format=response_model,
        temperature=temperature,
    )

    return response.choices[0].message.parsed
