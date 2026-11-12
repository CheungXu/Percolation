#!/usr/bin/env python3
"""探测配置里的向量和重排接口。只输出模型名、维度和状态，不输出密钥。"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def redact(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    return text


def post_json(url: str, payload: dict, api_key: str) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode())


def main() -> None:
    env = load_env(ROOT / "config" / "llm.env")
    catalog = json.loads((ROOT / "config" / "models.json").read_text(encoding="utf-8"))
    models = {item["key"]: item for item in catalog["models"]}
    secrets = [value for key, value in env.items() if key.endswith("_API_KEY")]

    embedding = models[catalog["slots"]["embedding_model"]]
    api_key = env[embedding["api_key_env"]]
    embedding_body = post_json(
        embedding["base_url"].rstrip("/") + "/embeddings",
        {
            "model": embedding["model"],
            "input": "便携显示器支架",
            "dimensions": embedding["dimensions"],
        },
        api_key,
    )
    vector = embedding_body["data"][0]["embedding"]
    print(f"embedding {embedding['model']} dim={len(vector)}")

    rerank = models[catalog["slots"]["rerank_model"]]
    rerank_key = env[rerank["api_key_env"]]
    documents = ["便携显示器支架承重", "下周交电费", "无关的日程"]
    attempts = [
        (
            rerank["base_url"],
            {
                "model": rerank["model"],
                "input": {"query": "显示器", "documents": documents},
                "parameters": {"top_n": 2, "return_documents": False},
            },
        ),
        (
            "https://dashscope.aliyuncs.com/compatible-api/v1/reranks",
            {
                "model": rerank["model"],
                "query": "显示器",
                "documents": documents,
                "top_n": 2,
            },
        ),
    ]
    last_error = "no attempt"
    for url, payload in attempts:
        try:
            body = post_json(url, payload, rerank_key)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:300]
            last_error = redact(f"{url} HTTP {exc.code} {detail}", secrets)
            continue
        results = body.get("output", {}).get("results") or body.get("results") or []
        if not results:
            last_error = f"{url} returned no ranked results"
            continue
        top = results[0]
        index = top.get("index")
        score = top.get("relevance_score", top.get("score"))
        print(f"rerank {rerank['model']} top_index={index} score={score}")
        return
    raise SystemExit(last_error)


if __name__ == "__main__":
    main()
