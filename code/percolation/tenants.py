"""临时租户的建立与清理（e2e 测试租户、复现用 replay 租户）。

只用建表账号 percolation_owner（config/db.env 的 MIGRATE_DATABASE_URL），靠 owner_maintenance 策略跨租户写。
清理只允许 e2e- / replay- 前缀，防止误删真实用户。轨迹不在这里删：轨迹是复现的对照证据，
需要时用 `trace_cli.py purge --tenant <id>` 单独清理。
"""

from __future__ import annotations

import shutil
from pathlib import Path

from agentkit.tenancy import create_pool

E2E_PREFIX = "e2e-"
REPLAY_PREFIX = "replay-"
DISPOSABLE_PREFIXES = (E2E_PREFIX, REPLAY_PREFIX)


def is_disposable(slug: str) -> bool:
    return slug.startswith(DISPOSABLE_PREFIXES)


async def create_tenant(owner_url: str, slug: str) -> str:
    if not is_disposable(slug):
        raise ValueError(f"临时租户 slug 必须以 {DISPOSABLE_PREFIXES} 开头：{slug}")
    pool = await create_pool(owner_url, max_size=1)
    try:
        async with pool.connection() as conn:
            row = await (
                await conn.execute("INSERT INTO users (external_slug) VALUES (%s) RETURNING id::text AS id", (slug,))
            ).fetchone()
        return row["id"]
    finally:
        await pool.close()


async def drop_tenant(owner_url: str, slug: str, nas_root: Path) -> str | None:
    """删库里的行（原话表的只追加触发器在事务内临时停用）、工作区和暂存区。返回被删的 user_id。"""
    if not is_disposable(slug):
        raise ValueError(f"只能清理 {DISPOSABLE_PREFIXES} 开头的临时租户：{slug}")
    pool = await create_pool(owner_url, max_size=1)
    try:
        async with pool.connection() as conn:
            row = await (
                await conn.execute("SELECT id::text AS id, workspace_rel_path FROM users WHERE external_slug = %s", (slug,))
            ).fetchone()
            if row is None:
                return None
            async with conn.transaction():
                await conn.execute("ALTER TABLE raw_messages DISABLE TRIGGER raw_messages_guard")
                await conn.execute("DELETE FROM raw_messages WHERE user_id = %s", (row["id"],))
                await conn.execute("ALTER TABLE raw_messages ENABLE TRIGGER raw_messages_guard")
                await conn.execute("DELETE FROM users WHERE id = %s", (row["id"],))
    finally:
        await pool.close()
    user_id = row["id"]
    for path in (nas_root / row["workspace_rel_path"], nas_root / "staging" / user_id):
        if path.is_dir() and path.name == user_id:
            shutil.rmtree(path)
    return user_id
