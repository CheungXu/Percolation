"""网页端配置，读 config/web.env（进程环境变量优先）。只给 HTTP 接口用，不进执行环境锚点。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from agentkit.envfile import merge_env
from percolation.config import REPO_ROOT

AUTH_MODES = ("star_page", "header")


@dataclass(frozen=True)
class WebSettings:
    auth_mode: str
    star_page_auth_url: str
    session_cookie: str
    agreement_version: str
    terms_url: str
    privacy_url: str
    daily_ask_limit: int
    daily_capture_limit: int
    web_dir: Path

    @property
    def public(self) -> bool:
        return self.auth_mode == "star_page"


def load_web_settings(root: Path | None = None) -> WebSettings:
    root = Path(root or REPO_ROOT)
    env = merge_env([root / "config" / "web.env"])
    mode = env.get("AUTH_MODE", "star_page")
    if mode not in AUTH_MODES:
        raise RuntimeError(f"config/web.env 的 AUTH_MODE 只能是 {AUTH_MODES}：{mode}")
    return WebSettings(
        auth_mode=mode,
        star_page_auth_url=env.get("STAR_PAGE_AUTH_URL", "http://127.0.0.1:8080/api/auth/me"),
        session_cookie=env.get("STAR_PAGE_SESSION_COOKIE", "sp_session"),
        agreement_version=env.get("STAR_PAGE_AGREEMENT_VERSION", ""),
        terms_url=env.get("STAR_PAGE_TERMS_URL", "/terms"),
        privacy_url=env.get("STAR_PAGE_PRIVACY_URL", "/privacy"),
        daily_ask_limit=int(env.get("DAILY_ASK_LIMIT", "200")),
        daily_capture_limit=int(env.get("DAILY_CAPTURE_LIMIT", "1000")),
        web_dir=Path(env.get("WEB_DIR") or root / "code" / "web"),
    )
