"""离线与隔离租户测试：RoutePlan 维度/日期路由、sync_wiki 派生同步、第四路召回与异构拓扑图组装。"""

from __future__ import annotations

import asyncio
import json
import shutil
import time
from pathlib import Path

import pytest

from agentkit import RunContext, run_agent
from agentkit.envfile import load_env_file
from agentkit.tenancy import create_pool
from agentkit.testing import ScriptedChatClient, reply
from percolation import graph, retriever
from percolation.agents.dream import filter_promotable_stats
from percolation.agents.search import RoutePlan, router_spec
from percolation.capture import capture
from percolation.indexer import sync_wiki
from percolation.services import Services

ROOT = Path(__file__).resolve().parents[2]
DB_ENV = load_env_file(ROOT / "config" / "db.env")


def test_parse_facet_specs_and_chinese_aliases():
    specs = ["domain=学习,编程", "形态:网站", "status=进行中"]
    assert graph.parse_facet_specs(specs) == {
        "domain": ["学习", "编程"],
        "form": ["网站"],
        "status": ["进行中"],
    }


def test_filter_promotable_stats_skips_already_promoted():
    hit_stats = [
        {"file": "MEMORY_CACHE/slang.md", "entry_key": "雕牌屏", "hits": 3},
        {"file": "MEMORY_CACHE/slang.md", "entry_key": "蹲", "hits": 2},
        {"file": "MEMORY_CACHE/slang.md", "entry_key": "已删词条", "hits": 4},
    ]
    memory_md = "# 热区\n- 雕牌屏：技嘉 AORUS FO27Q3 [#msg_3]\n"
    slang_md = "# 暗语\n- 蹲：等降价再买 [confirmed] [#msg_1]\n"
    promotable = filter_promotable_stats(hit_stats, memory_md, [slang_md])
    assert [s["entry_key"] for s in promotable] == ["蹲"]


def test_router_plan_parses_facets_and_date_range():
    scripted = ScriptedChatClient(
        [
            reply(
                json.dumps(
                    {
                        "queries": ["学习网站", "课程"],
                        "facet_filters": {"domain": ["学习"], "form": ["网站"]},
                        "date_from": "2026-11-01",
                        "date_to": "2026-11-30",
                        "time_field": "event",
                        "unknown_terms": [],
                        "memory_clues_used": [],
                        "clarify_now": False,
                        "clarify_question": "",
                    },
                    ensure_ascii=False,
                )
            )
        ]
    )
    res = asyncio.run(run_agent(router_spec(), "11月安排的学习网站有哪些", RunContext(), chat=scripted))
    plan: RoutePlan = res.output
    assert plan.facet_filters == {"domain": ["学习"], "form": ["网站"]}
    assert plan.date_from == "2026-11-01" and plan.date_to == "2026-11-30"
    assert plan.time_field == "event"


@pytest.mark.skipif(not DB_ENV.get("MIGRATE_DATABASE_URL"), reason="没有数据库迁移配置")
def test_multidim_sync_fourth_route_and_topology_graph():
    async def main():
        owner_url = DB_ENV["MIGRATE_DATABASE_URL"]
        slug = f"e2e-unit-graph-{int(time.time() * 1000)}"
        owner_pool = await create_pool(owner_url, max_size=1)
        services = await Services.open()
        user_id = None
        workspace_dir = None
        try:
            async with owner_pool.connection() as conn:
                await conn.execute("INSERT INTO users (external_slug) VALUES (%s)", (slug,))
            user = await services.resolve_user(slug)
            user_id = user.id
            ws = services.workspace(user)
            workspace_dir = ws.root

            m1 = await capture(services, user, "MIT Missing Semester 周末刷完前两讲 https://missing.csail.mit.edu")
            m2 = await capture(services, user, "Anki 用来背命令行快捷键卡片")

            ws.write_atomic(
                "wiki/cs-self-study.md",
                """---
title: 计算机自学路线
type: topic
aliases: [CS自学]
facets:
  domain: [学习]
---

## 核心工具
- [confirmed] 用 Anki 记忆卡片巩固命令行 [form:工具软件] [status:在用] [[related::missing-semester]] [#msg_"""
                + f"{m2['msg_seq']}]\n",
            )
            ws.write_atomic(
                "wiki/missing-semester.md",
                """---
title: MIT Missing Semester
type: resource
aliases: [シェル课程, 命令行课]
facets:
  domain: [学习]
---

## 课程背景
- [confirmed] MIT 面向计算机学生的工具链公开课 [#msg_"""
                + f"{m2['msg_seq']}]\n\n"
                + """## 课程进度
- [confirmed] 周末刷完前两讲 [form:网站] [topic:命令行] [status:进行中] [@2026-11-15] [[belongs_to::cs-self-study|计算机自学]] [[dangling-page|待建笔记]] [#msg_"""
                + f"{m1['msg_seq']}]\n",
            )

            report = await sync_wiki(services, user, ws)
            assert report.docs == 2
            assert report.facets_count >= 5
            assert report.events_count == 1
            assert len(report.dangling) == 1

            # 1. 切片级第四路纯维度召回：missing-semester.md 有两个小节，form=网站 只命中「课程进度」小节，不捞出「课程背景」
            by_form = await retriever.search(services, user, [], facet_filters={"form": ["网站"]})
            assert [h.heading for h in by_form.hits if h.kind == "wiki"] == ["课程进度"]
            assert m1["msg_seq"] in by_form.msg_seqs
            # 2. 两页之间同时存在反向 related 与正向 belongs_to 时，一跳邻居确定性优先选 belongs_to
            cs_neighbor = next(n for n in by_form.neighbors if n["doc_path"] == "wiki/cs-self-study.md")
            assert cs_neighbor["rel_type"] == "belongs_to" and cs_neighbor["direction"] == "out"

            # 3. 明确事件日期硬筛：带关键词 "命令行" 查 2026-11-15 时，没有该事件日期的 m2（已归档）被剔除
            async with services.tx(user) as conn:
                await conn.execute("UPDATE raw_messages SET dream_status = 'archived' WHERE msg_seq IN (%s, %s)", (m1["msg_seq"], m2["msg_seq"]))
            by_date_strict = await retriever.search(
                services, user, ["命令行"], date_from="2026-11-15", date_to="2026-11-15", time_field="event"
            )
            assert by_date_strict.date_filtered is True
            assert m1["msg_seq"] in by_date_strict.msg_seqs
            assert m2["msg_seq"] not in by_date_strict.msg_seqs

            # 4. 异步 pending 兜底：新录入尚未归档的 pending 日程，无论是否与查询词字面撞词，查事件日期都不会被硬筛误杀
            m3_pending = await capture(services, user, "下周六上午带小黑打疫苗")
            by_date_with_pending = await retriever.search(
                services, user, ["小黑", "疫苗"], date_from="2026-11-15", date_to="2026-11-15", time_field="event"
            )
            assert m3_pending["msg_seq"] in by_date_with_pending.msg_seqs
            by_generic_schedule = await retriever.search(
                services, user, ["这周六有什么安排", "周末日程"], date_from="2026-11-21", date_to="2026-11-21", time_field="event"
            )
            assert m3_pending["msg_seq"] in by_generic_schedule.msg_seqs

            # 4b. 路由算偏日期且当天碰巧有别的无关已归档记录时，不会把高分词法正解删光，而是回退保留并置 date_filtered=False
            m4_chore = await capture(services, user, "周六去超市买两瓶洗衣液")
            ws.write_atomic(
                "wiki/chores.md",
                "---\ntitle: 家务采购\ntype: topic\nfacets:\n  domain: [家庭]\n---\n\n## 采购\n"
                f"- [confirmed] 周六买两瓶洗衣液 [@2026-11-14] [#msg_{m4_chore['msg_seq']}]\n",
            )
            await sync_wiki(services, user, ws)
            async with services.tx(user) as conn:
                await conn.execute("UPDATE raw_messages SET dream_status = 'archived' WHERE msg_seq = %s", (m4_chore["msg_seq"],))
            wrong_date_fallback = await retriever.search(
                services, user, ["MIT 公开课"], date_from="2026-11-14", date_to="2026-11-14", time_field="event"
            )
            assert wrong_date_fallback.date_filtered is False
            assert m1["msg_seq"] in wrong_date_fallback.msg_seqs

            # 5. 纯日期查空区间时返回空，不会把无关 pending 消息混进来
            empty_date = await retriever.search(
                services, user, [], date_from="2026-12-30", date_to="2026-12-31", time_field="event"
            )
            assert empty_date.hits == []

            # 全图拓扑验证：同一节点同时连接 domain:学习 与 form:网站 两个虚拟维度枢纽
            full_graph = await graph.build_graph(services, user, include_facets=True)
            node_ids = {n["id"] for n in full_graph["nodes"]}
            assert "page:wiki/missing-semester.md" in node_ids
            assert "facet:domain:学习" in node_ids
            assert "facet:form:网站" in node_ids
            assert "dangling:dangling-page" in node_ids

            edge_triples = {(e["source"], e["rel_type"], e["target"]) for e in full_graph["edges"]}
            assert ("page:wiki/missing-semester.md", "domain", "facet:domain:学习") in edge_triples
            assert ("page:wiki/missing-semester.md", "form", "facet:form:网站") in edge_triples
            assert ("page:wiki/missing-semester.md", "belongs_to", "page:wiki/cs-self-study.md") in edge_triples

            # 多维交集过滤：domain=学习 AND form=网站 只保留 missing-semester.md
            filtered = await graph.build_graph(
                services, user, facet_filters={"domain": ["学习"], "form": ["网站"]}
            )
            assert [n["doc_path"] for n in filtered["nodes"] if n["kind"] == "page"] == ["wiki/missing-semester.md"]

            # center + depth=1 递归邻域且默认展开原话节点
            sub = await graph.build_graph(services, user, center="missing-semester", depth=1)
            sub_pages = {n["doc_path"] for n in sub["nodes"] if n["kind"] == "page"}
            assert sub_pages == {"wiki/missing-semester.md", "wiki/cs-self-study.md"}
            assert any(n["kind"] == "message" and n["msg_seq"] == m1["msg_seq"] for n in sub["nodes"])

            # 维度总览接口
            overview = await graph.build_facets_overview(services, user)
            assert any(item["val"] == "学习" and item["pages"] == 2 for item in overview["counts"]["domain"])

            # 跨租户 RLS 隔离：default 用户看不到任何新增的 wiki_pages / page_facets / message_facets
            default_user = await services.resolve_user(services.settings.default_user_slug)
            default_graph = await graph.build_graph(services, default_user)
            assert not any(n.get("doc_path") == "wiki/missing-semester.md" for n in default_graph["nodes"])
        finally:
            await services.close()
            if user_id:
                async with owner_pool.connection() as conn:
                    async with conn.transaction():
                        await conn.execute("ALTER TABLE raw_messages DISABLE TRIGGER raw_messages_guard")
                        await conn.execute("DELETE FROM raw_messages WHERE user_id = %s", (user_id,))
                        await conn.execute("ALTER TABLE raw_messages ENABLE TRIGGER raw_messages_guard")
                        await conn.execute("DELETE FROM users WHERE id = %s", (user_id,))
            await owner_pool.close()
            if workspace_dir and workspace_dir.is_dir() and user_id and user_id in workspace_dir.name:
                shutil.rmtree(workspace_dir)

    asyncio.run(main())
