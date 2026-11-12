#!/usr/bin/env python3
"""Percolation 命令行。用 code/.venv 的解释器运行：

  code/.venv/bin/python script/percolation_cli.py capture "cforce 15.6 oled 999蹲"
  code/.venv/bin/python script/percolation_cli.py ask "之前想买的那个屏幕多少钱"
  code/.venv/bin/python script/percolation_cli.py clarify <search_id> "老张是供应商张伟"
  code/.venv/bin/python script/percolation_cli.py dream [--mode defrag] [--all]
  code/.venv/bin/python script/percolation_cli.py graph [--center DOC] [--depth 2] [--facet domain=学习] [--json]
  code/.venv/bin/python script/percolation_cli.py facets
  code/.venv/bin/python script/percolation_cli.py status
  code/.venv/bin/python script/percolation_cli.py reindex

--user 指定租户 slug，缺省为 config/storage.env 的 DEFAULT_USER_SLUG。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "code"))

from percolation import graph  # noqa: E402
from percolation.agents import dream, search  # noqa: E402
from percolation.capture import capture  # noqa: E402
from percolation.indexer import sync_wiki  # noqa: E402
from percolation.services import Services  # noqa: E402


def dump(value) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


def print_graph_human(data: dict) -> None:
    stats = data["stats"]
    print(
        f"主题页 {stats['total_pages']} · 链接边 {stats['total_links']}（悬空 {stats['dangling_links']}）"
        f" · 孤立页 {stats['isolated_pages']} · 节点总数 {len(data['nodes'])} · 边总数 {len(data['edges'])}"
    )
    if stats["facets"]:
        print("\n[维度分布]")
        for dim, items in stats["facets"].items():
            summary = "、".join(f"{it['val']}({it['pages']}页/{it['messages']}条)" for it in items)
            print(f"  {dim}: {summary}")
    pages = [n for n in data["nodes"] if n["kind"] == "page"]
    if pages:
        print("\n[页面节点]")
        for p in pages:
            print(f"  - {p['doc_path']} [{p['page_type']}] {p['title']} · 切片 {p['chunk_count']} · 原话 {p['msg_count']}")
    wiki_edges = [e for e in data["edges"] if e["kind"] == "wiki_link"]
    if wiki_edges:
        print("\n[页面关系边]")
        for e in wiki_edges:
            flag = " (悬空)" if e.get("dangling") else ""
            print(f"  - {e['source']} --[{e['rel_type']}]--> {e['target']}{flag}")


async def status(services: Services, user) -> dict:
    async with services.tx(user) as conn:
        state = await (await conn.execute("SELECT * FROM users WHERE id = %s", (user.id,))).fetchone()
        counts = await (
            await conn.execute("SELECT dream_status, count(*) AS n FROM raw_messages GROUP BY 1 ORDER BY 1")
        ).fetchall()
        chunks = await (await conn.execute("SELECT count(*) AS n, count(DISTINCT doc_path) AS docs FROM wiki_chunks")).fetchone()
        pages_cnt = await (await conn.execute("SELECT count(*) AS pages FROM wiki_pages")).fetchone()
        facets_cnt = await (
            await conn.execute("SELECT count(DISTINCT dim || ':' || val) AS distinct_facets FROM page_facets")
        ).fetchone()
        searches = await (
            await conn.execute(
                "SELECT route_path, outcome, count(*) AS n FROM search_logs GROUP BY 1, 2 ORDER BY 1, 2"
            )
        ).fetchall()
        runs = await (
            await conn.execute(
                "SELECT run_mode, status, started_at, finished_at, error_message FROM dream_runs ORDER BY started_at DESC LIMIT 5"
            )
        ).fetchall()
    return {
        "user": {"slug": user.slug, "id": user.id},
        "state": {
            k: state[k]
            for k in ("dirty_since", "pending_msg_count", "pending_cache_hits", "memory_line_count", "last_dream_at", "last_defrag_at")
        },
        "raw_messages": {row["dream_status"]: row["n"] for row in counts},
        "wiki": {**dict(chunks), **dict(pages_cnt), **dict(facets_cnt)},
        "searches": [dict(row) for row in searches],
        "recent_dream_runs": [dict(row) for row in runs],
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description="Percolation CLI")
    parser.add_argument("--user", default=None, help="租户 slug")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("capture")
    p.add_argument("content")
    p = sub.add_parser("ask")
    p.add_argument("query")
    p = sub.add_parser("clarify")
    p.add_argument("search_id")
    p.add_argument("content")
    p = sub.add_parser("dream")
    p.add_argument("--mode", choices=["incremental", "defrag"], default=None)
    p.add_argument("--all", action="store_true", help="处理全部脏租户（定时任务用）")

    p = sub.add_parser("graph")
    p.add_argument("--center", default=None, help="中心页面路径、文件名或标题")
    p.add_argument("--depth", type=int, default=1, help="子图递归跳数（1..3）")
    p.add_argument("--facet", action="append", default=None, help="多维过滤，如 domain=学习 或 form:网站，可多次指定")
    p.add_argument("--no-facets", action="store_true", help="不生成虚拟维度枢纽节点")
    p.add_argument("--messages", dest="include_messages", action="store_true", default=None, help="展开原话节点")
    p.add_argument("--no-messages", dest="include_messages", action="store_false", help="不展开原话节点")
    p.add_argument("--json", action="store_true", help="输出完整 JSON 拓扑")

    sub.add_parser("facets")
    sub.add_parser("status")
    sub.add_parser("reindex")
    args = parser.parse_args()

    services = await Services.open()
    try:
        if args.command == "dream" and args.all:
            dump([outcome.as_dict() for outcome in await dream.run_dirty_queue(services, mode=args.mode)])
            return
        user = await services.resolve_user(args.user)
        if args.command == "capture":
            dump(await capture(services, user, args.content))
        elif args.command == "ask":
            dump((await search.ask(services, user, args.query)).as_dict())
        elif args.command == "clarify":
            captured, outcome = await search.clarify(services, user, args.search_id, args.content)
            dump({"captured": captured, "search": outcome.as_dict()})
        elif args.command == "dream":
            dump((await dream.run_for_user(services, user, mode=args.mode)).as_dict())
        elif args.command == "graph":
            data = await graph.build_graph(
                services,
                user,
                include_facets=not args.no_facets,
                include_messages=args.include_messages,
                center=args.center,
                depth=args.depth,
                facet_filters=graph.parse_facet_specs(args.facet),
            )
            if args.json:
                dump(data)
            else:
                print_graph_human(data)
        elif args.command == "facets":
            dump(await graph.build_facets_overview(services, user))
        elif args.command == "status":
            dump(await status(services, user))
        elif args.command == "reindex":
            dump((await sync_wiki(services, user, services.workspace(user))).as_dict())
    finally:
        await services.close()


if __name__ == "__main__":
    asyncio.run(main())
