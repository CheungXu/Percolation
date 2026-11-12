"""受限命令执行。

应用层的路径字符串校验拦不住子进程逃逸，所以 shell 命令一律进内核命名空间沙箱。
SandboxExecutor 是接口；本机用 BwrapSandbox，扩容时换成云端沙箱实现，调用方不变。
"""

from __future__ import annotations

import asyncio
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

SYSTEM_RO_DIRS = ("/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc/alternatives")


@dataclass(frozen=True)
class Bind:
    source: Path
    target: str
    readonly: bool = True


@dataclass
class SandboxResult:
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False
    truncated: bool = False

    def render(self) -> str:
        parts = []
        if self.stdout:
            parts.append(self.stdout.rstrip())
        if self.stderr:
            parts.append(f"[stderr]\n{self.stderr.rstrip()}")
        if self.timed_out:
            parts.append("[超时，进程已终止]")
        if self.truncated:
            parts.append("[输出已截断]")
        parts.append(f"[exit {self.exit_code}]")
        return "\n".join(parts)


class SandboxExecutor(Protocol):
    async def run(
        self,
        command: str,
        *,
        binds: list[Bind],
        cwd: str = "/workspace",
        timeout: float = 5.0,
        max_output: int = 8000,
    ) -> SandboxResult: ...


@dataclass
class BwrapSandbox:
    """Bubblewrap：断网、清空环境变量、只挂载显式声明的目录。"""

    bwrap_path: str = field(default_factory=lambda: shutil.which("bwrap") or "/usr/bin/bwrap")
    path_env: str = "/usr/local/bin:/usr/bin:/bin"

    def build_args(self, command: str, binds: list[Bind], cwd: str) -> list[str]:
        args = [self.bwrap_path, "--unshare-all", "--die-with-parent", "--new-session", "--clearenv"]
        for directory in SYSTEM_RO_DIRS:
            if os.path.islink(directory):
                args += ["--symlink", os.readlink(directory), directory]
            elif os.path.isdir(directory):
                args += ["--ro-bind", directory, directory]
        args += ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"]
        for bind in binds:
            source = str(Path(bind.source).resolve())
            args += ["--ro-bind" if bind.readonly else "--bind", source, bind.target]
        args += [
            "--chdir", cwd,
            "--setenv", "PATH", self.path_env,
            "--setenv", "LANG", "C.UTF-8",
            "--setenv", "LC_ALL", "C.UTF-8",
            "--setenv", "HOME", "/tmp",
            "--", "/bin/bash", "-c", command,
        ]
        return args

    async def run(
        self,
        command: str,
        *,
        binds: list[Bind],
        cwd: str = "/workspace",
        timeout: float = 5.0,
        max_output: int = 8000,
    ) -> SandboxResult:
        process = await asyncio.create_subprocess_exec(
            *self.build_args(command, binds, cwd),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        timed_out = False
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except TimeoutError:
            timed_out = True
            process.kill()
            stdout, stderr = await process.communicate()
        out = stdout.decode(errors="replace")
        err = stderr.decode(errors="replace")
        truncated = len(out) + len(err) > max_output
        return SandboxResult(
            exit_code=process.returncode if process.returncode is not None else -1,
            stdout=out[:max_output],
            stderr=err[: max(0, max_output - len(out))][:2000],
            timed_out=timed_out,
            truncated=truncated,
        )
