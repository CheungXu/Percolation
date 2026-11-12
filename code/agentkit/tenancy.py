"""PostgreSQL 多租户辅助：事务级租户上下文 + 单租户咨询锁。

配合 ENABLE + FORCE ROW LEVEL SECURITY 使用。租户号只在事务内有效，
连接归还连接池后不会串租户；忘记设置时 RLS 默认返回空集。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool


async def create_pool(url: str, *, min_size: int = 1, max_size: int = 10, timeout: float = 30) -> AsyncConnectionPool:
    pool = AsyncConnectionPool(
        url,
        min_size=min_size,
        max_size=max_size,
        timeout=timeout,
        kwargs={"autocommit": True, "row_factory": dict_row},
        open=False,
    )
    await pool.open()
    return pool


@asynccontextmanager
async def tenant_tx(
    pool: AsyncConnectionPool,
    tenant_id: str,
    *,
    setting: str = "app.current_user_id",
) -> AsyncIterator[AsyncConnection]:
    if not tenant_id:
        raise ValueError("tenant_id is required")
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config(%s, %s, true)", (setting, str(tenant_id)))
            yield conn


@asynccontextmanager
async def try_advisory_lock(pool: AsyncConnectionPool, key: str) -> AsyncIterator[bool]:
    """会话级非阻塞咨询锁。拿不到锁时 yield False，调用方应直接跳过。

    锁绑定在一条专用连接上，运行期间这条连接不会归还连接池。
    """
    async with pool.connection() as conn:
        cursor = await conn.execute("SELECT pg_try_advisory_lock(hashtextextended(%s, 0)) AS ok", (key,))
        acquired = bool((await cursor.fetchone())["ok"])
        try:
            yield acquired
        finally:
            if acquired:
                await conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (key,))
