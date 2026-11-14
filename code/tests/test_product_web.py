"""拾记凝境网页端：读模型纯函数、星页登录态识别、线程组装（连库）与线上鉴权模式下的接口全链路（连库）。"""

from __future__ import annotations

import asyncio
import shutil
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from agentkit.envfile import load_env_file
from agentkit.tenancy import create_pool
from percolation import tenants
from percolation.capture import capture
from percolation.product import views
from percolation.product.identity import (
    Account,
    AuthUnavailable,
    StarPageAuth,
    parse_account,
)
from percolation.product.settings import load_web_settings, normalize_phone, parse_phone_whitelist
from percolation.services import Services

ROOT = Path(__file__).resolve().parents[2]
DB_ENV = load_env_file(ROOT / "config" / "db.env")
NAS_ROOT = Path(load_env_file(ROOT / "config" / "storage.env").get("NAS_ROOT_DIR") or "/mnt/percolation")
needs_db = pytest.mark.skipif(not DB_ENV.get("MIGRATE_DATABASE_URL"), reason="没有数据库迁移配置")

MEMORY_SAMPLE = """# 运行注入区

只放已经确认、而且经常会用到的个人背景和暗语。

## 暗语与缩写

- 雕牌屏：技嘉 AORUS FO27Q3 显示器 [confirmed] [#msg_3]
- 老地方：[[place::bamboo-tea|竹里茶室]]靠窗座 [#msg_1]

## 空分组
"""

PAGE_SAMPLE = """---
title: 显示器与便携屏待购清单
type: topic
---

## 便携屏

- [inferred] 支架大概率是给便携屏用的 [#msg_2]
- [confirmed] CFORCE 15.6 寸 OLED 便携屏，蹲到 999 元再买 [form:硬件外设] [status:待购] [#msg_1]
- [confirmed] AORUS FO27Q3 到手价 4299 元 [@2027-11-11] [#msg_3]
- [confirmed] 第三条不该出现 [#msg_4]
"""


def test_recall_tokens_drop_function_words():
    assert views.recall_tokens("下周有什么安排？") == ["下周", "安排"]
    tokens = views.recall_tokens("之前想买的便携屏多少钱")
    assert {"想买", "便携", "携屏"} <= set(tokens)
    assert not {"多少", "买的", "之前"} & set(tokens)
    assert {"cforce", "oled"} <= set(views.recall_tokens("CFORCE OLED 什么价"))
    assert views.recall_tokens("吗") == []


def test_parse_memory_and_page_highlights_strip_markers():
    sections = views.parse_memory(MEMORY_SAMPLE)
    assert sections == [
        {"title": "暗语与缩写", "items": ["雕牌屏：技嘉 AORUS FO27Q3 显示器", "老地方：竹里茶室靠窗座"]},
    ]
    assert views.parse_memory("- 没有分组的一条 [#msg_9]") == [{"title": "记住的事", "items": ["没有分组的一条"]}]
    assert views.page_highlights(PAGE_SAMPLE) == ["CFORCE 15.6 寸 OLED 便携屏，蹲到 999 元再买", "AORUS FO27Q3 到手价 4299 元"]


def test_assemble_threads_orders_steps_and_attaches_replies():
    t0 = datetime(2026, 11, 15, 9, tzinfo=UTC)

    def row(sid, query, outcome, *, parent=None, minutes=0, answer="", clarify="", paths=()):
        return {
            "id": sid,
            "query_text": query,
            "outcome": outcome,
            "answer_text": answer,
            "clarify_question": clarify,
            "verified_msg_seqs": [7] if outcome == "answered" else [],
            "hit_doc_paths": list(paths),
            "parent_id": parent,
            "created_at": t0 + timedelta(minutes=minutes),
        }

    roots = [row("r2", "第二问", "answered", minutes=5, answer="好"), row("r1", "阿白是谁", "clarify_asked", clarify="阿白指谁？")]
    children = [row("c1", "阿白是谁", "answered", parent="r1", minutes=2, answer="你的同事", paths=["wiki/people.md"])]
    replies = [{"msg_seq": 7, "content": "阿白是同事", "search_id": "r1"}]
    threads = views.assemble_threads(roots, children, replies, {"wiki/people.md": "同事与朋友"})

    assert [t["id"] for t in threads] == ["r1", "r2"]
    first = threads[0]
    assert [s["search_id"] for s in first["steps"]] == ["r1", "c1"]
    assert first["steps"][0]["reply"] == {"seq": 7, "content": "阿白是同事"}
    assert first["steps"][1]["cues"] == ["同事与朋友"]
    assert first["steps"][1]["reply"] is None


def test_account_parsing_and_masking():
    uid = str(uuid.uuid4())
    account = parse_account({"id": uid, "display_name": "小王", "phone": "13812345678"})
    assert account.slug == f"sp-{uid}"
    assert account.public() == {"display_name": "小王", "phone": "138****5678"}
    assert parse_account({"id": "not-a-uuid"}) is None
    assert parse_account({}) is None


def test_star_page_auth_forwards_cookie_and_caches():
    uid = str(uuid.uuid4())
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.headers.get("cookie", ""))
        token = request.headers.get("cookie", "").split("=", 1)[-1]
        if token == "good":
            return httpx.Response(200, json={"id": uid, "display_name": "u", "phone": "13800000000"})
        if token == "boom":
            return httpx.Response(502)
        return httpx.Response(401, json={"detail": "请先登录"})

    async def main():
        settings = load_web_settings()
        auth = StarPageAuth(settings, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        try:
            assert await auth.account(None) is None
            first = await auth.account("good")
            second = await auth.account("good")
            assert first == second and first.id == uid
            assert calls == [f"{settings.session_cookie}=good"]
            assert await auth.account("bad") is None
            with pytest.raises(AuthUnavailable):
                await auth.account("boom")
            auth.forget("good")
            await auth.account("good")
            assert len(calls) == 4
        finally:
            await auth.aclose()

    asyncio.run(main())


@needs_db
def test_threads_notes_and_recall_against_db():
    async def main():
        owner_url = DB_ENV["MIGRATE_DATABASE_URL"]
        slug = f"e2e-unit-web-{int(time.time() * 1000)}"
        services = await Services.open()
        await tenants.create_tenant(owner_url, slug)
        try:
            user = await services.resolve_user(slug)
            m1 = await capture(services, user, "下周三 15:00 瑞尔齿科复查智齿，最近牙怕冷饮")
            m2 = await capture(services, user, "cforce 15.6 oled 便携屏 999 蹲")
            m3 = await capture(services, user, "周四下午三点和陈总在福田站碰面")
            m4 = await capture(services, user, "陈总习惯看纸质版，记得打印两份报价单")
            await capture(services, user, "凑数的一条")

            page = await views.list_notes(services, user, limit=2)
            assert page["total"] == 5 and page["has_more"] is True
            assert [n["seq"] for n in page["notes"]] == sorted(n["seq"] for n in page["notes"])
            older = await views.list_notes(services, user, before_seq=page["notes"][0]["seq"], limit=10)
            assert older["has_more"] is False and older["total"] is None
            assert {m1["msg_seq"], m2["msg_seq"]} <= {n["seq"] for n in older["notes"]}

            assert m1["msg_seq"] in await views.recall(services, user, "下周三下午能约冰美式吗")
            assert await views.recall(services, user, "便携屏多少钱") == [m2["msg_seq"]]
            # 「四见」「总要」等跨词二字组在记录里不存在，不计入门槛：只命中「陈总」的那条也要浮现
            assert await views.recall(services, user, "周四见陈总要带什么") == [m3["msg_seq"], m4["msg_seq"]]

            async with services.tx(user) as conn:
                root = await (
                    await conn.execute(
                        """
                        INSERT INTO search_logs (user_id, query_text, route_path, outcome, clarify_question)
                        VALUES (%s, '阿白推荐的店叫什么', 'primary_direct', 'clarify_asked', '阿白是谁？')
                        RETURNING id::text AS id
                        """,
                        (user.id,),
                    )
                ).fetchone()
            reply = await capture(services, user, "阿白是同事白静", source_kind="clarification", reply_to_search_id=root["id"])
            async with services.tx(user) as conn:
                await conn.execute(
                    """
                    INSERT INTO search_logs (user_id, query_text, route_path, outcome, answer_text, verified_msg_seqs, parent_search_id)
                    VALUES (%s, '阿白推荐的店叫什么', 'primary_direct', 'answered', '还没记过店名', %s, %s)
                    """,
                    (user.id, [reply["msg_seq"]], root["id"]),
                )
            listed = await views.list_threads(services, user)
            assert listed["has_more"] is False and len(listed["threads"]) == 1
            steps = listed["threads"][0]["steps"]
            assert [s["outcome"] for s in steps] == ["clarify_asked", "answered"]
            assert steps[0]["reply"]["content"] == "阿白是同事白静"
            assert steps[1]["seqs"] == [reply["msg_seq"]]

            ctx = await views.context(services, user)
            assert ctx["sections"] == [] and ctx["pages"] == []
            assert ctx["stats"]["notes"] == 6 and ctx["stats"]["pending"] == 6
            assert (await views.usage_today(services, user)) == {"asks": 2, "captures": 6}
        finally:
            await services.close()
            await tenants.drop_tenant(owner_url, slug, NAS_ROOT)

    asyncio.run(main())


class _StubAuth:
    def __init__(self, account: Account) -> None:
        self._account = account
        self.forgotten: list[str] = []

    async def account(self, token):
        return self._account if token == "good" else None

    def forget(self, token):
        self.forgotten.append(token)

    async def aclose(self):
        pass


@needs_db
def test_api_star_page_mode_end_to_end():
    from fastapi.testclient import TestClient

    from percolation import api

    if not api.WEB.public:
        pytest.skip("config/web.env 不是 star_page 模式")
    account = Account(id=str(uuid.uuid4()), display_name="测试", phone="13800001234")
    good = {api.WEB.session_cookie: "good"}
    user_id = None
    try:
        with TestClient(api.app) as client:
            client.app.state.auth = _StubAuth(account)

            anon = client.get("/v1/session").json()
            assert anon["logged_in"] is False and anon["login"]["provider"] == "star_page"
            assert client.get("/v1/notes").status_code == 401
            assert client.get("/v1/notes", headers={"X-User-Slug": "default"}).status_code == 401

            client.cookies.update(good)
            me = client.get("/v1/session").json()
            assert me["logged_in"] is True and me["account"]["phone"] == "138****1234"

            empty = client.get("/v1/notes").json()
            assert empty == {"notes": [], "has_more": False, "total": 0}
            user_id = client.app.state.tenants[account.slug].id

            saved = client.post("/v1/capture", json={"content": "  周四见陈总，带两份纸质报价单  "}).json()
            assert saved["note"]["content"] == "周四见陈总，带两份纸质报价单"
            assert saved["note"]["status"] == "pending"
            assert client.get("/v1/notes").json()["total"] == 1
            assert client.get("/v1/recall", params={"q": "陈总那边要带什么"}).json() == {"seqs": [saved["msg_seq"]]}
            assert client.get("/v1/threads").json() == {"threads": [], "has_more": False}
            assert client.get("/v1/threads", params={"before_id": "x"}).status_code == 422
            assert client.get("/v1/context").json()["stats"]["notes"] == 1
            assert client.post("/v1/dream", json={}).status_code == 403
            assert client.post("/v1/clarify", json={"search_id": "nope", "content": "x"}).status_code == 404
            assert client.post("/v1/session/forget").status_code == 204

            index = client.get("/")
            assert index.status_code == 200 and "{{v}}" not in index.text and "app.js?v=" in index.text
            assert client.get("/app.js").status_code == 200
            assert client.get("/docs").status_code == 404
    finally:
        if user_id:
            asyncio.run(_drop_external_tenant(user_id))


def test_console_phone_whitelist_matching():
    assert normalize_phone(" 138-0000-1234 ") == "13800001234"
    assert normalize_phone("+86 13800001234") == "13800001234"
    assert normalize_phone("8613800001234") == "13800001234"
    assert normalize_phone("") == ""

    wl = parse_phone_whitelist("13800001234, +86 13900005678; ")
    assert wl == frozenset({"13800001234", "13900005678"})
    assert parse_phone_whitelist("") == frozenset()

    base = load_web_settings()
    pub = base.__class__(**{**base.__dict__, "auth_mode": "star_page", "console_phone_whitelist": wl})
    assert pub.is_console_allowed("13800001234") is True
    assert pub.is_console_allowed("+8613900005678") is True
    assert pub.is_console_allowed("13700009999") is False
    assert pub.is_console_allowed("") is False
    assert pub.is_console_allowed(None) is False

    empty_wl = base.__class__(**{**base.__dict__, "auth_mode": "star_page", "console_phone_whitelist": frozenset()})
    assert empty_wl.is_console_allowed("13800001234") is False

    dbg = base.__class__(**{**base.__dict__, "auth_mode": "header", "console_phone_whitelist": frozenset()})
    assert dbg.is_console_allowed(None) is True


class _MultiStubAuth:
    def __init__(self, accounts: dict[str, Account]) -> None:
        self._accounts = accounts

    async def account(self, token):
        return self._accounts.get(token)

    def forget(self, token):
        pass

    async def aclose(self):
        pass


@needs_db
def test_console_whitelist_access_control():
    from fastapi.testclient import TestClient

    from percolation import api

    if not api.WEB.public:
        pytest.skip("config/web.env 不是 star_page 模式")

    allowed = Account(id=str(uuid.uuid4()), display_name="管理员", phone="13800001111")
    blocked = Account(id=str(uuid.uuid4()), display_name="普通用户", phone="13900002222")
    orig_web = api.WEB
    patched_web = orig_web.__class__(
        **{**orig_web.__dict__, "console_phone_whitelist": frozenset({"13800001111"})}
    )
    try:
        with TestClient(api.app) as client:
            client.app.state.web = patched_web
            client.app.state.auth = _MultiStubAuth({"admin": allowed, "user": blocked})

            # 未登录：/v1/session console=False，控制台全部 401
            assert client.get("/v1/session").json()["console"] is False
            assert client.get("/console", follow_redirects=False).status_code == 401
            assert client.get("/console/").status_code == 401
            assert client.get("/console/app.js").status_code == 401
            assert client.get("/console/shared/generated.js").status_code == 401

            # 非白名单手机号：/v1/session console=False，控制台全部 403
            client.cookies.set(patched_web.session_cookie, "user")
            assert client.get("/v1/session").json()["console"] is False
            assert client.get("/console", follow_redirects=False).status_code == 403
            html_denied = client.get("/console/", headers={"Accept": "text/html"})
            assert html_denied.status_code == 403 and "无权访问" in html_denied.text
            assert client.get("/console/app.js").status_code == 403
            assert client.get("/console/shared/generated.js").status_code == 403

            # 白名单手机号：/v1/session console=True，控制台可访问，且路径穿越被拦截
            client.cookies.set(patched_web.session_cookie, "admin")
            assert client.get("/v1/session").json()["console"] is True
            redir = client.get("/console", follow_redirects=False)
            assert redir.status_code == 307 and redir.headers["location"] == "console/"
            idx = client.get("/console/")
            assert idx.status_code == 200 and "{{v}}" not in idx.text and "shared/generated.js?v=" in idx.text
            assert client.get("/console/app.js").status_code == 200
            assert client.get("/console/shared/generated.js").status_code == 200
            assert client.get("/console/../web/app.js").status_code == 404
    finally:
        pass


async def _drop_external_tenant(user_id: str) -> None:
    pool = await create_pool(DB_ENV["MIGRATE_DATABASE_URL"], max_size=1)
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                await conn.execute("ALTER TABLE raw_messages DISABLE TRIGGER raw_messages_guard")
                await conn.execute("DELETE FROM raw_messages WHERE user_id = %s", (user_id,))
                await conn.execute("ALTER TABLE raw_messages ENABLE TRIGGER raw_messages_guard")
                await conn.execute("DELETE FROM users WHERE id = %s", (user_id,))
    finally:
        await pool.close()
    workspace = NAS_ROOT / "workspaces" / user_id
    if workspace.is_dir():
        shutil.rmtree(workspace)
