"""Percolation 业务工具。资源一律从 RunContext 取：deps 是 Services，tenant_id 是当前用户。"""

from __future__ import annotations

from pydantic import BaseModel, Field

from agentkit import Tool, ToolError
from agentkit.workspace import workspace_tools
from percolation import retriever
from percolation.memory_fs import CACHE_DIR, WIKI_DIR, memory_validators
from percolation.services import UserRef


def _user(ctx) -> UserRef:
    if not ctx.tenant_id or ctx.deps is None:
        raise ToolError("当前运行没有用户上下文")
    return UserRef(id=ctx.tenant_id, slug="", workspace_rel_path="")


class HybridSearchArgs(BaseModel):
    queries: list[str] = Field(default_factory=list, max_length=5, description="1~5 个检索词，可以是关键词、型号、上位概念或改写后的问法")
    facets: dict[str, list[str]] = Field(
        default_factory=dict,
        description="可选的多维标签过滤/加权，如 {'domain': ['学习'], 'form': ['网站']}",
    )
    date_from: str | None = Field(default=None, description="可选起始日期 YYYY-MM-DD")
    date_to: str | None = Field(default=None, description="可选结束日期 YYYY-MM-DD")
    top_k: int = Field(default=6, ge=1, le=12)


async def hybrid_search(args: HybridSearchArgs, ctx) -> str:
    if not args.queries and not args.facets and not args.date_from and not args.date_to:
        raise ToolError("queries、facets 或日期范围至少提供一项")
    result = await retriever.traced_search(
        ctx,
        ctx.deps,
        _user(ctx),
        args.queries,
        top_k=args.top_k,
        facet_filters=args.facets,
        date_from=args.date_from,
        date_to=args.date_to,
    )
    return result.render()


class FetchRawArgs(BaseModel):
    msg_seqs: list[int] = Field(min_length=1, max_length=30, description="原话序号，即锚点 #msg_N 里的 N")
    with_batch: bool = Field(default=True, description="是否带上同一连发批次的前后消息")


async def fetch_raw_messages(args: FetchRawArgs, ctx) -> str:
    rows = await retriever.fetch_raw(ctx.deps, _user(ctx), args.msg_seqs, with_batch=args.with_batch)
    return retriever.render_raw(rows)


HYBRID_SEARCH = Tool(
    "hybrid_search",
    "在用户的主题页和原话里多维混合检索（中文全文 + 型号模糊匹配 + 语义向量 + 正交维度/日期召回 + 重排），返回带锚点的结果。",
    HybridSearchArgs,
    hybrid_search,
    frozenset({"read", "db"}),
)
FETCH_RAW = Tool(
    "fetch_raw_messages",
    "按序号读取用户的逐字原话和时间，用来核验主题页里的结论。",
    FetchRawArgs,
    fetch_raw_messages,
    frozenset({"read", "db"}),
)


def wiki_read_tools() -> list[Tool]:
    return workspace_tools(scope=WIKI_DIR)


def cache_probe_tools() -> list[Tool]:
    return workspace_tools(scope=CACHE_DIR)


def memory_write_tools(memory_line_limit: int, *, write_prefixes: tuple[str, ...], allow_delete: bool = False) -> list[Tool]:
    return workspace_tools(
        writable=True,
        write_prefixes=write_prefixes,
        allow_delete=allow_delete,
        validators=memory_validators(memory_line_limit),
    )
