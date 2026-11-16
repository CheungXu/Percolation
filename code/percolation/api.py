"""HTTP 接口，同时托管「拾记凝境」网页（code/web/）。

鉴权由 config/web.env 的 AUTH_MODE 决定：
- star_page（线上默认）：读星页同域登录 cookie，向星页 /api/auth/me 换账号，按 sp-<星页 user id>
  自动开租户。请求头 X-User-Slug 不生效；手动整理接口关闭，整理只由夜间定时器执行。
- header（本机调试）：请求头 X-User-Slug 选租户，缺省为配置里的默认用户。

启动：uvicorn percolation.api:app --host 127.0.0.1 --port 8710
线上经 Nginx 挂在 https://stars-page.com/Percolation/（转发时去掉前缀），网页里全部用相对路径。
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from percolation import graph
from percolation.agents import dream, search
from percolation.capture import capture
from percolation.product import views
from percolation.product.identity import Account, AuthUnavailable, StarPageAuth
from percolation.product.settings import WebSettings, load_web_settings
from percolation.services import Services, UserRef

log = logging.getLogger("percolation.api")

WEB = load_web_settings()
WEB_ASSETS = ("styles.css", "app.js")
CONSOLE_ASSETS = ("styles.css", "app.js", "shared/base.css", "shared/catalog.js", "shared/engine.js", "shared/generated.js", "shared/ui.js")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.services = await Services.open()
    app.state.web = WEB
    app.state.auth = StarPageAuth(WEB) if WEB.public else None
    app.state.tenants = {}
    try:
        yield
    finally:
        if app.state.auth is not None:
            await app.state.auth.aclose()
        await app.state.services.close()


app = FastAPI(
    title="Percolation",
    lifespan=lifespan,
    docs_url=None if WEB.public else "/docs",
    redoc_url=None,
    openapi_url=None if WEB.public else "/openapi.json",
)


def get_services(request: Request) -> Services:
    return request.app.state.services


def get_web(request: Request) -> WebSettings:
    return request.app.state.web


@dataclass(frozen=True)
class Viewer:
    user: UserRef
    account: Account | None


async def _star_page_account(request: Request) -> Account | None:
    token = request.cookies.get(request.app.state.web.session_cookie)
    try:
        return await request.app.state.auth.account(token)
    except AuthUnavailable as exc:
        log.warning("%s", exc)
        raise HTTPException(status_code=503, detail="登录服务暂时不可用，请稍后再试") from exc


async def get_viewer(
    request: Request,
    services: Services = Depends(get_services),
    x_user_slug: str | None = Header(default=None),
) -> Viewer:
    web: WebSettings = request.app.state.web
    if not web.public:
        try:
            return Viewer(await services.resolve_user(x_user_slug), None)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    account = await _star_page_account(request)
    if account is None:
        raise HTTPException(status_code=401, detail="请先登录")
    tenants: dict[str, UserRef] = request.app.state.tenants
    user = tenants.get(account.slug)
    if user is None:
        user = tenants[account.slug] = await services.provision_user(account.slug)
    return Viewer(user, account)


async def get_user(viewer: Viewer = Depends(get_viewer)) -> UserRef:
    return viewer.user


async def _check_quota(services: Services, user: UserRef, kind: Literal["asks", "captures"], web: WebSettings) -> None:
    limit = web.daily_ask_limit if kind == "asks" else web.daily_capture_limit
    if limit <= 0:
        return
    used = (await views.usage_today(services, user))[kind]
    if used >= limit:
        what = "询问" if kind == "asks" else "记录"
        raise HTTPException(status_code=429, detail=f"今天的{what}次数已到上限，明天再来")


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


# ---------- 会话 ----------


@app.get("/v1/session")
async def session_endpoint(request: Request, web: WebSettings = Depends(get_web)) -> dict:
    """不要求登录：告诉网页是否已登录、用什么方式登录。"""
    login = {
        "provider": "star_page" if web.public else "header",
        "agreement_version": web.agreement_version,
        "terms_url": web.terms_url,
        "privacy_url": web.privacy_url,
    }
    if not web.public:
        return {
            "logged_in": True,
            "account": {"display_name": "本机调试", "phone": ""},
            "login": login,
            "console": web.is_console_allowed(None),
        }
    account = await _star_page_account(request)
    return {
        "logged_in": account is not None,
        "account": account.public() if account else None,
        "login": login,
        "console": account is not None and web.is_console_allowed(account.phone),
    }


@app.post("/v1/session/forget", status_code=204)
async def forget_session(request: Request) -> None:
    """网页退出星页登录后调用，清掉本进程对这个 cookie 的缓存。"""
    if request.app.state.auth is not None:
        request.app.state.auth.forget(request.cookies.get(request.app.state.web.session_cookie))


# ---------- 记录与询问 ----------


@app.post("/v1/capture")
async def capture_endpoint(
    body: CaptureIn,
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
    web: WebSettings = Depends(get_web),
) -> dict:
    await _check_quota(services, user, "captures", web)
    captured = await capture(services, user, body.content.strip(), client_meta=body.client_meta)
    return {**captured, "note": await views.get_note(services, user, captured["msg_seq"])}


@app.post("/v1/search")
async def search_endpoint(
    body: SearchIn,
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
    web: WebSettings = Depends(get_web),
) -> dict:
    await _check_quota(services, user, "asks", web)
    try:
        outcome = await search.ask(services, user, body.query.strip())
    except Exception as exc:
        log.exception("search failed for %s", user.slug)
        raise HTTPException(status_code=502, detail="这次没能完成，请稍后再试") from exc
    return {**outcome.as_dict(), "step": await views.step_for_outcome(services, user, outcome)}


@app.post("/v1/clarify")
async def clarify_endpoint(
    body: ClarifyIn,
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
    web: WebSettings = Depends(get_web),
) -> dict:
    try:
        uuid.UUID(body.search_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="检索记录不存在") from exc
    await _check_quota(services, user, "asks", web)
    try:
        captured, outcome = await search.clarify(services, user, body.search_id, body.content.strip())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("clarify failed for %s", user.slug)
        raise HTTPException(status_code=502, detail="这次没能完成，请稍后再试") from exc
    return {
        "captured": captured,
        "search": outcome.as_dict(),
        "note": await views.get_note(services, user, captured["msg_seq"]),
        "step": await views.step_for_outcome(services, user, outcome),
    }


# ---------- 网页读模型 ----------


@app.get("/v1/notes")
async def notes_endpoint(
    before_seq: int | None = Query(default=None, ge=1),
    limit: int = Query(default=80, ge=1, le=200),
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
) -> dict:
    return await views.list_notes(services, user, before_seq=before_seq, limit=limit)


@app.get("/v1/notes/search")
async def notes_search_endpoint(
    q: str = Query(default="", max_length=200),
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
) -> dict:
    return await views.search_notes(services, user, q)


@app.get("/v1/notes/between")
async def notes_between_endpoint(
    after_seq: int | None = Query(default=None, ge=0),
    before_seq: int | None = Query(default=None, ge=1),
    edge: int = Query(default=views.FOLD_EDGE, ge=1, le=50),
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
) -> dict:
    if after_seq is None and before_seq is None:
        raise HTTPException(status_code=422, detail="after_seq 和 before_seq 至少给一个")
    return await views.notes_between(services, user, after_seq=after_seq, before_seq=before_seq, edge=edge)


@app.get("/v1/threads")
async def threads_endpoint(
    before_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
) -> dict:
    if before_id is not None:
        try:
            before_id = str(uuid.UUID(before_id))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="before_id 不是合法的 id") from exc
    return await views.list_threads(services, user, before_id=before_id, limit=limit)


@app.get("/v1/recall")
async def recall_endpoint(
    q: str = Query(default="", max_length=500),
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
) -> dict:
    return {"seqs": await views.recall(services, user, q)}


@app.get("/v1/context")
async def context_endpoint(services: Services = Depends(get_services), user: UserRef = Depends(get_user)) -> dict:
    return await views.context(services, user)


# ---------- 内部与调试 ----------


@app.post("/v1/dream")
async def dream_endpoint(
    body: DreamIn,
    services: Services = Depends(get_services),
    user: UserRef = Depends(get_user),
    web: WebSettings = Depends(get_web),
) -> dict:
    if web.public:
        raise HTTPException(status_code=403, detail="整理由后台每晚自动执行")
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


# ---------- 控制台（白名单手机号） ----------


class ConsoleDenied(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        self.message = message


@app.exception_handler(ConsoleDenied)
async def _console_denied_handler(request: Request, exc: ConsoleDenied):
    if "text/html" in (request.headers.get("accept") or ""):
        back = "./" if request.url.path.endswith("/console") else "../"
        html = (
            "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>无权访问</title>"
            "<style>body{font-family:system-ui,-apple-system,sans-serif;background:#fbfbfa;color:#1f2329;"
            "display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}"
            ".box{max-width:360px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center}"
            "h1{font-size:17px;margin:0 0 8px}p{font-size:14px;color:#6b7280;margin:0 0 18px}"
            "a{display:inline-block;padding:8px 16px;border-radius:8px;background:#0f766e;color:#fff;text-decoration:none;font-size:14px}</style>"
            f"</head><body><div class='box'><h1>{exc.message}</h1>"
            "<p>控制台仅对白名单账号开放。</p>"
            f"<a href='{back}'>返回拾记凝境</a></div></body></html>"
        )
        return HTMLResponse(html, status_code=exc.status_code, headers={"Cache-Control": "no-store"})
    return JSONResponse({"detail": exc.message}, status_code=exc.status_code, headers={"Cache-Control": "no-store"})


async def require_console_access(request: Request, web: WebSettings = Depends(get_web)) -> None:
    if not web.public:
        return
    account = await _star_page_account(request)
    if account is None:
        raise ConsoleDenied(401, "请先登录后再访问控制台")
    if not web.is_console_allowed(account.phone):
        raise ConsoleDenied(403, "当前账号无权访问控制台")


def _console_asset_version(web: WebSettings) -> str:
    stamps = [(web.console_dir / name).stat().st_mtime_ns for name in CONSOLE_ASSETS if (web.console_dir / name).exists()]
    return format(max(stamps, default=0) // 1_000_000, "x")


@app.get("/console", include_in_schema=False, dependencies=[Depends(require_console_access)])
async def console_redirect() -> RedirectResponse:
    return RedirectResponse("console/", status_code=307, headers={"Cache-Control": "no-store"})


@app.get("/console/", include_in_schema=False, dependencies=[Depends(require_console_access)])
async def console_index(web: WebSettings = Depends(get_web)) -> HTMLResponse:
    index_file = web.console_dir / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=404, detail="控制台未就绪")
    html = index_file.read_text(encoding="utf-8").replace("{{v}}", _console_asset_version(web))
    return HTMLResponse(
        html,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin",
        },
    )


@app.get("/console/{asset_path:path}", include_in_schema=False, dependencies=[Depends(require_console_access)])
async def console_asset(asset_path: str, web: WebSettings = Depends(get_web)) -> FileResponse:
    root = web.console_dir.resolve()
    target = (root / asset_path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Not Found")
    return FileResponse(
        target,
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---------- 网页 ----------


def _asset_version() -> str:
    stamps = [(WEB.web_dir / name).stat().st_mtime_ns for name in WEB_ASSETS if (WEB.web_dir / name).exists()]
    return format(max(stamps, default=0) // 1_000_000, "x")


@app.get("/", include_in_schema=False)
async def index() -> HTMLResponse:
    html = (WEB.web_dir / "index.html").read_text(encoding="utf-8").replace("{{v}}", _asset_version())
    return HTMLResponse(
        html,
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin",
        },
    )


if WEB.web_dir.is_dir():
    app.mount("/", StaticFiles(directory=WEB.web_dir), name="web")
