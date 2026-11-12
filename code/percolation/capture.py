"""碎片录入。原文只通过数据库函数 capture_message 写入，录入时不算向量。"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

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
