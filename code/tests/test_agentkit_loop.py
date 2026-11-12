import asyncio

import pytest
from pydantic import BaseModel

from agentkit import AgentSpec, RunContext, ToolError, run_agent, tool
from agentkit.loop import AgentOutputError
from agentkit.testing import ScriptedChatClient, call_tool, reply


class AddArgs(BaseModel):
    a: int
    b: int


@tool(description="相加")
async def add(args: AddArgs, ctx):
    return {"sum": args.a + args.b}


class FailArgs(BaseModel):
    pass


@tool(description="总是失败")
def fail(args: FailArgs, ctx):
    raise ToolError("故意失败")


class Out(BaseModel):
    answer: int


def run(spec, chat, text="问题"):
    ctx = RunContext()
    return asyncio.run(run_agent(spec, text, ctx, chat=chat)), ctx


def test_tool_result_fed_back_and_output_validated():
    chat = ScriptedChatClient([call_tool("add", {"a": 1, "b": 2}), reply('```json\n{"answer": 3}\n```')])
    spec = AgentSpec(name="t", model_slot="x", system_prompt="s", tools=(add,), output_model=Out)
    result, ctx = run(spec, chat)
    assert result.output == Out(answer=3)
    assert result.tool_calls == 1
    tool_message = chat.requests[1]["messages"][-1]
    assert tool_message["role"] == "tool" and '"sum": 3' in tool_message["content"]
    assert ctx.trace.tool_calls("add")[0]["ok"] is True
    assert "JSON Schema" in chat.requests[0]["messages"][0]["content"]


def test_tool_errors_do_not_crash_loop():
    chat = ScriptedChatClient([call_tool("fail"), call_tool("missing"), reply('{"answer": 1}')])
    spec = AgentSpec(name="t", model_slot="x", system_prompt="s", tools=(fail,), output_model=Out)
    result, ctx = run(spec, chat)
    assert result.output.answer == 1
    assert [event["ok"] for event in ctx.trace.tool_calls()] == [False, False]
    assert "故意失败" in chat.requests[1]["messages"][-1]["content"]


def test_invalid_output_repaired_once():
    chat = ScriptedChatClient([reply("不是 JSON"), reply('{"answer": 7}')])
    spec = AgentSpec(name="t", model_slot="x", system_prompt="s", output_model=Out)
    result, _ = run(spec, chat)
    assert result.output.answer == 7
    assert "不符合输出要求" in chat.requests[1]["messages"][-1]["content"]


def test_invalid_output_raises_after_repairs():
    chat = ScriptedChatClient([reply("x"), reply("y")])
    spec = AgentSpec(name="t", model_slot="x", system_prompt="s", output_model=Out, max_repairs=1)
    with pytest.raises(AgentOutputError):
        run(spec, chat)


def test_max_turns_forces_final_answer_without_tools():
    chat = ScriptedChatClient([call_tool("add", {"a": 1, "b": 1}), call_tool("add", {"a": 2, "b": 2}), reply('{"answer": 4}')])
    spec = AgentSpec(name="t", model_slot="x", system_prompt="s", tools=(add,), output_model=Out, max_turns=2)
    result, _ = run(spec, chat)
    assert result.output.answer == 4
    assert chat.requests[-1]["tools"] is None
    assert "轮数已用完" in chat.requests[-1]["messages"][-1]["content"]


def test_plain_text_output_when_no_model():
    chat = ScriptedChatClient([reply("你好")])
    result, _ = run(AgentSpec(name="t", model_slot="x", system_prompt="s"), chat)
    assert result.output == "你好"
