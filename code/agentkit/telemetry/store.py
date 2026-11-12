"""轨迹文件仓。

目录结构（root 下，全部 0700/0600，只给运维进程读写，不挂进任何沙箱）：
    traces/YYYY/MM/DD/<trace_id>.json.zst   单条轨迹（span 树 + 事件 + 账本）
    index/YYYY-MM.runs.jsonl                每条轨迹一行摘要，供 CLI / DuckDB 扫描
    blobs/sha256/<2位>/<hash>.zst            内容寻址的大文本：系统提示词、工具 Schema、超长原文
    datasets/                               从轨迹沉淀出的评测集（预留）

轨迹里被外置的文本替换成 {"$ref": "sha256:...", "chars": N}，hydrate() 可还原。
写入前先过 redact（脱敏回调），保证密钥不会落盘或导出。
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable, Iterable, Iterator
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

import zstandard

from agentkit.trace import Trace, sha256_text

DIR_MODE = 0o700
FILE_MODE = 0o600
DEFAULT_BLOB_THRESHOLD = 16 * 1024
REF_KEY = "$ref"


class Exporter(Protocol):
    def export(self, data: dict[str, Any]) -> None: ...


class TraceStore:
    def __init__(
        self,
        root: Path,
        *,
        level: str = "full",
        blob_threshold: int = DEFAULT_BLOB_THRESHOLD,
        redact: Callable[[str], str] | None = None,
        exporters: Iterable[Exporter] = (),
        compression_level: int = 10,
    ) -> None:
        if level not in {"full", "summary"}:
            raise ValueError(f"未知轨迹级别：{level}")
        self.root = Path(root)
        self.level = level
        self.blob_threshold = blob_threshold
        self.redact = redact
        self.exporters = list(exporters)
        self.compression_level = compression_level

    # ---- 写 ----
    def ensure(self) -> None:
        for path in (self.root, self.root / "traces", self.root / "index", self.root / "blobs", self.root / "datasets"):
            path.mkdir(mode=DIR_MODE, parents=True, exist_ok=True)
            os.chmod(path, DIR_MODE)

    def save(self, trace: Trace) -> Path:
        """落盘并导出。返回轨迹文件路径。导出失败只告警，不抛出。"""
        self.ensure()
        data = self._sanitize(trace.to_dict(level=self.level))
        stored = self._externalize(data)
        payload = json.dumps(stored, ensure_ascii=False, default=str).encode("utf-8")
        started = datetime.fromisoformat(data["started_at"])
        path = self.root / "traces" / f"{started:%Y/%m/%d}" / f"{data['trace_id']}.json.zst"
        self._write_atomic(path, self._compressor().compress(payload))
        self._append_index(started, index_record(data, path.relative_to(self.root).as_posix(), len(payload)))
        for exporter in self.exporters:
            try:
                exporter.export(data)
            except Exception as exc:  # noqa: BLE001
                print(f"[agentkit.telemetry] 导出 {type(exporter).__name__} 失败：{exc}", file=sys.stderr)
        return path

    def put_blob(self, text: str) -> str:
        digest = sha256_text(text)
        path = self.blob_path(digest)
        if not path.exists():
            self._write_atomic(path, self._compressor().compress(text.encode("utf-8")))
        return digest

    def _sanitize(self, data: dict[str, Any]) -> dict[str, Any]:
        text = json.dumps(data, ensure_ascii=False, default=str)
        if self.redact is None:
            return json.loads(text)
        data = json.loads(self.redact(text))
        # 脱敏可能改了资产内容，哈希按脱敏后的内容重算，并同步改 span 属性里的引用。
        remap = {digest: sha256_text(content) for digest, content in data.get("assets", {}).items()}
        data["assets"] = {remap[digest]: content for digest, content in data.get("assets", {}).items()}
        for span in data.get("spans", []):
            attributes = span.get("attributes", {})
            for key, value in attributes.items():
                if isinstance(value, str) and value in remap:
                    attributes[key] = remap[value]
        return data

    def _externalize(self, data: dict[str, Any]) -> dict[str, Any]:
        stored = dict(data)
        assets: dict[str, str] = stored.pop("assets", {}) or {}
        known = {self.put_blob(content) for content in assets.values()}
        stored["asset_refs"] = sorted(known)

        def walk(value: Any) -> Any:
            if isinstance(value, str):
                if len(value) >= 512:
                    digest = sha256_text(value)
                    if digest in known:
                        return {REF_KEY: digest, "chars": len(value)}
                if len(value) > self.blob_threshold:
                    return {REF_KEY: self.put_blob(value), "chars": len(value)}
                return value
            if isinstance(value, list):
                return [walk(item) for item in value]
            if isinstance(value, dict):
                return {key: walk(item) for key, item in value.items()}
            return value

        stored["spans"] = [
            {**span, "payload": walk(span["payload"])} if "payload" in span else span for span in stored.get("spans", [])
        ]
        return stored

    def _append_index(self, started: datetime, record: dict[str, Any]) -> None:
        path = self.root / "index" / f"{started:%Y-%m}.runs.jsonl"
        line = (json.dumps(record, ensure_ascii=False, default=str) + "\n").encode("utf-8")
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, FILE_MODE)
        try:
            os.write(fd, line)
        finally:
            os.close(fd)

    def _write_atomic(self, path: Path, content: bytes) -> None:
        path.parent.mkdir(mode=DIR_MODE, parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, FILE_MODE)
        try:
            os.write(fd, content)
        finally:
            os.close(fd)
        os.replace(tmp, path)

    def _compressor(self) -> zstandard.ZstdCompressor:
        return zstandard.ZstdCompressor(level=self.compression_level)

    # ---- 读 ----
    def blob_path(self, digest: str) -> Path:
        hexdigest = digest.removeprefix("sha256:")
        return self.root / "blobs" / "sha256" / hexdigest[:2] / f"{hexdigest}.zst"

    def read_blob(self, digest: str) -> str:
        return zstandard.ZstdDecompressor().decompress(self.blob_path(digest).read_bytes()).decode("utf-8")

    def find(self, trace_id_prefix: str) -> Path:
        matches = sorted(self.root.glob(f"traces/*/*/*/{trace_id_prefix}*.json.zst"))
        if not matches:
            raise FileNotFoundError(f"找不到轨迹：{trace_id_prefix}")
        if len(matches) > 1:
            raise LookupError(f"前缀 {trace_id_prefix} 匹配到 {len(matches)} 条轨迹，请写长一点")
        return matches[0]

    def load(self, trace_id_or_path: str | Path, *, hydrate: bool = False) -> dict[str, Any]:
        path = Path(trace_id_or_path)
        if not path.exists():
            path = self.find(str(trace_id_or_path))
        data = json.loads(zstandard.ZstdDecompressor().decompress(path.read_bytes()).decode("utf-8"))
        return self.hydrate(data) if hydrate else data

    def hydrate(self, value: Any) -> Any:
        if isinstance(value, dict):
            if REF_KEY in value and isinstance(value[REF_KEY], str) and value[REF_KEY].startswith("sha256:"):
                return self.read_blob(value[REF_KEY])
            return {key: self.hydrate(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.hydrate(item) for item in value]
        return value

    def hydrate_assets(self, data: dict[str, Any]) -> dict[str, Any]:
        """还原成 Trace.to_dict() 的形状（含 assets），用于重放导出。"""
        data = self.hydrate(data)
        data["assets"] = {digest: self.read_blob(digest) for digest in data.pop("asset_refs", [])}
        return data

    def iter_index(self, months: Iterable[str] | None = None) -> Iterator[dict[str, Any]]:
        files = sorted((self.root / "index").glob("*.runs.jsonl"))
        if months is not None:
            wanted = set(months)
            files = [path for path in files if path.name.split(".")[0] in wanted]
        for path in files:
            with path.open(encoding="utf-8") as handle:
                for line in handle:
                    if line.strip():
                        yield json.loads(line)


def index_record(data: dict[str, Any], rel_path: str, raw_bytes: int) -> dict[str, Any]:
    spans = data.get("spans", [])
    agents = [span for span in spans if span["kind"] == "agent"]
    tools = [span for span in spans if span["kind"] == "tool"]
    return {
        "trace_id": data["trace_id"],
        "name": data["name"],
        "status": data["status"],
        "level": data["level"],
        "started_at": data["started_at"],
        "duration_ms": data["duration_ms"],
        "tenant_id": data["metadata"].get("tenant_id"),
        "metadata": data["metadata"],
        "summary": data["summary"],
        "usage": data["usage"],
        "cost": data["cost"]["total"],
        "currency": data["cost"]["currency"],
        "unpriced_calls": data["cost"]["unpriced_calls"],
        "usage_by_model": data["usage_by_model"],
        "agents": [span["name"] for span in agents],
        "fingerprints": {span["name"]: span["attributes"].get("spec_fingerprint") for span in agents},
        "llm_calls": sum(1 for span in spans if span["kind"] == "llm"),
        "tool_calls": len(tools),
        "tool_errors": sum(1 for span in tools if span["status"] == "error"),
        "blocked_calls": sum(1 for span in tools if span["attributes"].get("blocked")),
        "error_spans": sum(1 for span in spans if span["status"] == "error"),
        "path": rel_path,
        "bytes": raw_bytes,
    }
