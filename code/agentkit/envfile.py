from __future__ import annotations

import os
from pathlib import Path


def load_env_file(path: Path) -> dict[str, str]:
    """读取 KEY=VALUE 格式的 env 文件。文件不存在时返回空字典。"""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def merge_env(paths: list[Path]) -> dict[str, str]:
    """按顺序合并多个 env 文件，进程环境变量优先级最高。"""
    merged: dict[str, str] = {}
    for path in paths:
        merged.update(load_env_file(path))
    for key in list(merged):
        if key in os.environ:
            merged[key] = os.environ[key]
    return merged
