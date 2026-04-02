import re


_ASPECT_RATIO_TOKEN_RE = re.compile(r"\b\d+(?:\.\d+)?:\d+\b")
_ASPECT_RATIO_PHRASE_RE = re.compile(
    r"(?i)(?:\b(?:vertical|horizontal|portrait|landscape|widescreen)\b[\s-]*)?"
    r"\(?\b\d+(?:\.\d+)?:\d+\b\)?"
    r"(?:\s*(?:vertical|horizontal|portrait|landscape|widescreen))?"
    r"(?:\s+aspect(?:\s+ratio)?)?"
)

_VEO_ASPECT_RATIOS = {"16:9", "9:16"}


def normalize_aspect_ratio(aspect_ratio: str) -> str:
    return str(aspect_ratio or "16:9").strip().replace(" ", "") or "16:9"


def validate_video_aspect_ratio(video_model: str, aspect_ratio: str) -> str:
    locked = normalize_aspect_ratio(aspect_ratio)
    if video_model in {"veo", "veo-standard"} and locked not in _VEO_ASPECT_RATIOS:
        supported = ", ".join(sorted(_VEO_ASPECT_RATIOS))
        raise ValueError(
            f"{video_model} only supports aspect ratios {supported}. "
            f"Refusing to change requested aspect ratio {locked}."
        )
    return locked


def sanitize_visual_constraints(text: str) -> str:
    """No-op — kept for API compatibility. Line-dropping was removed because it
    silently stripped scene descriptions and subject locks from prompts."""
    return (text or "").strip()


def sanitize_generation_prompt(text: str, aspect_ratio: str) -> str:
    if not text:
        return text

    locked = normalize_aspect_ratio(aspect_ratio)

    def _replace(match: re.Match) -> str:
        token_match = _ASPECT_RATIO_TOKEN_RE.search(match.group(0))
        if token_match and token_match.group(0) == locked:
            return f"{locked} aspect ratio"
        return f"{locked} aspect ratio"

    sanitized = sanitize_visual_constraints(text)
    sanitized = _ASPECT_RATIO_PHRASE_RE.sub(_replace, sanitized)
    sanitized = re.sub(
        rf"(?:{re.escape(locked)} aspect ratio[\s,;.]*){{2,}}",
        f"{locked} aspect ratio. ",
        sanitized,
    )

    if f"{locked} aspect ratio" not in sanitized.lower():
        sanitized = sanitized.rstrip() + f"\nAspect ratio: {locked}."

    return sanitized.strip()
