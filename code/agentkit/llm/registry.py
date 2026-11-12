from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agentkit.envfile import merge_env


@dataclass(frozen=True)
class ModelConfig:
    key: str
    provider: str
    protocol: str
    base_url: str
    model: str
    api_key: str = field(repr=False)
    params: dict[str, Any] = field(default_factory=dict)
    extra_body: dict[str, Any] = field(default_factory=dict)
    dimensions: int | None = None
    pricing: dict[str, Any] = field(default_factory=dict)


class ModelRegistry:
    """把逻辑槽位（router_model 等）映射到具体模型。业务代码只认槽位，不认模型名。"""

    def __init__(self, slots: dict[str, str], models: dict[str, ModelConfig]) -> None:
        self.slots = dict(slots)
        self.models = dict(models)

    @classmethod
    def from_files(cls, models_json: Path, env_files: list[Path]) -> ModelRegistry:
        catalog = json.loads(models_json.read_text(encoding="utf-8"))
        env = merge_env(env_files)
        models: dict[str, ModelConfig] = {}
        for item in catalog.get("models", []):
            models[item["key"]] = ModelConfig(
                key=item["key"],
                provider=item.get("provider", ""),
                protocol=item.get("protocol", "openai"),
                base_url=item["base_url"],
                model=item["model"],
                api_key=env.get(item.get("api_key_env", ""), ""),
                params=dict(item.get("params") or {}),
                extra_body=dict(item.get("extra_body") or {}),
                dimensions=item.get("dimensions"),
                pricing=dict(item.get("pricing") or {}),
            )
        return cls(catalog.get("slots", {}), models)

    def get(self, slot_or_key: str) -> ModelConfig:
        key = self.slots.get(slot_or_key, slot_or_key)
        model = self.models.get(key)
        if model is None:
            raise KeyError(f"未知模型槽位或模型：{slot_or_key}")
        if not model.api_key:
            raise ValueError(f"模型 {key} 缺少 API Key")
        return model

    @property
    def secrets(self) -> list[str]:
        return [model.api_key for model in self.models.values() if model.api_key]

    def redact(self, text: str) -> str:
        for secret in self.secrets:
            text = text.replace(secret, "***")
        return text

    def chat(self, slot: str, **overrides: Any):
        from agentkit.llm.chat import OpenAIChatClient

        return OpenAIChatClient(self.get(slot), **overrides)

    def embedding(self, slot: str = "embedding_model"):
        from agentkit.llm.embedding import EmbeddingClient

        return EmbeddingClient(self.get(slot))

    def rerank(self, slot: str = "rerank_model"):
        from agentkit.llm.rerank import RerankClient

        return RerankClient(self.get(slot))
