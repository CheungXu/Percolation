"""SKILL.md 按需加载：系统提示词里只放一行索引，正文由模型调 read_skill 读取。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

from agentkit.tools import Tool, ToolError


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    path: Path

    def body(self) -> str:
        return _split_frontmatter(self.path.read_text(encoding="utf-8"))[1].strip()


def _split_frontmatter(text: str) -> tuple[dict, str]:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            meta = yaml.safe_load(parts[1]) or {}
            return (meta if isinstance(meta, dict) else {}), parts[2]
    return {}, text


class SkillLibrary:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.skills: dict[str, Skill] = {}
        if root.is_dir():
            for path in sorted(root.glob("*/SKILL.md")):
                meta, _ = _split_frontmatter(path.read_text(encoding="utf-8"))
                name = str(meta.get("name") or path.parent.name)
                description = " ".join(str(meta.get("description") or "").split())
                self.skills[name] = Skill(name=name, description=description, path=path)

    def index_text(self) -> str:
        lines = ["## 可用技能", "需要时先调用 read_skill 读取正文，再按正文执行。"]
        lines.extend(f"- {skill.name}：{skill.description}" for skill in self.skills.values())
        return "\n".join(lines)

    def read_skill_tool(self) -> Tool:
        library = self

        class ReadSkillArgs(BaseModel):
            name: str = Field(description="技能名称")

        def handler(args: ReadSkillArgs, ctx) -> str:
            skill = library.skills.get(args.name)
            if skill is None:
                raise ToolError(f"没有技能 {args.name}，可用：{', '.join(library.skills)}")
            return skill.body()

        return Tool(
            name="read_skill",
            description="读取一个技能的完整说明。",
            args_model=ReadSkillArgs,
            handler=handler,
            tags=frozenset({"read"}),
            max_output_chars=20000,
        )
