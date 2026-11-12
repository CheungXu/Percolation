"""单测用替身：按顺序回放预设的模型响应，不调真实接口。"""

from __future__ import annotations

import json
from typing import Any

from agentkit.llm.types import ChatResponse, ToolCall, Usage


def reply(content: str) -> ChatResponse:
    return ChatResponse(content=content, usage=Usage(input_tokens=10, output_tokens=5, calls=1))


def call_tool(name: str, arguments: dict[str, Any] | None = None, call_id: str | None = None) -> ChatResponse:
    return ChatResponse(
        content="",
        tool_calls=[ToolCall(id=call_id or f"call_{name}", name=name, arguments=json.dumps(arguments or {}, ensure_ascii=False))],
        usage=Usage(input_tokens=10, output_tokens=5, calls=1),
    )


class ScriptedChatClient:
    def __init__(
        self,
        responses: list[ChatResponse],
        model_key: str = "scripted",
        *,
        pricing: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> None:
        self.responses = list(responses)
        self.model_key = model_key
        self.pricing = pricing or {}
        self.params = params or {}
        self.requests: list[dict[str, Any]] = []

    async def complete(self, messages: list[dict[str, Any]], *, tools: list[dict[str, Any]] | None = None) -> ChatResponse:
        self.requests.append({"messages": [dict(message) for message in messages], "tools": tools})
        if not self.responses:
            raise AssertionError("ScriptedChatClient 没有更多预设响应")
        return self.responses.pop(0)
