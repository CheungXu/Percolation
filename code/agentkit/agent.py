from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from agentkit.tools import Tool


@dataclass(frozen=True)
class AgentSpec:
    """一个 agent 的全部静态配置。

    system_prompt 保持固定，动态内容（记忆、检索结果）放进 run_agent 的输入，
    这样系统提示词前缀稳定，容易命中模型侧 KV Cache。
    """

    name: str
    model_slot: str
    system_prompt: str
    tools: tuple[Tool, ...] = ()
    output_model: type[BaseModel] | None = None
    max_turns: int = 8
    max_repairs: int = 1
    skills_dir: Path | None = None
    model_params: dict[str, Any] = field(default_factory=dict)
    # 死循环护栏：同一个工具 + 同样参数连续执行的上限，超过后直接回灌拦截提示。
    max_identical_tool_calls: int = 2

    def with_tools(self, *tools: Tool) -> AgentSpec:
        from dataclasses import replace

        return replace(self, tools=tuple(self.tools) + tuple(tools))
