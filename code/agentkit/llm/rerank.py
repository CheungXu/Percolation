from __future__ import annotations

import httpx

from agentkit.llm.registry import ModelConfig
from agentkit.llm.types import Usage


class RerankClient:
    """DashScope 原生 text-rerank 端点。返回 [(原下标, 相关度)]，按相关度降序。"""

    def __init__(self, model: ModelConfig, *, timeout_seconds: float = 20) -> None:
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def rerank(self, query: str, documents: list[str], top_n: int | None = None) -> list[tuple[int, float]]:
        if not documents:
            return []
        payload = {
            "model": self.model.model,
            "input": {"query": query, "documents": documents},
            "parameters": {"top_n": min(top_n or len(documents), len(documents)), "return_documents": False},
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(
                self.model.base_url,
                headers={"Authorization": f"Bearer {self.model.api_key}"},
                json=payload,
            )
            response.raise_for_status()
            body = response.json()
        from agentkit.trace import record_model_usage

        tokens = int((body.get("usage") or {}).get("total_tokens") or (body.get("usage") or {}).get("input_tokens") or 0)
        record_model_usage(self.model.key, Usage(input_tokens=tokens, calls=1), self.model.pricing)
        results = body.get("output", {}).get("results") or body.get("results") or []
        ranked = [(int(item["index"]), float(item.get("relevance_score", item.get("score", 0.0)))) for item in results]
        ranked.sort(key=lambda pair: pair[1], reverse=True)
        return ranked
