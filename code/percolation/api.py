"""HTTP 接口。单用户阶段用请求头 X-User-Slug 选租户，缺省为配置里的默认用户。

启动：uvicorn percolation.api:app --host 127.0.0.1 --port 8710
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from percolation import graph
from percolation.agents import dream, search
from percolation.capture import capture
from percolation.services import Services, UserRef


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.services = await Services.open()
    try:
        yield
    finally:
        await app.state.services.close()


app = FastAPI(title="Percolation", lifespan=lifespan)


def get_services(request: Request) -> Services:
    return request.app.state.services


async def get_user(services: Services = Depends(get_services), x_user_slug: str | None = Header(default=None)) -> UserRef:
    try:
        return await services.resolve_user(x_user_slug)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class CaptureIn(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    client_meta: dict[str, Any] = Field(default_factory=dict)


class SearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=2000)


class ClarifyIn(BaseModel):
    search_id: str
    content: str = Field(min_length=1, max_length=5000)


class DreamIn(BaseModel):
    mode: Literal["incremental", "defrag"] | None = None


@app.get("/healthz")
async def healthz(services: Services = Depends(get_services)) -> dict:
    async with services.pool.connection() as conn:
        await conn.execute("SELECT 1")
    return {"ok": True}


@app.post("/v1/capture")
async def capture_endpoint(body: CaptureIn, services: Services = Depends(get_services), user: UserRef = Depends(get_user)) -> dict:
    return await capture(services, user, body.content, client_meta=body.client_meta)


@app.post("/v1/search")
async def search_endpoint(body: SearchIn, services: Services = Depends(get_services), user: UserRef = Depends(get_user)) -> dict:
    return (await search.ask(services, user, body.query)).as_dict()


@app.post("/v1/clarify")
async def clarify_endpoint(body: ClarifyIn, services: Services = Depends(get_services), user: UserRef = Depends(get_user)) -> dict:
    try:
        captured, outcome = await search.clarify(services, user, body.search_id, body.content)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"captured": captured, "search": outcome.as_dict()}


@app.post("/v1/dream")
async def dream_endpoint(body: DreamIn, services: Services = Depends(get_services), user: UserRef = Depends(get_user)) -> dict:
    return (await dream.run_for_user(services, user, mode=body.mode)).as_dict()


@app.get("/v1/facets")
async def facets_endpoint(services: Services = Depends(get_services), user: UserRef = Depends(get_user)) -> dict:
    return await graph.build_facets_overview(services, user)


@app.get("/v1/graph")
async def graph_endpoint(
    include_facets: bool = Query(default=True, description="是否生成虚拟维度节点与 has_facet 边"),
    include_messages: bool | None = Query(default=None, description="是否展开原话节点；缺省在指定 center 时开启"),
    center: str | None = Query(default=None, description="中心主题页路径、文件名或标题"),
    depth: int = Query(default=1, ge=1, le=3, description="center 子图跳数（1..3）"),
    facet: list[str] | None = Query(default=None, description="多维过滤，如 domain=学习 或 form:网站，可传多个"),
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
) -> dict:
    return await graph.build_graph(
        services,
        user,
        include_facets=include_facets,
        include_messages=include_messages,
        center=center,
        depth=depth,
        facet_filters=graph.parse_facet_specs(facet),
    )
