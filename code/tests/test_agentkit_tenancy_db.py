"""连真实库验证租户上下文与咨询锁。没有 config/db.env 时跳过。"""

import asyncio
from pathlib import Path

import pytest

from agentkit.envfile import load_env_file
from agentkit.tenancy import create_pool, tenant_tx, try_advisory_lock

ENV = load_env_file(Path(__file__).resolve().parents[2] / "config" / "db.env")
STORAGE = load_env_file(Path(__file__).resolve().parents[2] / "config" / "storage.env")
pytestmark = pytest.mark.skipif(not ENV.get("DATABASE_URL"), reason="没有数据库配置")


def test_tenant_context_and_lock():
    async def main():
        pool = await create_pool(ENV["DATABASE_URL"], max_size=3)
        try:
            async with pool.connection() as conn:
                rows = await (await conn.execute("SELECT id FROM users")).fetchall()
                assert rows == []
            async with tenant_tx(pool, STORAGE["DEFAULT_USER_ID"]) as conn:
                rows = await (await conn.execute("SELECT external_slug FROM users")).fetchall()
                assert [row["external_slug"] for row in rows] == ["default"]
            async with pool.connection() as conn:
                value = await (await conn.execute("SELECT current_setting('app.current_user_id', true) AS v")).fetchone()
                assert not value["v"]
            async with try_advisory_lock(pool, "agentkit-test-lock") as first:
                assert first
                async with try_advisory_lock(pool, "agentkit-test-lock") as second:
                    assert not second
        finally:
            await pool.close()

    asyncio.run(main())
