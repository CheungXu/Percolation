"""Dreaming Agent：夜间自底向上整理。

0. 从脏队列取租户，加单租户咨询锁，判定节奏（incremental / defrag），登记 dream_runs。
1. 归档：dream_model 把 pending 原话按连发批次并入主题页和候选区。
2. 索引：确定性同步 wiki_chunks / wiki_links。
3. 升降级：按候选区命中统计晋升热区，热区超水位或 defrag 时下沉、合并、修链。
4. 收尾：单事务推进原话状态、清脏标记、记账；工作区 git 提交。

任一步失败：丢弃未提交的文件改动、按文件重建索引、记 failed，原话保持 pending 下次重试。
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from functools import cache

from pydantic import BaseModel, Field

from agentkit import AgentSpec, Trace, run_agent
from agentkit.tenancy import try_advisory_lock
from percolation import retriever
from percolation.agents import SKILLS_DIR, load_prompt
from percolation.indexer import load_pages, sync_wiki
from percolation.memory_fs import (
    CACHE_DIR,
    MEMORY_FILE,
    WIKI_DIR,
    changed_files,
    git_commit,
    git_discard,
    line_count,
)
from percolation.services import Services, UserRef
from percolation.tools import FETCH_RAW, HYBRID_SEARCH, memory_write_tools
from percolation.wiki import MSG_ANCHOR_RE, effective_facets_catalog, format_facets_summary, format_facets_taxonomy

ARCHIVE_BATCH_MESSAGES = 40
PROMOTION_WINDOW_DAYS = 14
PROMOTION_MIN_HITS = 2
DEFRAG_INTERVAL_DAYS = 7
DEFRAG_DANGLING_LINKS = 5
ENTRY_KEY_RE = re.compile(r"^\s*[-*]\s*([^:：\n]+?)\s*[:：]")


def extract_entry_keys(text: str) -> set[str]:
    """提取 MEMORY.md 或 MEMORY_CACHE/*.md 中 `- 键：解释` 的条目键集合。"""
    keys: set[str] = set()
    for line in (text or "").splitlines():
        match = ENTRY_KEY_RE.match(line)
        if not match:
            continue
        raw = match.group(1).strip().strip("\"'“”‘’`")
        # 兼容键后附带括号备注（如 `"那件事"（2026-11 语境）`），同时保留原键与去括号主名
        if raw:
            keys.add(raw)
            base = re.split(r"[（(]", raw, maxsplit=1)[0].strip().strip("\"'“”‘’`")
            if base:
                keys.add(base)
    return keys


def filter_promotable_stats(hit_stats: list[dict], memory_text: str, cache_texts: list[str]) -> list[dict]:
    """排除已经晋升进 MEMORY.md 热区或已不在 MEMORY_CACHE/ 中的滞后命中统计。"""
    hot_keys = extract_entry_keys(memory_text)
    cache_keys: set[str] = set()
    for text in cache_texts:
        cache_keys.update(extract_entry_keys(text))
    filtered: list[dict] = []
    for stat in hit_stats:
        key = str(stat.get("entry_key") or "").strip().strip("\"'“”‘’`")
        if not key or key in hot_keys or key not in cache_keys:
            continue
        filtered.append(stat)
    return filtered


class ArchiveReport(BaseModel):
    archived_msg_seqs: list[int] = Field(default_factory=list)
    skipped_msg_seqs: list[int] = Field(default_factory=list)
    files_changed: list[str] = Field(default_factory=list)
    notes: str = ""


class TierMove(BaseModel):
    entry_key: str
    file: str = ""


class TieringReport(BaseModel):
    promotions: list[TierMove] = Field(default_factory=list)
    demotions: list[TierMove] = Field(default_factory=list)
    merged_pages: list[str] = Field(default_factory=list)
    fixed_links: int = 0
    notes: str = ""


@cache
def archive_spec(memory_limit: int) -> AgentSpec:
    return AgentSpec(
        name="dream_archive",
        model_slot="dream_model",
        system_prompt=load_prompt("dream_archive"),
        tools=(HYBRID_SEARCH, FETCH_RAW, *memory_write_tools(memory_limit, write_prefixes=(f"{WIKI_DIR}/", f"{CACHE_DIR}/"))),
        output_model=ArchiveReport,
        max_turns=30,
        skills_dir=SKILLS_DIR,
    )


@cache
def tiering_spec(memory_limit: int, soft_limit: int, defrag: bool) -> AgentSpec:
    prefixes = (MEMORY_FILE, f"{CACHE_DIR}/") + ((f"{WIKI_DIR}/",) if defrag else ())
    return AgentSpec(
        name="dream_tiering_defrag" if defrag else "dream_tiering",
        model_slot="dream_model",
        system_prompt=load_prompt("dream_tiering", memory_limit=memory_limit, soft_limit=soft_limit),
        tools=tuple(memory_write_tools(memory_limit, write_prefixes=prefixes, allow_delete=defrag)),
        output_model=TieringReport,
        max_turns=30,
        skills_dir=SKILLS_DIR,
    )


@dataclass
class DreamOutcome:
    user_id: str
    status: str
    mode: str = ""
    run_id: str | None = None
    archived: list[int] = field(default_factory=list)
    skipped: list[int] = field(default_factory=list)
    still_pending: list[int] = field(default_factory=list)
    files_changed: list[str] = field(default_factory=list)
    promotions: list[dict] = field(default_factory=list)
    demotions: list[dict] = field(default_factory=list)
    index: dict = field(default_factory=dict)
    commit: str | None = None
    error: str | None = None
    usage: dict = field(default_factory=dict)
    cost_cny: float = 0.0
    trace_id: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


def _section(title: str, body: str) -> str:
    return f"## {title}\n{body.strip() or '（无）'}"


def _wiki_index_text(ws) -> str:
    pages, _ = load_pages(ws)
    if not pages:
        return "（还没有主题页）"
    lines = []
    for page in pages:
        sections = "、".join(dict.fromkeys(chunk.section_heading or "概述" for chunk in page.chunks))
        aliases = f" · 别名：{'、'.join(page.aliases)}" if page.aliases else ""
        facets = format_facets_summary(page.facets)
        facet_part = f" · 维度：{facets}" if facets else ""
        lines.append(f"- {page.doc_path} [{page.page_type}] · {page.title}{aliases}{facet_part} · 小节：{sections}")
    return "\n".join(lines)


def _anchored_seqs(ws) -> set[int]:
    seqs: set[int] = set()
    for path in [*ws.files(WIKI_DIR, "**/*.md"), *ws.files(CACHE_DIR, "**/*.md"), ws.resolve(MEMORY_FILE)]:
        if path.is_file():
            seqs.update(int(value) for value in MSG_ANCHOR_RE.findall(path.read_text(encoding="utf-8", errors="replace")))
    return seqs


def _batches(rows: list[dict], limit: int) -> list[list[dict]]:
    """按连发批次切分，每组不超过 limit 条，且不把同一批次拆开（单批次超长除外）。"""
    groups: list[list[dict]] = []
    current: list[dict] = []
    for batch_id in dict.fromkeys(row["batch_id"] for row in rows):
        members = [row for row in rows if row["batch_id"] == batch_id]
        if current and len(current) + len(members) > limit:
            groups.append(current)
            current = []
        current.extend(members)
    if current:
        groups.append(current)
    return groups


async def _catalog_with_existing_facets(services: Services, user: UserRef, ws) -> dict:
    """将数据库已有的高频维度值（尤其 topic）合并进词表，引导增量归档优先复用已有词。"""
    catalog = effective_facets_catalog(services.settings.facets, ws.read_text(f"{CACHE_DIR}/facets.md"))
    async with services.tx(user) as conn:
        rows = await (
            await conn.execute(
                """
                SELECT dim, val, count(DISTINCT doc_path)::int AS pages
                FROM page_facets GROUP BY dim, val ORDER BY pages DESC, val LIMIT 60
                """
            )
        ).fetchall()
    dims = catalog.setdefault("dimensions", {})
    for row in rows:
        entry = dims.setdefault(row["dim"], {"label": row["dim"], "values": []})
        values = entry.setdefault("values", [])
        if row["val"] not in values and len(values) < 25:
            values.append(row["val"])
    return catalog


async def _facet_distribution_lines(services: Services, user: UserRef) -> list[str]:
    async with services.tx(user) as conn:
        rows = await (
            await conn.execute(
                """
                SELECT dim, val, count(DISTINCT doc_path)::int AS pages
                FROM page_facets GROUP BY dim, val ORDER BY dim, pages DESC, val
                """
            )
        ).fetchall()
    return [
        f"- {r['dim']}={r['val']} · {r['pages']} 页" + ("（孤立单页标签）" if r["pages"] == 1 else "")
        for r in rows
    ]


async def _cache_hit_stats(services: Services, user: UserRef) -> list[dict]:
    async with services.tx(user) as conn:
        rows = await (
            await conn.execute(
                """
                SELECT mode() WITHIN GROUP (
                         ORDER BY regexp_replace(hit->>'file', '^(/workspace/)?(MEMORY_CACHE/)?', 'MEMORY_CACHE/')
                       ) AS file,
                       hit->>'entry_key' AS entry_key,
                       max(hit->>'clue') AS clue, count(*) AS hits, max(s.created_at) AS last_hit
                FROM search_logs s, jsonb_array_elements(s.cache_hit_entries) AS hit
                WHERE s.route_path = 'cache_fallback' AND s.outcome = 'answered'
                  AND s.created_at >= now() - %s::interval
                GROUP BY 2 ORDER BY hits DESC, last_hit DESC
                """,
                (timedelta(days=PROMOTION_WINDOW_DAYS),),
            )
        ).fetchall()
    return [dict(row) for row in rows]


async def _memory_clue_usage(services: Services, user: UserRef) -> list[dict]:
    async with services.tx(user) as conn:
        rows = await (
            await conn.execute(
                """
                SELECT clue, count(*) AS uses, max(created_at) AS last_used
                FROM search_logs, unnest(memory_clues_used) AS clue
                WHERE created_at >= now() - interval '30 days'
                GROUP BY 1 ORDER BY uses DESC LIMIT 100
                """
            )
        ).fetchall()
    return [dict(row) for row in rows]


def choose_mode(state: dict, memory_lines: int, soft_limit: int, dangling: int, requested: str | None) -> str:
    if requested in {"incremental", "defrag"}:
        return requested
    reference = state["last_defrag_at"] or state["created_at"]
    if memory_lines > soft_limit or dangling >= DEFRAG_DANGLING_LINKS:
        return "defrag"
    if reference and datetime.now(UTC) - reference >= timedelta(days=DEFRAG_INTERVAL_DAYS):
        return "defrag"
    return "incremental"


async def _traced_sync(services: Services, user: UserRef, ws, trace: Trace):
    """索引同步包一层 span：embedding 用量和改动的文档都记在上面。"""
    with trace.span("sync_wiki", kind="chain") as span:
        report = await sync_wiki(services, user, ws)
        span.set(**report.as_dict())
    return report


async def run_for_user(services: Services, user: UserRef, *, mode: str | None = None) -> DreamOutcome:
    async with try_advisory_lock(services.pool, f"percolation:dream:{user.id}") as acquired:
        if not acquired:
            return DreamOutcome(user_id=user.id, status="locked")
        return await _run_locked(services, user, mode)


async def _run_locked(services: Services, user: UserRef, requested_mode: str | None) -> DreamOutcome:
    trace = services.new_trace("dream", user, requested_mode=requested_mode)
    trace.root.payload["input"] = {"requested_mode": requested_mode}
    try:
        with trace.activate():
            outcome = await _dream(services, user, trace, requested_mode)
    except Exception as exc:
        error = f"{type(exc).__name__}: {services.models.redact(str(exc))}"[:2000]
        services.save_trace(user, trace, {"error": error}, status="failed")
        raise
    outcome.cost_cny = round(trace.cost, 6)
    outcome.trace_id = trace.trace_id
    trace.root.payload["output"] = asdict(outcome)
    services.save_trace(
        user, trace, {"run_id": outcome.run_id, "mode": outcome.mode, "error": outcome.error}, status=outcome.status
    )
    return outcome


async def _dream(services: Services, user: UserRef, trace: Trace, requested_mode: str | None) -> DreamOutcome:
    settings = services.settings
    ws = services.workspace(user)
    ctx = services.context(user, trace, ws)
    memory_limit, soft_limit = settings.memory_line_limit, settings.memory_soft_limit

    async with services.tx(user) as conn:
        state = await (await conn.execute("SELECT * FROM users WHERE id = %s", (user.id,))).fetchone()
        pending = [
            dict(row)
            for row in await (
                await conn.execute(
                    """
                    SELECT r.msg_seq, r.batch_id::text AS batch_id, r.source_kind, r.content, r.captured_at,
                           r.dream_status, s.query_text AS reply_to_query
                    FROM raw_messages r LEFT JOIN search_logs s ON s.id = r.reply_to_search_id
                    WHERE r.dream_status = 'pending' ORDER BY r.msg_seq LIMIT 400
                    """
                )
            ).fetchall()
        ]
        dangling = (await (await conn.execute("SELECT count(*) AS n FROM wiki_links WHERE to_doc_path IS NULL")).fetchone())["n"]
    memory_init = ws.read_text(MEMORY_FILE)
    memory_lines = line_count(memory_init)
    mode = choose_mode(state, memory_lines, soft_limit, dangling, requested_mode)
    hit_stats = await _cache_hit_stats(services, user)
    cache_texts = [
        p.read_text(encoding="utf-8", errors="replace")
        for p in ws.files(CACHE_DIR, "**/*.md")
        if p.name != "facets.md"
    ]
    promotable = filter_promotable_stats(hit_stats, memory_init, cache_texts)
    candidates = [stat for stat in promotable if stat["hits"] >= PROMOTION_MIN_HITS]
    needs_tiering = bool(candidates) or memory_lines > soft_limit or mode == "defrag"

    if not pending and not needs_tiering:
        await _finalize(services, user, None, mode, [], [], memory_lines, ArchiveReport(), TieringReport(), [], trace, defrag=False)
        return DreamOutcome(user_id=user.id, status="noop", mode=mode)

    seqs = [row["msg_seq"] for row in pending]
    async with services.tx(user) as conn:
        run = await (
            await conn.execute(
                """
                INSERT INTO dream_runs (user_id, run_mode, status, msg_seq_from, msg_seq_to)
                VALUES (%s, %s, 'running', %s, %s) RETURNING id::text AS id
                """,
                (user.id, mode, min(seqs) if seqs else None, max(seqs) if seqs else None),
            )
        ).fetchone()
    run_id = run["id"]
    trace.event("dream_start", run_id=run_id, mode=mode, pending=len(pending), candidates=len(candidates))

    try:
        archive = ArchiveReport()
        memory = memory_init
        catalog = await _catalog_with_existing_facets(services, user, ws)
        taxonomy_text = format_facets_taxonomy(catalog)
        for group in _batches(pending, ARCHIVE_BATCH_MESSAGES):
            prompt = "\n\n".join(
                [
                    _section("当前日期", retriever.format_local_today()),
                    _section("受控维度词表", taxonomy_text),
                    _section("热区记忆 MEMORY.md", memory),
                    _section("现有主题页", _wiki_index_text(ws)),
                    _section("候选缓存区文件", "\n".join(ws.rel(p) for p in ws.files(CACHE_DIR, "**/*.md"))),
                    _section("待整理原话（按连发批次排列，含录入星期）", retriever.render_raw(group)),
                ]
            )
            report: ArchiveReport = (await run_agent(archive_spec(memory_limit), prompt, ctx)).output
            archive.archived_msg_seqs += report.archived_msg_seqs
            archive.skipped_msg_seqs += report.skipped_msg_seqs
            archive.notes = "\n".join(filter(None, [archive.notes, report.notes]))

        index_report = await _traced_sync(services, user, ws, trace)

        # 归档后重新计算仍在候选区且尚未进热区的有效晋升项
        memory_text = ws.read_text(MEMORY_FILE)
        post_cache_texts = [
            p.read_text(encoding="utf-8", errors="replace")
            for p in ws.files(CACHE_DIR, "**/*.md")
            if p.name != "facets.md"
        ]
        post_promotable = filter_promotable_stats(hit_stats, memory_text, post_cache_texts)
        post_candidates = [s for s in post_promotable if s["hits"] >= PROMOTION_MIN_HITS]
        run_tiering = bool(post_candidates) or line_count(memory_text) > soft_limit or mode == "defrag"

        tiering = TieringReport()
        if run_tiering:
            defrag = mode == "defrag"
            stats_lines = [
                f"- {s['file']} · {s['entry_key']} · 命中 {s['hits']} 次 · 最近 {s['last_hit']:%m-%d}"
                + (" · 建议晋升" if s["hits"] >= PROMOTION_MIN_HITS else "")
                + (f" · 线索：{s['clue']}" if s.get("clue") else "")
                for s in post_promotable
            ]
            usage_lines = [f"- {u['clue']} · 用到 {u['uses']} 次 · 最近 {u['last_used']:%m-%d}" for u in await _memory_clue_usage(services, user)]
            parts = [
                _section("模式", mode),
                _section(f"热区 MEMORY.md 当前内容（{line_count(memory_text)} 行，上限 {memory_limit}）", memory_text),
                _section(f"近 {PROMOTION_WINDOW_DAYS} 天候选区命中统计", "\n".join(stats_lines)),
                _section("近 30 天热区条目使用统计", "\n".join(usage_lines)),
                _section("候选缓存区文件", "\n".join(ws.rel(p) for p in ws.files(CACHE_DIR, "**/*.md"))),
            ]
            if defrag:
                facet_lines = await _facet_distribution_lines(services, user)
                parts.append(_section("受控维度词表", taxonomy_text))
                parts.append(_section("现有主题页", _wiki_index_text(ws)))
                parts.append(_section("当前维度分布（注意合并只出现 1 次的近义标签）", "\n".join(facet_lines)))
                parts.append(_section("悬空链接", "\n".join(index_report.dangling)))
            tiering = (await run_agent(tiering_spec(memory_limit, soft_limit, defrag), "\n\n".join(parts), ctx)).output
            if any(path.startswith(f"{WIKI_DIR}/") for path in changed_files(ws)):
                second = await _traced_sync(services, user, ws, trace)
                second.embedded += index_report.embedded
                second.docs_rewritten = sorted({*index_report.docs_rewritten, *second.docs_rewritten})
                second.docs_deleted = sorted({*index_report.docs_deleted, *second.docs_deleted})
                index_report = second

        pending_set = set(seqs)
        anchored = _anchored_seqs(ws)
        archived = sorted(pending_set & (set(archive.archived_msg_seqs) | anchored))
        skipped = sorted((pending_set & set(archive.skipped_msg_seqs)) - set(archived))
        still_pending = sorted(pending_set - set(archived) - set(skipped))
        files = changed_files(ws)
        memory_lines = line_count(ws.read_text(MEMORY_FILE))
        await _finalize(
            services, user, run_id, mode, archived, skipped, memory_lines, archive, tiering, files, trace,
            defrag=mode == "defrag",
        )
        commit = git_commit(ws, f"dream {mode} {run_id[:8]}: archived {len(archived)}, skipped {len(skipped)}")
        outcome = DreamOutcome(
            user_id=user.id, status="succeeded", mode=mode, run_id=run_id, archived=archived, skipped=skipped,
            still_pending=still_pending, files_changed=files,
            promotions=[m.model_dump() for m in tiering.promotions], demotions=[m.model_dump() for m in tiering.demotions],
            index=index_report.as_dict(), commit=commit, usage=trace.usage.as_dict(),
        )
    except Exception as exc:
        error = f"{type(exc).__name__}: {services.models.redact(str(exc))}"[:2000]
        trace.event("dream_error", error=error)
        git_discard(ws)
        try:
            await _traced_sync(services, user, ws, trace)
        except Exception as sync_exc:  # noqa: BLE001
            trace.event("dream_error", error=f"索引回滚失败：{sync_exc}"[:500])
        async with services.tx(user) as conn:
            await conn.execute(
                """
                UPDATE dream_runs SET status = 'failed', error_message = %s, finished_at = now(), token_usage = %s::jsonb
                WHERE id = %s
                """,
                (error, json.dumps(trace.usage.as_dict()), run_id),
            )
        outcome = DreamOutcome(user_id=user.id, status="failed", mode=mode, run_id=run_id, error=error, usage=trace.usage.as_dict())
    return outcome


async def _finalize(
    services: Services,
    user: UserRef,
    run_id: str | None,
    mode: str,
    archived: list[int],
    skipped: list[int],
    memory_lines: int,
    archive: ArchiveReport,
    tiering: TieringReport,
    files: list[str],
    trace: Trace,
    *,
    defrag: bool,
) -> None:
    async with services.tx(user) as conn:
        await conn.execute("SELECT 1 FROM users WHERE id = %s FOR UPDATE", (user.id,))
        if archived:
            await conn.execute(
                "UPDATE raw_messages SET dream_status = 'archived', dreamed_at = now() WHERE msg_seq = ANY(%s) AND dream_status = 'pending'",
                (archived,),
            )
        if skipped:
            await conn.execute(
                "UPDATE raw_messages SET dream_status = 'skipped', dreamed_at = now() WHERE msg_seq = ANY(%s) AND dream_status = 'pending'",
                (skipped,),
            )
        await conn.execute(
            """
            UPDATE users SET
              pending_msg_count = sub.n,
              dirty_since = CASE WHEN sub.n > 0 THEN COALESCE(dirty_since, now()) ELSE NULL END,
              pending_cache_hits = 0,
              memory_line_count = %s,
              last_dream_at = now(),
              last_defrag_at = CASE WHEN %s THEN now() ELSE last_defrag_at END
            FROM (SELECT count(*)::int AS n FROM raw_messages WHERE dream_status = 'pending') sub
            WHERE users.id = %s
            """,
            (memory_lines, defrag, user.id),
        )
        if run_id:
            await conn.execute(
                """
                UPDATE dream_runs SET status = 'succeeded', finished_at = now(), wiki_files_changed = %s,
                  cache_promotions = %s::jsonb, memory_demotions = %s::jsonb, token_usage = %s::jsonb
                WHERE id = %s
                """,
                (
                    files,
                    json.dumps([m.model_dump() for m in tiering.promotions], ensure_ascii=False),
                    json.dumps([m.model_dump() for m in tiering.demotions], ensure_ascii=False),
                    json.dumps(trace.usage.as_dict()),
                    run_id,
                ),
            )
    if archive.notes:
        trace.event("archive_notes", notes=archive.notes[:2000])


async def run_dirty_queue(services: Services, *, limit: int = 50, mode: str | None = None) -> list[DreamOutcome]:
    async with services.pool.connection() as conn:
        rows = await (await conn.execute("SELECT * FROM list_dirty_users(%s)", (limit,))).fetchall()
    outcomes = []
    for row in rows:
        user = UserRef(id=str(row["user_id"]), slug=row["external_slug"], workspace_rel_path=row["workspace_rel_path"])
        outcomes.append(await run_for_user(services, user, mode=mode))
    return outcomes

