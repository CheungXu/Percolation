from __future__ import annotations

import asyncio
import json
from json import JSONDecodeError
from typing import Any, Protocol

import httpx

from agentkit.llm.registry import ModelConfig
from agentkit.llm.types import ChatResponse, ToolCall, Usage

RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}


class ChatClient(Protocol):
    model_key: str

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> ChatResponse: ...


class OpenAIChatClient:
    """OpenAI 兼容的 chat/completions 客户端。

    一律走流式：部分厂商（如百炼开启思考时）不接受非流式请求。流式分片里的
    tool_calls 按 index 拼回完整调用。
    """

    def __init__(
        self,
        model: ModelConfig,
        *,
        timeout_seconds: float = 120,
        retry_attempts: int = 3,
        retry_initial_delay: float = 1.0,
        params: dict[str, Any] | None = None,
        extra_body: dict[str, Any] | None = None,
    ) -> None:
        self.model = model
        self.model_key = model.key
        self.timeout_seconds = timeout_seconds
        self.retry_attempts = max(1, retry_attempts)
        self.retry_initial_delay = retry_initial_delay
        self.params = {**model.params, **(params or {})}
        self.extra_body = {**model.extra_body, **(extra_body or {})}
        self.pricing = model.pricing

    async def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> ChatResponse:
        for attempt in range(1, self.retry_attempts + 1):
            try:
                return await self._complete_once(messages, tools)
            except Exception as exc:
                if attempt >= self.retry_attempts or not _is_retryable(exc):
                    raise
                await asyncio.sleep(self.retry_initial_delay * (2 ** (attempt - 1)))
        raise RuntimeError("unreachable")

    async def _complete_once(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
    ) -> ChatResponse:
        body: dict[str, Any] = {
            "model": self.model.model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            **self.params,
            **self.extra_body,
        }
        if tools:
            body["tools"] = tools
        headers = {
            "Authorization": f"Bearer {self.model.api_key}",
            "Content-Type": "application/json",
        }
        content: list[str] = []
        reasoning: list[str] = []
        calls: dict[int, dict[str, str]] = {}
        usage = Usage(calls=1)
        finish_reason: str | None = None
        model_name = self.model.model

        async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout_seconds)) as client:
            async with client.stream(
                "POST",
                f"{self.model.base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=body,
            ) as response:
                if response.status_code >= 400:
                    detail = (await response.aread()).decode(errors="replace")[:500]
                    raise httpx.HTTPStatusError(
                        f"HTTP {response.status_code}: {detail}",
                        request=response.request,
                        response=response,
                    )
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line.removeprefix("data:").strip()
                    if not payload or payload == "[DONE]":
                        continue
                    chunk = json.loads(payload)
                    model_name = chunk.get("model") or model_name
                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        if delta.get("content"):
                            content.append(delta["content"])
                        if delta.get("reasoning_content"):
                            reasoning.append(delta["reasoning_content"])
                        for part in delta.get("tool_calls") or []:
                            slot = calls.setdefault(
                                int(part.get("index", 0)), {"id": "", "name": "", "arguments": ""}
                            )
                            if part.get("id"):
                                slot["id"] = part["id"]
                            function = part.get("function") or {}
                            if function.get("name"):
                                slot["name"] += function["name"]
                            if function.get("arguments"):
                                slot["arguments"] += function["arguments"]
                        if choice.get("finish_reason"):
                            finish_reason = choice["finish_reason"]
                    raw_usage = chunk.get("usage")
                    if raw_usage:
                        prompt_details = raw_usage.get("prompt_tokens_details") or {}
                        completion_details = raw_usage.get("completion_tokens_details") or {}
                        usage = Usage(
                            input_tokens=raw_usage.get("prompt_tokens") or 0,
                            output_tokens=raw_usage.get("completion_tokens") or 0,
                            cached_input_tokens=prompt_details.get("cached_tokens") or 0,
                            reasoning_tokens=completion_details.get("reasoning_tokens") or 0,
                            calls=1,
                        )

        tool_calls = [
            ToolCall(id=slot["id"] or f"call_{index}", name=slot["name"], arguments=slot["arguments"] or "{}")
            for index, slot in sorted(calls.items())
            if slot["name"]
        ]
        return ChatResponse(
            content="".join(content).strip(),
            tool_calls=tool_calls,
            usage=usage,
            model=model_name,
            finish_reason=finish_reason,
            reasoning="".join(reasoning),
        )


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRYABLE_STATUS_CODES
    return isinstance(
        exc,
        (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError, JSONDecodeError),
    )
