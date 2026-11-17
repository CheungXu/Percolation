"""执行环境锚点：一次检索或整理开跑前，把复现它需要的全部「环境坐标」记进根 span。

分四类：
- 工作区：库里登记的已发布版本 workspace_head、主工作区实际 git HEAD、二者是否一致；
- 数据库水位：库时钟 as_of、最大原话序号、当时仍 pending 的原话、用户状态计数、检索日志条数；
- 代码与依赖（进程内只算一次）：代码提交与是否有未提交改动、agentkit/percolation 源码摘要、
  最新迁移、Python 与依赖指纹、git/rg/bwrap 版本；
- 配置指纹：models.json / facets.json 哈希与影响行为的常量。
复现时按这些坐标重建一个 replay 租户；对比报告里列出当前环境与锚点的差异。
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import platform
import shutil
import subprocess
from datetime import datetime
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

from agentkit.workspace import Workspace
from percolation.memory_fs import changed_files, git_head

if TYPE_CHECKING:
    from percolation.services import Services, UserRef

ANCHOR_VERSION = 1
CODE_DIRS = ("code/agentkit", "code/percolation")
CODE_SUFFIXES = {".py", ".md", ".json", ".txt"}
USER_STATE_FIELDS = (
    "pending_cache_hits",
    "pending_msg_count",
    "memory_line_count",
    "last_dream_at",
    "last_defrag_at",
    "dirty_since",
    "created_at",
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _run(*args: str, cwd: Path | None = None) -> str:
    try:
        result = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def _tool_version(name: str) -> str:
    path = shutil.which(name)
    output = _run(path, "--version") if path else ""
    return output.splitlines()[0] if output else ""


def code_digest(repo_root: Path) -> str:
    digest = hashlib.sha256()
    for rel in CODE_DIRS:
        base = repo_root / rel
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix not in CODE_SUFFIXES or "__pycache__" in path.parts:
                continue
            digest.update(path.relative_to(repo_root).as_posix().encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()[:16]


def _deps_hash() -> str:
    names = sorted(
        f"{dist.metadata['Name'].lower()}=={dist.version}"
        for dist in importlib.metadata.distributions()
        if dist.metadata["Name"]
    )
    return _sha("\n".join(names).encode())


@cache
def code_env(repo_root: Path) -> dict[str, Any]:
    """进程级缓存：代码和依赖在进程生命周期内不变。"""
    migrations = sorted(p.name for p in (repo_root / "code" / "db" / "migrations").glob("*.sql"))
    dirty = _run(
        "git", "--no-optional-locks", "status", "--porcelain", "--", *CODE_DIRS, "config/models.json", "config/facets.json", cwd=repo_root
    )
    return {
        "code_commit": _run("git", "--no-optional-locks", "rev-parse", "HEAD", cwd=repo_root) or None,
        "code_dirty": bool(dirty),
        "code_digest": code_digest(repo_root),
        "migration": migrations[-1] if migrations else None,
        "python": platform.python_version(),
        "deps_hash": _deps_hash(),
        "tools": {name: _tool_version(name) for name in ("git", "rg", "bwrap")},
    }


def config_env(services: Services) -> dict[str, Any]:
    from percolation import retriever
    from percolation.agents import dream

    settings = services.settings
    config = settings.repo_root / "config"

    def file_hash(name: str) -> str | None:
        path = config / name
        return _sha(path.read_bytes()) if path.is_file() else None

    return {
        "models_json": file_hash("models.json"),
        "facets_json": file_hash("facets.json"),
        "memory_line_limit": settings.memory_line_limit,
        "burst_window_seconds": settings.burst_window_seconds,
        "local_tz": str(retriever.LOCAL_TZ),
        "retriever": {
            "rrf_k": retriever.RRF_K,
            "per_route_limit": retriever.PER_ROUTE_LIMIT,
            "pending_limit": retriever.PENDING_LIMIT,
            "rerank_pool": retriever.RERANK_POOL,
            "trgm_threshold": retriever.TRGM_THRESHOLD,
        },
        "dream": {
            "archive_batch_messages": dream.ARCHIVE_BATCH_MESSAGES,
            "promotion_window_days": dream.PROMOTION_WINDOW_DAYS,
            "promotion_min_hits": dream.PROMOTION_MIN_HITS,
            "defrag_interval_days": dream.DEFRAG_INTERVAL_DAYS,
            "defrag_dangling_links": dream.DEFRAG_DANGLING_LINKS,
        },
    }


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


async def db_watermark(services: Services, user: UserRef, *, as_of: datetime | None = None) -> dict[str, Any]:
    """单条语句读出，天然是同一快照。as_of 不传时取库时钟。"""
    async with services.tx(user) as conn:
        row = await (
            await conn.execute(
                """
                SELECT COALESCE(%s::timestamptz, clock_timestamp()) AS as_of, u.workspace_head, u.next_msg_seq,
                       u.pending_cache_hits, u.pending_msg_count, u.memory_line_count, u.last_dream_at,
                       u.last_defrag_at, u.dirty_since, u.created_at,
                       (SELECT max(msg_seq) FROM raw_messages) AS max_msg_seq,
                       (SELECT COALESCE(array_agg(msg_seq ORDER BY msg_seq), '{}')
                          FROM raw_messages WHERE dream_status = 'pending' AND deleted_at IS NULL) AS pending_msg_seqs,
                       (SELECT count(*) FROM search_logs WHERE deleted_at IS NULL) AS search_logs_count,
                       (SELECT max(created_at) FROM search_logs WHERE deleted_at IS NULL) AS search_logs_max_at
                FROM users u WHERE u.id = %s
                """,
                (as_of, user.id),
            )
        ).fetchone()
    if row is None:
        raise LookupError(f"用户不存在：{user.id}")
    return {
        "as_of": row["as_of"].isoformat(),
        "workspace_head": row["workspace_head"],
        "max_msg_seq": row["max_msg_seq"] or 0,
        "pending_msg_seqs": list(row["pending_msg_seqs"]),
        "search_logs_count": row["search_logs_count"],
        "search_logs_max_at": _iso(row["search_logs_max_at"]),
        "user_state": {key: _iso(row[key]) for key in USER_STATE_FIELDS},
    }


async def capture_env(
    services: Services,
    user: UserRef,
    ws: Workspace,
    *,
    as_of: datetime | None = None,
    check_clean: bool = False,
) -> dict[str, Any]:
    watermark = await db_watermark(services, user, as_of=as_of)
    head = git_head(ws)
    workspace = {
        "workspace_head": watermark.pop("workspace_head"),
        "git_head": head,
    }
    workspace["workspace_mismatch"] = bool(workspace["workspace_head"]) and workspace["workspace_head"] != head
    if check_clean:
        try:
            workspace["git_clean"] = not changed_files(ws)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            workspace["git_clean"] = None
    anchor = {
        "version": ANCHOR_VERSION,
        "workspace": workspace,
        "db": watermark,
        "code": code_env(services.settings.repo_root.resolve()),
        "config": config_env(services),
    }
    return anchor


def env_digest(anchor: dict[str, Any]) -> str:
    """只对「环境」做摘要（代码、依赖、配置），不含随每次运行变化的水位。"""
    stable = {"code": anchor.get("code"), "config": anchor.get("config")}
    return _sha(json.dumps(stable, sort_keys=True, ensure_ascii=False, default=str).encode())


def env_watermark(anchor: dict[str, Any]) -> dict[str, Any]:
    """写进索引行的关键水位，供列表和统计直接看，不用解压轨迹。"""
    db = anchor.get("db", {})
    ws = anchor.get("workspace", {})
    return {
        "as_of": db.get("as_of"),
        "workspace_head": (ws.get("workspace_head") or ws.get("git_head") or "")[:12] or None,
        "max_msg_seq": db.get("max_msg_seq"),
        "pending": len(db.get("pending_msg_seqs") or []),
        "search_logs": db.get("search_logs_count"),
        "mismatch": ws.get("workspace_mismatch"),
    }


def attach(trace, anchor: dict[str, Any]) -> None:
    trace.root.set(env=anchor, env_digest=env_digest(anchor), env_watermark=env_watermark(anchor))


def set_decision(trace, **decision: Any) -> None:
    """整理的模式判定与理由补进锚点：复现时按原入参重新走判定，并在报告里核对模式与理由是否一致。"""
    env = trace.root.attributes.get("env")
    if isinstance(env, dict):
        env["decision"] = {**env.get("decision", {}), **decision}
