import os
import re
import yaml
from typing import Dict, Any, List


_EXCLUDED_SKILL_NAMES = frozenset({"gemini_3_guidelines"})
_AD_SKILL_NAMES = frozenset({
    "ad_emotional",
    "ad_iconic",
    "ad_layout",
    "ad_social_proof",
    "ad_storytelling",
})
_FRAMEWORK_MARKERS = (
    "VARIATION RULE:",
    "ADAPTIVE DIRECTION:",
    "FORMATS:",
    "GUIDING PRINCIPLES:",
)


def _clean_ad_fragment(fragment: str, selected_ad_format: str = "", variation_index: int = 0) -> str:
    cleaned = fragment.strip()
    if variation_index > 0:
        # Variations: strip only the ADAPTIVE DIRECTION block, keep everything else
        # (FORMATS, VARIATION RULE, GUIDING PRINCIPLES) regardless of section order
        ad_start = cleaned.find("ADAPTIVE DIRECTION:")
        if ad_start != -1:
            # Find where ADAPTIVE DIRECTION ends: the next known section marker after it
            ad_end = len(cleaned)
            all_markers = ("VARIATION RULE:", "ADAPTIVE DIRECTION:", "FORMATS:", "GUIDING PRINCIPLES:")
            for marker in all_markers:
                if marker == "ADAPTIVE DIRECTION:":
                    continue
                m_idx = cleaned.find(marker, ad_start + len("ADAPTIVE DIRECTION:"))
                if m_idx != -1:
                    ad_end = min(ad_end, m_idx)
            cleaned = (cleaned[:ad_start] + cleaned[ad_end:]).strip()
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        if selected_ad_format:
            cleaned = f"{cleaned}\n\nBase format was: {selected_ad_format.strip()}."
        cleaned = f"{cleaned}\nThis is variation #{variation_index + 1} — use a DIFFERENT format from the list above. Do not repeat the base format."
    else:
        # Primary generation: strip everything after the intro paragraph — only send the
        # resolved format so the model isn't confused by a menu of competing options
        for marker in _FRAMEWORK_MARKERS:
            idx = cleaned.find(marker)
            if idx != -1:
                cleaned = cleaned[:idx].strip()
                break
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        if selected_ad_format:
            cleaned = f"{cleaned}\n\nFormat: {selected_ad_format.strip()}."
    return cleaned


class FoundationSkillLoader:
    def __init__(self, skills_dir: str = os.path.join(os.path.dirname(__file__), "skills", "foundation")):
        self.skills_dir = skills_dir
        self.skills_data: Dict[str, Dict[str, str]] = {}
        self._load_all_skills()

    def _load_all_skills(self):
        if not os.path.exists(self.skills_dir):
            print(f"Warning: Foundation skills directory not found: {self.skills_dir}")
            return

        for filename in os.listdir(self.skills_dir):
            if filename.endswith(".yaml") or filename.endswith(".yml"):
                filepath = os.path.join(self.skills_dir, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f)
                        skill_name = data.get("name")
                        fragments = data.get("fragments", {})
                        if skill_name and fragments and skill_name not in _EXCLUDED_SKILL_NAMES:
                            self.skills_data[skill_name] = {
                                k: str(v).strip() for k, v in fragments.items()
                            }
                except Exception as e:
                    print(f"Error loading skill file {filename}: {e}")

    def get_available_skills_schema(self) -> Dict[str, List[str]]:
        """
        Returns a dictionary mapping skill names to their available variants.
        e.g., {"lighting": ["default", "cinematic", "editorial", ...], ...}
        """
        return {
            skill: list(variants.keys())
            for skill, variants in self.skills_data.items()
        }

    def get_fragment(self, skill_name: str, variant: str) -> str:
        """
        Retrieves the exact XML-like string for a specific skill and variant.
        Falls back to 'default' if the variant is not found.
        """
        variants = self.skills_data.get(skill_name, {})
        if not variants:
            return ""

        return variants.get(variant, variants.get("default", ""))

    def get_all_fragments(self, selected_skills: Dict[str, str], selected_ad_format: str = "", variation_index: int = 0) -> List[str]:
        """
        Returns fragment texts for all selected skills.
        Negative prompt fragments (skill name "negative_prompts") are always placed
        last — per Gemini 3 guidelines, negative constraints work best at the end.
        selected_skills: dict mapping skill_name -> variant
        """
        regular = []
        negative = []
        for skill_name, variant in selected_skills.items():
            if skill_name in _EXCLUDED_SKILL_NAMES:
                continue
            fragment = self.get_fragment(skill_name, variant)
            if fragment:
                if skill_name in _AD_SKILL_NAMES:
                    fragment = _clean_ad_fragment(fragment, selected_ad_format=selected_ad_format, variation_index=variation_index)
                if skill_name == "negative_prompts":
                    negative.append(f"Avoid: {fragment}")
                else:
                    regular.append(fragment)
        return regular + negative

if __name__ == "__main__":
    loader = FoundationSkillLoader()
    schema = loader.get_available_skills_schema()
    print("Loaded schema:")
    for skill, variants in schema.items():
        print(f"  {skill}: {variants}")
    print("\\nSample lighting -> cinematic:")
    print(loader.get_fragment("lighting", "cinematic"))
