"""运行轨迹：span 树 + 兼容旧接口的事件流 + 用量/成本账本 + 预算护栏。

一次 Trace 对应一次业务运行（一次检索、一次做梦），结构是：
    workflow(根) → agent → llm / tool / retrieval / 业务自定义 span
- span 的 attributes 放可索引的小字段（模型、轮次、指纹、用量），payload 放大文本
  （完整 messages、思考链、工具原文）。落盘时 level=summary 会丢弃 payload。
- 当前 span 用 ContextVar 跟踪，所以 embedding / rerank 客户端这类拿不到 ctx 的代码
  也能通过 record_model_usage() 把用量记到当前 span 上。
- event()/tool_calls()/add_usage() 保持旧语义，业务代码无需改动。
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agentkit.llm.types import Usage

SCHEMA_VERSION = "agentkit.trace/v1"
DEFAULT_CURRENCY = "CNY"
FAILED_STATUSES = {"failed", "error"}

_ACTIVE: ContextVar[tuple[Trace, Span] | None] = ContextVar("agentkit_active_span", default=None)


class BudgetExceeded(RuntimeError):
    """单次运行的 token 或金额超出预算。属于硬失败，不回灌给模型。"""


@dataclass
class Budget:
    max_cost: float | None = None
    max_tokens: int | None = None


def sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def new_span_id() -> str:
    return uuid.uuid4().hex[:16]


@dataclass
class Span:
    span_id: str
    parent_id: str | None
    name: str
    kind: str
    start_ns: int
    end_ns: int | None = None
    status: str = "ok"
    error: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    payload: dict[str, Any] = field(default_factory=dict)
    usage: Usage = field(default_factory=Usage)
    cost: float | None = None

    def set(self, **attributes: Any) -> Span:
        self.attributes.update(attributes)
        return self

    def fail(self, error: str) -> Span:
        self.status = "error"
        self.error = error[:2000]
        return self

    def add_cost(self, cost: float | None) -> None:
        if cost is not None:
            self.cost = round((self.cost or 0.0) + cost, 8)

    def to_dict(self, include_payload: bool) -> dict[str, Any]:
        data: dict[str, Any] = {
            "span_id": self.span_id,
            "parent_id": self.parent_id,
            "name": self.name,
            "kind": self.kind,
            "start_ns": self.start_ns,
            "end_ns": self.end_ns,
            "duration_ms": (self.end_ns - self.start_ns) // 1_000_000 if self.end_ns else None,
            "status": self.status,
            "attributes": self.attributes,
        }
        if self.error:
            data["error"] = self.error
        if self.usage.calls or self.usage.input_tokens:
            data["usage"] = self.usage.as_dict()
        if self.cost is not None:
            data["cost"] = self.cost
        if include_payload and self.payload:
            data["payload"] = self.payload
        return data


class Trace:
    """记录一次（可能包含多个 agent 的）运行。"""

    def __init__(
        self,
        name: str = "",
        on_event: Callable[[dict[str, Any]], None] | None = None,
        *,
        metadata: dict[str, Any] | None = None,
        budget: Budget | None = None,
    ) -> None:
        self.trace_id = uuid.uuid4().hex
        self.name = name or "run"
        self.metadata = dict(metadata or {})
        self.budget = budget or Budget()
        self.on_event = on_event
        self.events: list[dict[str, Any]] = []
        self.usage = Usage()
        self.cost = 0.0
        self.currency = DEFAULT_CURRENCY
        self.unpriced_calls = 0
        self.usage_by_model: dict[str, dict[str, Any]] = {}
        self.assets: dict[str, str] = {}
        self.started = time.monotonic()
        self.root = Span(new_span_id(), None, self.name, "workflow", time.time_ns())
        self.spans: list[Span] = [self.root]
        self.status = "ok"
        self.summary: dict[str, Any] = {}

    # ---- span 树 ----
    @property
    def current_span(self) -> Span:
        active = _ACTIVE.get()
        return active[1] if active is not None and active[0] is self else self.root

    @contextmanager
    def span(self, name: str, kind: str = "chain", **attributes: Any) -> Iterator[Span]:
        span = Span(new_span_id(), self.current_span.span_id, name, kind, time.time_ns(), attributes=dict(attributes))
        self.spans.append(span)
        token = _ACTIVE.set((self, span))
        try:
            yield span
        except BaseException as exc:
            span.fail(f"{type(exc).__name__}: {exc}")
            raise
        finally:
            span.end_ns = time.time_ns()
            _ACTIVE.reset(token)

    @contextmanager
    def activate(self) -> Iterator[Trace]:
        """把根 span 设为当前 span，供 record_model_usage 在 agent 之外也能记账。"""
        token = _ACTIVE.set((self, self.root))
        try:
            yield self
        finally:
            _ACTIVE.reset(token)

    def asset(self, content: str) -> str:
        """按内容哈希登记大段静态内容（系统提示词、工具 Schema），落盘时进 CAS 去重。"""
        digest = sha256_text(content)
        self.assets.setdefault(digest, content)
        return digest

    # ---- 兼容旧接口 ----
    def event(self, kind: str, **data: Any) -> None:
        record = {"t_ms": self.elapsed_ms, "kind": kind, "span_id": self.current_span.span_id, **data}
        self.events.append(record)
        if self.on_event is not None:
            self.on_event(record)

    def tool_calls(self, name: str | None = None, agent: str | None = None) -> list[dict[str, Any]]:
        return [
            event
            for event in self.events
            if event["kind"] == "tool_call"
            and (name is None or event.get("tool") == name)
            and (agent is None or event.get("agent") == agent)
        ]

    # ---- 用量与成本 ----
    def add_usage(
        self,
        usage: Usage | None,
        *,
        model: str | None = None,
        cost: float | None = None,
        currency: str | None = None,
    ) -> None:
        if usage is None:
            return
        self.usage.add(usage)
        if cost is not None:
            self.cost = round(self.cost + cost, 8)
            self.currency = currency or self.currency
        elif usage.calls:
            self.unpriced_calls += usage.calls
        if model:
            entry = self.usage_by_model.setdefault(model, {"usage": Usage(), "cost": None})
            entry["usage"].add(usage)
            if cost is not None:
                entry["cost"] = round((entry["cost"] or 0.0) + cost, 8)

    def check_budget(self) -> None:
        budget = self.budget
        if budget.max_cost is not None and self.cost > budget.max_cost:
            raise BudgetExceeded(f"本次运行成本 {self.cost:.4f} {self.currency} 超出预算 {budget.max_cost}")
        tokens = self.usage.input_tokens + self.usage.output_tokens
        if budget.max_tokens is not None and tokens > budget.max_tokens:
            raise BudgetExceeded(f"本次运行 token {tokens} 超出预算 {budget.max_tokens}")

    @property
    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    # ---- 收尾与序列化 ----
    def finish(self, status: str | None = None, **summary: Any) -> None:
        if status:
            self.status = status
        self.summary.update(summary)
        if self.root.end_ns is None:
            self.root.end_ns = time.time_ns()
        if self.status in FAILED_STATUSES:
            self.root.status = "error"

    def to_dict(self, level: str = "full") -> dict[str, Any]:
        full = level == "full"
        end_ns = self.root.end_ns or time.time_ns()
        return {
            "schema": SCHEMA_VERSION,
            "trace_id": self.trace_id,
            "name": self.name,
            "level": level,
            "status": self.status,
            "started_at": datetime.fromtimestamp(self.root.start_ns / 1e9, UTC).isoformat(),
            "duration_ms": (end_ns - self.root.start_ns) // 1_000_000,
            "metadata": self.metadata,
            "summary": self.summary,
            "usage": self.usage.as_dict(),
            "cost": {"total": self.cost, "currency": self.currency, "unpriced_calls": self.unpriced_calls},
            "usage_by_model": {
                key: {"usage": value["usage"].as_dict(), "cost": value["cost"]} for key, value in self.usage_by_model.items()
            },
            "budget": {"max_cost": self.budget.max_cost, "max_tokens": self.budget.max_tokens},
            "spans": [span.to_dict(include_payload=full) for span in self.spans],
            "events": self.events,
            "assets": dict(self.assets) if full else {},
        }

    def write_jsonl(self, path: Path) -> None:
        """旧的本地调试输出：只写事件流。正式落盘请用 agentkit.telemetry.TraceStore。"""
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            for event in self.events:
                handle.write(json.dumps({"trace": self.name, **event}, ensure_ascii=False, default=str) + "\n")


def current_trace() -> Trace | None:
    active = _ACTIVE.get()
    return active[0] if active is not None else None


def record_model_usage(model_key: str, usage: Usage, pricing: dict[str, Any] | None = None) -> None:
    """给拿不到 RunContext 的模型客户端（embedding / rerank）用：记到当前 span 与整条轨迹。"""
    active = _ACTIVE.get()
    if active is None:
        return
    from agentkit.llm.pricing import cost_of

    trace, span = active
    cost = cost_of(usage, pricing)
    span.usage.add(usage)
    span.add_cost(cost)
    trace.add_usage(usage, model=model_key, cost=cost, currency=(pricing or {}).get("currency"))
