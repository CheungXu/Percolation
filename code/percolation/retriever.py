"""双轨多维混合召回。

轨道一（已整理）：wiki_chunks 的全文（重叠二字，标题别名权重 A、小节与维度权重 B）、trgm（残缺型号）、
向量（halfvec 余弦），外加第四路切片级多维标签与事件时间召回，四路经 RRF 融合。
轨道二（未整理/原话）：近期 pending 原话候选，另加全量原话的全文/trgm 命中与原话级维度/时间命中。
指定明确日期区间时对已归档记录做范围过滤（若区间内无精确命中且带查询词，则自动平滑回退并标注说明）。
两条轨道合并后交给 rerank 统一精排，再沿 wiki_links 补确定性优先级排序的一跳邻居页。
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from zoneinfo import ZoneInfo

from psycopg import AsyncConnection

from agentkit.llm.embedding import to_vector_literal
from percolation.services import Services, UserRef
from percolation.wiki import format_facets_summary, merge_facets

RRF_K = 60
PER_ROUTE_LIMIT = 20
PENDING_LIMIT = 60
RERANK_POOL = 40
TRGM_THRESHOLD = 0.35
LOCAL_TZ = ZoneInfo("Asia/Shanghai")
WEEKDAYS_ZH = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")

OR_TSQUERY = """
  SELECT to_tsquery('simple', string_agg(quote_literal(t), ' | ')) AS query
  FROM unnest(percolation_tokens(%(q)s)) AS t
"""


def _parse_iso_date(raw: str | date | None) -> date | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    try:
        return date.fromisoformat(str(raw).strip()[:10])
    except ValueError:
        return None


@dataclass
class Hit:
    kind: str
    key: str
    content: str
    score: float | None = None
    rrf: float = 0.0
    doc_path: str | None = None
    title: str = ""
    page_type: str = "topic"
    facets: dict[str, list[str]] = field(default_factory=dict)
    heading: str = ""
    certainty: str = "confirmed"
    source_msg_seqs: list[int] = field(default_factory=list)
    msg_seq: int | None = None
    captured_at: datetime | None = None
    dream_status: str | None = None
    event_dates: list[str] = field(default_factory=list)

    def rerank_text(self) -> str:
        facet_str = format_facets_summary(self.facets)
        meta = f" [{self.page_type}" + (f" · {facet_str}" if facet_str else "") + "]"
        if self.kind == "wiki":
            return f"{self.title}{meta} / {self.heading}\n{self.content}"[:1500]
        extra = f"（{facet_str}）" if facet_str else ""
        return f"原话 #{self.msg_seq}{extra}：{self.content}"[:1500]

    def render(self) -> str:
        score = f" 相关度 {self.score:.2f}" if self.score is not None else ""
        facet_str = format_facets_summary(self.facets)
        facet_part = f" · 维度 {facet_str}" if facet_str else ""
        if self.kind == "wiki":
            seqs = ",".join(f"#{s}" for s in self.source_msg_seqs) or "无"
            return (
                f"[主题页 {self.doc_path} · {self.title}（{self.page_type}）/ {self.heading or '概述'}"
                f" · {self.certainty}{facet_part}{score} · 锚点 {seqs}]\n{self.content}"
            )
        when = self.captured_at.astimezone(LOCAL_TZ).strftime("%Y-%m-%d %H:%M") if self.captured_at else ""
        ev_part = f" · 事件日期 {','.join(self.event_dates)}" if self.event_dates else ""
        return f"[原话 #{self.msg_seq} · {when} · {self.dream_status}{facet_part}{ev_part}{score}]\n{self.content}"


@dataclass
class RetrievalResult:
    queries: list[str]
    hits: list[Hit]
    neighbors: list[dict]
    reranked: bool
    facet_filters: dict[str, list[str]] = field(default_factory=dict)
    date_range: tuple[str | None, str | None] = (None, None)
    date_filtered: bool | None = None

    @property
    def doc_paths(self) -> list[str]:
        return list(dict.fromkeys(hit.doc_path for hit in self.hits if hit.doc_path))

    @property
    def msg_seqs(self) -> list[int]:
        seqs: list[int] = []
        for hit in self.hits:
            seqs.extend(hit.source_msg_seqs if hit.kind == "wiki" else [hit.msg_seq])
        return list(dict.fromkeys(s for s in seqs if s is not None))

    @property
    def top_score(self) -> float:
        return max((hit.score or 0.0 for hit in self.hits), default=0.0)

    def render(self) -> str:
        if not self.hits:
            return "（没有召回任何记录）"
        parts: list[str] = []
        if self.date_filtered is False and any(self.date_range):
            span_text = f"{self.date_range[0] or ''}..{self.date_range[1] or ''}"
            parts.append(f"（注：未找到精确落在日期范围 {span_text} 内的已归档记录，以下为按关键词/语义召回的相近记录）")
        parts.extend(hit.render() for hit in self.hits)
        if self.neighbors:
            items = []
            for n in self.neighbors:
                rel = n.get("rel_type") or "related"
                arrow = "->" if n.get("direction") == "out" else "<-"
                f_str = format_facets_summary(n.get("facets") or {})
                f_note = f"，{f_str}" if f_str else ""
                items.append(f"{n['doc_path']}（{n['title']}，{rel}{arrow}{n.get('via', '')}{f_note}）")
            parts.append("相关联的主题页：" + "；".join(items))
        return "\n\n".join(parts)


async def _wiki_routes(conn: AsyncConnection, query: str, vector: str | None) -> list[list[str]]:
    routes: list[list[str]] = []
    rows = await (
        await conn.execute(
            f"""
            WITH q AS ({OR_TSQUERY})
            SELECT c.id::text AS id FROM wiki_chunks c, q
            WHERE q.query IS NOT NULL AND c.tsv @@ q.query
            ORDER BY ts_rank(c.tsv, q.query) DESC LIMIT %(limit)s
            """,
            {"q": query, "limit": PER_ROUTE_LIMIT},
        )
    ).fetchall()
    routes.append([row["id"] for row in rows])
    rows = await (
        await conn.execute(
            """
            SELECT id::text AS id FROM (
              SELECT id, GREATEST(
                word_similarity(%(q)s, page_title || ' ' || array_to_string(aliases, ' ') || ' ' || facet_text || ' ' || content),
                CASE WHEN content ILIKE '%%' || %(q)s || '%%' OR page_title ILIKE '%%' || %(q)s || '%%' OR facet_text ILIKE '%%' || %(q)s || '%%' THEN 0.5 ELSE 0 END
              ) AS score
              FROM wiki_chunks
            ) s WHERE score >= %(threshold)s ORDER BY score DESC LIMIT %(limit)s
            """,
            {"q": query, "threshold": TRGM_THRESHOLD, "limit": PER_ROUTE_LIMIT},
        )
    ).fetchall()
    routes.append([row["id"] for row in rows])
    if vector is not None:
        rows = await (
            await conn.execute(
                "SELECT id::text AS id FROM wiki_chunks ORDER BY embedding <=> %s::halfvec LIMIT %s",
                (vector, PER_ROUTE_LIMIT),
            )
        ).fetchall()
        routes.append([row["id"] for row in rows])
    return routes


async def _raw_route(conn: AsyncConnection, query: str) -> list[int]:
    rows = await (
        await conn.execute(
            f"""
            WITH q AS ({OR_TSQUERY})
            SELECT r.msg_seq FROM raw_messages r, q
            WHERE (q.query IS NOT NULL AND r.tsv @@ q.query)
               OR word_similarity(%(q)s, r.content) >= %(threshold)s
               OR r.content ILIKE '%%' || %(q)s || '%%'
            ORDER BY COALESCE(ts_rank(r.tsv, q.query), 0) + word_similarity(%(q)s, r.content) DESC
            LIMIT %(limit)s
            """,
            {"q": query, "threshold": TRGM_THRESHOLD, "limit": 10},
        )
    ).fetchall()
    return [row["msg_seq"] for row in rows]


async def _matching_date_targets(
    conn: AsyncConnection,
    d_from: date | None,
    d_to: date | None,
    time_field: str,
) -> tuple[set[str], set[int]]:
    """计算精确落在指定日期窗口内的 (wiki_chunk_ids, raw_msg_seqs)。"""
    use_event = time_field in {"any", "event"}
    use_captured = time_field in {"any", "captured"}
    matched_seqs: set[int] = set()
    if use_event:
        for row in await (
            await conn.execute(
                """
                SELECT DISTINCT msg_seq FROM message_events
                WHERE (%s::date IS NULL OR event_end >= %s::date)
                  AND (%s::date IS NULL OR event_start <= %s::date)
                """,
                (d_from, d_from, d_to, d_to),
            )
        ).fetchall():
            matched_seqs.add(int(row["msg_seq"]))
    if use_captured:
        for row in await (
            await conn.execute(
                """
                SELECT msg_seq FROM raw_messages
                WHERE (%s::date IS NULL OR (captured_at AT TIME ZONE 'Asia/Shanghai')::date >= %s::date)
                  AND (%s::date IS NULL OR (captured_at AT TIME ZONE 'Asia/Shanghai')::date <= %s::date)
                """,
                (d_from, d_from, d_to, d_to),
            )
        ).fetchall():
            matched_seqs.add(int(row["msg_seq"]))

    matched_chunks: set[str] = set()
    if matched_seqs:
        for row in await (
            await conn.execute(
                "SELECT id::text AS id FROM wiki_chunks WHERE source_msg_seqs && %s::bigint[]",
                (sorted(matched_seqs),),
            )
        ).fetchall():
            matched_chunks.add(row["id"])
    return matched_chunks, matched_seqs


async def _facet_and_time_routes(
    conn: AsyncConnection,
    facets: dict[str, list[str]],
    date_chunk_ids: set[str],
    date_raw_seqs: set[int],
) -> tuple[list[str], list[int]]:
    """第四路召回：按切片级正交维度交集度与日期命中排序召回切片和原话。"""
    dims: list[str] = []
    vals: list[str] = []
    for dim, dim_vals in facets.items():
        for val in dim_vals:
            dims.append(dim)
            vals.append(val)

    chunk_scores: dict[str, tuple[int, int]] = {}
    if dims:
        for row in await (
            await conn.execute(
                """
                SELECT c.id::text AS id, c.chunk_index,
                       count(DISTINCT f.dim || ':' || f.val)::int AS matched
                FROM wiki_chunks c
                JOIN unnest(%s::text[], %s::text[]) AS f(dim, val)
                  ON (
                    CASE WHEN c.facets <> '{}'::jsonb THEN c.facets ELSE
                      COALESCE((SELECT p.facets FROM wiki_pages p WHERE p.user_id = c.user_id AND p.doc_path = c.doc_path), '{}'::jsonb)
                    END
                  ) @> jsonb_build_object(f.dim, jsonb_build_array(f.val))
                GROUP BY c.id, c.chunk_index
                """,
                (dims, vals),
            )
        ).fetchall():
            chunk_scores[row["id"]] = (row["matched"] * 2, row["chunk_index"])

    if date_chunk_ids:
        for row in await (
            await conn.execute(
                "SELECT id::text AS id, chunk_index FROM wiki_chunks WHERE id = ANY(%s::uuid[])",
                (sorted(date_chunk_ids),),
            )
        ).fetchall():
            prev_score, idx = chunk_scores.get(row["id"], (0, row["chunk_index"]))
            chunk_scores[row["id"]] = (prev_score + 2, idx)

    wiki_ids = [
        cid for cid, _ in sorted(chunk_scores.items(), key=lambda kv: (-kv[1][0], kv[1][1], kv[0]))[:PER_ROUTE_LIMIT]
    ]

    msg_scores: dict[int, int] = defaultdict(int)
    if dims:
        for row in await (
            await conn.execute(
                """
                SELECT mf.msg_seq, count(DISTINCT mf.dim || ':' || mf.val)::int AS matched
                FROM message_facets mf
                JOIN unnest(%s::text[], %s::text[]) AS f(dim, val)
                  ON mf.dim = f.dim AND mf.val = f.val
                GROUP BY mf.msg_seq
                """,
                (dims, vals),
            )
        ).fetchall():
            msg_scores[int(row["msg_seq"])] += row["matched"] * 2
    for seq in date_raw_seqs:
        msg_scores[seq] += 2

    raw_seqs = sorted(msg_scores, key=lambda s: (-msg_scores[s], -s))[:PER_ROUTE_LIMIT]
    return wiki_ids, raw_seqs


async def search(
    services: Services,
    user: UserRef,
    queries: list[str],
    *,
    rerank_query: str | None = None,
    top_k: int = 6,
    facet_filters: dict[str, list[str]] | None = None,
    date_from: str | date | None = None,
    date_to: str | date | None = None,
    time_field: str = "any",
) -> RetrievalResult:
    queries = [q.strip() for q in dict.fromkeys(queries) if q and q.strip()]
    norm_facets = merge_facets(facet_filters or {})
    d_from, d_to = _parse_iso_date(date_from), _parse_iso_date(date_to)
    if d_from and d_to and d_to < d_from:
        d_from, d_to = d_to, d_from
    has_date = d_from is not None or d_to is not None
    effective_time_field = time_field or "any"
    date_pair = (d_from.isoformat() if d_from else None, d_to.isoformat() if d_to else None)

    if not queries and not norm_facets and not has_date:
        return RetrievalResult(queries=[], hits=[], neighbors=[], reranked=False)

    async with services.tx(user) as conn:
        has_chunks = (await (await conn.execute("SELECT EXISTS (SELECT 1 FROM wiki_chunks) AS ok")).fetchone())["ok"]
    vectors: list[str | None] = [None] * len(queries)
    if has_chunks and queries:
        embedded = await services.models.embedding().embed(queries)
        vectors = [to_vector_literal(v) for v in embedded]

    rrf: dict[str, float] = defaultdict(float)
    text_raw_hits: set[int] = set()
    date_filtered: bool | None = None

    async with services.tx(user) as conn:
        date_chunk_ids: set[str] = set()
        date_raw_seqs: set[int] = set()
        if has_date:
            date_chunk_ids, date_raw_seqs = await _matching_date_targets(conn, d_from, d_to, effective_time_field)

        for query, vector in zip(queries, vectors, strict=True):
            if has_chunks:
                for route in await _wiki_routes(conn, query, vector):
                    for rank, chunk_id in enumerate(route):
                        rrf[f"w:{chunk_id}"] += 1.0 / (RRF_K + rank + 1)
            for rank, seq in enumerate(await _raw_route(conn, query)):
                rrf[f"r:{seq}"] += 1.0 / (RRF_K + rank + 1)
                text_raw_hits.add(seq)

        if norm_facets or has_date:
            facet_wiki_ids, facet_raw_seqs = await _facet_and_time_routes(
                conn, norm_facets, date_chunk_ids, date_raw_seqs
            )
            for rank, chunk_id in enumerate(facet_wiki_ids):
                rrf[f"w:{chunk_id}"] += 1.5 / (RRF_K + rank + 1)
            for rank, seq in enumerate(facet_raw_seqs):
                rrf[f"r:{seq}"] += 1.5 / (RRF_K + rank + 1)

        pending_set: set[int] = set()
        if queries:
            pending_rows = await (
                await conn.execute(
                    "SELECT msg_seq FROM raw_messages WHERE dream_status = 'pending' ORDER BY msg_seq DESC LIMIT %s",
                    (PENDING_LIMIT,),
                )
            ).fetchall()
            pending_set = {int(row["msg_seq"]) for row in pending_rows}
            if not has_date:
                for seq in pending_set:
                    rrf.setdefault(f"r:{seq}", 0.0)
            else:
                # 指定日期时，只让匹配日期或被查询词文本命中的 pending 消息进入候选，不塞入无关全量 pending
                for seq in pending_set:
                    if seq in date_raw_seqs or (effective_time_field in {"any", "event"} and seq in text_raw_hits):
                        rrf.setdefault(f"r:{seq}", 0.0)

        if has_date:
            if date_chunk_ids or date_raw_seqs:
                date_filtered = True
                allow_unindexed_pending = effective_time_field in {"any", "event"}
                for key in list(rrf):
                    if key.startswith("w:") and key[2:] not in date_chunk_ids:
                        del rrf[key]
                    elif key.startswith("r:"):
                        seq = int(key[2:])
                        if seq in date_raw_seqs:
                            continue
                        if allow_unindexed_pending and seq in pending_set and seq in text_raw_hits:
                            continue
                        del rrf[key]
            elif not queries and not norm_facets:
                date_filtered = True
                rrf.clear()
            else:
                date_filtered = False

        keys = sorted(rrf, key=lambda key: rrf[key], reverse=True)
        wiki_ids = [key[2:] for key in keys if key.startswith("w:")][:RERANK_POOL]
        raw_seqs = [int(key[2:]) for key in keys if key.startswith("r:")]
        hits: dict[str, Hit] = {}
        if wiki_ids:
            for row in await (
                await conn.execute(
                    """
                    SELECT c.id::text AS id, c.doc_path, c.page_title, c.section_heading, c.content,
                           c.certainty, c.source_msg_seqs,
                           COALESCE(p.page_type, 'topic') AS page_type,
                           CASE WHEN c.facets <> '{}'::jsonb THEN c.facets ELSE COALESCE(p.facets, '{}'::jsonb) END AS facets
                    FROM wiki_chunks c
                    LEFT JOIN wiki_pages p ON p.user_id = c.user_id AND p.doc_path = c.doc_path
                    WHERE c.id = ANY(%s::uuid[])
                    """,
                    (wiki_ids,),
                )
            ).fetchall():
                key = f"w:{row['id']}"
                hits[key] = Hit(
                    kind="wiki",
                    key=key,
                    content=row["content"],
                    rrf=rrf[key],
                    doc_path=row["doc_path"],
                    title=row["page_title"],
                    page_type=row["page_type"],
                    facets=dict(row["facets"] or {}),
                    heading=row["section_heading"],
                    certainty=row["certainty"],
                    source_msg_seqs=list(row["source_msg_seqs"]),
                )
        if raw_seqs:
            mf_map: dict[int, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
            for mf in await (
                await conn.execute(
                    "SELECT msg_seq, dim, val FROM message_facets WHERE msg_seq = ANY(%s)",
                    (raw_seqs,),
                )
            ).fetchall():
                bucket = mf_map[int(mf["msg_seq"])][mf["dim"]]
                if mf["val"] not in bucket:
                    bucket.append(mf["val"])
            me_map: dict[int, list[str]] = defaultdict(list)
            for me in await (
                await conn.execute(
                    "SELECT msg_seq, event_start, event_end FROM message_events WHERE msg_seq = ANY(%s) ORDER BY event_start",
                    (raw_seqs,),
                )
            ).fetchall():
                s_str = me["event_start"].isoformat()
                e_str = me["event_end"].isoformat()
                label = s_str if s_str == e_str else f"{s_str}..{e_str}"
                if label not in me_map[int(me["msg_seq"])]:
                    me_map[int(me["msg_seq"])].append(label)

            for row in await (
                await conn.execute(
                    "SELECT msg_seq, content, captured_at, dream_status FROM raw_messages WHERE msg_seq = ANY(%s)",
                    (raw_seqs,),
                )
            ).fetchall():
                seq = int(row["msg_seq"])
                key = f"r:{seq}"
                hits[key] = Hit(
                    kind="raw",
                    key=key,
                    content=row["content"],
                    rrf=rrf[key],
                    msg_seq=seq,
                    captured_at=row["captured_at"],
                    dream_status=row["dream_status"],
                    facets={k: list(v) for k, v in sorted(mf_map[seq].items())},
                    event_dates=me_map[seq],
                )

    pool = sorted(hits.values(), key=lambda hit: hit.rrf, reverse=True)[:RERANK_POOL]
    reranked = False
    effective_rerank_q = rerank_query or (queries[0] if queries else format_facets_summary(norm_facets))
    if pool and effective_rerank_q:
        try:
            ranked = await services.models.rerank().rerank(
                effective_rerank_q, [hit.rerank_text() for hit in pool], top_n=top_k
            )
            selected = []
            for index, score in ranked:
                pool[index].score = score
                selected.append(pool[index])
            pool = selected
            reranked = True
        except Exception:  # noqa: BLE001
            pool = [hit for hit in pool if hit.rrf > 0][:top_k]
    final = pool[:top_k]

    neighbors: list[dict] = []
    doc_paths = list(dict.fromkeys(hit.doc_path for hit in final if hit.doc_path))
    if doc_paths:
        async with services.tx(user) as conn:
            rows = await (
                await conn.execute(
                    """
                    WITH edges AS (
                      SELECT to_doc_path AS doc_path, rel_type, 'out' AS direction, from_doc_path AS via
                      FROM wiki_links
                      WHERE from_doc_path = ANY(%(docs)s) AND to_doc_path IS NOT NULL
                      UNION
                      SELECT from_doc_path AS doc_path, rel_type, 'in' AS direction, to_doc_path AS via
                      FROM wiki_links
                      WHERE to_doc_path = ANY(%(docs)s)
                    ),
                    dedup AS (
                      SELECT DISTINCT ON (e.doc_path)
                        e.doc_path, e.rel_type, e.direction, e.via,
                        CASE e.rel_type
                          WHEN 'belongs_to' THEN 1
                          WHEN 'part_of' THEN 2
                          WHEN 'replaces' THEN 3
                          WHEN 'uses' THEN 4
                          WHEN 'about' THEN 5
                          WHEN 'related' THEN 9
                          ELSE 6
                        END AS rel_prio,
                        CASE WHEN e.direction = 'out' THEN 0 ELSE 1 END AS dir_prio,
                        COALESCE(p.page_title, c.page_title) AS title,
                        COALESCE(p.page_type, 'topic') AS page_type,
                        COALESCE(p.facets, '{}'::jsonb) AS facets
                      FROM edges e
                      LEFT JOIN wiki_pages p ON p.doc_path = e.doc_path
                      LEFT JOIN wiki_chunks c ON c.doc_path = e.doc_path AND c.chunk_index = 0
                      WHERE NOT (e.doc_path = ANY(%(docs)s))
                        AND COALESCE(p.page_title, c.page_title) IS NOT NULL
                      ORDER BY e.doc_path, rel_prio ASC, dir_prio ASC, e.via ASC
                    )
                    SELECT doc_path, rel_type, direction, via, title, page_type, facets
                    FROM dedup
                    ORDER BY rel_prio ASC, dir_prio ASC, doc_path ASC
                    LIMIT 8
                    """,
                    {"docs": doc_paths},
                )
            ).fetchall()
        neighbors = [dict(row) for row in rows]
    return RetrievalResult(
        queries=queries,
        hits=final,
        neighbors=neighbors,
        reranked=reranked,
        facet_filters=norm_facets,
        date_range=date_pair,
        date_filtered=date_filtered,
    )


async def fetch_raw(
    services: Services,
    user: UserRef,
    msg_seqs: list[int],
    *,
    with_batch: bool = True,
    limit: int = 40,
) -> list[dict]:
    """按序号取原话；with_batch 时把同一连发批次的前后消息一起带上，便于还原语境。"""
    if not msg_seqs:
        return []
    async with services.tx(user) as conn:
        if with_batch:
            rows = await (
                await conn.execute(
                    """
                    SELECT r.msg_seq, r.batch_id::text AS batch_id, r.source_kind, r.content, r.captured_at,
                           r.dream_status, s.query_text AS reply_to_query
                    FROM raw_messages r
                    LEFT JOIN search_logs s ON s.id = r.reply_to_search_id
                    WHERE r.batch_id IN (SELECT batch_id FROM raw_messages WHERE msg_seq = ANY(%s))
                    ORDER BY r.msg_seq
                    LIMIT %s
                    """,
                    (msg_seqs, limit),
                )
            ).fetchall()
        else:
            rows = await (
                await conn.execute(
                    """
                    SELECT r.msg_seq, r.batch_id::text AS batch_id, r.source_kind, r.content, r.captured_at,
                           r.dream_status, s.query_text AS reply_to_query
                    FROM raw_messages r
                    LEFT JOIN search_logs s ON s.id = r.reply_to_search_id
                    WHERE r.msg_seq = ANY(%s)
                    ORDER BY r.msg_seq
                    LIMIT %s
                    """,
                    (msg_seqs, limit),
                )
            ).fetchall()
    return [dict(row) for row in rows]


async def traced_search(
    ctx,
    services: Services,
    user: UserRef,
    queries: list[str],
    *,
    rerank_query: str | None = None,
    top_k: int = 6,
    facet_filters: dict[str, list[str]] | None = None,
    date_from: str | date | None = None,
    date_to: str | date | None = None,
    time_field: str = "any",
) -> RetrievalResult:
    """search() 外包一层 retrieval span：召回文档进 payload，embedding/rerank 用量记在这个 span 上。"""
    with ctx.trace.span(
        "retrieval",
        kind="retrieval",
        queries=queries,
        rerank_query=rerank_query,
        top_k=top_k,
        facet_filters=facet_filters or {},
        date_from=str(date_from) if date_from else None,
        date_to=str(date_to) if date_to else None,
        time_field=time_field,
    ) as span:
        result = await search(
            services,
            user,
            queries,
            rerank_query=rerank_query,
            top_k=top_k,
            facet_filters=facet_filters,
            date_from=date_from,
            date_to=date_to,
            time_field=time_field,
        )
        span.set(
            hits=len(result.hits),
            reranked=result.reranked,
            doc_paths=result.doc_paths,
            msg_seqs=result.msg_seqs,
            facet_filters=result.facet_filters,
            date_range=list(result.date_range),
            date_filtered=result.date_filtered,
        )
        span.payload["documents"] = [
            {"id": hit.key, "content": hit.render(), "score": hit.score if hit.score is not None else hit.rrf}
            for hit in result.hits
        ]
        span.payload["neighbors"] = result.neighbors
        ctx.trace.event(
            "retrieval",
            queries=result.queries,
            facet_filters=result.facet_filters,
            date_range=list(result.date_range),
            date_filtered=result.date_filtered,
            doc_paths=result.doc_paths,
            msg_seqs=result.msg_seqs,
            reranked=result.reranked,
        )
    return result


def format_local_today(now: datetime | None = None) -> str:
    dt = (now or datetime.now(LOCAL_TZ)).astimezone(LOCAL_TZ)
    return f"{dt:%Y-%m-%d}（{WEEKDAYS_ZH[dt.weekday()]}）"


def render_raw(rows: list[dict]) -> str:
    if not rows:
        return "（无）"
    lines = []
    for row in rows:
        local_dt = row["captured_at"].astimezone(LOCAL_TZ)
        when = f"{local_dt:%Y-%m-%d} {WEEKDAYS_ZH[local_dt.weekday()]} {local_dt:%H:%M}"
        extra = ""
        if row["source_kind"] == "clarification":
            extra = f" · 澄清，回答的问题：{row.get('reply_to_query') or '未知'}"
        lines.append(f"#{row['msg_seq']} [{when} · 批次 {row['batch_id'][:8]} · {row['dream_status']}{extra}] {row['content']}")
    return "\n".join(lines)
