"""白盒 agent 循环。

语义：调模型 → 没有工具调用就校验最终输出并结束 → 有工具调用就执行、回灌、继续 →
轮数用完时撤掉工具，强制模型基于已有信息给出最终输出。
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ValidationError

from agentkit.agent import AgentSpec
from agentkit.context import RunContext
from agentkit.llm.chat import ChatClient
from agentkit.llm.pricing import cost_of
from agentkit.llm.types import ChatResponse, ToolCall, Usage
from agentkit.tools import SIDE_EFFECT_TAG, Tool, ToolOutcome

T = TypeVar("T")

OUTPUT_INSTRUCTION = """## 最终输出
完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：
{schema}"""

EXHAUSTED_MESSAGE = "工具调用轮数已用完。不要再调用工具，基于目前掌握的信息直接给出最终输出。"
REPAIR_MESSAGE = "上一条回复不符合输出要求：{error}\n请只回复一个符合 Schema 的 JSON 对象。"
BLOCKED_MESSAGE = "ERROR: 这个调用和前面 {count} 次完全相同（同工具同参数），结果不会变化，已拦截。请换个参数、换个工具，或直接给出结论。"
REPLAY_BLOCKED_MESSAGE = "ERROR: 当前是回放运行，这个工具会产生外部副作用，已拦截。请直接基于已有信息继续。"

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


class AgentOutputError(Exception):
    def __init__(self, message: str, text: str) -> None:
        super().__init__(message)
        self.text = text


@dataclass
class AgentResult(Generic[T]):
    output: T
    text: str
    messages: list[dict[str, Any]]
    usage: Usage = field(default_factory=Usage)
    turns: int = 0
    tool_calls: int = 0
    cost: float | None = None
    spec_fingerprint: str = ""


def build_system_prompt(spec: AgentSpec, extra_tools: list[Tool]) -> tuple[str, list[Tool]]:
    parts = [spec.system_prompt.strip()]
    tools = list(spec.tools)
    if spec.skills_dir is not None:
        from agentkit.skills import SkillLibrary

        library = SkillLibrary(spec.skills_dir)
        if library.skills:
            parts.append(library.index_text())
            tools.append(library.read_skill_tool())
    tools.extend(extra_tools)
    if spec.output_model is not None:
        schema = json.dumps(spec.output_model.model_json_schema(), ensure_ascii=False)
        parts.append(OUTPUT_INSTRUCTION.format(schema=schema))
    return "\n\n".join(parts), tools


def parse_output(text: str, model: type[BaseModel]) -> BaseModel:
    cleaned = _FENCE.sub("", text.strip()).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise
        data = json.loads(cleaned[start : end + 1])
    return model.model_validate(data)


def spec_fingerprint(system_prompt: str, schemas: list[dict[str, Any]] | None, model_key: str, params: dict[str, Any]) -> str:
    """Prompt/工具/模型参数的指纹。任何一项变化都会换指纹，方便把效果波动对到具体版本。"""
    material = json.dumps(
        {"system": system_prompt, "tools": schemas or [], "model": model_key, "params": params},
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def _call_signature(tool_call: ToolCall) -> tuple[str, str]:
    try:
        arguments = json.dumps(json.loads(tool_call.arguments or "{}"), ensure_ascii=False, sort_keys=True)
    except json.JSONDecodeError:
        arguments = tool_call.arguments
    return tool_call.name, arguments


async def run_agent(
    spec: AgentSpec,
    user_input: str | list[dict[str, Any]],
    ctx: RunContext,
    *,
    chat: ChatClient | None = None,
    extra_tools: list[Tool] | None = None,
) -> AgentResult[Any]:
    system_prompt, tools = build_system_prompt(spec, extra_tools or [])
    by_name = {tool.name: tool for tool in tools}
    if len(by_name) != len(tools):
        raise ValueError(f"{spec.name} 存在同名工具")
    schemas = [tool.schema() for tool in tools] or None
    chat = chat or ctx.chat_for(spec.model_slot, spec.model_params or None)
    pricing = getattr(chat, "pricing", None)
    params = {**(getattr(chat, "params", None) or spec.model_params), **(getattr(chat, "extra_body", None) or {})}
    trace = ctx.trace
    fingerprint = spec_fingerprint(system_prompt, schemas, chat.model_key, params)

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    if isinstance(user_input, str):
        messages.append({"role": "user", "content": user_input})
    else:
        messages.extend(user_input)

    usage = Usage()
    cost: float | None = None
    tool_count = 0
    turns = 0

    with trace.span(
        spec.name,
        kind="agent",
        agent=spec.name,
        model=chat.model_key,
        model_slot=spec.model_slot,
        model_params=params,
        spec_fingerprint=fingerprint,
        prompt_hash=trace.asset(system_prompt),
        tools_hash=trace.asset(json.dumps(schemas, ensure_ascii=False, sort_keys=True)) if schemas else None,
        tools=list(by_name),
        max_turns=spec.max_turns,
    ) as agent_span:
        agent_span.payload["messages"] = messages
        trace.event("agent_start", agent=spec.name, model=chat.model_key, tools=list(by_name), spec_fingerprint=fingerprint)

        async def call(with_tools: bool) -> ChatResponse:
            nonlocal cost
            with trace.span(
                f"llm {chat.model_key}",
                kind="llm",
                agent=spec.name,
                model=chat.model_key,
                turn=turns,
                with_tools=with_tools,
                input_messages=len(messages),
            ) as llm_span:
                started = time.monotonic()
                response = await chat.complete(messages, tools=schemas if with_tools else None)
                call_cost = cost_of(response.usage, pricing)
                llm_span.usage.add(response.usage)
                llm_span.add_cost(call_cost)
                llm_span.set(
                    response_model=response.model,
                    finish_reason=response.finish_reason,
                    latency_ms=int((time.monotonic() - started) * 1000),
                    tool_call_names=[call.name for call in response.tool_calls],
                )
                llm_span.payload["output"] = {
                    "content": response.content,
                    "reasoning": response.reasoning,
                    "tool_calls": [call.as_message_part() for call in response.tool_calls],
                }
                usage.add(response.usage)
                agent_span.usage.add(response.usage)
                agent_span.add_cost(call_cost)
                if call_cost is not None:
                    cost = round((cost or 0.0) + call_cost, 8)
                trace.add_usage(response.usage, model=chat.model_key, cost=call_cost, currency=(pricing or {}).get("currency"))
                messages.append(response.as_assistant_message())
            trace.check_budget()
            return response

        async def execute(tool_call: ToolCall, repeat: int) -> str:
            target = by_name.get(tool_call.name)
            with trace.span(
                f"tool {tool_call.name}",
                kind="tool",
                agent=spec.name,
                tool=tool_call.name,
                call_id=tool_call.id,
                arguments=tool_call.arguments,
            ) as tool_span:
                if target is None:
                    outcome = ToolOutcome.error(f"ERROR: 没有名为 {tool_call.name} 的工具")
                elif repeat > spec.max_identical_tool_calls:
                    outcome = ToolOutcome.error(BLOCKED_MESSAGE.format(count=repeat - 1), blocked=True)
                elif ctx.replay and SIDE_EFFECT_TAG in target.tags:
                    outcome = ToolOutcome.error(REPLAY_BLOCKED_MESSAGE, blocked=True)
                    tool_span.set(replay_blocked=True)
                else:
                    outcome = await target.invoke_full(tool_call.arguments, ctx)
                tool_span.set(
                    ok=outcome.ok,
                    blocked=outcome.blocked,
                    truncated=outcome.truncated,
                    output_chars=len(outcome.raw),
                    fed_chars=len(outcome.fed),
                )
                tool_span.payload["output"] = outcome.raw
                if not outcome.ok:
                    tool_span.fail(outcome.fed[:500])
                trace.event(
                    "tool_call",
                    agent=spec.name,
                    tool=tool_call.name,
                    arguments=tool_call.arguments,
                    ok=outcome.ok,
                    blocked=outcome.blocked,
                    result_preview=outcome.fed[:300],
                )
            return outcome.fed

        response: ChatResponse | None = None
        last_signature: tuple[str, str] | None = None
        repeat = 0
        while turns < spec.max_turns:
            turns += 1
            response = await call(with_tools=True)
            if not response.tool_calls:
                break
            for tool_call in response.tool_calls:
                tool_count += 1
                signature = _call_signature(tool_call)
                repeat = repeat + 1 if signature == last_signature else 1
                last_signature = signature
                result = await execute(tool_call, repeat)
                messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})
            response = None

        if response is None:
            agent_span.set(exhausted=True)
            messages.append({"role": "user", "content": EXHAUSTED_MESSAGE})
            turns += 1
            response = await call(with_tools=False)

        text = response.content
        output: Any = text
        if spec.output_model is not None:
            for attempt in range(spec.max_repairs + 1):
                try:
                    output = parse_output(text, spec.output_model)
                    break
                except (json.JSONDecodeError, ValidationError) as exc:
                    if attempt >= spec.max_repairs:
                        trace.event("agent_error", agent=spec.name, error=str(exc)[:500])
                        raise AgentOutputError(f"{spec.name} 输出不符合 Schema：{exc}", text) from exc
                    agent_span.set(repairs=attempt + 1)
                    messages.append({"role": "user", "content": REPAIR_MESSAGE.format(error=str(exc)[:800])})
                    turns += 1
                    text = (await call(with_tools=False)).content

        agent_span.set(turns=turns, tool_calls=tool_count)
        agent_span.payload["output"] = output.model_dump(mode="json") if isinstance(output, BaseModel) else output
        trace.event("agent_end", agent=spec.name, turns=turns, tool_calls=tool_count, usage=usage.as_dict(), cost=cost)
    return AgentResult(
        output=output,
        text=text,
        messages=messages,
        usage=usage,
        turns=turns,
        tool_calls=tool_count,
        cost=cost,
        spec_fingerprint=fingerprint,
    )
