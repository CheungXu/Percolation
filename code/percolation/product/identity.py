"""星页登录态识别。

拾记凝境挂在 stars-page.com/Percolation 下，与星页同域，浏览器会带上星页的登录 cookie。
这里把 cookie 原样转给星页的 /api/auth/me 换出账号，不读星页的库、不碰它的签名密钥。
同一个 cookie 的结果在进程内缓存一小段时间，星页退出登录后最迟 TTL 秒内失效。
"""

from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass

import httpx

from percolation.product.settings import WebSettings

TENANT_PREFIX = "sp-"


class AuthUnavailable(RuntimeError):
    """星页鉴权接口连不上或返回 5xx。和「没登录」区分开，前端提示稍后再试而不是弹登录。"""


@dataclass(frozen=True)
class Account:
    id: str
    display_name: str
    phone: str

    @property
    def slug(self) -> str:
        return f"{TENANT_PREFIX}{self.id}"

    @property
    def phone_masked(self) -> str:
        p = self.phone
        return f"{p[:3]}****{p[-4:]}" if len(p) >= 11 else p

    def public(self) -> dict:
        return {"display_name": self.display_name, "phone": self.phone_masked}


def parse_account(payload: dict) -> Account | None:
    try:
        account_id = str(uuid.UUID(str(payload.get("id"))))
    except (TypeError, ValueError):
        return None
    return Account(
        id=account_id,
        display_name=str(payload.get("display_name") or ""),
        phone=str(payload.get("phone") or ""),
    )


class StarPageAuth:
    def __init__(
        self,
        settings: WebSettings,
        *,
        ttl: float = 60,
        negative_ttl: float = 5,
        max_entries: int = 5000,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings
        self.ttl = ttl
        self.negative_ttl = negative_ttl
        self.max_entries = max_entries
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(5.0))
        self._cache: dict[str, tuple[float, Account | None]] = {}

    async def aclose(self) -> None:
        await self.client.aclose()

    def forget(self, token: str | None) -> None:
        if token:
            self._cache.pop(self._key(token), None)

    @staticmethod
    def _key(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    async def account(self, token: str | None) -> Account | None:
        if not token:
            return None
        key = self._key(token)
        now = time.monotonic()
        hit = self._cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
        account = await self._fetch(token)
        if len(self._cache) >= self.max_entries:
            self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
            if len(self._cache) >= self.max_entries:
                self._cache.clear()
        self._cache[key] = (now + (self.ttl if account else self.negative_ttl), account)
        return account

    async def _fetch(self, token: str) -> Account | None:
        try:
            resp = await self.client.get(
                self.settings.star_page_auth_url,
                headers={"Cookie": f"{self.settings.session_cookie}={token}", "Accept": "application/json"},
            )
        except httpx.HTTPError as exc:
            raise AuthUnavailable(f"星页鉴权接口不可用：{type(exc).__name__}") from exc
        if resp.status_code in (401, 403):
            return None
        if resp.status_code >= 500:
            raise AuthUnavailable(f"星页鉴权接口返回 {resp.status_code}")
        if resp.status_code != 200:
            return None
        try:
            return parse_account(resp.json())
        except ValueError:
            return None
