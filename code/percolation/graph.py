"""异构多维拓扑图谱与维度统计查询。

不依赖图数据库：基于 PostgreSQL 邻接表（wiki_links）、多维倒排表（page_facets / message_facets）
与 WITH RECURSIVE 递归查询，在单次租户事务内组装可直接喂给 Cytoscape.js / Sigma.js / ForceGraph 的图结构。
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from percolation.memory_fs import CACHE_DIR
from percolation.services import Services, UserRef
from percolation.wiki import effective_facets_catalog, merge_facets, normalize_dim_key


def parse_facet_specs(specs: list[str] | None) -> dict[str, list[str]]:
    """解析 CLI / Query 传入的 ['domain=学习', 'form:网站'] 列表。"""
    parsed: dict[str, list[str]] = defaultdict(list)
    for raw in specs or []:
        text = (raw or "").strip()
        if not text:
            continue
        sep = "=" if "=" in text else (":" if ":" in text else None)
        if sep is None:
            continue
        k, v = text.split(sep, 1)
        dim = normalize_dim_key(k)
        if dim and v.strip():
            for item in v.split(","):
                if item.strip():
                    parsed[dim].append(item.strip())
    return merge_facets(parsed)


def _normalize_center_doc(raw: str) -> str:
    cleaned = raw.strip().removeprefix("page:").removeprefix("/").removeprefix("./")
    if not cleaned.startswith("wiki/"):
        cleaned = f"wiki/{cleaned}"
    if not cleaned.endswith(".md"):
        cleaned = f"{cleaned}.md"
    return cleaned


async def build_facets_overview(services: Services, user: UserRef) -> dict[str, Any]:
    """返回受控维度词表（含用户扩展）及当前租户在各维度、页面类型、关系类型上的实时计数。"""
    ws = services.workspace(user)
    catalog = effective_facets_catalog(services.settings.facets, ws.read_text(f"{CACHE_DIR}/facets.md"))

    async with services.tx(user) as conn:
        pf_rows = await (
            await conn.execute(
                "SELECT dim, val, count(DISTINCT doc_path)::int AS pages FROM page_facets GROUP BY dim, val"
            )
        ).fetchall()
        mf_rows = await (
            await conn.execute(
                "SELECT dim, val, count(DISTINCT msg_seq)::int AS messages FROM message_facets GROUP BY dim, val"
            )
        ).fetchall()
        type_rows = await (
            await conn.execute("SELECT page_type, count(*)::int AS pages FROM wiki_pages GROUP BY page_type ORDER BY pages DESC")
        ).fetchall()
        rel_rows = await (
            await conn.execute("SELECT rel_type, count(*)::int AS edges FROM wiki_links GROUP BY rel_type ORDER BY edges DESC")
        ).fetchall()

    stats_map: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: {"pages": 0, "messages": 0}))
    for row in pf_rows:
        stats_map[row["dim"]][row["val"]]["pages"] = row["pages"]
    for row in mf_rows:
        stats_map[row["dim"]][row["val"]]["messages"] = row["messages"]

    counts_by_dim: dict[str, list[dict[str, Any]]] = {}
    for dim in sorted(set(catalog.get("dimensions", {})) | set(stats_map)):
        val_map = stats_map.get(dim, {})
        items = [
            {"val": val, "pages": counts["pages"], "messages": counts["messages"]}
            for val, counts in sorted(val_map.items(), key=lambda kv: (-kv[1]["pages"], -kv[1]["messages"], kv[0]))
        ]
        counts_by_dim[dim] = items

    return {
        "catalog": catalog,
        "counts": counts_by_dim,
        "page_types": {r["page_type"]: r["pages"] for r in type_rows},
        "relation_types": {r["rel_type"]: r["edges"] for r in rel_rows},
    }


async def build_graph(
    services: Services,
    user: UserRef,
    *,
    include_facets: bool = True,
    include_messages: bool | None = None,
    center: str | None = None,
    depth: int = 1,
    facet_filters: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """构建异构多维拓扑图。

    - 不同维度之间取交集（如 domain=学习 AND form=网站），同维度多值取并集。
    - center 指定某页（支持路径、文件名或标题）时，用 WITH RECURSIVE 取 1..3 跳子图。
    - include_messages 缺省在局部子图（有 center）时开启、全图时关闭。
    """
    depth = max(1, min(int(depth), 3))
    norm_facets = merge_facets(facet_filters or {})
    if include_messages is None:
        include_messages = center is not None

    async with services.tx(user) as conn:
        selected_docs: set[str] | None = None

        if center:
            candidate = _normalize_center_doc(center)
            row = await (
                await conn.execute(
                    """
                    SELECT doc_path FROM wiki_pages
                    WHERE doc_path = %s OR lower(page_title) = lower(%s) OR %s = ANY(aliases)
                    ORDER BY CASE WHEN doc_path = %s THEN 0 ELSE 1 END
                    LIMIT 1
                    """,
                    (candidate, center.strip(), center.strip(), candidate),
                )
            ).fetchone()
            center_doc = row["doc_path"] if row else candidate
            hood_rows = await (
                await conn.execute(
                    """
                    WITH RECURSIVE neighborhood(doc_path, hop, visited) AS (
                      SELECT %s::text, 0, ARRAY[%s::text]
                      UNION ALL
                      SELECT nxt.doc_path, n.hop + 1, n.visited || nxt.doc_path
                      FROM neighborhood n
                      JOIN LATERAL (
                        SELECT to_doc_path AS doc_path FROM wiki_links
                        WHERE from_doc_path = n.doc_path AND to_doc_path IS NOT NULL
                        UNION
                        SELECT from_doc_path AS doc_path FROM wiki_links
                        WHERE to_doc_path = n.doc_path
                      ) nxt ON NOT (nxt.doc_path = ANY(n.visited))
                      WHERE n.hop < %s
                    )
                    SELECT DISTINCT doc_path FROM neighborhood
                    """,
                    (center_doc, center_doc, depth),
                )
            ).fetchall()
            selected_docs = {r["doc_path"] for r in hood_rows}

        if norm_facets:
            for dim, vals in norm_facets.items():
                matched = {
                    r["doc_path"]
                    for r in await (
                        await conn.execute(
                            "SELECT DISTINCT doc_path FROM page_facets WHERE dim = %s AND val = ANY(%s)",
                            (dim, vals),
                        )
                    ).fetchall()
                }
                selected_docs = matched if selected_docs is None else (selected_docs & matched)

        if selected_docs is not None:
            page_rows = await (
                await conn.execute(
                    "SELECT * FROM wiki_pages WHERE doc_path = ANY(%s) ORDER BY doc_path",
                    (sorted(selected_docs),),
                )
            ).fetchall()
        else:
            page_rows = await (await conn.execute("SELECT * FROM wiki_pages ORDER BY doc_path")).fetchall()

        doc_paths = [r["doc_path"] for r in page_rows]
        doc_set = set(doc_paths)

        link_rows = (
            await (
                await conn.execute(
                    """
                    SELECT from_doc_path, to_target, to_doc_path, anchor_text, rel_type
                    FROM wiki_links
                    WHERE from_doc_path = ANY(%s) OR to_doc_path = ANY(%s)
                    ORDER BY from_doc_path, rel_type, to_target
                    """,
                    (doc_paths, doc_paths),
                )
            ).fetchall()
            if doc_paths
            else []
        )

        pf_rows = (
            await (
                await conn.execute(
                    "SELECT doc_path, dim, val FROM page_facets WHERE doc_path = ANY(%s) ORDER BY dim, val, doc_path",
                    (doc_paths,),
                )
            ).fetchall()
            if doc_paths
            else []
        )

        mf_counts = {
            (r["dim"], r["val"]): r["n"]
            for r in (
                await (
                    await conn.execute(
                        """
                        SELECT dim, val, count(DISTINCT msg_seq)::int AS n
                        FROM message_facets WHERE doc_path = ANY(%s)
                        GROUP BY dim, val
                        """,
                        (doc_paths,),
                    )
                ).fetchall()
                if doc_paths
                else []
            )
        }

        msg_rows: list[dict] = []
        msg_events_map: dict[int, tuple[str | None, str | None]] = {}
        msg_facets_map: dict[int, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
        if include_messages and doc_paths:
            all_seqs = sorted({int(seq) for r in page_rows for seq in (r["source_msg_seqs"] or [])})
            if all_seqs:
                msg_rows = [
                    dict(r)
                    for r in await (
                        await conn.execute(
                            "SELECT msg_seq, content, captured_at, dream_status FROM raw_messages WHERE msg_seq = ANY(%s) ORDER BY msg_seq",
                            (all_seqs,),
                        )
                    ).fetchall()
                ]
                for me in await (
                    await conn.execute(
                        "SELECT msg_seq, min(event_start) AS s, max(event_end) AS e FROM message_events WHERE msg_seq = ANY(%s) GROUP BY msg_seq",
                        (all_seqs,),
                    )
                ).fetchall():
                    msg_events_map[int(me["msg_seq"])] = (
                        me["s"].isoformat() if me["s"] else None,
                        me["e"].isoformat() if me["e"] else None,
                    )
                for mf in await (
                    await conn.execute(
                        "SELECT msg_seq, dim, val FROM message_facets WHERE msg_seq = ANY(%s)",
                        (all_seqs,),
                    )
                ).fetchall():
                    bucket = msg_facets_map[int(mf["msg_seq"])][mf["dim"]]
                    if mf["val"] not in bucket:
                        bucket.append(mf["val"])

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    connected_docs: set[str] = set()
    by_type: dict[str, int] = defaultdict(int)

    for row in page_rows:
        doc = row["doc_path"]
        seqs = list(row["source_msg_seqs"] or [])
        by_type[row["page_type"]] += 1
        nodes.append(
            {
                "id": f"page:{doc}",
                "kind": "page",
                "doc_path": doc,
                "label": row["page_title"],
                "title": row["page_title"],
                "page_type": row["page_type"],
                "aliases": list(row["aliases"] or []),
                "facets": dict(row["facets"] or {}),
                "chunk_count": row["chunk_count"],
                "msg_count": len(seqs),
            }
        )

    dangling_stubs: set[str] = set()
    dangling_count = 0
    wiki_edge_count = 0
    for link in link_rows:
        src = link["from_doc_path"]
        dst = link["to_doc_path"]
        if src not in doc_set:
            continue
        if dst is not None and dst not in doc_set:
            # 子图边界外的目标页不悬空，只是未纳入当前子图过滤集合
            continue
        is_dangling = dst is None
        if is_dangling:
            dangling_count += 1
            stub_id = f"dangling:{link['to_target']}"
            if stub_id not in dangling_stubs:
                dangling_stubs.add(stub_id)
                nodes.append({"id": stub_id, "kind": "dangling", "label": link["to_target"], "target": link["to_target"]})
            target_id = stub_id
        else:
            connected_docs.add(src)
            connected_docs.add(dst)
            target_id = f"page:{dst}"

        wiki_edge_count += 1
        edges.append(
            {
                "source": f"page:{src}",
                "target": target_id,
                "kind": "wiki_link",
                "rel_type": link["rel_type"],
                "anchor": link["anchor_text"],
                "dangling": is_dangling,
            }
        )

    facet_page_counts: dict[tuple[str, str], int] = defaultdict(int)
    for pf in pf_rows:
        facet_page_counts[(pf["dim"], pf["val"])] += 1

    if include_facets:
        for (dim, val), page_cnt in sorted(facet_page_counts.items()):
            nodes.append(
                {
                    "id": f"facet:{dim}:{val}",
                    "kind": "facet",
                    "dim": dim,
                    "val": val,
                    "label": f"{dim}:{val}",
                    "page_count": page_cnt,
                    "msg_count": mf_counts.get((dim, val), 0),
                }
            )
        for pf in pf_rows:
            edges.append(
                {
                    "source": f"page:{pf['doc_path']}",
                    "target": f"facet:{pf['dim']}:{pf['val']}",
                    "kind": "has_facet",
                    "rel_type": pf["dim"],
                }
            )

    if include_messages and msg_rows:
        known_seqs = {int(m["msg_seq"]) for m in msg_rows}
        for m in msg_rows:
            seq = int(m["msg_seq"])
            ev_s, ev_e = msg_events_map.get(seq, (None, None))
            content = m["content"] or ""
            preview = content if len(content) <= 120 else content[:120] + "…"
            nodes.append(
                {
                    "id": f"msg:{seq}",
                    "kind": "message",
                    "msg_seq": seq,
                    "label": f"#{seq}",
                    "preview": preview,
                    "captured_at": m["captured_at"].isoformat() if m["captured_at"] else None,
                    "dream_status": m["dream_status"],
                    "event_start": ev_s,
                    "event_end": ev_e,
                    "facets": {k: list(v) for k, v in sorted(msg_facets_map[seq].items())},
                }
            )
        for row in page_rows:
            doc = row["doc_path"]
            for seq in row["source_msg_seqs"] or []:
                if int(seq) in known_seqs:
                    edges.append(
                        {
                            "source": f"page:{doc}",
                            "target": f"msg:{int(seq)}",
                            "kind": "anchors_msg",
                            "rel_type": "anchors",
                        }
                    )

    facet_stats: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (dim, val), page_cnt in sorted(facet_page_counts.items(), key=lambda kv: (kv[0][0], -kv[1], kv[0][1])):
        facet_stats[dim].append({"val": val, "pages": page_cnt, "messages": mf_counts.get((dim, val), 0)})

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "total_pages": len(page_rows),
            "total_links": wiki_edge_count,
            "dangling_links": dangling_count,
            "isolated_pages": sum(1 for d in doc_paths if d not in connected_docs),
            "by_page_type": dict(by_type),
            "facets": dict(facet_stats),
        },
        "query": {
            "center": center,
            "depth": depth if center else None,
            "facet_filters": norm_facets,
            "include_facets": include_facets,
            "include_messages": include_messages,
        },
    }
