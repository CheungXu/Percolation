from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agentkit.envfile import merge_env
from agentkit.llm import ModelRegistry
from percolation.wiki import load_facets_catalog

REPO_ROOT = Path(os.environ.get("PERCOLATION_ROOT", Path(__file__).resolve().parents[2]))


@dataclass(frozen=True)
class TelemetrySettings:
    """轨迹仓与导出配置，来自 config/observability.env。"""

    root: Path
    level: str = "full"
    blob_threshold: int = 16 * 1024
    max_cost: float | None = None
    max_tokens: int | None = None
    otlp_endpoint: str = ""
    otlp_project: str = "percolation"
    otlp_headers: str = field(default="", repr=False)


@dataclass(frozen=True)
class Settings:
    repo_root: Path
    database_url: str
    pool_size: int
    nas_root: Path
    default_user_slug: str
    burst_window_seconds: int
    memory_line_limit: int
    telemetry: TelemetrySettings
    models: ModelRegistry
    facets: dict[str, Any] = field(default_factory=load_facets_catalog)

    @property
    def memory_soft_limit(self) -> int:
        """超过这个行数就触发全局重整，给热区留出余量。"""
        return int(self.memory_line_limit * 0.9)


def _optional(value: str | None, cast):
    return cast(value) if value not in (None, "") else None


def load_settings(root: Path | None = None) -> Settings:
    root = Path(root or REPO_ROOT)
    config = root / "config"
    env = merge_env([config / "db.env", config / "storage.env", config / "observability.env"])
    if not env.get("DATABASE_URL"):
        raise RuntimeError("config/db.env 缺少 DATABASE_URL")
    nas_root = Path(env.get("NAS_ROOT_DIR", "/mnt/percolation"))
    telemetry = TelemetrySettings(
        root=Path(env.get("TELEMETRY_ROOT") or nas_root / "telemetry"),
        level=env.get("TRACE_LEVEL", "full"),
        blob_threshold=int(env.get("TRACE_BLOB_THRESHOLD", str(16 * 1024))),
        max_cost=_optional(env.get("RUN_MAX_COST_CNY"), float),
        max_tokens=_optional(env.get("RUN_MAX_TOKENS"), int),
        otlp_endpoint=env.get("OTLP_ENDPOINT", ""),
        otlp_project=env.get("OTLP_PROJECT", "percolation"),
        otlp_headers=env.get("OTLP_HEADERS", ""),
    )
    return Settings(
        repo_root=root,
        database_url=env["DATABASE_URL"],
        pool_size=int(env.get("DB_POOL_SIZE", "10")),
        nas_root=nas_root,
        default_user_slug=env.get("DEFAULT_USER_SLUG", "default"),
        burst_window_seconds=int(env.get("BURST_WINDOW_SECONDS", "180")),
        memory_line_limit=int(env.get("MEMORY_LINE_LIMIT", "200")),
        telemetry=telemetry,
        models=ModelRegistry.from_files(config / "models.json", [config / "llm.env"]),
        facets=load_facets_catalog(config),
    )
