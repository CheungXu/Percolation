from __future__ import annotations

import inspect
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, get_type_hints

from pydantic import BaseModel, ValidationError

if TYPE_CHECKING:
    from agentkit.context import RunContext

DEFAULT_MAX_OUTPUT_CHARS = 8000

Handler = Callable[[Any, "RunContext"], Awaitable[Any] | Any]


class ToolError(Exception):
    """工具可预期的失败。消息原样回灌给模型，让它换个做法，而不是让循环崩掉。"""


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args_model: type[BaseModel]
    handler: Handler
    tags: frozenset[str] = field(default_factory=frozenset)
    max_output_chars: int = DEFAULT_MAX_OUTPUT_CHARS

    def schema(self) -> dict[str, Any]:
        parameters = self.args_model.model_json_schema()
        parameters.pop("title", None)
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": parameters},
        }

    async def invoke(self, raw_arguments: str, ctx: RunContext) -> tuple[str, bool]:
        """执行工具，返回 (回灌文本, 是否成功)。任何异常都转成文本。"""
        outcome = await self.invoke_full(raw_arguments, ctx)
        return outcome.fed, outcome.ok

    async def invoke_full(self, raw_arguments: str, ctx: RunContext) -> ToolOutcome:
        """执行工具，同时保留未截断原文（给轨迹）和截断后的回灌文本（给模型）。"""
        try:
            data = json.loads(raw_arguments or "{}")
            if not isinstance(data, dict):
                raise ToolError("参数必须是 JSON 对象")
            args = self.args_model.model_validate(data)
            result = self.handler(args, ctx)
            if inspect.isawaitable(result):
                result = await result
        except json.JSONDecodeError as exc:
            return ToolOutcome.error(f"ERROR: 参数不是合法 JSON：{exc}")
        except ValidationError as exc:
            return ToolOutcome.error(f"ERROR: 参数校验失败：{exc.errors(include_url=False)}")
        except ToolError as exc:
            return ToolOutcome.error(f"ERROR: {exc}")
        except Exception as exc:  # noqa: BLE001
            return ToolOutcome.error(f"ERROR: 工具内部错误 {type(exc).__name__}: {exc}")
        raw = render(result)
        return ToolOutcome(fed=truncate(raw, self.max_output_chars), ok=True, raw=raw)


@dataclass(frozen=True)
class ToolOutcome:
    fed: str
    ok: bool
    raw: str
    blocked: bool = False

    @property
    def truncated(self) -> bool:
        return self.raw != self.fed

    @classmethod
    def error(cls, message: str, *, blocked: bool = False) -> ToolOutcome:
        return cls(fed=message, ok=False, raw=message, blocked=blocked)


def render(result: Any) -> str:
    if result is None:
        return "OK"
    if isinstance(result, str):
        return result
    if isinstance(result, BaseModel):
        return result.model_dump_json()
    return json.dumps(result, ensure_ascii=False, default=str)


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…（输出已截断，共 {len(text)} 字，只显示前 {limit} 字）"


def tool(
    name: str | None = None,
    *,
    description: str | None = None,
    tags: tuple[str, ...] = (),
    max_output_chars: int = DEFAULT_MAX_OUTPUT_CHARS,
) -> Callable[[Handler], Tool]:
    """把 `async def fn(args: ArgsModel, ctx)` 变成 Tool。参数模型从第一个参数的注解推断。"""

    def wrap(fn: Handler) -> Tool:
        hints = get_type_hints(fn)
        first = next(iter(inspect.signature(fn).parameters))
        args_model = hints.get(first)
        if not (isinstance(args_model, type) and issubclass(args_model, BaseModel)):
            raise TypeError(f"{fn.__name__} 的第一个参数必须注解为 pydantic BaseModel")
        return Tool(
            name=name or fn.__name__,
            description=description or inspect.cleandoc(fn.__doc__ or ""),
            args_model=args_model,
            handler=fn,
            tags=frozenset(tags),
            max_output_chars=max_output_chars,
        )

    return wrap
