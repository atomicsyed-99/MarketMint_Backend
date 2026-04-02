"""
Ad Script Skills Loader
========================
Loads ad scriptwriting skill YAML files (frameworks, formats, emotional triggers,
pacing rules, domain tactics) and provides them to the storyboard planner at runtime.

Mirrors the NanoBanana 2 FoundationSkillLoader pattern.
"""

import os
from typing import Dict, List

import yaml


_DISABLED_FORMATS = {"hook_driven"}


class AdScriptSkillLoader:
    def __init__(self, skills_dir: str = None):
        if skills_dir is None:
            skills_dir = os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "ad_script_skills"
            )
        self.skills_dir = skills_dir
        self.skills_data: Dict[str, Dict[str, str]] = {}
        # Raw fragment data for structured formats (scene_types, etc.)
        self._raw_fragments: Dict[str, Dict] = {}
        self._load_all_skills()

    def _load_all_skills(self):
        if not os.path.exists(self.skills_dir):
            print(f"Warning: Ad script skills directory not found: {self.skills_dir}")
            return

        for filename in os.listdir(self.skills_dir):
            if filename.endswith((".yaml", ".yml")):
                filepath = os.path.join(self.skills_dir, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f)
                        skill_name = data.get("name")
                        fragments = data.get("fragments", {})
                        if skill_name and fragments:
                            # Store raw fragments for structured access
                            self._raw_fragments[skill_name] = fragments
                            # Extract text for backward compatibility:
                            # fragments can be plain strings or dicts with a "text" key
                            normalized = {}
                            for k, v in fragments.items():
                                if isinstance(v, dict):
                                    normalized[k] = str(v.get("text", "")).strip()
                                else:
                                    normalized[k] = str(v).strip()
                            self.skills_data[skill_name] = normalized
                except Exception as e:
                    print(f"Error loading ad script skill {filename}: {e}")

    def get_available_skills_schema(self) -> Dict[str, List[str]]:
        """Returns skill names mapped to their available variants."""
        schema = {}
        for skill, variants in self.skills_data.items():
            names = list(variants.keys())
            if skill == "formats":
                names = [name for name in names if name not in _DISABLED_FORMATS]
            schema[skill] = names
        return schema

    def get_fragment(self, skill_name: str, variant: str) -> str:
        """Get a specific skill fragment. Falls back to 'default' if variant not found."""
        variants = self.skills_data.get(skill_name, {})
        if not variants:
            return ""
        return variants.get(variant, variants.get("default", ""))

    def get_all_fragments(self, selected_skills: Dict[str, str]) -> List[str]:
        """Returns fragment texts for all selected skills."""
        fragments = []
        for skill_name, variant in selected_skills.items():
            fragment = self.get_fragment(skill_name, variant)
            if fragment:
                fragments.append(fragment)
        return fragments

    def get_taxonomy_text(self) -> str:
        """Format all script skills into a taxonomy block for the LLM system prompt."""
        lines = []

        # Formats
        if "formats" in self.skills_data:
            lines.append("## COMMERCIAL FORMATS (pick one slug):")
            for variant in self.skills_data["formats"]:
                if variant not in _DISABLED_FORMATS:
                    lines.append(f"  - {variant}")

        # Pacing (auto-selected, shown for reference)
        if "pacing" in self.skills_data:
            lines.append(
                "\n## PACING (auto-selected based on duration, shown for reference):"
            )
            for variant in sorted(self.skills_data["pacing"]):
                lines.append(f"  - {variant}")

        return "\n".join(lines)

    def get_format_scene_types(self, format_slug: str) -> List[Dict]:
        """Get the scene_types list for a commercial format.

        Returns a list of dicts with keys: slug, role, visual, video_hints,
        allowed_actions.
        """
        formats_raw = self._raw_fragments.get("formats", {})
        format_data = formats_raw.get(format_slug, {})
        if format_slug in _DISABLED_FORMATS:
            return []
        if not isinstance(format_data, dict):
            return []

        return format_data.get("scene_types", [])

    def get_format_labels(self) -> Dict[str, str]:
        """Get format slug -> label mapping for the director prompt."""
        formats_raw = self._raw_fragments.get("formats", {})
        labels = {}
        for slug, data in formats_raw.items():
            if slug in _DISABLED_FORMATS:
                continue
            if isinstance(data, dict):
                text = data.get("text", "")
            else:
                text = str(data)
            # Extract label from the XML tag: <commercial_format name="Label Here">
            if 'name="' in text:
                labels[slug] = text.split('name="')[1].split('"')[0]
            else:
                labels[slug] = slug.replace("_", " ").title()
        return labels

    def get_question_set(self, format_slug: str) -> List[Dict]:
        """Get structured clarifying questions for a format.

        Returns an empty list when no hardcoded questions exist,
        allowing the caller to fall through to LLM-generated questions.
        """
        controls_raw = self._raw_fragments.get("question_controls", {})
        format_controls = controls_raw.get(format_slug, {})
        if not isinstance(format_controls, dict):
            return []

        for payload in format_controls.values():
            if isinstance(payload, dict) and isinstance(payload.get("questions"), list):
                return payload["questions"]

        return []

    def resolve_question_option_payload(
        self,
        format_slug: str,
        question_id: str,
        option_id: str,
    ) -> Dict:
        """Resolve the mapping payload for one structured question option."""
        for question in self.get_question_set(format_slug):
            if question.get("id") != question_id:
                continue
            for option in question.get("options", []):
                if option.get("id") == option_id:
                    mappings = option.get("mappings", {})
                    return mappings if isinstance(mappings, dict) else {}
            return {}
        return {}

    def resolve_pacing_variant(self, duration: int) -> str:
        """Auto-select pacing variant based on video duration."""
        if duration <= 6:
            return "6s"
        elif duration <= 12:
            return "10s"
        elif duration <= 20:
            return "15s"
        elif duration <= 45:
            return "30s"
        else:
            return "60s"


if __name__ == "__main__":
    loader = AdScriptSkillLoader()
    schema = loader.get_available_skills_schema()
    print("Loaded ad script skills:")
    for skill, variants in schema.items():
        print(f"  {skill}: {variants}")
    print(f"\nTaxonomy text:\n{loader.get_taxonomy_text()}")
    print(
        f"\nSample framework -> aida:\n{loader.get_fragment('frameworks', 'aida')[:200]}..."
    )
    print(f"\nFormat labels: {loader.get_format_labels()}")
    scene_types = loader.get_format_scene_types("lifestyle")
    print(f"\nLifestyle scene_types ({len(scene_types)} scenes):")
    for st in scene_types:
        print(f"  [{st['role']}] {st['slug']}: {st['visual'][:60]}...")
