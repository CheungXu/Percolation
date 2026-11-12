from __future__ import annotations

import asyncio

import httpx

from agentkit.llm.registry import ModelConfig
from agentkit.llm.types import Usage

# 百炼 text-embedding-v4 单次最多 10 条。
BATCH_SIZE = 10


class EmbeddingClient:
    def __init__(self, model: ModelConfig, *, timeout_seconds: float = 30, retry_attempts: int = 3) -> None:
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.retry_attempts = max(1, retry_attempts)

    @property
    def dimensions(self) -> int | None:
        return self.model.dimensions

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            vectors.extend(await self._embed_batch(texts[start : start + BATCH_SIZE]))
        return vectors

    async def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        payload: dict = {"model": self.model.model, "input": texts}
        if self.model.dimensions:
            payload["dimensions"] = self.model.dimensions
        for attempt in range(1, self.retry_attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.post(
                        f"{self.model.base_url.rstrip('/')}/embeddings",
                        headers={"Authorization": f"Bearer {self.model.api_key}"},
                        json=payload,
                    )
                    response.raise_for_status()
                    body = response.json()
                    from agentkit.trace import record_model_usage

                    tokens = int((body.get("usage") or {}).get("total_tokens") or 0)
                    record_model_usage(self.model.key, Usage(input_tokens=tokens, calls=1), self.model.pricing)
                    data = sorted(body["data"], key=lambda item: item["index"])
                    return [item["embedding"] for item in data]
            except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                retryable = not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code in {429, 500, 502, 503, 504}
                if attempt >= self.retry_attempts or not retryable:
                    raise
                await asyncio.sleep(2 ** (attempt - 1))
        raise RuntimeError("unreachable")


def to_vector_literal(vector: list[float]) -> str:
    """转成 pgvector 文本字面量，配合 `%s::halfvec` 使用，无需额外驱动适配。"""
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"
