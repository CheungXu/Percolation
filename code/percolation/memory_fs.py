"""租户工作区的目录约定、写入规则与 git 快照。"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from agentkit.workspace import Workspace

MEMORY_FILE = "MEMORY.md"
CACHE_DIR = "MEMORY_CACHE"
WIKI_DIR = "wiki"
DOC_PATH_RE = re.compile(r"^wiki/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}\.md$")
CACHE_PATH_RE = re.compile(r"^MEMORY_CACHE/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.md$")

INITIAL_MEMORY = """# 运行注入区

只放已经确认、而且经常会用到的个人背景和暗语。控制在 200 行以内。还没确认的猜测不要写在这里。
"""

GIT_IDENTITY = ["-c", "user.name=percolation-dream", "-c", "user.email=dream@percolation.local"]


def open_workspace(root: Path) -> Workspace:
    root.mkdir(parents=True, exist_ok=True)
    (root / CACHE_DIR).mkdir(exist_ok=True)
    (root / WIKI_DIR).mkdir(exist_ok=True)
    memory = root / MEMORY_FILE
    if not memory.exists():
        memory.write_text(INITIAL_MEMORY, encoding="utf-8")
    if not (root / ".git").exists():
        _git(root, "init", "-q")
        _git(root, "add", "-A")
        _git(root, *GIT_IDENTITY, "commit", "-q", "--allow-empty", "-m", "init workspace")
    return Workspace(root)


def line_count(text: str) -> int:
    return len(text.splitlines())


def memory_validators(limit: int):
    def memory_rules(rel: str, text: str) -> str | None:
        if rel != MEMORY_FILE:
            return None
        if line_count(text) > limit:
            return f"MEMORY.md 不能超过 {limit} 行（当前 {line_count(text)} 行），先把低频条目下沉到 MEMORY_CACHE/"
        if "[inferred]" in text:
            return "MEMORY.md 只能放已确认事实，[inferred] 条目留在 wiki 或 MEMORY_CACHE"
        return None

    def path_rules(rel: str, text: str) -> str | None:
        if rel.startswith(f"{WIKI_DIR}/") and not DOC_PATH_RE.match(rel):
            return "wiki 文件名只能用英文字母、数字、点、横线和下划线，并以 .md 结尾，例如 wiki/digital-gear.md"
        if rel.startswith(f"{CACHE_DIR}/") and not CACHE_PATH_RE.match(rel):
            return "MEMORY_CACHE 文件名只能用英文字母、数字、点、横线和下划线，并以 .md 结尾，例如 MEMORY_CACHE/people.md"
        return None

    return (memory_rules, path_rules)


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=True)
    return result.stdout


def changed_files(ws: Workspace) -> list[str]:
    output = _git(ws.root, "status", "--porcelain", "--untracked-files=all")
    files = []
    for line in output.splitlines():
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        files.append(path.strip('"'))
    return sorted(set(files))


def git_commit(ws: Workspace, message: str) -> str | None:
    if not changed_files(ws):
        return None
    _git(ws.root, "add", "-A")
    _git(ws.root, *GIT_IDENTITY, "commit", "-q", "-m", message)
    return _git(ws.root, "rev-parse", "--short", "HEAD").strip()


def git_discard(ws: Workspace) -> None:
    """整理失败时丢弃未提交的改动，让文件回到上一次成功快照。"""
    _git(ws.root, "reset", "-q", "--hard", "HEAD")
    _git(ws.root, "clean", "-q", "-fd")
