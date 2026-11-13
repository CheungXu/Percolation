"""执行环境追溯与复现：as_of 时钟、整理决策、side_effect 回放拦截、轨迹清理与 blob 回收、
暂存整理的单事务发布与失败隔离、plan/apply 与 reindex 等价、环境锚点。"""

from __future__ import annotations

import asyncio
import json
import subprocess
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import BaseModel

from agentkit import AgentSpec, RunContext, Trace, run_agent, tool
from agentkit.envfile import load_env_file
from agentkit.telemetry import TraceStore
from agentkit.tenancy import try_advisory_lock
from agentkit.testing import ScriptedChatClient, call_tool, reply
from percolation import env_anchor, memory_fs, retriever, tenants
from percolation.replay import anchor_warnings
from percolation.agents import dream
from percolation.capture import capture
from percolation.indexer import apply_sync, plan_sync
from percolation.memory_fs import changed_files, git_head
from percolation.services import Services
from percolation.wiki import parse_page

ROOT = Path(__file__).resolve().parents[2]
DB_ENV = load_env_file(ROOT / "config" / "db.env")
DERIVED_TABLES = {
    "wiki_pages": "doc_path, page_title, page_type, aliases, facets, chunk_count, source_msg_seqs",
    "page_facets": "doc_path, dim, val",
    "message_facets": "msg_seq, doc_path, dim, val",
    "message_events": "msg_seq, doc_path, event_start, event_end",
    "wiki_chunks": "doc_path, chunk_index, section_heading, facet_text, facets, content, content_hash, embedding::text",
    "wiki_links": "from_doc_path, to_target, to_doc_path, anchor_text, rel_type",
}

PAGE = """---
title: MIT Missing Semester
type: resource
aliases: [命令行课]
facets:
  domain: [学习]
---

## 课程进度
- [confirmed] {plan} [form:网站] [status:进行中] [@2026-11-15] [[belongs_to::cs-self-study]] [#msg_{seq}]
"""


# ---- 离线 ----


def test_decide_mode_uses_injected_as_of():
    as_of = datetime(2026, 11, 13, 12, tzinfo=UTC)
    state = {"last_defrag_at": as_of - timedelta(days=8), "created_at": as_of - timedelta(days=30)}
    mode, reasons = dream.decide_mode(state, 10, 180, 0, None, as_of=as_of)
    assert mode == "defrag" and reasons == ["interval:8d>=7d"]
    mode, reasons = dream.decide_mode(state, 10, 180, 0, None, as_of=as_of - timedelta(days=2))
    assert mode == "incremental" and reasons == []
    assert dream.decide_mode(state, 190, 180, 0, None, as_of=as_of - timedelta(days=2))[1] == ["memory_lines:190>180"]
    assert dream.decide_mode(state, 10, 180, 0, "defrag", as_of=as_of) == ("defrag", ["requested:defrag"])


def test_format_local_today_pins_to_as_of():
    # UTC 16:30 已经是上海次日 00:30
    assert retriever.format_local_today(datetime(2026, 11, 13, 16, 30, tzinfo=UTC)) == "2026-11-14（周六）"


def test_facet_distribution_from_staged_pages():
    pages = [
        parse_page("wiki/a.md", "---\ntitle: A\nfacets:\n  domain: [学习]\n---\n\n## x\n- [confirmed] 一 [#msg_1]\n", None),
        parse_page("wiki/b.md", "---\ntitle: B\nfacets:\n  domain: [学习, 编程]\n---\n\n## y\n- [confirmed] 二 [#msg_2]\n", None),
    ]
    assert dream.facet_distribution_lines(pages) == ["- domain=学习 · 2 页", "- domain=编程 · 1 页（孤立单页标签）"]


class Empty(BaseModel):
    pass


class Out(BaseModel):
    done: bool


SENT: list[str] = []


@tool(description="向外部发消息", tags=("side_effect",))
def notify(args: Empty, ctx):
    SENT.append("sent")
    return "ok"


def test_side_effect_tool_blocked_only_in_replay():
    spec = AgentSpec(name="t", model_slot="x", system_prompt="s", tools=(notify,), output_model=Out)
    SENT.clear()
    for replay in (False, True):
        chat = ScriptedChatClient([call_tool("notify"), reply('{"done": true}')])
        ctx = RunContext(replay=replay)
        asyncio.run(run_agent(spec, "go", ctx, chat=chat))
        tool_span = next(span for span in ctx.trace.spans if span.kind == "tool")
        assert tool_span.attributes.get("replay_blocked", False) is replay
    assert SENT == ["sent"]


def _saved_trace(store: TraceStore, tenant: str, shared: str, unique: str) -> str:
    trace = Trace("search", metadata={"tenant_id": tenant, "user_slug": f"e2e-{tenant}"})
    trace.root.set(system_hash=trace.asset(shared), unique_hash=trace.asset(unique))
    trace.root.payload["input"] = {"text": unique * 2}
    trace.finish("ok")
    store.save(trace)
    return trace.trace_id


def test_trace_purge_removes_tenant_and_sweeps_blobs(tmp_path):
    store = TraceStore(tmp_path, blob_threshold=1024)
    shared = "共享系统提示词" * 200
    a = _saved_trace(store, "tenant-a", shared, "A 独有的超长原文" * 300)
    b = _saved_trace(store, "tenant-b", shared, "B 独有的超长原文" * 300)
    blobs_before = len(list((tmp_path / "blobs").rglob("*.zst")))

    preview = store.purge(lambda row: row["tenant_id"] == "tenant-a", dry_run=True, blob_grace_seconds=0)
    assert preview["traces"] == 1 and preview["blobs_deleted"] == 2
    assert len(list((tmp_path / "blobs").rglob("*.zst"))) == blobs_before

    result = store.purge(lambda row: row["tenant_id"] == "tenant-a", blob_grace_seconds=0)
    assert result["traces"] == 1 and result["blobs_deleted"] == 2
    assert [row["trace_id"] for row in store.iter_index()] == [b]
    with pytest.raises(FileNotFoundError):
        store.find(a)
    restored = store.hydrate_assets(store.load(b))
    assert shared in restored["assets"].values()
    assert restored["spans"][0]["payload"]["input"]["text"].startswith("B 独有")


def test_env_digest_ignores_watermark():
    base = {"code": {"code_digest": "x"}, "config": {"models_json": "y"}, "db": {"as_of": "t1", "max_msg_seq": 1}}
    later = {**base, "db": {"as_of": "t2", "max_msg_seq": 9}}
    assert env_anchor.env_digest(base) == env_anchor.env_digest(later)
    assert env_anchor.env_digest(base) != env_anchor.env_digest({**base, "config": {"models_json": "z"}})
    code = env_anchor.code_env(ROOT)
    assert code["code_digest"] and code["migration"] == "004_workspace_head.sql"


def test_ensure_published_cases(tmp_path):
    main = memory_fs.open_workspace(tmp_path / "ws")
    base = git_head(main)

    def commit(text: str) -> str:
        (main.root / memory_fs.MEMORY_FILE).write_text(text, encoding="utf-8")
        memory_fs.git_commit(main, text)
        return git_head(main)

    published = commit("published")
    # 主工作区领先（人工提交）：不报错，交给调用方重新同步
    ahead = commit("manual edit")
    assert memory_fs.ensure_published(main, published) is False and git_head(main) == ahead
    # 主工作区落后（快进中断）：补快进，并清掉已并入的暂存分支
    subprocess.run(["git", "-C", str(main.root), "branch", "dream/r1", ahead], check=True)
    subprocess.run(["git", "-C", str(main.root), "reset", "-q", "--hard", base], check=True)
    assert memory_fs.ensure_published(main, ahead) is True and git_head(main) == ahead
    assert memory_fs.prune_merged_staging_branches(main) == ["dream/r1"]
    # 分叉或登记的版本不存在：要人工处理
    subprocess.run(["git", "-C", str(main.root), "reset", "-q", "--hard", base], check=True)
    commit("fork")
    with pytest.raises(RuntimeError, match="分叉"):
        memory_fs.ensure_published(main, ahead)
    with pytest.raises(RuntimeError, match="不存在"):
        memory_fs.ensure_published(main, "0" * 40)


def test_anchor_warnings():
    assert anchor_warnings({"workspace": {"git_clean": True}}) == []
    assert anchor_warnings({"workspace": {}}) == []
    assert "未提交改动" in anchor_warnings({"workspace": {"git_clean": False}})[0]
    assert "未能确认" in anchor_warnings({"workspace": {"git_clean": None}})[0]
    assert "不一致" in anchor_warnings({"workspace": {"workspace_mismatch": True, "git_head": "a", "workspace_head": "b"}})[0]


# ---- 隔离租户 + 真实数据库 ----


async def _snapshot(services: Services, user) -> dict[str, list]:
    out = {}
    async with services.tx(user) as conn:
        for table, columns in DERIVED_TABLES.items():
            rows = await (await conn.execute(f"SELECT {columns} FROM {table} ORDER BY {columns}")).fetchall()
            out[table] = [json.dumps(dict(row), ensure_ascii=False, sort_keys=True, default=str) for row in rows]
    return out


async def _count(services: Services, user, sql: str) -> int:
    async with services.tx(user) as conn:
        return (await (await conn.execute(sql)).fetchone())["n"]


def _archive_script(seq: int, plan: str) -> ScriptedChatClient:
    return ScriptedChatClient(
        [
            call_tool("write_file", {"path": "wiki/missing-semester.md", "content": PAGE.format(plan=plan, seq=seq)}),
            reply(json.dumps({"archived_msg_seqs": [seq], "files_changed": ["wiki/missing-semester.md"]})),
        ]
    )


@pytest.mark.skipif(not DB_ENV.get("MIGRATE_DATABASE_URL"), reason="没有数据库迁移配置")
def test_staged_dream_publish_failure_isolation_and_reindex(monkeypatch):
    async def main():
        owner_url = DB_ENV["MIGRATE_DATABASE_URL"]
        slug = f"e2e-unit-stage-{int(time.time() * 1000)}"
        await tenants.create_tenant(owner_url, slug)
        services = await Services.open()
        user = None
        try:
            user = await services.resolve_user(slug)
            main_ws = services.workspace(user)
            m1 = await capture(services, user, "MIT Missing Semester 周末刷完前两讲 https://missing.csail.mit.edu")
            seq = m1["msg_seq"]
            head0 = git_head(main_ws)

            # 1. 发布事务里注入失败：主工作区、六张派生表、原话状态都保持原样，暂存区与分支被清掉
            async def boom(*args, **kwargs):
                raise RuntimeError("注入失败")

            services.chat_overrides["dream_model"] = _archive_script(seq, "周末刷完前两讲")
            monkeypatch.setattr(dream, "_finalize", boom)
            failed = await dream.run_for_user(services, user, mode="incremental")
            monkeypatch.undo()
            assert failed.status == "failed" and "注入失败" in failed.error
            assert git_head(main_ws) == head0 and not changed_files(main_ws)
            assert not main_ws.resolve("wiki/missing-semester.md").exists()
            for table in DERIVED_TABLES:
                assert await _count(services, user, f"SELECT count(*) AS n FROM {table}") == 0, table
            assert await _count(services, user, "SELECT count(*) AS n FROM raw_messages WHERE dream_status = 'pending'") == 1
            assert not (services.settings.nas_root / "staging" / user.id / failed.run_id).exists()
            branches = subprocess.run(
                ["git", "-C", str(main_ws.root), "branch", "--list", "dream/*"], capture_output=True, text=True
            ).stdout
            assert branches.strip() == ""

            # 2. 正常整理：文件、索引、原话状态、workspace_head 一起发布，主工作区快进
            services.chat_overrides["dream_model"] = _archive_script(seq, "周末刷完前两讲")
            ok = await dream.run_for_user(services, user, mode="incremental")
            assert ok.status == "succeeded" and ok.archived == [seq], ok.error
            head1 = git_head(main_ws)
            assert head1 != head0 and main_ws.resolve("wiki/missing-semester.md").is_file()
            async with services.tx(user) as conn:
                state = await (await conn.execute("SELECT workspace_head FROM users WHERE id = %s", (user.id,))).fetchone()
            assert state["workspace_head"] == head1
            assert await _count(services, user, "SELECT count(*) AS n FROM wiki_pages") == 1
            assert await _count(services, user, "SELECT count(*) AS n FROM message_events") == 1
            assert ok.index["dangling"] == ["wiki/missing-semester.md -> [[belongs_to::cs-self-study]]"]

            # 3. 根 span 带执行环境锚点：工作区干净、水位里的 pending 就是这条、决策是 incremental
            trace = services.trace_store.load(ok.trace_id)
            root = next(span for span in trace["spans"] if span["parent_id"] is None)
            env = root["attributes"]["env"]
            assert env["workspace"]["git_clean"] is True and env["workspace"]["workspace_mismatch"] is False
            assert env["db"]["pending_msg_seqs"] == [seq] and env["db"]["max_msg_seq"] == seq
            assert env["decision"]["mode"] == "incremental" and env["decision"]["reasons"] == ["requested:incremental"]
            index_row = next(row for row in services.trace_store.iter_index() if row["trace_id"] == ok.trace_id)
            assert index_row["env_digest"] == root["attributes"]["env_digest"]
            assert index_row["env_watermark"]["workspace_head"] == head0[:12]

            # 4. plan_sync + apply_sync 与整理发布结果逐行等价，且幂等
            published = await _snapshot(services, user)
            plan = await plan_sync(services, user, main_ws)
            assert plan.embedded == 0
            async with services.tx(user) as conn:
                again = await apply_sync(conn, user, plan)
            assert again.docs_rewritten == [] and again.docs_deleted == []
            assert await _snapshot(services, user) == published

            # 5. reindex 与整理共用锁；拿不到锁时不动索引
            async with try_advisory_lock(services.pool, dream.dream_lock_key(user)) as acquired:
                assert acquired
                assert await dream.reindex(services, user) is None

            # 6. 人工改动：reindex 先提交并发布，workspace_head 跟上新提交
            main_ws.write_atomic("wiki/missing-semester.md", PAGE.format(plan="周末刷完前三讲", seq=seq))
            report = await dream.reindex(services, user)
            head2 = git_head(main_ws)
            assert report is not None and report.docs_rewritten == ["wiki/missing-semester.md"]
            assert head2 != head1 and not changed_files(main_ws)
            async with services.tx(user) as conn:
                state = await (await conn.execute("SELECT workspace_head FROM users WHERE id = %s", (user.id,))).fetchone()
                content = await (await conn.execute("SELECT string_agg(content, '') AS c FROM wiki_chunks")).fetchone()
            assert state["workspace_head"] == head2 and "前三讲" in content["c"]

            # 7. 快进中断后的修复：主工作区回退一步，下一次准备阶段按 workspace_head 补快进
            subprocess.run(["git", "-C", str(main_ws.root), "reset", "-q", "--hard", head1], check=True)
            _, repaired = await dream.prepare_workspace(services, user)
            assert git_head(main_ws) == head2 and repaired is None
            # 检索侧同样能补：拿得到整理锁就快进；整理正在跑（锁被占）就跳过
            subprocess.run(["git", "-C", str(main_ws.root), "reset", "-q", "--hard", head1], check=True)
            async with try_advisory_lock(services.pool, dream.dream_lock_key(user)) as held:
                assert held and await dream.repair_fast_forward(services, user) is False
            assert git_head(main_ws) == head1
            assert await dream.repair_fast_forward(services, user) is True and git_head(main_ws) == head2
        finally:
            await services.close()
            await tenants.drop_tenant(owner_url, slug, services.settings.nas_root)
            if user is not None:
                services.trace_store.purge(lambda row: row.get("tenant_id") == user.id)

    asyncio.run(main())
