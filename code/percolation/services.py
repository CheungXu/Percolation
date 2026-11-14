from __future__ import annotations

import sys
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from psycopg_pool import AsyncConnectionPool

from agentkit import Budget, RunContext, Trace
from agentkit.llm import ChatClient
from agentkit.sandbox import BwrapSandbox, SandboxExecutor
from agentkit.telemetry import OtlpExporter, TraceStore
from agentkit.telemetry.otlp import parse_headers
from agentkit.tenancy import create_pool, tenant_tx
from agentkit.workspace import Workspace
from percolation.config import Settings, load_settings
from percolation.memory_fs import open_workspace


@dataclass(frozen=True)
class UserRef:
    id: str
    slug: str
    workspace_rel_path: str


@dataclass
class Services:
    """进程级共享依赖。作为 RunContext.deps 传给业务工具。"""

    settings: Settings
    pool: AsyncConnectionPool
    sandbox: SandboxExecutor = field(default_factory=BwrapSandbox)
    chat_overrides: dict[str, ChatClient] = field(default_factory=dict)
    trace_metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    async def open(cls, settings: Settings | None = None) -> Services:
        settings = settings or load_settings()
        pool = await create_pool(settings.database_url, max_size=settings.pool_size)
        return cls(settings=settings, pool=pool)

    async def close(self) -> None:
        await self.pool.close()

    @property
    def models(self):
        return self.settings.models

    def tx(self, user: UserRef | str):
        return tenant_tx(self.pool, user.id if isinstance(user, UserRef) else user)

    async def resolve_user(self, slug: str | None = None) -> UserRef:
        slug = slug or self.settings.default_user_slug
        async with self.pool.connection() as conn:
            row = await (await conn.execute("SELECT * FROM resolve_user_by_slug(%s)", (slug,))).fetchone()
        if row is None:
            raise LookupError(f"用户不存在：{slug}")
        return UserRef(id=str(row["user_id"]), slug=row["external_slug"], workspace_rel_path=row["workspace_rel_path"])

    async def provision_user(self, slug: str) -> UserRef:
        """外部账号（sp-<uuid>）首次访问时建租户，已存在则直接返回。只走受控函数 provision_user。"""
        async with self.pool.connection() as conn:
            row = await (await conn.execute("SELECT * FROM provision_user(%s)", (slug,))).fetchone()
        return UserRef(id=str(row["user_id"]), slug=row["external_slug"], workspace_rel_path=row["workspace_rel_path"])

    def workspace(self, user: UserRef) -> Workspace:
        return open_workspace(self.settings.nas_root / user.workspace_rel_path)

    def context(self, user: UserRef, trace: Trace, workspace: Workspace | None = None) -> RunContext:
        return RunContext(
            tenant_id=user.id,
            models=self.models,
            workspace=workspace or self.workspace(user),
            sandbox=self.sandbox,
            trace=trace,
            deps=self,
            chat_clients=dict(self.chat_overrides),
            replay=bool(trace.metadata.get("replay_of")),
        )

    async def capture_env(self, user: UserRef, ws: Workspace, **kwargs: Any) -> dict[str, Any]:
        """执行环境锚点（工作区版本、库水位、代码/依赖/配置指纹），见 percolation.env_anchor。"""
        from percolation.env_anchor import capture_env

        return await capture_env(self, user, ws, **kwargs)

    # ---- 轨迹 ----
    @cached_property
    def trace_store(self) -> TraceStore:
        telemetry = self.settings.telemetry
        root = telemetry.root.resolve()
        workspaces = (self.settings.nas_root / "workspaces").resolve()
        if root == workspaces or workspaces in root.parents:
            raise RuntimeError(f"轨迹仓 {root} 不能放在用户数据目录 {workspaces} 之下")
        exporters = []
        if telemetry.otlp_endpoint:
            exporters.append(
                OtlpExporter(
                    telemetry.otlp_endpoint,
                    headers=parse_headers(telemetry.otlp_headers),
                    project=telemetry.otlp_project,
                    service_name="percolation",
                )
            )
        return TraceStore(
            root,
            level=telemetry.level,
            blob_threshold=telemetry.blob_threshold,
            redact=self._redact,
            exporters=exporters,
        )

    def _redact(self, text: str) -> str:
        secrets = [*self.models.secrets, *parse_headers(self.settings.telemetry.otlp_headers).values()]
        password = urlsplit(self.settings.database_url).password
        if password:
            secrets.append(password)
        for secret in sorted({s for s in secrets if len(s) >= 8}, key=len, reverse=True):
            text = text.replace(secret, "***")
            if secret.startswith("Bearer "):
                text = text.replace(secret.removeprefix("Bearer "), "***")
        return text

    def new_trace(self, name: str, user: UserRef, **metadata: Any) -> Trace:
        telemetry = self.settings.telemetry
        return Trace(
            name=name,
            metadata={"service": "percolation", "tenant_id": user.id, "user_slug": user.slug, **self.trace_metadata, **metadata},
            budget=Budget(max_cost=telemetry.max_cost, max_tokens=telemetry.max_tokens),
        )

    def save_trace(
        self,
        user: UserRef,
        trace: Trace,
        extra: dict[str, Any] | None = None,
        *,
        status: str | None = None,
    ) -> Path | None:
        """收尾并落 NAS 轨迹仓（同时导出 OTLP）。轨迹失败绝不影响业务结果。"""
        extra = dict(extra or {})
        trace.event("summary", **extra)
        trace.finish(status or str(extra.get("status") or extra.get("outcome") or "ok"), **extra)
        try:
            return self.trace_store.save(trace)
        except Exception as exc:  # noqa: BLE001
            print(f"[percolation] 轨迹落盘失败 {trace.trace_id}：{self._redact(str(exc))}", file=sys.stderr)
            return None
