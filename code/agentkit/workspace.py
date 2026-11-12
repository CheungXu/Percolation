"""租户工作区与受限文件工具。

路径一律相对工作区根目录，解析后必须仍在根目录（以及可选的 scope 子目录）内，
`.git` 对 agent 不可见。shell 类操作只走沙箱。
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable
from pathlib import Path

from pydantic import BaseModel, Field

from agentkit.sandbox import Bind
from agentkit.tools import Tool, ToolError

HIDDEN_NAMES = {".git"}
SANDBOX_ROOT = "/workspace"

WriteValidator = Callable[[str, str], str | None]


class Workspace:
    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()

    def resolve(self, rel: str, *, scope: str | None = None) -> Path:
        cleaned = (rel or ".").strip()
        if cleaned.startswith(SANDBOX_ROOT):
            cleaned = cleaned[len(SANDBOX_ROOT) :]
        cleaned = cleaned.lstrip("/") or "."
        path = (self.root / cleaned).resolve()
        if path != self.root and self.root not in path.parents:
            raise ToolError(f"路径越出工作区：{rel}")
        relative = path.relative_to(self.root)
        if any(part in HIDDEN_NAMES for part in relative.parts):
            raise ToolError(f"不允许访问：{rel}")
        if scope:
            scope_root = (self.root / scope).resolve()
            if path != scope_root and scope_root not in path.parents:
                raise ToolError(f"只允许访问 {scope}/ 下的文件：{rel}")
        return path

    def rel(self, path: Path) -> str:
        relative = path.resolve().relative_to(self.root).as_posix()
        return relative if relative != "." else "."

    def read_text(self, rel: str) -> str:
        path = self.resolve(rel)
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    def write_atomic(self, rel: str, text: str) -> Path:
        path = self.resolve(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
        return path

    def files(self, subdir: str = ".", pattern: str = "**/*") -> list[Path]:
        base = self.resolve(subdir)
        if not base.is_dir():
            return []
        return sorted(
            path
            for path in base.glob(pattern)
            if path.is_file() and not any(part in HIDDEN_NAMES or part.startswith(".tmp-") for part in path.relative_to(self.root).parts)
        )


class ListDirArgs(BaseModel):
    path: str = Field(default=".", description="相对工作区的目录")
    recursive: bool = Field(default=False, description="是否递归列出")


class ReadFileArgs(BaseModel):
    path: str = Field(description="相对工作区的文件路径")
    start_line: int = Field(default=1, ge=1)
    end_line: int | None = Field(default=None, ge=1)


class BashArgs(BaseModel):
    command: str = Field(description="只读 shell 命令，例如 ls -R、rg -n 关键词、head -n 50 文件")


class WriteFileArgs(BaseModel):
    path: str
    content: str = Field(description="文件完整新内容")


class EditFileArgs(BaseModel):
    path: str
    old_text: str = Field(description="要替换的原文，必须与文件内容逐字一致（不含行号前缀）")
    new_text: str
    replace_all: bool = False


class DeleteFileArgs(BaseModel):
    path: str


def _workspace(ctx) -> Workspace:
    if ctx.workspace is None:
        raise ToolError("当前运行没有工作区")
    return ctx.workspace


def workspace_tools(
    *,
    scope: str | None = None,
    writable: bool = False,
    write_prefixes: tuple[str, ...] | None = None,
    allow_delete: bool = False,
    validators: tuple[WriteValidator, ...] = (),
    bash_timeout: float = 5.0,
) -> list[Tool]:
    """生成一组文件工具。scope 限制可见子目录；writable 才会带写工具。"""

    where = f"{scope}/" if scope else "工作区"

    def list_dir(args: ListDirArgs, ctx) -> str:
        ws = _workspace(ctx)
        base = ws.resolve(args.path, scope=scope)
        if not base.is_dir():
            raise ToolError(f"不是目录：{args.path}")
        paths = ws.files(ws.rel(base)) if args.recursive else sorted(
            p for p in base.iterdir() if p.name not in HIDDEN_NAMES and not p.name.startswith(".tmp-")
        )
        lines = []
        for path in paths:
            if path.is_dir():
                lines.append(f"{ws.rel(path)}/")
            else:
                line_count = path.read_text(encoding="utf-8", errors="replace").count("\n")
                lines.append(f"{ws.rel(path)}  ({line_count} 行)")
        return "\n".join(lines) or "（空目录）"

    def read_file(args: ReadFileArgs, ctx) -> str:
        ws = _workspace(ctx)
        path = ws.resolve(args.path, scope=scope)
        if not path.is_file():
            raise ToolError(f"文件不存在：{args.path}")
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        end = min(args.end_line or len(lines), len(lines))
        body = "\n".join(f"{number:>5}| {lines[number - 1]}" for number in range(args.start_line, end + 1))
        return body or "（空文件）"

    async def bash(args: BashArgs, ctx) -> str:
        ws = _workspace(ctx)
        if ctx.sandbox is None:
            raise ToolError("当前运行没有配置沙箱")
        if scope:
            binds = [Bind(ws.resolve(scope, scope=scope), f"{SANDBOX_ROOT}/{scope}", readonly=True)]
        else:
            binds = [Bind(ws.root, SANDBOX_ROOT, readonly=True)]
        result = await ctx.sandbox.run(args.command, binds=binds, cwd=SANDBOX_ROOT, timeout=bash_timeout)
        return result.render()

    def check_write(ws: Workspace, rel_path: str, text: str) -> Path:
        path = ws.resolve(rel_path, scope=scope)
        rel = ws.rel(path)
        if write_prefixes and not any(rel == p.rstrip("/") or rel.startswith(p) for p in write_prefixes):
            raise ToolError(f"只允许写入：{', '.join(write_prefixes)}")
        for validate in validators:
            error = validate(rel, text)
            if error:
                raise ToolError(error)
        return path

    def write_file(args: WriteFileArgs, ctx) -> str:
        ws = _workspace(ctx)
        path = check_write(ws, args.path, args.content)
        ws.write_atomic(ws.rel(path), args.content)
        ctx.trace.event("file_write", path=ws.rel(path))
        return f"已写入 {ws.rel(path)}（{args.content.count(chr(10)) + 1} 行）"

    def edit_file(args: EditFileArgs, ctx) -> str:
        ws = _workspace(ctx)
        path = ws.resolve(args.path, scope=scope)
        if not path.is_file():
            raise ToolError(f"文件不存在：{args.path}")
        text = path.read_text(encoding="utf-8")
        count = text.count(args.old_text)
        if count == 0:
            raise ToolError("old_text 在文件中找不到，先 read_file 确认原文")
        if count > 1 and not args.replace_all:
            raise ToolError(f"old_text 出现 {count} 次，请提供更长的上下文或设置 replace_all")
        updated = text.replace(args.old_text, args.new_text) if args.replace_all else text.replace(args.old_text, args.new_text, 1)
        check_write(ws, args.path, updated)
        ws.write_atomic(ws.rel(path), updated)
        ctx.trace.event("file_write", path=ws.rel(path))
        return f"已修改 {ws.rel(path)}"

    def delete_file(args: DeleteFileArgs, ctx) -> str:
        ws = _workspace(ctx)
        path = check_write(ws, args.path, "")
        if not path.is_file():
            raise ToolError(f"文件不存在：{args.path}")
        path.unlink()
        ctx.trace.event("file_delete", path=ws.rel(path))
        return f"已删除 {ws.rel(path)}"

    tools = [
        Tool("list_dir", f"列出{where}下的文件和行数。", ListDirArgs, list_dir, frozenset({"read"})),
        Tool("read_file", f"读取{where}下的文件，输出带行号前缀（行号不是内容）。", ReadFileArgs, read_file, frozenset({"read"})),
        Tool(
            "bash",
            f"在断网的只读沙箱里执行 shell 命令，工作目录 /workspace，可见范围是{where}。适合 ls、rg、head、wc。",
            BashArgs,
            bash,
            frozenset({"read", "shell"}),
        ),
    ]
    if writable:
        tools += [
            Tool("write_file", f"整体写入{where}下的文件（不存在则新建）。", WriteFileArgs, write_file, frozenset({"write"})),
            Tool("edit_file", f"按原文精确替换{where}下文件的一段内容。", EditFileArgs, edit_file, frozenset({"write"})),
        ]
    if writable and allow_delete:
        tools.append(Tool("delete_file", f"删除{where}下的文件。", DeleteFileArgs, delete_file, frozenset({"write"})))
    return tools
