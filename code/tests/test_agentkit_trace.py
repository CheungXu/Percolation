import asyncio
import os
import stat

import pytest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from pydantic import BaseModel

from agentkit import AgentSpec, Budget, BudgetExceeded, RunContext, Trace, run_agent, tool
from agentkit.llm.types import ChatResponse, Usage
from agentkit.telemetry import TraceStore, build_export_request
from agentkit.testing import ScriptedChatClient, call_tool, reply
from agentkit.trace import record_model_usage

PRICING = {"currency": "CNY", "input": 1.0, "cached_input": 0.1, "output": 2.0}
SECRET = "sk-test-secret-123456"


class BigArgs(BaseModel):
    n: int


@tool(description="返回很长的文本", max_output_chars=50)
async def big(args: BigArgs, ctx):
    return "x" * args.n


class Out(BaseModel):
    answer: int


def _run(spec, chat, trace=None):
    ctx = RunContext(trace=trace or Trace(name="unit", metadata={"tenant_id": "t1"}))
    return asyncio.run(run_agent(spec, "问题", ctx, chat=chat)), ctx


def test_span_tree_raw_output_cost_and_fingerprint():
    thinking = ChatResponse(content="", tool_calls=call_tool("big", {"n": 100}).tool_calls, usage=Usage(1000, 100, 400, 20, 1), reasoning="先查一下")
    chat = ScriptedChatClient([thinking, reply('{"answer": 1}')], pricing=PRICING)
    spec = AgentSpec(name="a", model_slot="x", system_prompt="s", tools=(big,), output_model=Out)
    result, ctx = _run(spec, chat)
    trace = ctx.trace

    kinds = [(span.kind, span.parent_id) for span in trace.spans]
    root, agent = trace.spans[0], trace.spans[1]
    assert kinds[0] == ("workflow", None) and kinds[1] == ("agent", root.span_id)
    assert [k for k, _ in kinds[2:]] == ["llm", "tool", "llm"]
    assert all(parent == agent.span_id for _, parent in kinds[2:])

    llm, tool_span = trace.spans[2], trace.spans[3]
    assert llm.payload["output"]["reasoning"] == "先查一下"
    assert tool_span.payload["output"] == "x" * 100  # 原文不截断
    assert tool_span.attributes["truncated"] is True
    assert "截断" in chat.requests[1]["messages"][-1]["content"]  # 回灌给模型的是截断版

    # (1000-400)*1 + 400*0.1 + 100*2 = 840 ；第二次 10*1 + 5*2 = 20 → 860 / 1e6
    assert result.cost == pytest.approx(860 / 1e6)
    assert trace.cost == pytest.approx(860 / 1e6)
    assert agent.cost == pytest.approx(860 / 1e6)
    assert len(result.spec_fingerprint) == 16
    assert agent.attributes["prompt_hash"] in trace.assets


def test_fingerprint_changes_with_prompt():
    def fp(prompt):
        chat = ScriptedChatClient([reply("ok")])
        return _run(AgentSpec(name="a", model_slot="x", system_prompt=prompt), chat)[0].spec_fingerprint

    assert fp("s1") == fp("s1") != fp("s2")


def test_identical_tool_calls_blocked():
    same = call_tool("big", {"n": 1})
    chat = ScriptedChatClient([same, same, same, reply('{"answer": 1}')])
    spec = AgentSpec(name="a", model_slot="x", system_prompt="s", tools=(big,), output_model=Out, max_identical_tool_calls=2)
    _, ctx = _run(spec, chat)
    calls = ctx.trace.tool_calls("big")
    assert [c["blocked"] for c in calls] == [False, False, True]
    assert "已拦截" in chat.requests[3]["messages"][-1]["content"]


def test_budget_exceeded_stops_run():
    chat = ScriptedChatClient([call_tool("big", {"n": 1}), reply('{"answer": 1}')], pricing=PRICING)
    spec = AgentSpec(name="a", model_slot="x", system_prompt="s", tools=(big,), output_model=Out)
    trace = Trace(name="unit", budget=Budget(max_tokens=10))
    with pytest.raises(BudgetExceeded):
        _run(spec, chat, trace)
    assert trace.spans[1].status == "error"


def test_record_model_usage_attaches_to_current_span():
    trace = Trace(name="unit")
    record_model_usage("emb", Usage(input_tokens=5, calls=1), {"input": 1})  # 没有活动轨迹：忽略
    with trace.span("retrieval", kind="retrieval") as span:
        record_model_usage("emb", Usage(input_tokens=1000, calls=1), {"input": 0.5})
    assert span.usage.input_tokens == 1000
    assert trace.cost == pytest.approx(0.0005)
    assert trace.usage_by_model["emb"]["usage"].input_tokens == 1000


def test_store_roundtrip_blobs_redaction_and_permissions(tmp_path):
    chat = ScriptedChatClient([call_tool("big", {"n": 40_000}), reply('{"answer": 1}')], pricing=PRICING)
    spec = AgentSpec(name="a", model_slot="x", system_prompt=f"系统提示 {SECRET} " + "规则。" * 300, tools=(big,), output_model=Out)
    _, ctx = _run(spec, chat)
    ctx.trace.finish("succeeded", outcome="ok")

    store = TraceStore(tmp_path / "telemetry", redact=lambda text: text.replace(SECRET, "***"))
    path = store.save(ctx.trace)
    assert stat.S_IMODE(os.stat(tmp_path / "telemetry").st_mode) == 0o700
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600

    raw = store.load(ctx.trace.trace_id[:8])
    tool_payload = next(s for s in raw["spans"] if s["kind"] == "tool")["payload"]
    assert tool_payload["output"]["$ref"].startswith("sha256:")  # 超长原文外置
    system_message = next(s for s in raw["spans"] if s["kind"] == "agent")["payload"]["messages"][0]
    assert "$ref" in system_message["content"]  # 系统提示词按资产去重

    full = store.load(path, hydrate=True)
    assert next(s for s in full["spans"] if s["kind"] == "tool")["payload"]["output"] == "x" * 40_000
    assert SECRET not in str(full) and "***" in next(s for s in full["spans"] if s["kind"] == "agent")["payload"]["messages"][0]["content"]

    rows = list(store.iter_index())
    assert rows[0]["trace_id"] == ctx.trace.trace_id and rows[0]["tool_calls"] == 1 and rows[0]["agents"] == ["a"]

    summary_store = TraceStore(tmp_path / "summary", level="summary")
    data = summary_store.load(summary_store.save(ctx.trace))
    assert all("payload" not in span for span in data["spans"])


def test_otlp_request_has_openinference_attributes():
    chat = ScriptedChatClient([call_tool("big", {"n": 3}), reply('{"answer": 1}')], pricing=PRICING)
    spec = AgentSpec(name="a", model_slot="x", system_prompt="s", tools=(big,), output_model=Out)
    _, ctx = _run(spec, chat)
    ctx.trace.finish("succeeded")
    request = build_export_request(ctx.trace.to_dict(), project="unit")
    ExportTraceServiceRequest.FromString(request.SerializeToString())
    spans = request.resource_spans[0].scope_spans[0].spans
    attrs = {span.name: {kv.key: kv.value for kv in span.attributes} for span in spans}
    assert attrs["a"]["openinference.span.kind"].string_value == "AGENT"
    llm = attrs["llm scripted"]
    assert llm["openinference.span.kind"].string_value == "LLM"
    assert llm["llm.input_messages.0.message.role"].string_value == "system"
    assert llm["llm.token_count.prompt"].int_value == 10
    assert attrs["tool big"]["tool.name"].string_value == "big"
    assert attrs["tool big"]["output.value"].string_value == "xxx"
