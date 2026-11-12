from __future__ import annotations

from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parents[1]
PROMPTS_DIR = PACKAGE_DIR / "prompts"
SKILLS_DIR = PACKAGE_DIR / "skills"


def load_prompt(name: str, **values: object) -> str:
    text = (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    for key, value in values.items():
        text = text.replace("{" + key + "}", str(value))
    return text
