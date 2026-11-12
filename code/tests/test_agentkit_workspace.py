import asyncio
import shutil
from pathlib import Path

import pytest

from agentkit import AgentSpec, RunContext, ToolError, run_agent
from agentkit.sandbox import Bind, BwrapSandbox
from agentkit.skills import SkillLibrary
from agentkit.testing import ScriptedChatClient, call_tool, reply
from agentkit.workspace import Workspace, workspace_tools

needs_bwrap = pytest.mark.skipif(shutil.which("bwrap") is None, reason="bwrap 未安装")


@pytest.fixture
def ws(tmp_path: Path) -> Workspace:
    (tmp_path / "MEMORY_CACHE").mkdir()
    (tmp_path / "MEMORY_CACHE" / "slang.md").write_text("老张：供应商张伟\n", encoding="utf-8")
    (tmp_path / "wiki").mkdir()
    (tmp_path / "MEMORY.md").write_text("# 热区\n", encoding="utf-8")
    (tmp_path / ".git").mkdir()
    return Workspace(tmp_path)


def by_name(tools):
    return {tool.name: tool for tool in tools}


def invoke(tool, args, ctx):
    import json

    return asyncio.run(tool.invoke(json.dumps(args, ensure_ascii=False), ctx))


def test_path_escape_and_hidden_rejected(ws):
    with pytest.raises(ToolError):
        ws.resolve("../etc/passwd")
    with pytest.raises(ToolError):
        ws.resolve(".git/config")
    with pytest.raises(ToolError):
        ws.resolve("MEMORY.md", scope="MEMORY_CACHE")
    assert ws.resolve("/workspace/MEMORY.md") == ws.root / "MEMORY.md"


def test_scope_and_write_rules(ws):
    def no_inferred(rel, text):
        return "热区不能写推测" if rel == "MEMORY.md" and "[inferred]" in text else None

    tools = by_name(workspace_tools(writable=True, write_prefixes=("MEMORY.md", "wiki/"), validators=(no_inferred,)))
    ctx = RunContext(workspace=ws)
    text, ok = invoke(tools["write_file"], {"path": "MEMORY_CACHE/x.md", "content": "a"}, ctx)
    assert not ok and "只允许写入" in text
    text, ok = invoke(tools["write_file"], {"path": "MEMORY.md", "content": "- [inferred] x"}, ctx)
    assert not ok and "推测" in text
    text, ok = invoke(tools["write_file"], {"path": "wiki/a.md", "content": "hello\nworld"}, ctx)
    assert ok and (ws.root / "wiki/a.md").read_text() == "hello\nworld"
    text, ok = invoke(tools["edit_file"], {"path": "wiki/a.md", "old_text": "world", "new_text": "there"}, ctx)
    assert ok and (ws.root / "wiki/a.md").read_text() == "hello\nthere"
    text, ok = invoke(tools["read_file"], {"path": "wiki/a.md"}, ctx)
    assert "2| there" in text
    readonly = by_name(workspace_tools(scope="MEMORY_CACHE"))
    assert "write_file" not in readonly
    text, ok = invoke(readonly["read_file"], {"path": "MEMORY.md"}, ctx)
    assert not ok


@needs_bwrap
def test_bwrap_readonly_scope(ws):
    tools = by_name(workspace_tools(scope="MEMORY_CACHE"))
    ctx = RunContext(workspace=ws, sandbox=BwrapSandbox())
    text, ok = invoke(tools["bash"], {"command": "rg -n 老张 . && ls /workspace && cat /workspace/MEMORY.md; touch MEMORY_CACHE/x; env | wc -l"}, ctx)
    assert ok
    assert "供应商张伟" in text
    assert "No such file" in text
    assert "Read-only file system" in text
    assert not (ws.root / "MEMORY_CACHE" / "x").exists()


@needs_bwrap
def test_bwrap_no_network_and_timeout(tmp_path):
    sandbox = BwrapSandbox()
    result = asyncio.run(sandbox.run("cat /proc/net/dev | wc -l; sleep 3", binds=[Bind(tmp_path, "/workspace")], timeout=0.5))
    assert result.timed_out


def test_skills_index_and_read(tmp_path, ws):
    skill_dir = tmp_path / "skills" / "wiki-format"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("---\nname: wiki-format\ndescription: 主题页格式\n---\n# 正文\n用 [#msg_N] 锚点\n", encoding="utf-8")
    library = SkillLibrary(tmp_path / "skills")
    assert "wiki-format：主题页格式" in library.index_text()
    chat = ScriptedChatClient([call_tool("read_skill", {"name": "wiki-format"}), reply("done")])
    spec = AgentSpec(name="t", model_slot="x", system_prompt="s", skills_dir=tmp_path / "skills")
    asyncio.run(run_agent(spec, "q", RunContext(workspace=ws), chat=chat))
    assert "可用技能" in chat.requests[0]["messages"][0]["content"]
    assert "[#msg_N]" in chat.requests[1]["messages"][-1]["content"]
