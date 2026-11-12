#!/usr/bin/env python3
"""从真实代码导出控制台需要的 Agent 元数据，写到 generated.js。

  code/.venv/bin/python script/preview-console/build_data.py

导出内容全部来自运行时对象，不手抄：每个 AgentSpec 的槽位、实际模型、轮数、
工具 JSON Schema、输出 Schema，以及 run_agent 实际拼出的完整 system prompt；
外加 prompts/*.md、wiki-format SKILL.md 原文和 models.json（不含密钥）。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "code"))

from agentkit.loop import build_system_prompt  # noqa: E402
from agentkit.skills import SkillLibrary  # noqa: E402
from percolation.agents import PROMPTS_DIR, SKILLS_DIR, dream, search  # noqa: E402


def spec_info(spec, agent: str, mode: str | None = None) -> dict:
    system_prompt, tools = build_system_prompt(spec, [])
    models = json.loads((ROOT / "config" / "models.json").read_text(encoding="utf-8"))
    model_key = models["slots"].get(spec.model_slot)
    model = next((m for m in models["models"] if m["key"] == model_key), {})
    return {
        "name": spec.name,
        "agent": agent,
        "mode": mode,
        "model_slot": spec.model_slot,
        "model_key": model_key,
        "model": model.get("model"),
        "provider": model.get("provider"),
        "params": {**model.get("params", {}), **spec.model_params},
        "extra_body": model.get("extra_body", {}),
        "max_turns": spec.max_turns,
        "max_repairs": spec.max_repairs,
        "skills": list(SkillLibrary(spec.skills_dir).skills) if spec.skills_dir else [],
        "output_model": spec.output_model.__name__ if spec.output_model else None,
        "output_schema": spec.output_model.model_json_schema() if spec.output_model else None,
        "tools": [
            {
                "name": tool.name,
                "description": tool.description,
                "tags": sorted(tool.tags),
                "max_output_chars": tool.max_output_chars,
                "parameters": tool.schema()["function"]["parameters"],
            }
            for tool in tools
        ],
        "system_prompt_raw": spec.system_prompt,
        "system_prompt_final": system_prompt,
        "system_prompt_chars": len(system_prompt),
    }


def main() -> None:
    limit, soft = 200, 180
    specs = [
        spec_info(search.router_spec(), "search"),
        spec_info(search.answer_spec(), "search"),
        spec_info(search.probe_spec(), "search"),
        spec_info(dream.archive_spec(limit), "dream"),
        spec_info(dream.tiering_spec(limit, soft, False), "dream", "incremental"),
        spec_info(dream.tiering_spec(limit, soft, True), "dream", "defrag"),
    ]
    models = json.loads((ROOT / "config" / "models.json").read_text(encoding="utf-8"))
    for model in models["models"]:
        model.pop("api_key_env", None)
    data = {
        "generated_from": "code/percolation/agents/*.py · run_agent.build_system_prompt",
        "specs": specs,
        "prompts": {path.stem: path.read_text(encoding="utf-8") for path in sorted(PROMPTS_DIR.glob("*.md"))},
        "skills": {
            name: {"description": skill.description, "path": str(skill.path.relative_to(ROOT)), "body": skill.body()}
            for name, skill in SkillLibrary(SKILLS_DIR).skills.items()
        },
        "models": models,
        "constants": {
            "memory_line_limit": limit,
            "memory_soft_limit": soft,
            "promotion_window_days": dream.PROMOTION_WINDOW_DAYS,
            "promotion_min_hits": dream.PROMOTION_MIN_HITS,
            "defrag_interval_days": dream.DEFRAG_INTERVAL_DAYS,
            "defrag_dangling_links": dream.DEFRAG_DANGLING_LINKS,
            "archive_batch_messages": dream.ARCHIVE_BATCH_MESSAGES,
        },
    }
    out = Path(__file__).resolve().parent / "shared" / "generated.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("window.PERC_GEN = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(specs)} specs, {len(data['prompts'])} prompts, {len(data['skills'])} skills")


if __name__ == "__main__":
    main()
