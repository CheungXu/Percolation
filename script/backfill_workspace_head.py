#!/usr/bin/env python3
"""迁移 004 之后的一次性回填：把每个租户 users.workspace_head 设成其工作区当前 git HEAD。

用建表账号（config/db.env 的 MIGRATE_DATABASE_URL）跨租户执行，只填 NULL 的行，可重复运行。
工作区有未提交改动的租户只打印提示：它们会在下一次整理或 reindex 开头被提交并发布。

  code/.venv/bin/python script/backfill_workspace_head.py [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "code"))

from agentkit.envfile import load_env_file  # noqa: E402
from agentkit.tenancy import create_pool  # noqa: E402
from agentkit.workspace import Workspace  # noqa: E402
from percolation.memory_fs import changed_files, git_head  # noqa: E402


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    owner_url = load_env_file(ROOT / "config" / "db.env")["MIGRATE_DATABASE_URL"]
    nas_root = Path(load_env_file(ROOT / "config" / "storage.env").get("NAS_ROOT_DIR", "/mnt/percolation"))
    pool = await create_pool(owner_url, max_size=1)
    try:
        async with pool.connection() as conn:
            rows = await (
                await conn.execute("SELECT id::text AS id, external_slug, workspace_rel_path, workspace_head FROM users ORDER BY created_at")
            ).fetchall()
            for row in rows:
                root = nas_root / row["workspace_rel_path"]
                head = git_head(root) if (root / ".git").exists() else None
                dirty = bool(head) and bool(changed_files(Workspace(root)))
                action = "skip"
                if row["workspace_head"] is None and head:
                    action = "dry-run" if args.dry_run else "set"
                    if not args.dry_run:
                        await conn.execute("UPDATE users SET workspace_head = %s WHERE id = %s", (head, row["id"]))
                print(f"{row['external_slug']:<24} {action:<8} head={head[:12] if head else '-'} dirty={dirty}")
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
