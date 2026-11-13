"""按轨迹里的执行环境锚点复现一次检索或整理。

流程（每次重跑都建一个全新的 replay 租户，互不污染）：
1. 读原轨迹根 span 的 env 锚点；没有锚点（锚点上线前的轨迹）直接拒绝。
2. 建 replay-* 租户；把原工作区 clone 过来并 reset 到锚点记录的提交。
3. 用建表账号在一个事务里复制三张事实表到水位：检索日志（as_of 之前，id 重映射）、
   原话（max_msg_seq 之前，保留序号/批次/录入时间，锚点时仍 pending 的恢复为 pending）、用户状态计数。
4. 派生表不复制：按工作区文件重新 plan_sync/apply_sync，向量按 content_hash 复用原租户的，不重复调接口。
5. 以原入参重跑（检索：原问题与澄清；整理：原模式），注入原 as_of；轨迹打 replay_of 标记，
   RunContext.replay=True 让 side_effect 工具被拦截。
6. 对比原运行与每次重跑，输出报告；默认清理 replay 租户（轨迹保留作证据）。
"""

from __future__ import annotations

import dataclasses
import difflib
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from agentkit.envfile import load_env_file
from agentkit.tenancy import create_pool
from percolation.indexer import apply_sync, plan_sync
from percolation.memory_fs import GC_TIMEOUT_SECONDS, GIT_TIMEOUT_SECONDS, _git, git_head
from percolation.services import Services, UserRef
from percolation.tenants import REPLAY_PREFIX, create_tenant, drop_tenant

REPLAYABLE = {"search", "dream"}
SEARCH_FIELDS = ("outcome", "route_path", "facet_filters", "date_range", "verified_msg_seqs", "hit_doc_paths")
DREAM_FIELDS = ("status", "mode", "archived", "skipped", "still_pending", "files_changed")


class ReplayError(RuntimeError):
    pass


# ---- 读原轨迹 ----


def root_span(data: dict[str, Any]) -> dict[str, Any]:
    return next(span for span in data["spans"] if span.get("parent_id") is None)


def fingerprints(data: dict[str, Any]) -> dict[str, str]:
    return {
        span["name"]: span["attributes"].get("spec_fingerprint")
        for span in data["spans"]
        if span["kind"] == "agent" and span["attributes"].get("spec_fingerprint")
    }


def load_original(services: Services, trace_id: str) -> dict[str, Any]:
    data = services.trace_store.load(trace_id, hydrate=True)
    if data["name"] not in REPLAYABLE:
        raise ReplayError(f"只支持复现 {sorted(REPLAYABLE)} 轨迹，这条是 {data['name']}")
    if data["metadata"].get("replay_of"):
        raise ReplayError(f"这条本身是回放运行（replay_of={data['metadata']['replay_of']}），请复现原轨迹")
    root = root_span(data)
    if not isinstance(root["attributes"].get("env"), dict):
        raise ReplayError("这条轨迹没有执行环境锚点（锚点上线之前产生），无法复现")
    if not root.get("payload", {}).get("input"):
        raise ReplayError("轨迹没有记录原始入参（level=summary 时 payload 会被丢弃），无法复现")
    return data


# ---- 建环境 ----


def clone_workspace(source: Path, target: Path, rev: str) -> None:
    if target.exists():
        raise ReplayError(f"目标工作区已存在：{target}")
    if not (source / ".git").exists():
        raise ReplayError(f"原工作区不存在：{source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "clone", "-q", "--no-hardlinks", str(source), str(target)],
        check=True,
        capture_output=True,
        timeout=GC_TIMEOUT_SECONDS,
    )
    try:
        _git(target, "reset", "-q", "--hard", rev)
    except subprocess.CalledProcessError as exc:
        raise ReplayError(f"原工作区里找不到提交 {rev[:12]}（可能已被 gc）：{exc.stderr.strip()}") from exc
    _git(target, "remote", "remove", "origin")


async def copy_watermark(owner_url: str, source_id: str, target_id: str, env: dict[str, Any], head: str | None) -> dict:
    """单事务复制三张事实表到锚点水位。返回复制计数，供报告核对。"""
    db = env["db"]
    as_of = db["as_of"]
    pending = set(db.get("pending_msg_seqs") or [])
    max_seq = db.get("max_msg_seq") or 0
    state = db.get("user_state", {})
    pool = await create_pool(owner_url, max_size=1)
    try:
        async with pool.connection() as conn, conn.transaction():
            logs = await (
                await conn.execute(
                    """
                    SELECT * FROM search_logs WHERE user_id = %s AND created_at <= %s::timestamptz
                    ORDER BY created_at, id
                    """,
                    (source_id, as_of),
                )
            ).fetchall()
            id_map: dict[str, str] = {}
            for log in logs:
                row = await (
                    await conn.execute(
                        """
                        INSERT INTO search_logs (
                          user_id, query_text, route_path, outcome, rewritten_queries, memory_clues_used,
                          cache_files_probed, cache_hit_entries, hit_doc_paths, verified_msg_seqs,
                          latency_ms, token_usage, created_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s::jsonb, %s)
                        RETURNING id::text AS id
                        """,
                        (
                            target_id, log["query_text"], log["route_path"], log["outcome"], log["rewritten_queries"],
                            log["memory_clues_used"], log["cache_files_probed"], json.dumps(log["cache_hit_entries"]),
                            log["hit_doc_paths"], log["verified_msg_seqs"], log["latency_ms"],
                            json.dumps(log["token_usage"]) if log["token_usage"] is not None else None, log["created_at"],
                        ),
                    )
                ).fetchone()
                id_map[str(log["id"])] = row["id"]

            messages = await (
                await conn.execute(
                    "SELECT * FROM raw_messages WHERE user_id = %s AND msg_seq <= %s ORDER BY msg_seq",
                    (source_id, max_seq),
                )
            ).fetchall()
            unmapped_replies = 0
            for msg in messages:
                reply = str(msg["reply_to_search_id"]) if msg["reply_to_search_id"] else None
                if reply and reply not in id_map:
                    unmapped_replies += 1
                is_pending = msg["msg_seq"] in pending
                await conn.execute(
                    """
                    INSERT INTO raw_messages (
                      user_id, msg_seq, batch_id, source_kind, reply_to_search_id, content, client_meta,
                      dream_status, captured_at, dreamed_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                    """,
                    (
                        target_id, msg["msg_seq"], msg["batch_id"], msg["source_kind"], id_map.get(reply) if reply else None,
                        msg["content"], json.dumps(msg["client_meta"]),
                        "pending" if is_pending else msg["dream_status"], msg["captured_at"],
                        None if is_pending else msg["dreamed_at"],
                    ),
                )
            await conn.execute(
                """
                UPDATE users SET
                  next_msg_seq = %s, pending_msg_count = %s, pending_cache_hits = %s, memory_line_count = %s,
                  last_dream_at = %s::timestamptz, last_defrag_at = %s::timestamptz, dirty_since = %s::timestamptz,
                  created_at = %s::timestamptz, workspace_head = %s
                WHERE id = %s
                """,
                (
                    max_seq + 1, len(pending), state.get("pending_cache_hits") or 0, state.get("memory_line_count") or 0,
                    state.get("last_dream_at"), state.get("last_defrag_at"), state.get("dirty_since"),
                    state.get("created_at"), head, target_id,
                ),
            )
            vectors = {
                row["content_hash"]: row["embedding"]
                for row in await (
                    await conn.execute(
                        "SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding FROM wiki_chunks WHERE user_id = %s",
                        (source_id,),
                    )
                ).fetchall()
            }
    finally:
        await pool.close()
    return {
        "search_logs": len(logs),
        "raw_messages": len(messages),
        "pending": len(pending),
        "unmapped_replies": unmapped_replies,
        "vectors": vectors,
    }


def replay_slug(original: dict[str, Any], run_index: int) -> str:
    return f"{REPLAY_PREFIX}{original['trace_id'][:8]}-{int(time.time())}-r{run_index}"


async def build_replay_tenant(
    services: Services, owner_url: str, original: dict[str, Any], slug: str
) -> tuple[UserRef, dict[str, Any]]:
    env = root_span(original)["attributes"]["env"]
    source_id = original["metadata"]["tenant_id"]
    workspace = env.get("workspace", {})
    head = workspace.get("git_head") or workspace.get("workspace_head")
    if not head:
        raise ReplayError("锚点里没有工作区版本")
    target_id = await create_tenant(owner_url, slug)
    nas_root = services.settings.nas_root
    clone_workspace(nas_root / "workspaces" / source_id, nas_root / "workspaces" / target_id, head)
    copied = await copy_watermark(owner_url, source_id, target_id, env, head)
    user = await services.resolve_user(slug)
    ws = services.workspace(user)
    vector_cache = copied.pop("vectors")
    known = set(vector_cache)
    plan = await plan_sync(services, user, ws, vector_cache)
    async with services.tx(user) as conn:
        report = await apply_sync(conn, user, plan)
    copied.update(
        slug=slug,
        user_id=target_id,
        workspace_head=head,
        docs=report.docs,
        chunks=report.chunks,
        embedded_fresh=len(set(plan.vectors) - known),
    )
    return user, copied


# ---- 重跑 ----


async def rerun(services: Services, user: UserRef, original: dict[str, Any], run_index: int) -> Any:
    from percolation.agents import dream, search

    root = root_span(original)
    env = root["attributes"]["env"]
    as_of = datetime.fromisoformat(env["db"]["as_of"])
    tagged = dataclasses.replace(
        services,
        trace_metadata={"replay_of": original["trace_id"], "replay_run": run_index, "replay_source_tenant": original["metadata"]["tenant_id"]},
    )
    inputs = root["payload"]["input"]
    if original["name"] == "search":
        return await search.ask(tagged, user, inputs["query"], clarification=inputs.get("clarification"), as_of=as_of)
    # 按原入参 requested_mode 重跑（自动模式保持 None，让 decide_mode 按 as_of 重新判定并核对是否漂移）
    mode = inputs["requested_mode"] if "requested_mode" in inputs else (env.get("decision") or {}).get("mode")
    return await dream.run_for_user(tagged, user, mode=mode, as_of=as_of)


# ---- 对比 ----


def _flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            out.update(_flatten(item, f"{prefix}.{key}" if prefix else key))
        return out
    return {prefix: value}


def env_diff(original_env: dict[str, Any], replay_env: dict[str, Any]) -> list[dict[str, Any]]:
    """代码/依赖/配置三类坐标逐项比较；水位不比（replay 租户的水位本来就该和原锚点相同，单独核对）。"""
    diffs = []
    for section in ("code", "config"):
        left = _flatten(original_env.get(section) or {})
        right = _flatten(replay_env.get(section) or {})
        for key in sorted(set(left) | set(right)):
            if left.get(key) != right.get(key):
                diffs.append({"key": f"{section}.{key}", "original": left.get(key), "replay": right.get(key)})
    return diffs


def watermark_check(original_env: dict[str, Any], replay_env: dict[str, Any]) -> dict[str, bool]:
    a, b = original_env.get("db", {}), replay_env.get("db", {})
    return {
        "as_of": a.get("as_of") == b.get("as_of"),
        "max_msg_seq": a.get("max_msg_seq") == b.get("max_msg_seq"),
        "pending_msg_seqs": a.get("pending_msg_seqs") == b.get("pending_msg_seqs"),
        "search_logs_count": a.get("search_logs_count") == b.get("search_logs_count"),
    }


def _file_at(root: Path, rev: str | None, path: str) -> str | None:
    if not rev:
        return None
    try:
        result = subprocess.run(
            ["git", "--no-optional-locks", "-C", str(root), "show", f"{rev}:{path}"],
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return None
    return result.stdout if result.returncode == 0 else None


def file_diffs(source_root: Path, original_commit: str | None, replay_root: Path, files: list[str]) -> list[dict[str, Any]]:
    out = []
    replay_head = git_head(replay_root)
    for path in sorted(set(files)):
        left = _file_at(source_root, original_commit, path) or ""
        right = _file_at(replay_root, replay_head, path) or ""
        if left == right:
            out.append({"file": path, "same": True})
            continue
        diff = list(difflib.unified_diff(left.splitlines(), right.splitlines(), lineterm="", n=0))
        added = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
        removed = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
        out.append({"file": path, "same": False, "added": added, "removed": removed})
    return out


def summarize(name: str, output: dict[str, Any], trace: dict[str, Any] | None) -> dict[str, Any]:
    fields = SEARCH_FIELDS if name == "search" else DREAM_FIELDS
    summary = {key: output.get(key) for key in fields}
    if name == "search":
        dr = summary.get("date_range")
        summary["date_range"] = list(dr) if isinstance(dr, (list, tuple)) else [None, None]
        summary["answer"] = (output.get("answer") or "")[:300]
    else:
        decision = ((root_span(trace)["attributes"].get("env") or {}).get("decision") or {}) if trace else {}
        summary["decision_reasons"] = decision.get("reasons")
        summary["promotions"] = sorted(m.get("entry_key", "") for m in output.get("promotions") or [])
        index = output.get("index") or {}
        summary["index"] = {
            key: (len(index[key]) if isinstance(index.get(key), list) else index.get(key))
            for key in ("docs", "chunks", "links", "facets_count", "events_count", "dangling")
        }
    summary["cost_cny"] = trace["cost"]["total"] if trace else output.get("cost_cny")
    summary["duration_ms"] = trace["duration_ms"] if trace else output.get("latency_ms")
    summary["fingerprints"] = fingerprints(trace) if trace else {}
    return summary


def compare(original: dict[str, Any], replay: dict[str, Any]) -> dict[str, bool]:
    keys = [key for key in original if key not in {"cost_cny", "duration_ms", "answer"}]
    return {key: original.get(key) == replay.get(key) for key in keys}


def old_code_hint(env: dict[str, Any], current: dict[str, Any], repo_root: Path) -> str | None:
    """代码摘要不同才提示：同一提交但工作树有改动时，提交号相同而摘要不同。"""
    code = env.get("code") or {}
    commit = code.get("code_commit")
    if not commit or code.get("code_digest") == current.get("code_digest"):
        return None
    dirty = "（原运行时代码有未提交改动，用提交只能近似还原）" if code.get("code_dirty") else ""
    target = f"/tmp/percolation-{commit[:8]}"
    return (
        f"原运行代码提交 {commit[:12]}（摘要 {code.get('code_digest')}），当前摘要 {current.get('code_digest')}{dirty}。"
        f"如需用原代码复现：\n"
        f"  git -C {repo_root} worktree add {target} {commit}\n"
        f"  install -m 600 {repo_root}/config/*.env {target}/config/\n"
        f"  cd {target} && {repo_root}/code/.venv/bin/python script/trace_cli.py reproduce <trace_id>"
    )


def anchor_warnings(env: dict[str, Any]) -> list[str]:
    """锚点里能看出“现场没法完整还原”的情况，报告开头直接说明。"""
    ws = env.get("workspace") or {}
    warnings = []
    if ws.get("git_clean") is False:
        warnings.append("原运行时工作区有未提交改动，复现用的是当时最近一次提交，文件内容可能与现场不同")
    elif "git_clean" in ws and ws["git_clean"] is None:
        warnings.append("原运行时未能确认工作区是否干净，复现用的是当时最近一次提交")
    if ws.get("workspace_mismatch"):
        warnings.append(
            f"原运行时主工作区 {str(ws.get('git_head'))[:12]} 与已发布索引 {str(ws.get('workspace_head'))[:12]} 不一致，"
            "复现按工作区文件重建索引，索引会与现场不同"
        )
    return warnings


async def reproduce(services: Services, trace_id: str, *, runs: int = 3, keep: bool = False) -> dict[str, Any]:
    from percolation.env_anchor import code_env

    original = load_original(services, trace_id)
    owner_url = load_env_file(services.settings.repo_root / "config" / "db.env").get("MIGRATE_DATABASE_URL")
    if not owner_url:
        raise ReplayError("config/db.env 缺少 MIGRATE_DATABASE_URL，无法建 replay 租户")
    name = original["name"]
    root = root_span(original)
    env = root["attributes"]["env"]
    original_output = root["payload"].get("output") or {}
    baseline = summarize(name, original_output, original)
    source_root = services.settings.nas_root / "workspaces" / original["metadata"]["tenant_id"]

    report: dict[str, Any] = {
        "trace_id": original["trace_id"],
        "name": name,
        "input": root["payload"]["input"],
        "as_of": env["db"]["as_of"],
        "original": baseline,
        "warnings": anchor_warnings(env),
        "runs": [],
    }
    tenants: list[str] = []
    try:
        for index in range(1, runs + 1):
            slug = replay_slug(original, index)
            tenants.append(slug)
            user, built = await build_replay_tenant(services, owner_url, original, slug)
            outcome = await rerun(services, user, original, index)
            output = outcome.as_dict()
            replay_trace = services.trace_store.load(output["trace_id"], hydrate=True) if output.get("trace_id") else None
            replay_env = root_span(replay_trace)["attributes"].get("env", {}) if replay_trace else {}
            summary = summarize(name, output, replay_trace)
            run: dict[str, Any] = {
                "run": index,
                "tenant": user.slug,
                "trace_id": output.get("trace_id"),
                "setup": built,
                "summary": summary,
                "same": compare(baseline, summary),
                "watermark_match": watermark_check(env, replay_env),
                "replay_blocked_tools": sum(
                    1 for span in (replay_trace or {}).get("spans", []) if span["attributes"].get("replay_blocked")
                ),
            }
            if name == "dream":
                run["file_diffs"] = file_diffs(
                    source_root,
                    original_output.get("commit"),
                    services.settings.nas_root / user.workspace_rel_path,
                    [*(original_output.get("files_changed") or []), *(output.get("files_changed") or [])],
                )
            report["runs"].append(run)
            if index == 1:
                report["env_diff"] = env_diff(env, replay_env)
    finally:
        if not keep:
            for slug in tenants:
                await drop_tenant(owner_url, slug, services.settings.nas_root)
        report["kept_tenants"] = tenants if keep else []
    compared = [key for key in baseline if key not in {"cost_cny", "duration_ms", "answer"}]
    report["stability"] = {key: sum(run["same"].get(key, False) for run in report["runs"]) for key in compared}
    report["old_code_hint"] = old_code_hint(env, code_env(services.settings.repo_root.resolve()), services.settings.repo_root)
    return report
