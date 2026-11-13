"""租户工作区的目录约定、写入规则、git 快照与整理暂存区。"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
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
STALE_LOCK_SECONDS = 600
GIT_TIMEOUT_SECONDS = 60


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
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=True, timeout=GIT_TIMEOUT_SECONDS
    )
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


def git_head(ws: Workspace | Path) -> str | None:
    root = ws.root if isinstance(ws, Workspace) else ws
    try:
        return _git(root, "rev-parse", "HEAD").strip() or None
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None


def commit_exists(ws: Workspace, rev: str) -> bool:
    try:
        _git(ws.root, "cat-file", "-e", f"{rev}^{{commit}}")
        return True
    except subprocess.CalledProcessError:
        return False


def is_ancestor(ws: Workspace, ancestor: str, descendant: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(ws.root), "merge-base", "--is-ancestor", ancestor, descendant], capture_output=True
    )
    return result.returncode == 0


def clear_stale_lock(ws: Workspace, max_age_seconds: int = STALE_LOCK_SECONDS) -> bool:
    """进程崩溃会在 NFS 上留下 index.lock，导致之后的提交全部失败。只能在持有整理锁时调用。"""
    lock = ws.root / ".git" / "index.lock"
    if lock.exists() and time.time() - lock.stat().st_mtime > max_age_seconds:
        lock.unlink(missing_ok=True)
        return True
    return False


def gc_auto(ws: Workspace) -> None:
    subprocess.run(["git", "-C", str(ws.root), "gc", "--auto", "--quiet"], capture_output=True)


# ---- 暂存区：整理在独立 worktree 里写，成功后主工作区快进，失败整个丢弃 ----


def staging_branch(run_id: str) -> str:
    return f"dream/{run_id}"


def create_staging(main: Workspace, path: Path, branch: str) -> Workspace:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    for directory in (path.parent.parent, path.parent):
        os.chmod(directory, 0o700)
    if path.exists():
        remove_staging(main, path, branch)
    _git(main.root, "worktree", "add", "-q", "-b", branch, str(path), "HEAD")
    for name in (CACHE_DIR, WIKI_DIR):
        (path / name).mkdir(exist_ok=True)
    return Workspace(path)


def remove_staging(main: Workspace, path: Path, branch: str, *, keep_branch: bool = False) -> None:
    subprocess.run(["git", "-C", str(main.root), "worktree", "remove", "--force", str(path)], capture_output=True)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    subprocess.run(["git", "-C", str(main.root), "worktree", "prune"], capture_output=True)
    if not keep_branch:
        subprocess.run(["git", "-C", str(main.root), "branch", "-q", "-D", branch], capture_output=True)


def prune_merged_staging_branches(main: Workspace) -> list[str]:
    """快进补齐后，之前为保住提交而留下的 dream/* 分支已并入主线，可以删掉。"""
    merged = _git(main.root, "branch", "--format=%(refname:short)", "--merged", "HEAD", "--list", "dream/*").split()
    for branch in merged:
        subprocess.run(["git", "-C", str(main.root), "branch", "-q", "-D", branch], capture_output=True)
    return merged


def fast_forward(main: Workspace, rev: str) -> None:
    _git(main.root, "merge", "-q", "--ff-only", rev)


def ensure_published(main: Workspace, published_head: str | None) -> bool:
    """库里登记的发布版本领先于主工作区时补快进（上次发布在快进前中断）。返回是否做了修复。

    主工作区领先（人工提交了、索引还没跟上）不在这里处理，交给调用方重新同步并登记新版本。
    """
    current = git_head(main)
    if not published_head or published_head == current:
        return False
    if not commit_exists(main, published_head):
        raise RuntimeError(f"已发布版本 {published_head[:8]} 在工作区里不存在，需要人工处理")
    if current and is_ancestor(main, published_head, current):
        return False
    if current and not is_ancestor(main, current, published_head):
        raise RuntimeError(f"主工作区 HEAD {current[:8]} 与已发布版本 {published_head[:8]} 分叉，需要人工处理")
    fast_forward(main, published_head)
    return True
