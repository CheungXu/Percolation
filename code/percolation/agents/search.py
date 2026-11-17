"""Search Agent：四步在线检索。

1. 路由：热区记忆 + 提问 → 检索词和未知暗语。
2. 主路径：混合召回 + 锚点原话核验 → 作答。
3. 主路径答不上时，静默探查候选缓存区，改写检索词再走一次主路径。
4. 仍然答不上，才最小化追问或如实说没找到。

确定性的流转写在这里，只有需要判断的节点调用 agentkit 的循环。
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from functools import cache
from typing import Literal

from pydantic import BaseModel, Field

from agentkit import AgentSpec, RunContext, Trace, run_agent
from agentkit.workspace import Workspace
from percolation import env_anchor, retriever
from percolation.agents import load_prompt
from percolation.memory_fs import CACHE_DIR, MEMORY_FILE
from percolation.services import Services, UserRef
from percolation.tools import FETCH_RAW, HYBRID_SEARCH, cache_probe_tools, wiki_read_tools
from percolation.wiki import effective_facets_catalog, format_facets_summary, format_facets_taxonomy


class RoutePlan(BaseModel):
    queries: list[str] = Field(default_factory=list, description="1~4 个检索词")
    facet_filters: dict[str, list[str]] = Field(default_factory=dict, description="正交维度条件，如 {'domain': ['学习'], 'form': ['网站']}")
    date_from: str | None = Field(default=None, description="起始日期 YYYY-MM-DD")
    date_to: str | None = Field(default=None, description="结束日期 YYYY-MM-DD")
    time_field: Literal["any", "event", "captured"] = "any"
    unknown_terms: list[str] = Field(default_factory=list, description="看不懂、热区也没解释的暗语或指代")
    memory_clues_used: list[str] = Field(default_factory=list, description="用到的热区条目键")
    clarify_now: bool = False
    clarify_question: str = ""


class AnswerDraft(BaseModel):
    status: Literal["answered", "ambiguous", "insufficient"]
    answer: str = ""
    verified_msg_seqs: list[int] = Field(default_factory=list)
    hit_doc_paths: list[str] = Field(default_factory=list)
    unresolved_terms: list[str] = Field(default_factory=list)
    clarify_question: str = ""


class CacheHit(BaseModel):
    file: str
    entry_key: str
    clue: str = ""


class CacheProbe(BaseModel):
    found: bool
    rewritten_queries: list[str] = Field(default_factory=list)
    clues: list[str] = Field(default_factory=list)
    cache_hits: list[CacheHit] = Field(default_factory=list)
    files_probed: list[str] = Field(default_factory=list)


@cache
def router_spec() -> AgentSpec:
    return AgentSpec(
        name="search_router",
        model_slot="router_model",
        system_prompt=load_prompt("search_router"),
        output_model=RoutePlan,
        max_turns=1,
        model_params={"temperature": 0.1, "max_tokens": 800},
    )


@cache
def answer_spec() -> AgentSpec:
    return AgentSpec(
        name="search_answer",
        model_slot="search_model",
        system_prompt=load_prompt("search_answer"),
        tools=(HYBRID_SEARCH, FETCH_RAW, *[t for t in wiki_read_tools() if t.name == "read_file"]),
        output_model=AnswerDraft,
        max_turns=3,
    )


@cache
def probe_spec() -> AgentSpec:
    return AgentSpec(
        name="search_cache_probe",
        model_slot="search_model",
        system_prompt=load_prompt("search_probe"),
        tools=tuple(cache_probe_tools()),
        output_model=CacheProbe,
        max_turns=4,
    )


def _cache_rel(path: str) -> str:
    """模型报告的文件名写法不一（slang.md、/workspace/MEMORY_CACHE/slang.md），统一成相对工作区路径。"""
    path = path.strip().removeprefix("/workspace/").removeprefix("./")
    return path if path.startswith(f"{CACHE_DIR}/") else f"{CACHE_DIR}/{path}"


@dataclass
class SearchOutcome:
    search_id: str
    outcome: str
    route_path: str
    answer: str
    query: str = ""
    clarify_question: str = ""
    verified_msg_seqs: list[int] = field(default_factory=list)
    hit_doc_paths: list[str] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)
    facet_filters: dict[str, list[str]] = field(default_factory=dict)
    date_range: tuple[str | None, str | None] = (None, None)
    cache_hit_entries: list[dict] = field(default_factory=list)
    latency_ms: int = 0
    usage: dict = field(default_factory=dict)
    cost_cny: float = 0.0
    trace_id: str = ""
    parent_search_id: str | None = None
    is_reask: bool = False

    def as_dict(self) -> dict:
        data = asdict(self)
        data["date_range"] = list(self.date_range)
        return data


def _tool_path(event: dict) -> str | None:
    try:
        return json.loads(event["arguments"]).get("path")
    except (json.JSONDecodeError, AttributeError):
        return None


def _section(title: str, body: str) -> str:
    return f"## {title}\n{body.strip() or '（无）'}"


async def _primary(
    services: Services,
    user: UserRef,
    ctx: RunContext,
    *,
    query: str,
    queries: list[str],
    memory: str,
    clues: list[str],
    unknown_terms: list[str] | tuple[str, ...] = (),
    facet_filters: dict[str, list[str]] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    time_field: str = "any",
    as_of: datetime | None = None,
) -> tuple[AnswerDraft, retriever.RetrievalResult]:
    result = await retriever.traced_search(
        ctx,
        services,
        user,
        queries,
        rerank_query=query,
        facet_filters=facet_filters,
        date_from=date_from,
        date_to=date_to,
        time_field=time_field,
    )
    raw_rows = await retriever.fetch_raw(services, user, result.msg_seqs[:20], with_batch=True)
    dim_info = format_facets_summary(result.facet_filters)
    if any(result.date_range):
        dim_info = " · ".join(filter(None, [dim_info, f"日期范围 {result.date_range[0] or ''}..{result.date_range[1] or ''}"]))
    prompt = "\n\n".join(
        [
            _section("当前日期", retriever.format_local_today(as_of)),
            _section("热区记忆", memory),
            _section("提问", query),
            _section("补充线索", "\n".join(f"- {clue}" for clue in clues)),
            _section("待确认的暗语", "、".join(unknown_terms)),
            _section("本轮检索词与维度条件", "、".join(result.queries) + (f"（{dim_info}）" if dim_info else "")),
            _section("检索结果", result.render()),
            _section("检索结果涉及的原话（含同批次前后消息）", retriever.render_raw(raw_rows)),
        ]
    )
    draft = (await run_agent(answer_spec(), prompt, ctx)).output
    return draft, result


async def _repair_behind(services: Services, user: UserRef, trace: Trace) -> bool:
    """上次整理快进中断时，索引已是新版本而文件还是旧的；能补就先补齐再检索。补不了不影响检索。"""
    from percolation.agents.dream import repair_fast_forward

    try:
        repaired = await repair_fast_forward(services, user)
    except Exception as exc:  # noqa: BLE001
        trace.event("workspace_repair_failed", error=services.models.redact(str(exc))[:500])
        return False
    if repaired:
        trace.event("workspace_repaired")
    return repaired


async def ask(
    services: Services,
    user: UserRef,
    query: str,
    *,
    clarification: str | None = None,
    as_of: datetime | None = None,
    parent_search_id: str | None = None,
    reask_of: str | None = None,
) -> SearchOutcome:
    """as_of 只在复现时传：把「当前日期」钉在原运行的时刻。reask_of 是「改了再问/重新问」所属的原线程。"""
    is_reask = False
    if reask_of is not None:
        async with services.tx(user) as conn:
            target = await (
                await conn.execute(
                    "SELECT COALESCE(parent_search_id, id)::text AS root_id FROM search_logs WHERE id = %s AND deleted_at IS NULL",
                    (reask_of,),
                )
            ).fetchone()
        if target is None:
            raise LookupError(f"检索记录不存在：{reask_of}")
        parent_search_id = target["root_id"]
        is_reask = True

    trace = services.new_trace("search", user, clarification=bool(clarification), reask=is_reask)
    trace.root.payload["input"] = {"query": query, "clarification": clarification}
    try:
        with trace.activate():
            ws = services.workspace(user)
            anchor = await services.capture_env(user, ws, as_of=as_of, check_clean=True)
            if anchor["workspace"]["workspace_mismatch"] and await _repair_behind(services, user, trace):
                anchor = await services.capture_env(user, ws, as_of=as_of, check_clean=True)
            env_anchor.attach(trace, anchor)
            result = await _ask(
                services,
                user,
                trace,
                query,
                clarification,
                ws=ws,
                as_of=datetime.fromisoformat(anchor["db"]["as_of"]),
                parent_search_id=parent_search_id,
                is_reask=is_reask,
            )
    except Exception as exc:
        error = f"{type(exc).__name__}: {services.models.redact(str(exc))}"[:2000]
        services.save_trace(user, trace, {"error": error}, status="failed")
        raise
    trace.root.payload["output"] = result.as_dict()
    services.save_trace(
        user,
        trace,
        {"search_id": result.search_id, "outcome": result.outcome, "route_path": result.route_path, "latency_ms": result.latency_ms},
        status=result.outcome,
    )
    return result


async def _ask(
    services: Services,
    user: UserRef,
    trace: Trace,
    query: str,
    clarification: str | None,
    *,
    ws: Workspace,
    as_of: datetime,
    parent_search_id: str | None = None,
    is_reask: bool = False,
) -> SearchOutcome:
    started = time.monotonic()
    ctx = services.context(user, trace, ws)
    memory = ws.read_text(MEMORY_FILE)
    async with services.tx(user) as conn:
        unpurged_deleted = {
            int(r["msg_seq"])
            for r in await (
                await conn.execute("SELECT msg_seq FROM raw_messages WHERE deleted_at IS NOT NULL")
            ).fetchall()
        }
    if unpurged_deleted:
        memory = retriever.strip_deleted_anchor_lines(memory, unpurged_deleted)
    clues: list[str] = []
    if clarification:
        clues.append(f"用户对上次追问的补充回答：{clarification}")

    catalog = effective_facets_catalog(services.settings.facets, ws.read_text(f"{CACHE_DIR}/facets.md"))
    router_input = "\n\n".join(
        [
            _section("当前日期", retriever.format_local_today(as_of)),
            _section("可用维度词表", format_facets_taxonomy(catalog)),
            _section("热区记忆", memory),
            _section("提问", query),
            _section("补充线索", "\n".join(clues)),
        ]
    )
    plan: RoutePlan = (await run_agent(router_spec(), router_input, ctx)).output
    queries = list(dict.fromkeys([query, *plan.queries]))
    memory_clues = list(plan.memory_clues_used)
    route_path = "primary_direct"
    cache_files: list[str] = []
    cache_hits: list[dict] = []

    if plan.clarify_now and not clarification:
        draft = AnswerDraft(status="ambiguous", clarify_question=plan.clarify_question or "能再具体说说要找什么吗？")
        route_path = "clarify_immediate"
    else:
        draft, _ = await _primary(
            services,
            user,
            ctx,
            query=query,
            queries=queries,
            memory=memory,
            clues=clues,
            unknown_terms=plan.unknown_terms,
            facet_filters=plan.facet_filters,
            date_from=plan.date_from,
            date_to=plan.date_to,
            time_field=plan.time_field,
            as_of=as_of,
        )
        if draft.status != "answered" and ws.files(CACHE_DIR, "**/*.md"):
            route_path = "cache_fallback"
            unknown = list(dict.fromkeys([*plan.unknown_terms, *draft.unresolved_terms]))
            probe_input = "\n\n".join(
                [
                    _section("提问", query),
                    _section("看不懂的词", "、".join(unknown) or "（路由没有标出，可从提问里自行判断）"),
                    _section("主路径的情况", draft.answer or draft.clarify_question or "没有找到相关记录"),
                ]
            )
            probe: CacheProbe = (await run_agent(probe_spec(), probe_input, ctx)).output
            probed = [_tool_path(event) for event in trace.tool_calls("read_file", agent="search_cache_probe")]
            cache_files = sorted({_cache_rel(path) for path in [*probe.files_probed, *probed] if path})
            if probe.found and (probe.rewritten_queries or probe.clues):
                clues.extend(probe.clues)
                queries = list(dict.fromkeys([*probe.rewritten_queries, *queries]))
                draft, _ = await _primary(
                    services,
                    user,
                    ctx,
                    query=query,
                    queries=queries,
                    memory=memory,
                    clues=clues,
                    facet_filters=plan.facet_filters,
                    date_from=plan.date_from,
                    date_to=plan.date_to,
                    time_field=plan.time_field,
                    as_of=as_of,
                )
                cache_hits = [{**hit.model_dump(), "file": _cache_rel(hit.file)} for hit in probe.cache_hits]
                memory_clues.extend(probe.clues)

    if draft.status == "answered":
        outcome, answer = "answered", draft.answer
    elif draft.clarify_question and (draft.status == "ambiguous" or draft.unresolved_terms):
        outcome, answer = "clarify_asked", draft.answer
    else:
        outcome, answer = "not_found", draft.answer or "没有找到相关记录。"

    clarify_question = draft.clarify_question if outcome == "clarify_asked" else ""
    latency_ms = int((time.monotonic() - started) * 1000)
    async with services.tx(user) as conn:
        existing = await (
            await conn.execute(
                "SELECT msg_seq FROM raw_messages WHERE msg_seq = ANY(%s) AND deleted_at IS NULL",
                (draft.verified_msg_seqs,),
            )
        ).fetchall()
        verified = sorted(row["msg_seq"] for row in existing)
        row = await (
            await conn.execute(
                """
                INSERT INTO search_logs (
                  user_id, query_text, route_path, outcome, rewritten_queries, memory_clues_used,
                  cache_files_probed, cache_hit_entries, hit_doc_paths, verified_msg_seqs, latency_ms, token_usage,
                  answer_text, clarify_question, parent_search_id, is_reask
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s::jsonb, %s, %s, %s, %s)
                RETURNING id::text AS id
                """,
                (
                    user.id, query, route_path, outcome, queries[1:], memory_clues, cache_files,
                    json.dumps(cache_hits, ensure_ascii=False), draft.hit_doc_paths, verified, latency_ms,
                    json.dumps(trace.usage.as_dict()), answer or "", clarify_question, parent_search_id, is_reask,
                ),
            )
        ).fetchone()
        if route_path == "cache_fallback" and outcome == "answered" and cache_hits:
            await conn.execute(
                """
                UPDATE users SET pending_cache_hits = pending_cache_hits + 1, dirty_since = COALESCE(dirty_since, now())
                WHERE id = %s
                """,
                (user.id,),
            )

    result = SearchOutcome(
        search_id=row["id"],
        outcome=outcome,
        route_path=route_path,
        answer=answer,
        query=query,
        clarify_question=clarify_question,
        verified_msg_seqs=verified,
        hit_doc_paths=draft.hit_doc_paths,
        queries=queries,
        facet_filters=plan.facet_filters,
        date_range=(plan.date_from, plan.date_to),
        cache_hit_entries=cache_hits,
        latency_ms=latency_ms,
        usage=trace.usage.as_dict(),
        cost_cny=round(trace.cost, 6),
        trace_id=trace.trace_id,
        parent_search_id=parent_search_id,
        is_reask=is_reask,
    )
    return result


async def clarify(services: Services, user: UserRef, search_id: str, content: str) -> tuple[dict, SearchOutcome]:
    """用户回复追问：作为高优澄清原话入库，再用原问题重新检索一次。重查挂在线程第一问下面。"""
    from percolation.capture import capture

    async with services.tx(user) as conn:
        row = await (
            await conn.execute(
                "SELECT query_text, COALESCE(parent_search_id, id)::text AS root_id FROM search_logs WHERE id = %s AND deleted_at IS NULL",
                (search_id,),
            )
        ).fetchone()
    if row is None:
        raise LookupError(f"检索记录不存在：{search_id}")
    captured = await capture(services, user, content, source_kind="clarification", reply_to_search_id=search_id)
    outcome = await ask(services, user, row["query_text"], clarification=content, parent_search_id=row["root_id"])
    return captured, outcome
