"""给网页用的读模型：记录流、问答线程、边问边浮现、近况、当日用量。

全部在租户事务里执行，受强制 RLS 约束。工作区文件按路径直接读，不调用 open_workspace，
避免「看一眼近况」就在 NAS 上初始化一个 git 仓库。
"""

from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from psycopg import AsyncConnection

from percolation.agents.search import SearchOutcome
from percolation.memory_fs import MEMORY_FILE
from percolation.services import Services, UserRef
from percolation.wiki import (
    CERTAINTY_RE,
    EVENT_DATE_RE,
    INLINE_FACET_RE,
    LINK_RE,
    split_frontmatter,
)

MAX_CUES = 3
RECALL_SCAN = 3000
RECALL_LOOSE_TOKENS = 3

STEP_COLUMNS = """
  id::text AS id, query_text, outcome, answer_text, clarify_question,
  verified_msg_seqs, hit_doc_paths, parent_search_id::text AS parent_id, created_at
"""


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


# ---------- 记录流 ----------


def note_payload(row: dict) -> dict:
    return {
        "seq": row["msg_seq"],
        "content": row["content"],
        "at": row["captured_at"].isoformat(),
        "status": row["dream_status"],
        "kind": row["source_kind"],
    }


async def list_notes(services: Services, user: UserRef, *, before_seq: int | None = None, limit: int = 80) -> dict:
    limit = _clamp(limit, 1, 200)
    async with services.tx(user) as conn:
        rows = await (
            await conn.execute(
                """
                SELECT msg_seq, content, captured_at, dream_status, source_kind
                FROM raw_messages
                WHERE %(before)s::bigint IS NULL OR msg_seq < %(before)s::bigint
                ORDER BY msg_seq DESC
                LIMIT %(limit)s
                """,
                {"before": before_seq, "limit": limit + 1},
            )
        ).fetchall()
        total = None
        if before_seq is None:
            total = (await (await conn.execute("SELECT count(*) AS n FROM raw_messages")).fetchone())["n"]
    return {"notes": [note_payload(r) for r in reversed(rows[:limit])], "has_more": len(rows) > limit, "total": total}


async def get_note(services: Services, user: UserRef, seq: int) -> dict | None:
    async with services.tx(user) as conn:
        row = await (
            await conn.execute(
                "SELECT msg_seq, content, captured_at, dream_status, source_kind FROM raw_messages WHERE msg_seq = %s",
                (seq,),
            )
        ).fetchone()
    return note_payload(row) if row else None


# ---------- 问答线程 ----------


async def _page_titles(conn: AsyncConnection, paths: set[str]) -> dict[str, str]:
    if not paths:
        return {}
    rows = await (
        await conn.execute("SELECT doc_path, page_title FROM wiki_pages WHERE doc_path = ANY(%s)", (sorted(paths),))
    ).fetchall()
    return {r["doc_path"]: r["page_title"] for r in rows}


def cue_labels(doc_paths: list[str], titles: dict[str, str]) -> list[str]:
    seen: list[str] = []
    for path in doc_paths:
        title = titles.get(path)
        if title and title not in seen:
            seen.append(title)
    return seen[:MAX_CUES]


def step_payload(row: dict, titles: dict[str, str], reply: dict | None = None) -> dict:
    return {
        "search_id": row["id"],
        "outcome": row["outcome"],
        "answer": row["answer_text"],
        "clarify_question": row["clarify_question"],
        "seqs": list(row["verified_msg_seqs"] or []),
        "cues": cue_labels(list(row["hit_doc_paths"] or []), titles),
        "at": row["created_at"].isoformat(),
        "reply": {"seq": reply["msg_seq"], "content": reply["content"]} if reply else None,
    }


def assemble_threads(roots: list[dict], children: list[dict], replies: list[dict], titles: dict[str, str]) -> list[dict]:
    """roots 按时间倒序进来，返回按时间正序的线程；每个线程的 steps 依次是第一问和每次澄清后的重查。"""
    by_root: dict[str, list[dict]] = defaultdict(list)
    for child in children:
        by_root[child["parent_id"]].append(child)
    reply_by_search: dict[str, dict] = {}
    for reply in replies:
        reply_by_search.setdefault(reply["search_id"], reply)
    threads = []
    for root in reversed(roots):
        steps = [root, *sorted(by_root.get(root["id"], []), key=lambda r: r["created_at"])]
        threads.append(
            {
                "id": root["id"],
                "query": root["query_text"],
                "at": root["created_at"].isoformat(),
                "steps": [step_payload(s, titles, reply_by_search.get(s["id"])) for s in steps],
            }
        )
    return threads


async def list_threads(services: Services, user: UserRef, *, before_id: str | None = None, limit: int = 20) -> dict:
    limit = _clamp(limit, 1, 50)
    async with services.tx(user) as conn:
        roots = await (
            await conn.execute(
                f"""
                SELECT {STEP_COLUMNS} FROM search_logs
                WHERE parent_search_id IS NULL AND (%(before)s::uuid IS NULL OR id < %(before)s::uuid)
                ORDER BY id DESC
                LIMIT %(limit)s
                """,
                {"before": before_id, "limit": limit + 1},
            )
        ).fetchall()
        has_more = len(roots) > limit
        roots = roots[:limit]
        root_ids = [r["id"] for r in roots]
        children: list[dict] = []
        replies: list[dict] = []
        if root_ids:
            children = await (
                await conn.execute(
                    f"SELECT {STEP_COLUMNS} FROM search_logs WHERE parent_search_id = ANY(%s::uuid[]) ORDER BY id",
                    (root_ids,),
                )
            ).fetchall()
            all_ids = root_ids + [c["id"] for c in children]
            replies = await (
                await conn.execute(
                    """
                    SELECT msg_seq, content, reply_to_search_id::text AS search_id
                    FROM raw_messages WHERE reply_to_search_id = ANY(%s::uuid[]) ORDER BY msg_seq
                    """,
                    (all_ids,),
                )
            ).fetchall()
        titles = await _page_titles(conn, {p for r in [*roots, *children] for p in (r["hit_doc_paths"] or [])})
    return {"threads": assemble_threads(roots, children, replies, titles), "has_more": has_more}


async def step_for_outcome(services: Services, user: UserRef, outcome: SearchOutcome) -> dict:
    async with services.tx(user) as conn:
        titles = await _page_titles(conn, set(outcome.hit_doc_paths))
    row = {
        "id": outcome.search_id,
        "outcome": outcome.outcome,
        "answer_text": outcome.answer,
        "clarify_question": outcome.clarify_question,
        "verified_msg_seqs": outcome.verified_msg_seqs,
        "hit_doc_paths": outcome.hit_doc_paths,
        "created_at": datetime.now(UTC),
    }
    return step_payload(row, titles)


# ---------- 边问边浮现 ----------
# 输入问题时每次停顿都会调一次，所以只做词面匹配：不调模型、不算向量。

_STOP_PHRASES = re.compile(
    "什么|怎么|怎样|哪里|哪儿|哪些|哪个|哪家|哪天|多少|几点|是不是|有没有|能不能|可不可以|可以|请问|一下|"
    "之前|上次|那个|这个|那家|这家|那件|这件|我的|我们|你的|时候|现在|最近|应该|需要|还是|记得|来着|合适"
)
_FUNCTION_CHARS = set("的了吗呢吧啊呀是我你他她它有在和跟就都也还又把被给让对么个些这那哪谁啥")
_SEGMENT_RE = re.compile(r"[\u4e00-\u9fff]+|[a-z0-9][a-z0-9.+-]*")


def recall_tokens(query: str) -> list[str]:
    text = _STOP_PHRASES.sub(" ", (query or "").lower())
    tokens: list[str] = []
    for seg in _SEGMENT_RE.findall(text):
        if seg[0].isascii():
            if len(seg) >= 2:
                tokens.append(seg)
            continue
        for i in range(len(seg) - 1):
            pair = seg[i : i + 2]
            if not (_FUNCTION_CHARS & set(pair)):
                tokens.append(pair)
    return list(dict.fromkeys(tokens))[:16]


async def recall(services: Services, user: UserRef, query: str, *, limit: int = 5) -> list[int]:
    """在记录里确实出现过的词不超过 RECALL_LOOSE_TOKENS 个时命中 1 个就算，否则至少命中 2 个。
    只数出现过的词，跨词边界切出的二字组（如「四见」）不会抬高门槛。"""
    tokens = recall_tokens(query)
    if not tokens:
        return []
    async with services.tx(user) as conn:
        rows = await (
            await conn.execute(
                """
                WITH toks AS (SELECT unnest(%(toks)s::text[]) AS tok),
                recent AS (SELECT msg_seq, lower(content) AS c FROM raw_messages ORDER BY msg_seq DESC LIMIT %(scan)s),
                hits AS (SELECT r.msg_seq, t.tok FROM recent r JOIN toks t ON strpos(r.c, t.tok) > 0),
                live AS (SELECT count(DISTINCT tok) AS n FROM hits)
                SELECT h.msg_seq
                FROM hits h CROSS JOIN live
                GROUP BY h.msg_seq, live.n
                HAVING count(*) >= CASE WHEN live.n <= %(loose)s THEN 1 ELSE 2 END
                ORDER BY count(*) DESC, h.msg_seq DESC
                LIMIT %(limit)s
                """,
                {"toks": tokens, "scan": RECALL_SCAN, "loose": RECALL_LOOSE_TOKENS, "limit": limit},
            )
        ).fetchall()
    return [r["msg_seq"] for r in rows]


# ---------- 近况 ----------

_ANCHOR_TAG_RE = re.compile(r"\[#msg_\d+\]|#msg_\d+")
_BULLET_RE = re.compile(r"^\s*[-*]\s+(.*)$")


def clean_item(text: str) -> str:
    text = LINK_RE.sub(lambda m: m.group(4) or m.group(3), text)
    for pattern in (CERTAINTY_RE, _ANCHOR_TAG_RE, EVENT_DATE_RE, INLINE_FACET_RE):
        text = pattern.sub("", text)
    return re.sub(r"\s{2,}", " ", text).strip(" -*·;；,，")


def parse_memory(text: str) -> list[dict]:
    """MEMORY.md 的二级标题是分组，列表项是条目；开头的说明段落不展示。"""
    sections: list[dict] = []
    current: dict | None = None
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            current = {"title": stripped[3:].strip(), "items": []}
            sections.append(current)
            continue
        match = _BULLET_RE.match(line)
        if not match:
            continue
        item = clean_item(match.group(1))
        if not item:
            continue
        if current is None:
            current = {"title": "记住的事", "items": []}
            sections.append(current)
        current["items"].append(item)
    return [s for s in sections if s["items"]]


def page_highlights(text: str, limit: int = 2) -> list[str]:
    """主题页里已确认的前几条，作为近况卡片的摘要。"""
    _, body = split_frontmatter(text or "")
    picked: list[str] = []
    for line in body.splitlines():
        match = _BULLET_RE.match(line)
        if not match or "[inferred]" in match.group(1):
            continue
        item = clean_item(match.group(1))
        if item:
            picked.append(item)
        if len(picked) >= limit:
            break
    return picked


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, IsADirectoryError, UnicodeDecodeError):
        return ""


async def note_stats(conn: AsyncConnection, user: UserRef) -> dict[str, Any]:
    row = await (
        await conn.execute(
            """
            SELECT count(*) AS notes, count(*) FILTER (WHERE dream_status = 'pending') AS pending,
                   (SELECT last_dream_at FROM users WHERE id = %s) AS last_dream_at
            FROM raw_messages
            """,
            (user.id,),
        )
    ).fetchone()
    return {
        "notes": row["notes"],
        "pending": row["pending"],
        "last_dream_at": row["last_dream_at"].isoformat() if row["last_dream_at"] else None,
    }


async def context(services: Services, user: UserRef, *, page_limit: int = 8) -> dict:
    async with services.tx(user) as conn:
        stats = await note_stats(conn, user)
        pages = await (
            await conn.execute(
                "SELECT doc_path, page_title, page_type FROM wiki_pages ORDER BY file_mtime DESC LIMIT %s",
                (page_limit,),
            )
        ).fetchall()
    root = services.settings.nas_root / user.workspace_rel_path
    memory_text = await asyncio.to_thread(_read, root / MEMORY_FILE)
    page_texts = await asyncio.gather(*[asyncio.to_thread(_read, root / p["doc_path"]) for p in pages])
    return {
        "sections": parse_memory(memory_text),
        "pages": [
            {"title": p["page_title"], "type": p["page_type"], "highlights": page_highlights(text)}
            for p, text in zip(pages, page_texts)
        ],
        "stats": stats,
    }


# ---------- 用量 ----------


async def usage_today(services: Services, user: UserRef) -> dict[str, int]:
    async with services.tx(user) as conn:
        row = await (
            await conn.execute(
                """
                SELECT (SELECT count(*) FROM search_logs WHERE created_at > now() - interval '1 day') AS asks,
                       (SELECT count(*) FROM raw_messages WHERE captured_at > now() - interval '1 day') AS captures
                """
            )
        ).fetchone()
    return {"asks": row["asks"], "captures": row["captures"]}
