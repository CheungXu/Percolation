"""把 wiki/*.md 同步成数据库索引。纯确定性代码，只有向量需要调接口。

文件是本体，库是索引：每次 wiki 改动后调用 sync_wiki，按 content_hash 增量，
只对内容变化的切片重新算向量；页面节点、多维标签、事件时间与链接边表在同一租户事务内幂等刷新。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime

from agentkit.llm.embedding import to_vector_literal
from agentkit.workspace import Workspace
from percolation.memory_fs import DOC_PATH_RE, WIKI_DIR
from percolation.services import Services, UserRef
from percolation.wiki import WikiPage, lookup_link, parse_page, resolve_link_targets


@dataclass
class SyncReport:
    docs: int = 0
    chunks: int = 0
    embedded: int = 0
    reused: int = 0
    docs_rewritten: list[str] = field(default_factory=list)
    docs_deleted: list[str] = field(default_factory=list)
    links: int = 0
    facets_count: int = 0
    events_count: int = 0
    dangling: list[str] = field(default_factory=list)
    skipped_files: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def load_pages(ws: Workspace) -> tuple[list[WikiPage], list[str]]:
    pages, skipped = [], []
    for path in ws.files(WIKI_DIR, "**/*.md"):
        rel = ws.rel(path)
        if not DOC_PATH_RE.match(rel):
            skipped.append(rel)
            continue
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        page = parse_page(rel, path.read_text(encoding="utf-8", errors="replace"), mtime)
        if page.chunks:
            pages.append(page)
        else:
            skipped.append(rel)
    return pages, skipped


async def sync_wiki(services: Services, user: UserRef, ws: Workspace) -> SyncReport:
    pages, skipped = load_pages(ws)
    report = SyncReport(docs=len(pages), skipped_files=skipped)

    async with services.tx(user) as conn:
        rows = await (
            await conn.execute(
                "SELECT doc_path, chunk_index, content_hash, embedding::text AS embedding FROM wiki_chunks WHERE user_id = %s",
                (user.id,),
            )
        ).fetchall()
        existing_page_rows = await (
            await conn.execute("SELECT doc_path FROM wiki_pages WHERE user_id = %s", (user.id,))
        ).fetchall()
    existing_by_doc: dict[str, list[tuple[int, str]]] = {}
    vector_by_hash: dict[str, str] = {}
    for row in rows:
        existing_by_doc.setdefault(row["doc_path"], []).append((row["chunk_index"], row["content_hash"]))
        vector_by_hash[row["content_hash"]] = row["embedding"]
    existing_docs = set(existing_by_doc) | {row["doc_path"] for row in existing_page_rows}

    pending = {
        chunk.content_hash: chunk.embed_text
        for page in pages
        for chunk in page.chunks
        if chunk.content_hash not in vector_by_hash
    }
    if pending:
        hashes = list(pending)
        vectors = await services.models.embedding().embed([pending[h] for h in hashes])
        vector_by_hash.update({h: to_vector_literal(v) for h, v in zip(hashes, vectors, strict=True)})
    report.embedded = len(pending)

    link_index = resolve_link_targets(pages)
    current_docs = {page.doc_path for page in pages}
    now = datetime.now(UTC)

    async with services.tx(user) as conn:
        for doc_path in sorted(existing_docs - current_docs):
            await conn.execute("DELETE FROM wiki_chunks WHERE user_id = %s AND doc_path = %s", (user.id, doc_path))
            await conn.execute("DELETE FROM wiki_pages WHERE user_id = %s AND doc_path = %s", (user.id, doc_path))
            report.docs_deleted.append(doc_path)

        await conn.execute("DELETE FROM page_facets WHERE user_id = %s", (user.id,))
        await conn.execute("DELETE FROM message_facets WHERE user_id = %s", (user.id,))
        await conn.execute("DELETE FROM message_events WHERE user_id = %s", (user.id,))

        seen_msg_facets: set[tuple[int, str, str, str]] = set()
        seen_msg_events: set[tuple[int, str, object, object]] = set()

        for page in pages:
            mtime = page.mtime or now
            await conn.execute(
                """
                INSERT INTO wiki_pages (
                  user_id, doc_path, page_title, page_type, aliases, facets,
                  chunk_count, source_msg_seqs, file_mtime, synced_at
                ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, now())
                ON CONFLICT (user_id, doc_path) DO UPDATE SET
                  page_title = EXCLUDED.page_title,
                  page_type = EXCLUDED.page_type,
                  aliases = EXCLUDED.aliases,
                  facets = EXCLUDED.facets,
                  chunk_count = EXCLUDED.chunk_count,
                  source_msg_seqs = EXCLUDED.source_msg_seqs,
                  file_mtime = EXCLUDED.file_mtime,
                  synced_at = now()
                """,
                (
                    user.id,
                    page.doc_path,
                    page.title,
                    page.page_type,
                    page.aliases,
                    json.dumps(page.facets, ensure_ascii=False),
                    len(page.chunks),
                    page.source_msg_seqs,
                    mtime,
                ),
            )

            for dim, vals in page.facets.items():
                for val in vals:
                    await conn.execute(
                        "INSERT INTO page_facets (user_id, doc_path, dim, val) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                        (user.id, page.doc_path, dim, val),
                    )
                    report.facets_count += 1

            for item in page.item_annotations:
                for seq in item.msg_seqs:
                    if seq <= 0:
                        continue
                    for dim, vals in item.facets.items():
                        for val in vals:
                            mf_key = (seq, page.doc_path, dim, val)
                            if mf_key in seen_msg_facets:
                                continue
                            seen_msg_facets.add(mf_key)
                            await conn.execute(
                                """
                                INSERT INTO message_facets (user_id, msg_seq, doc_path, dim, val)
                                VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
                                """,
                                (user.id, seq, page.doc_path, dim, val),
                            )
                    if item.event_start is not None and item.event_end is not None:
                        me_key = (seq, page.doc_path, item.event_start, item.event_end)
                        if me_key not in seen_msg_events:
                            seen_msg_events.add(me_key)
                            await conn.execute(
                                """
                                INSERT INTO message_events (user_id, msg_seq, doc_path, event_start, event_end)
                                VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
                                """,
                                (user.id, seq, page.doc_path, item.event_start, item.event_end),
                            )
                            report.events_count += 1

            report.chunks += len(page.chunks)
            signature = sorted((chunk.chunk_index, chunk.content_hash) for chunk in page.chunks)
            if sorted(existing_by_doc.get(page.doc_path, [])) == signature:
                report.reused += len(page.chunks)
                continue
            await conn.execute("DELETE FROM wiki_chunks WHERE user_id = %s AND doc_path = %s", (user.id, page.doc_path))
            for chunk in page.chunks:
                await conn.execute(
                    """
                    INSERT INTO wiki_chunks (
                      user_id, doc_path, chunk_index, page_title, aliases, section_heading, facet_text, facets, content,
                      certainty, source_msg_seqs, content_hash, embedding, file_mtime
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s::halfvec, %s)
                    """,
                    (
                        user.id,
                        page.doc_path,
                        chunk.chunk_index,
                        page.title,
                        page.aliases,
                        chunk.section_heading,
                        chunk.facet_text,
                        json.dumps(chunk.facets, ensure_ascii=False),
                        chunk.content,
                        chunk.certainty,
                        chunk.source_msg_seqs,
                        chunk.content_hash,
                        vector_by_hash[chunk.content_hash],
                        mtime,
                    ),
                )
            report.docs_rewritten.append(page.doc_path)

        await conn.execute("DELETE FROM wiki_links WHERE user_id = %s", (user.id,))
        for page in pages:
            for link in page.links:
                to_doc = lookup_link(link_index, link.target)
                if to_doc == page.doc_path:
                    continue
                await conn.execute(
                    """
                    INSERT INTO wiki_links (user_id, from_doc_path, to_target, to_doc_path, anchor_text, rel_type)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id, from_doc_path, to_target, rel_type) DO NOTHING
                    """,
                    (user.id, page.doc_path, link.target, to_doc, link.anchor, link.rel_type),
                )
                report.links += 1
                if to_doc is None:
                    report.dangling.append(f"{page.doc_path} -> [[{link.rel_type}::{link.target}]]")
    return report
