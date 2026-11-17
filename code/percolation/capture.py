"""碎片录入与受控修订/删除。原话变更一律走数据库受控函数，录入时不算向量。"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from psycopg import AsyncConnection, Error as PsycopgError

from percolation.services import Services, UserRef


async def capture(
    services: Services,
    user: UserRef,
    content: str,
    *,
    source_kind: str = "capture",
    reply_to_search_id: str | None = None,
    client_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    async with services.tx(user) as conn:
        row = await (
            await conn.execute(
                """
                SELECT msg_seq, batch_id, source_kind, captured_at
                FROM capture_message(%s::text, %s::text, %s::uuid, %s::jsonb, %s::interval)
                """,
                (
                    content,
                    source_kind,
                    reply_to_search_id,
                    json.dumps(client_meta or {}, ensure_ascii=False),
                    timedelta(seconds=services.settings.burst_window_seconds),
                ),
            )
        ).fetchone()
    return {
        "msg_seq": row["msg_seq"],
        "batch_id": str(row["batch_id"]),
        "source_kind": row["source_kind"],
        "captured_at": row["captured_at"].isoformat(),
    }


async def revise(services: Services, user: UserRef, msg_seq: int, content: str) -> dict[str, Any]:
    """修订一条未删除原话：写入 raw_message_revisions，更新最新正文并置回 pending。"""
    text = content.strip()
    if not text:
        raise ValueError("内容不能为空")
    try:
        async with services.tx(user) as conn:
            row = await (
                await conn.execute(
                    "SELECT * FROM revise_message(%s::bigint, %s::text)",
                    (msg_seq, text),
                )
            ).fetchone()
    except PsycopgError as exc:
        if "note not found" in str(exc):
            raise LookupError(f"记录不存在：{msg_seq}") from exc
        raise
    return dict(row)


async def delete_messages(services: Services, user: UserRef, msg_seqs: list[int]) -> list[int]:
    """软删除一条或多条原话，返回实际新标为删除的序号列表。"""
    seqs = sorted({int(s) for s in msg_seqs if int(s) > 0})
    if not seqs:
        return []
    async with services.tx(user) as conn:
        rows = await (
            await conn.execute("SELECT delete_messages(%s::bigint[]) AS msg_seq", (seqs,))
        ).fetchall()
    return [int(r["msg_seq"]) for r in rows]


async def restore_messages(services: Services, user: UserRef, msg_seqs: list[int]) -> list[int]:
    """撤销删除（仅对尚未物理抹除的记录有效），返回实际恢复的序号列表。"""
    seqs = sorted({int(s) for s in msg_seqs if int(s) > 0})
    if not seqs:
        return []
    async with services.tx(user) as conn:
        rows = await (
            await conn.execute("SELECT restore_messages(%s::bigint[]) AS msg_seq", (seqs,))
        ).fetchall()
    return [int(r["msg_seq"]) for r in rows]


async def purge_in_tx(conn: AsyncConnection, msg_seqs: list[int]) -> list[int]:
    """在当前租户事务内物理抹除已删除原话的正文与全部修订历史，只留序号占位。"""
    seqs = sorted({int(s) for s in msg_seqs if int(s) > 0})
    if not seqs:
        return []
    rows = await (
        await conn.execute("SELECT purge_messages(%s::bigint[]) AS msg_seq", (seqs,))
    ).fetchall()
    return [int(r["msg_seq"]) for r in rows]
