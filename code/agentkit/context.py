from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from agentkit.trace import Trace

if TYPE_CHECKING:
    from agentkit.llm.chat import ChatClient
    from agentkit.llm.registry import ModelRegistry
    from agentkit.sandbox import SandboxExecutor
    from agentkit.workspace import Workspace


@dataclass
class RunContext:
    """一次运行的资源容器。工具只能从这里拿资源，因此天然按租户隔离。

    deps 放业务自己的依赖（连接池、检索器等），agentkit 不关心它的类型。
    chat_clients 可按槽位注入替身客户端，单测用。
    """

    tenant_id: str | None = None
    models: ModelRegistry | None = None
    workspace: Workspace | None = None
    sandbox: SandboxExecutor | None = None
    trace: Trace = field(default_factory=Trace)
    deps: Any = None
    chat_clients: dict[str, ChatClient] = field(default_factory=dict)

    def chat_for(self, slot: str, params: dict[str, Any] | None = None) -> ChatClient:
        if slot in self.chat_clients:
            return self.chat_clients[slot]
        if self.models is None:
            raise RuntimeError("RunContext 没有配置 models，也没有为该槽位注入 chat 客户端")
        return self.models.chat(slot, params=params)
