import re


_ASPECT_RATIO_TOKEN_RE = re.compile(r"\b\d+(?:\.\d+)?:\d+\b")
_ASPECT_RATIO_PHRASE_RE = re.compile(
    r"(?i)(?:\b(?:vertical|horizontal|portrait|landscape|widescreen)\b[\s-]*)?"
    r"\(?\b\d+(?:\.\d+)?:\d+\b\)?"
    r"(?:\s*(?:vertical|horizontal|portrait|landscape|widescreen))?"
    r"(?:\s+aspect(?:\s+ratio)?)?"
)

_VEO_ASPECT_RATIOS = {"16:9", "9:16"}
_DROP_LINE_PATTERNS = (
    re.compile(r"(?i)\btext overlay\b"),
    re.compile(r"(?i)\btitle card\b"),
    re.compile(r"(?i)\bcaption overlay\b"),
    re.compile(r"(?i)\bnegative space for text\b"),
    re.compile(r"(?i)\bspace for caption\b"),
    re.compile(r"(?i)\bspace for text overlay\b"),
    re.compile(r"(?i)\bsplit[- ]screen\b"),
    re.compile(r"(?i)\bbefore[-/]after\b"),
    re.compile(r"(?i)\bmulti-panel\b"),
    re.compile(r"(?i)\bcollage\b"),
    re.compile(r"(?i)\bgrid layout\b"),
)
_INLINE_STRIP_PATTERNS = (
    re.compile(r"(?i),?\s*hold\s+\d+(?:\.\d+)?s\s+before\s+cut"),
    re.compile(r"(?i),?\s*quick\s+cuts?"),
    re.compile(r"(?i),?\s*jump\s+cuts?"),
    re.compile(r"(?i),?\s*match\s+cuts?"),
    re.compile(r"(?i),?\s*smash\s+cuts?"),
    re.compile(r"(?i),?\s*cut\s+to\s+[^,.;\n]+"),
    re.compile(r"(?i),?\s*before\s+cut"),
)


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
    if not text:
        return text

    cleaned_lines = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if cleaned_lines and cleaned_lines[-1] != "":
                cleaned_lines.append("")
            continue
        if any(pattern.search(line) for pattern in _DROP_LINE_PATTERNS):
            continue
        for pattern in _INLINE_STRIP_PATTERNS:
            line = pattern.sub("", line)
        line = re.sub(r"\s{2,}", " ", line).strip(" ,.;")
        if line:
            cleaned_lines.append(line)

    sanitized = "\n".join(cleaned_lines)
    sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
    return sanitized.strip()


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
