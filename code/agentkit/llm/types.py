from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    reasoning_tokens: int = 0
    calls: int = 0

    def add(self, other: Usage | None) -> Usage:
        if other is not None:
            self.input_tokens += other.input_tokens
            self.output_tokens += other.output_tokens
            self.cached_input_tokens += other.cached_input_tokens
            self.reasoning_tokens += other.reasoning_tokens
            self.calls += other.calls
        return self

    def as_dict(self) -> dict[str, int]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "reasoning_tokens": self.reasoning_tokens,
            "calls": self.calls,
        }


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str

    def as_message_part(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": "function",
            "function": {"name": self.name, "arguments": self.arguments},
        }


@dataclass
class ChatResponse:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    model: str = ""
    finish_reason: str | None = None
    reasoning: str = ""

    def as_assistant_message(self) -> dict[str, Any]:
        message: dict[str, Any] = {"role": "assistant", "content": self.content or ""}
        if self.tool_calls:
            message["tool_calls"] = [call.as_message_part() for call in self.tool_calls]
        return message
