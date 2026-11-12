"""把 Trace.to_dict() 转成 OTLP/HTTP protobuf，推给 Phoenix 等 OTel 后端。

直接拼 protobuf 而不走 OTel SDK：轨迹是事后整体导出的，需要保留原始 trace_id / span_id /
时间戳，这样从 NAS 回放历史轨迹（trace_cli export-otlp）和实时导出得到同一棵树。

属性同时写两套约定：
- OpenInference（Phoenix 原生识别）：openinference.span.kind、llm.input_messages.*、tool.name ...
- OTel GenAI semconv：gen_ai.operation.name、gen_ai.request.model、gen_ai.usage.* ...
其余业务属性以 agentkit.* 前缀附上。成本是人民币，写在 agentkit.cost_cny，不冒充 llm.cost（美元）。
"""

from __future__ import annotations

import json
from typing import Any

import httpx
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, ArrayValue, InstrumentationScope, KeyValue
from opentelemetry.proto.resource.v1.resource_pb2 import Resource
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans, Span, Status

OI_KIND = {
    "workflow": "CHAIN",
    "agent": "AGENT",
    "llm": "LLM",
    "tool": "TOOL",
    "retrieval": "RETRIEVER",
    "embedding": "EMBEDDING",
    "rerank": "RERANKER",
}
GENAI_OPERATION = {"agent": "invoke_agent", "llm": "chat", "tool": "execute_tool"}


class OtlpExporter:
    def __init__(
        self,
        endpoint: str,
        *,
        headers: dict[str, str] | None = None,
        project: str = "default",
        service_name: str = "agentkit",
        timeout: float = 10,
        max_value_chars: int = 16_000,
        max_input_messages: int = 40,
    ) -> None:
        self.endpoint = endpoint
        self.headers = dict(headers or {})
        self.project = project
        self.service_name = service_name
        self.timeout = timeout
        self.max_value_chars = max_value_chars
        self.max_input_messages = max_input_messages

    def export(self, data: dict[str, Any]) -> None:
        request = build_export_request(
            data,
            project=self.project,
            service_name=self.service_name,
            max_value_chars=self.max_value_chars,
            max_input_messages=self.max_input_messages,
        )
        response = httpx.post(
            self.endpoint,
            content=request.SerializeToString(),
            headers={"Content-Type": "application/x-protobuf", **self.headers},
            timeout=self.timeout,
        )
        response.raise_for_status()


def parse_headers(raw: str) -> dict[str, str]:
    """解析 OTEL_EXPORTER_OTLP_HEADERS 风格的 `k1=v1,k2=v2`。"""
    headers: dict[str, str] = {}
    for part in filter(None, (item.strip() for item in raw.split(","))):
        key, _, value = part.partition("=")
        headers[key.strip()] = value.strip()
    return headers


def build_export_request(
    data: dict[str, Any],
    *,
    project: str = "default",
    service_name: str = "agentkit",
    max_value_chars: int = 16_000,
    max_input_messages: int = 40,
) -> ExportTraceServiceRequest:
    builder = _SpanBuilder(data, max_value_chars, max_input_messages)
    resource = Resource(
        attributes=[
            _kv("service.name", service_name),
            _kv("openinference.project.name", project),
        ]
    )
    scope = ScopeSpans(scope=InstrumentationScope(name="agentkit"), spans=[builder.build(span) for span in data["spans"]])
    return ExportTraceServiceRequest(resource_spans=[ResourceSpans(resource=resource, scope_spans=[scope])])


class _SpanBuilder:
    def __init__(self, data: dict[str, Any], max_chars: int, max_messages: int) -> None:
        self.data = data
        self.trace_id = bytes.fromhex(data["trace_id"])
        self.by_id = {span["span_id"]: span for span in data["spans"]}
        self.assets = data.get("assets") or {}
        self.max_chars = max_chars
        self.max_messages = max_messages
        metadata = data.get("metadata") or {}
        self.common = {
            "session.id": metadata.get("session_id") or data["trace_id"],
            "user.id": metadata.get("tenant_id") or "",
            "agentkit.trace_name": data["name"],
        }

    def text(self, value: Any) -> str:
        if value is None:
            return ""
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
        if len(text) > self.max_chars:
            return text[: self.max_chars] + f"\n…（导出截断，原文 {len(text)} 字，完整内容见 NAS 轨迹）"
        return text

    def build(self, span: dict[str, Any]) -> Span:
        kind = span["kind"]
        attrs: dict[str, Any] = {**self.common, "openinference.span.kind": OI_KIND.get(kind, "CHAIN")}
        if kind in GENAI_OPERATION:
            attrs["gen_ai.operation.name"] = GENAI_OPERATION[kind]
        for key, value in span.get("attributes", {}).items():
            if value is not None:
                attrs[f"agentkit.{key}"] = value
        if span.get("cost") is not None:
            attrs["agentkit.cost_cny"] = span["cost"]
        usage = span.get("usage")
        if usage and kind == "llm":
            attrs.update(_usage_attrs(usage))
        elif usage:  # agent 汇总 / embedding 等：不写 llm.token_count，免得 Phoenix 重复累计
            attrs["agentkit.usage"] = usage
        builder = getattr(self, f"_{kind}", None)
        if builder is not None:
            builder(span, attrs)

        status = Status(code=Status.StatusCode.STATUS_CODE_OK)
        if span.get("status") == "error":
            status = Status(code=Status.StatusCode.STATUS_CODE_ERROR, message=(span.get("error") or "")[:1000])
        end_ns = span.get("end_ns") or span["start_ns"]
        return Span(
            trace_id=self.trace_id,
            span_id=bytes.fromhex(span["span_id"]),
            parent_span_id=bytes.fromhex(span["parent_id"]) if span.get("parent_id") else b"",
            name=span["name"],
            kind=Span.SpanKind.SPAN_KIND_CLIENT if kind == "llm" else Span.SpanKind.SPAN_KIND_INTERNAL,
            start_time_unix_nano=span["start_ns"],
            end_time_unix_nano=end_ns,
            attributes=[_kv(key, value) for key, value in attrs.items()],
            status=status,
        )

    # ---- 各类 span 的语义属性 ----
    def _workflow(self, span: dict[str, Any], attrs: dict[str, Any]) -> None:
        payload = span.get("payload") or {}
        attrs["input.value"] = self.text(payload.get("input", self.data.get("metadata")))
        attrs["output.value"] = self.text(payload.get("output", self.data.get("summary")))
        attrs["metadata"] = self.text({**self.data.get("metadata", {}), "status": self.data.get("status")})
        attrs["agentkit.trace_cost_cny"] = self.data.get("cost", {}).get("total")

    def _agent(self, span: dict[str, Any], attrs: dict[str, Any]) -> None:
        payload = span.get("payload") or {}
        a = span.get("attributes", {})
        attrs["gen_ai.agent.name"] = a.get("agent", span["name"])
        attrs["llm.model_name"] = a.get("model", "")
        messages = payload.get("messages") or []
        first_user = next((m.get("content") for m in messages if m.get("role") == "user"), None)
        attrs["input.value"] = self.text(first_user)
        attrs["output.value"] = self.text(payload.get("output"))

    def _llm(self, span: dict[str, Any], attrs: dict[str, Any]) -> None:
        a = span.get("attributes", {})
        parent = self.by_id.get(span.get("parent_id") or "", {})
        parent_attrs = parent.get("attributes", {})
        messages = (parent.get("payload") or {}).get("messages") or []
        inputs = messages[: a.get("input_messages", len(messages))]
        if len(inputs) > self.max_messages:
            inputs = inputs[:1] + inputs[-(self.max_messages - 1) :]
        model = a.get("response_model") or a.get("model", "")
        attrs.update({"llm.model_name": model, "gen_ai.request.model": a.get("model", ""), "gen_ai.response.model": model})
        if parent_attrs.get("model_params"):
            attrs["llm.invocation_parameters"] = self.text(parent_attrs["model_params"])
        for index, message in enumerate(inputs):
            attrs.update(self._message_attrs(f"llm.input_messages.{index}", message))
        output = (span.get("payload") or {}).get("output") or {}
        if output:
            attrs.update(
                self._message_attrs(
                    "llm.output_messages.0",
                    {"role": "assistant", "content": output.get("content", ""), "tool_calls": output.get("tool_calls") or []},
                )
            )
            if output.get("reasoning"):
                attrs["agentkit.reasoning"] = self.text(output["reasoning"])
            attrs["output.value"] = self.text(output.get("content") or output.get("tool_calls"))
        if inputs:
            attrs["input.value"] = self.text(inputs[-1].get("content"))
        if a.get("with_tools") and parent_attrs.get("tools_hash") in self.assets:
            for index, schema in enumerate(json.loads(self.assets[parent_attrs["tools_hash"]])):
                attrs[f"llm.tools.{index}.tool.json_schema"] = json.dumps(schema, ensure_ascii=False)

    def _tool(self, span: dict[str, Any], attrs: dict[str, Any]) -> None:
        a = span.get("attributes", {})
        attrs["tool.name"] = a.get("tool", span["name"])
        attrs["gen_ai.tool.name"] = a.get("tool", span["name"])
        attrs["gen_ai.tool.call.id"] = a.get("call_id", "")
        attrs["input.value"] = self.text(a.get("arguments"))
        attrs["input.mime_type"] = "application/json"
        attrs["output.value"] = self.text((span.get("payload") or {}).get("output"))

    def _retrieval(self, span: dict[str, Any], attrs: dict[str, Any]) -> None:
        a = span.get("attributes", {})
        attrs["input.value"] = self.text(a.get("queries"))
        for index, doc in enumerate((span.get("payload") or {}).get("documents") or []):
            prefix = f"retrieval.documents.{index}.document"
            attrs[f"{prefix}.id"] = str(doc.get("id", index))
            attrs[f"{prefix}.content"] = self.text(doc.get("content", ""))
            if doc.get("score") is not None:
                attrs[f"{prefix}.score"] = float(doc["score"])

    def _message_attrs(self, prefix: str, message: dict[str, Any]) -> dict[str, Any]:
        attrs: dict[str, Any] = {f"{prefix}.message.role": message.get("role", "")}
        content = message.get("content")
        if content:
            attrs[f"{prefix}.message.content"] = self.text(content)
        if message.get("tool_call_id"):
            attrs[f"{prefix}.message.tool_call_id"] = message["tool_call_id"]
        for index, call in enumerate(message.get("tool_calls") or []):
            function = call.get("function") or {}
            base = f"{prefix}.message.tool_calls.{index}.tool_call"
            attrs[f"{base}.id"] = call.get("id", "")
            attrs[f"{base}.function.name"] = function.get("name", "")
            attrs[f"{base}.function.arguments"] = self.text(function.get("arguments", ""))
        return attrs


def _usage_attrs(usage: dict[str, int]) -> dict[str, Any]:
    prompt, completion = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
    return {
        "llm.token_count.prompt": prompt,
        "llm.token_count.completion": completion,
        "llm.token_count.total": prompt + completion,
        "llm.token_count.prompt_details.cache_read": usage.get("cached_input_tokens", 0),
        "llm.token_count.completion_details.reasoning": usage.get("reasoning_tokens", 0),
        "gen_ai.usage.input_tokens": prompt,
        "gen_ai.usage.output_tokens": completion,
    }


def _any(value: Any) -> AnyValue:
    if isinstance(value, bool):
        return AnyValue(bool_value=value)
    if isinstance(value, int):
        return AnyValue(int_value=value)
    if isinstance(value, float):
        return AnyValue(double_value=value)
    if isinstance(value, str):
        return AnyValue(string_value=value)
    if isinstance(value, list) and all(isinstance(item, str | int | float | bool) for item in value):
        return AnyValue(array_value=ArrayValue(values=[_any(item) for item in value]))
    return AnyValue(string_value=json.dumps(value, ensure_ascii=False, default=str))


def _kv(key: str, value: Any) -> KeyValue:
    return KeyValue(key=key, value=_any(value))
