"""agentkit：零框架、白盒的轻量 Agent 内核。

不依赖任何业务代码。一个 agent = AgentSpec（模型槽位 + 提示词 + 工具 + 输出模型）
交给 run_agent 执行；编排逻辑用普通 Python 写在业务层。
轨迹（Trace）自动记录 span 树、完整 messages、工具原文、用量与成本，
由 agentkit.telemetry.TraceStore 落盘、OtlpExporter 导出。
"""

from agentkit.agent import AgentSpec
from agentkit.context import RunContext
from agentkit.loop import AgentResult, run_agent
from agentkit.tools import Tool, ToolError, ToolOutcome, tool
from agentkit.trace import Budget, BudgetExceeded, Span, Trace

__all__ = [
    "AgentResult",
    "AgentSpec",
    "Budget",
    "BudgetExceeded",
    "RunContext",
    "Span",
    "Tool",
    "ToolError",
    "ToolOutcome",
    "Trace",
    "run_agent",
    "tool",
]
