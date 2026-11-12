"""按 models.json 里的 pricing 把用量折算成金额（默认人民币，单价按每百万 token）。

pricing 示例：{"currency": "CNY", "input": 0.8, "cached_input": 0.1, "output": 2.7}
- input：未命中缓存的输入单价；cached_input 缺省时按 input 计。
- output：输出单价，思考 token 已包含在 output_tokens 里，不另计。
没有配置 pricing 的模型返回 None，表示“未知”，而不是 0。
"""

from __future__ import annotations

from typing import Any

from agentkit.llm.types import Usage

PER_TOKENS = 1_000_000


def cost_of(usage: Usage | None, pricing: dict[str, Any] | None) -> float | None:
    if usage is None or not pricing:
        return None
    input_price = float(pricing.get("input", 0))
    cached_price = float(pricing.get("cached_input", input_price))
    output_price = float(pricing.get("output", 0))
    cached = min(usage.cached_input_tokens, usage.input_tokens)
    amount = (usage.input_tokens - cached) * input_price + cached * cached_price + usage.output_tokens * output_price
    return round(amount / PER_TOKENS, 8)


def cost_of_tokens(tokens: int, pricing: dict[str, Any] | None) -> float | None:
    """embedding / rerank 这类只按输入 token 计费的模型。"""
    if not pricing:
        return None
    return round(tokens * float(pricing.get("input", 0)) / PER_TOKENS, 8)
