#!/usr/bin/env python3
"""端到端真机验收。用 owner 账号建一个临时测试租户，跑完 7 个场景后清理。

  code/.venv/bin/python script/e2e_percolation.py [--keep]

场景：
1. 连发录入后，未整理就能直接查到（pending 原话轨道）。
2. 增量整理生成主题页、向量、链接、git 提交。
3. 人工编辑候选区经 reindex 发布；暗语被沙箱探查命中 2 次，下一次整理晋升进热区，之后走主路径直达。
4. 未知指代追问 → 用户澄清 → 固化；热区不含推测。
5. 多维正交归档与检索、拓扑图；跨租户互相不可见。
6. 整理期间并发检索只看已发布版本；发布事务失败时主工作区与派生表不变。
7. 按执行环境锚点复现候选区兜底检索、维度检索与整理，各重跑 2 次并对比。

模型输出有随机性，脚本逐项打印 PASS/FAIL，不在第一处失败时中止。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "code"))

from agentkit.envfile import load_env_file  # noqa: E402
from percolation import graph, replay, tenants  # noqa: E402
from percolation.agents import dream, search  # noqa: E402
from percolation.capture import capture  # noqa: E402
from percolation.memory_fs import MEMORY_FILE, changed_files, git_head  # noqa: E402
from percolation.services import Services  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    RESULTS.append((name, bool(ok), str(detail)[:300]))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}  {str(detail)[:300]}", flush=True)


def show(label: str, value: object) -> None:
    print(f"--- {label}\n{json.dumps(value, ensure_ascii=False, indent=2, default=str)[:3000]}", flush=True)


async def drop_tenant(owner_url: str, slug: str, nas_root: Path) -> None:
    user_id = await tenants.drop_tenant(owner_url, slug, nas_root)
    if user_id:
        print(f"已清理测试租户 {slug}（{user_id}）；轨迹保留，需要时 trace_cli.py purge --tenant {user_id}")


async def scenarios(services: Services, slug: str) -> None:
    user = await services.resolve_user(slug)
    ws = services.workspace(user)

    print("\n===== 场景 1：连发录入 + 未整理直查")
    m1 = await capture(services, user, "cforce 15.6 oled 999蹲")
    m2 = await capture(services, user, "支架要能承重2kg的那种，放书房")
    check("连发两条共用批次", m1["batch_id"] == m2["batch_id"], f"#{m1['msg_seq']} #{m2['msg_seq']}")
    r = await search.ask(services, user, "之前想买的那个便携屏幕，打算多少钱入手？")
    show("ask 1", r.as_dict())
    check("未整理就能答出 999", r.outcome == "answered" and "999" in r.answer, r.answer)
    check("核验到原话 #1", m1["msg_seq"] in r.verified_msg_seqs, r.verified_msg_seqs)

    print("\n===== 场景 2：增量整理")
    m3 = await capture(services, user, "AORUS FO27Q3 到手价 4299，等双十一再看")
    d = await dream.run_for_user(services, user)
    show("dream 1", d.as_dict())
    check("整理成功", d.status == "succeeded", d.error or d.mode)
    check("三条原话已归档", set(d.archived) >= {m1["msg_seq"], m2["msg_seq"], m3["msg_seq"]}, d.archived)
    check("生成主题页", any(p.startswith("wiki/") for p in d.files_changed), d.files_changed)
    check("索引写入切片和向量", d.index.get("chunks", 0) > 0 and d.index.get("embedded", 0) > 0, d.index)
    check("git 提交", bool(d.commit), d.commit)
    async with services.tx(user) as conn:
        state = await (await conn.execute("SELECT dirty_since, pending_msg_count FROM users WHERE id = %s", (user.id,))).fetchone()
    check("脏标记已清", state["dirty_since"] is None and state["pending_msg_count"] == 0, dict(state))

    print("\n===== 场景 3：候选区静默穿透 + 晋升")
    existing = ws.read_text("MEMORY_CACHE/slang.md") or "# 个人暗语\n"
    ws.write_atomic(
        "MEMORY_CACHE/slang.md",
        existing.rstrip("\n")
        + f"\n- 雕牌屏：技嘉 AORUS FO27Q3 显示器（雕是技嘉 AORUS 的鹰标）[confirmed] [#msg_{m3['msg_seq']}]\n",
    )
    await dream.reindex(services, user)
    check("人工编辑经 reindex 提交发布", not changed_files(ws), changed_files(ws))
    routes = []
    cache_traces = []
    for attempt in range(2):
        r = await search.ask(services, user, "雕牌屏现在什么价来着")
        show(f"ask 雕牌屏 {attempt + 1}", r.as_dict())
        routes.append(r.route_path)
        cache_traces.append(r.trace_id)
        check(f"第 {attempt + 1} 次经候选区答出 4299", r.route_path == "cache_fallback" and r.outcome == "answered" and "4299" in r.answer, f"{r.route_path} {r.answer}")
    d = await dream.run_for_user(services, user)
    show("dream 2", d.as_dict())
    memory = ws.read_text(MEMORY_FILE)
    check("雕牌屏晋升进 MEMORY.md", "雕牌屏" in memory, memory[-400:])
    r = await search.ask(services, user, "雕牌屏现在什么价来着")
    show("ask 雕牌屏 3", r.as_dict())
    check("晋升后走主路径直达", r.route_path == "primary_direct" and "4299" in r.answer, f"{r.route_path} {r.answer}")

    print("\n===== 场景 4：追问澄清闭环 + 隔离")
    r = await search.ask(services, user, "小黑那件事后来定了哪天？")
    show("ask 小黑", r.as_dict())
    check("未知指代触发追问或如实未找到", r.outcome in {"clarify_asked", "not_found"}, f"{r.outcome} {r.clarify_question}")
    captured, r2 = await search.clarify(services, user, r.search_id, "小黑是我家的猫，那件事是带它去打疫苗，约在下周六上午")
    show("clarify", {"captured": captured, "search": r2.as_dict()})
    check("澄清作为 clarification 入库", captured["source_kind"] == "clarification", captured)
    check("澄清后能回答", r2.outcome == "answered" and "周六" in r2.answer, r2.answer)
    d = await dream.run_for_user(services, user)
    show("dream 3", d.as_dict())
    check("澄清已归档", captured["msg_seq"] in d.archived, d.archived)
    fixed = "\n".join(path.read_text(encoding="utf-8") for path in [*ws.files("MEMORY_CACHE"), ws.resolve(MEMORY_FILE)])
    check("小黑写进固定记忆区", "小黑" in fixed, "")
    check("MEMORY.md 不含推测", "[inferred]" not in ws.read_text(MEMORY_FILE), "")

    print("\n===== 场景 5：多维正交归档、正交维度检索与异构拓扑图谱")
    m_learn = await capture(
        services,
        user,
        "MIT Missing Semester 命令行公开课主页 https://missing.csail.mit.edu ，打算下周日刷完前两讲，顺便在书房新显示器上练手",
    )
    d_multi = await dream.run_for_user(services, user)
    show("dream multidim", d_multi.as_dict())
    check("多维原话已归档", m_learn["msg_seq"] in d_multi.archived, d_multi.archived)

    async with services.tx(user) as conn:
        wp_cnt = (await (await conn.execute("SELECT count(*) AS n FROM wiki_pages")).fetchone())["n"]
        pf_dims = {
            (r["dim"], r["val"])
            for r in await (await conn.execute("SELECT dim, val FROM page_facets")).fetchall()
        }
        mf_dims = {
            (r["dim"], r["val"])
            for r in await (
                await conn.execute("SELECT dim, val FROM message_facets WHERE msg_seq = %s", (m_learn["msg_seq"],))
            ).fetchall()
        }
        me_cnt = (
            await (
                await conn.execute("SELECT count(*) AS n FROM message_events WHERE msg_seq = %s", (m_learn["msg_seq"],))
            ).fetchone()
        )["n"]
        rel_types = [
            r["rel_type"] for r in await (await conn.execute("SELECT DISTINCT rel_type FROM wiki_links")).fetchall()
        ]
    check("wiki_pages 与 page_facets 已派生", wp_cnt >= 2 and ("domain", "学习") in pf_dims and ("form", "网站") in pf_dims, pf_dims)
    check(
        "message_facets 与事件时间已派生",
        ("domain", "学习") in mf_dims and ("form", "网站") in mf_dims and me_cnt >= 1,
        {"mf": mf_dims, "events": me_cnt, "rel_types": rel_types},
    )

    r_domain = await search.ask(services, user, "我记过什么学习类的课程资料？")
    show("ask 维度A(学习)", r_domain.as_dict())
    check(
        "从主题维度(学习)检索命中同一原话",
        r_domain.outcome == "answered" and "missing" in r_domain.answer.lower() and m_learn["msg_seq"] in r_domain.verified_msg_seqs,
        r_domain.answer,
    )

    r_form = await search.ask(services, user, "我之前收藏过什么网站？")
    show("ask 维度B(网站)", r_form.as_dict())
    check(
        "从形态维度(网站)正交检索命中同一原话",
        r_form.outcome == "answered" and "missing" in r_form.answer.lower() and m_learn["msg_seq"] in r_form.verified_msg_seqs,
        r_form.answer,
    )

    topo = await graph.build_graph(services, user, include_facets=True)
    show("graph stats", topo["stats"])
    by_src: dict[str, set[str]] = {}
    for edge in topo["edges"]:
        if edge["kind"] == "has_facet":
            by_src.setdefault(edge["source"], set()).add(edge["target"])
    dual_hub_pages = [
        src for src, targets in by_src.items() if "facet:domain:学习" in targets and "facet:form:网站" in targets
    ]
    check("拓扑图同一节点同时挂接学习与网站两个维度枢纽", len(dual_hub_pages) >= 1, dual_hub_pages)

    default = await services.resolve_user(services.settings.default_user_slug)
    async with services.tx(default) as conn:
        leaked = await (await conn.execute("SELECT count(*) AS n FROM raw_messages WHERE content ILIKE '%%cforce%%'")).fetchone()
        leaked_chunks = await (await conn.execute("SELECT count(*) AS n FROM wiki_chunks WHERE user_id = %s", (user.id,))).fetchone()
        leaked_pages = await (await conn.execute("SELECT count(*) AS n FROM wiki_pages WHERE user_id = %s", (user.id,))).fetchone()
        leaked_facets = await (await conn.execute("SELECT count(*) AS n FROM page_facets WHERE user_id = %s", (user.id,))).fetchone()
    check(
        "默认租户看不到测试租户原话、主题页与多维表",
        leaked["n"] == 0 and leaked_chunks["n"] == 0 and leaked_pages["n"] == 0 and leaked_facets["n"] == 0,
        f"{leaked['n']} {leaked_chunks['n']} {leaked_pages['n']} {leaked_facets['n']}",
    )
    async with services.pool.connection() as conn:
        bare = await (await conn.execute("SELECT count(*) AS n FROM raw_messages")).fetchone()
        bare_pages = await (await conn.execute("SELECT count(*) AS n FROM wiki_pages")).fetchone()
    check("不设租户时一行也看不到", bare["n"] == 0 and bare_pages["n"] == 0, f"{bare['n']} {bare_pages['n']}")

    await scenario_concurrency(services, user, ws)
    await scenario_reproduce(services, cache_traces[0], r_domain.trace_id, d_multi.trace_id)


async def derived_snapshot(services: Services, user) -> dict[str, int]:
    async with services.tx(user) as conn:
        return {
            table: (await (await conn.execute(f"SELECT count(*) AS n FROM {table}")).fetchone())["n"]
            for table in ("wiki_pages", "page_facets", "message_facets", "message_events", "wiki_chunks", "wiki_links")
        } | {
            "content": (await (await conn.execute("SELECT md5(string_agg(content_hash, ',' ORDER BY doc_path, chunk_index)) AS h FROM wiki_chunks")).fetchone())["h"]
        }


async def scenario_concurrency(services: Services, user, ws) -> None:
    print("\n===== 场景 6：整理期间检索只看已发布版本；发布前失败主工作区与索引不变")
    head_before = git_head(ws)
    m_new = await capture(services, user, "周三晚上和老王约了羽毛球，奥体中心 3 号场")
    task = asyncio.create_task(dream.run_for_user(services, user))
    staging_root = services.settings.nas_root / "staging" / user.id
    for _ in range(120):
        if task.done() or (staging_root.is_dir() and any(staging_root.iterdir())):
            break
        await asyncio.sleep(0.5)
    during = await search.ask(services, user, "我之前收藏过什么网站？")
    trace = services.trace_store.load(during.trace_id)
    env = next(s for s in trace["spans"] if s["parent_id"] is None)["attributes"]["env"]
    overlapped = not task.done()
    check(
        "整理进行中检索：主工作区未动、锚点版本与已发布一致",
        overlapped and git_head(ws) == head_before and env["workspace"]["git_head"] == head_before
        and env["workspace"]["workspace_mismatch"] is False and during.outcome == "answered",
        {"overlapped": overlapped, "env_ws": env["workspace"], "outcome": during.outcome},
    )
    d = await task
    async with services.tx(user) as conn:
        state = await (await conn.execute("SELECT workspace_head FROM users WHERE id = %s", (user.id,))).fetchone()
    check(
        "发布后主工作区快进且 workspace_head 一致",
        d.status == "succeeded" and m_new["msg_seq"] in d.archived and git_head(ws) == state["workspace_head"] != head_before
        and not changed_files(ws),
        {"status": d.status, "archived": d.archived, "head": git_head(ws), "db": state["workspace_head"]},
    )

    m_fail = await capture(services, user, "下个月想去杭州看一次秋天的西湖")
    head_mid = git_head(ws)
    before = await derived_snapshot(services, user)
    original_finalize = dream._finalize

    async def boom(*args, **kwargs):
        raise RuntimeError("e2e 注入：发布事务失败")

    dream._finalize = boom
    try:
        failed = await dream.run_for_user(services, user)
    finally:
        dream._finalize = original_finalize
    after = await derived_snapshot(services, user)
    async with services.tx(user) as conn:
        status = (await (await conn.execute("SELECT dream_status FROM raw_messages WHERE msg_seq = %s", (m_fail["msg_seq"],))).fetchone())["dream_status"]
    check(
        "发布前失败：主工作区、六张派生表、原话状态均不变",
        failed.status == "failed" and git_head(ws) == head_mid and not changed_files(ws) and before == after and status == "pending"
        and not any(staging_root.iterdir()),
        {"status": failed.status, "error": failed.error, "before": before, "after": after, "raw": status},
    )


async def scenario_reproduce(services: Services, cache_trace: str, facet_trace: str, dream_trace: str) -> None:
    print("\n===== 场景 7：按执行环境锚点复现（候选区兜底检索、维度检索、整理各 2 次）")
    for label, trace_id in (("候选区兜底检索", cache_trace), ("维度检索", facet_trace), ("整理", dream_trace)):
        report = await replay.reproduce(services, trace_id, runs=2)
        runs = report["runs"]
        show(f"reproduce {label}", {k: v for k, v in report.items() if k != "runs"} | {"runs": [{k: r[k] for k in ("same", "watermark_match", "setup")} for r in runs]})
        watermark_ok = all(all(r["watermark_match"].values()) for r in runs)
        check(f"复现{label}：两次重跑水位与原锚点一致、环境无差异", len(runs) == 2 and watermark_ok and not report["env_diff"], report["env_diff"])
        if report["name"] == "search":
            hits = sum(r["same"]["outcome"] and r["same"]["route_path"] for r in runs)
            check(f"复现{label}：至少一次结果与路由与原运行一致", hits >= 1, [r["summary"]["answer"][:80] for r in runs])
        else:
            same = sum(r["same"]["status"] and r["same"]["mode"] and r["same"]["archived"] for r in runs)
            check(f"复现{label}：两次重跑模式与归档集合都与原运行一致", same == 2, [r["summary"] for r in runs])
    owner_url = load_env_file(ROOT / "config" / "db.env")["MIGRATE_DATABASE_URL"]
    from agentkit.tenancy import create_pool

    pool = await create_pool(owner_url, max_size=1)
    try:
        async with pool.connection() as conn:
            left = (await (await conn.execute("SELECT count(*) AS n FROM users WHERE external_slug LIKE 'replay-%%'")).fetchone())["n"]
    finally:
        await pool.close()
    replays = [row for row in services.trace_store.iter_index() if row["metadata"].get("replay_of") in {cache_trace, facet_trace, dream_trace}]
    check("复现结束：replay 租户已清理，回放轨迹带 replay_of 保留", left == 0 and len(replays) >= 6, {"left": left, "replay_traces": len(replays)})


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep", action="store_true", help="保留测试租户数据，便于人工查看")
    parser.add_argument("--drop", metavar="SLUG", help="只清理指定的测试租户（必须以 e2e- 开头）")
    args = parser.parse_args()
    owner_url = load_env_file(ROOT / "config" / "db.env")["MIGRATE_DATABASE_URL"]
    if args.drop:
        if not tenants.is_disposable(args.drop):
            raise SystemExit("只能清理 e2e- / replay- 开头的临时租户")
        nas_root = Path(load_env_file(ROOT / "config" / "storage.env").get("NAS_ROOT_DIR", "/mnt/percolation"))
        await drop_tenant(owner_url, args.drop, nas_root)
        return
    slug = f"e2e-{int(time.time())}"
    services = await Services.open()
    started = time.monotonic()
    try:
        await tenants.create_tenant(owner_url, slug)
        print(f"测试租户：{slug}")
        await scenarios(services, slug)
    finally:
        await services.close()
        if not args.keep:
            await drop_tenant(owner_url, slug, services.settings.nas_root)
    passed = sum(ok for _, ok, _ in RESULTS)
    print(f"\n合计 {passed}/{len(RESULTS)} 通过，用时 {int(time.monotonic() - started)} 秒")
    for name, ok, detail in RESULTS:
        if not ok:
            print(f"  FAIL {name}: {detail}")


if __name__ == "__main__":
    asyncio.run(main())
