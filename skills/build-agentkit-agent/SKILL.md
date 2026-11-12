---
name: build-agentkit-agent
description: 基于仓库内零框架通用内核 code/agentkit/ 构建新的业务 Agent。当需要在当前项目或相邻项目中新增智能体节点、扩展业务工具、编排多步状态机或编写离线/真机验收测试时使用。
---

# 基于 agentkit 构建新业务 Agent 标准流程

`code/agentkit/` 是与业务完全解耦的轻量白盒 Agent 内核（架构与循环细节见 `wiki/percolation/01-agentkit-core-and-architecture.md`）。新建任何新 Agent 时，遵循以下六步标准范式，不要引入重型第三方 Agent 框架，也不要把业务表名或目录名塞进 `agentkit/`。

## 1. 确认模型槽位（`config/models.json`）

业务代码一律通过逻辑槽位名引用模型，不硬编码具体模型 ID：
- 低延迟分类、路由、快速工具核验：复用 `router_model` 或 `search_model`（关闭思考）。
- 复杂推理、跨文档归纳重构：复用 `dream_model`（开启思考）。
- 如需独立参数或新模型，在 `config/models.json` 的 `slots` 中新增槽位映射。

## 2. 编写业务工具（Pydantic 参数 + 从 `RunContext` 取依赖）

所有外部资源（数据库连接池、业务服务、当前租户 ID）统一通过 `ctx: RunContext` 读取，严禁读写模块级可变全局状态：

```python
from pydantic import BaseModel, Field
from agentkit import RunContext, ToolError, tool

class QueryOrderArgs(BaseModel):
    order_no: str = Field(description="订单编号")

@tool(description="按订单号查询当前租户的订单状态")
async def query_order(args: QueryOrderArgs, ctx: RunContext) -> dict:
    if not ctx.tenant_id or ctx.deps is None:
        raise ToolError("缺少租户上下文")
    row = await ctx.deps.fetch_order(ctx.tenant_id, args.order_no)
    if row is None:
        raise ToolError(f"未找到订单 {args.order_no}")
    return row
```

注意：
- 可预期的业务拒绝直接抛 `ToolError("原因")`，`agentkit` 会将其转为 `ERROR: 原因` 回灌给模型，不会中断循环。
- 若需读写租户工作区文件或跑受限 shell，直接组合 `agentkit.workspace.workspace_tools(scope=..., writable=..., write_prefixes=..., validators=...)`，不要手写未校验路径的 `open()` 或 `subprocess`。

## 3. 按最小权限声明 `AgentSpec` 与独立提示词

1. 将静态系统提示词存放在业务包的 `prompts/<node_name>.md` 中，**不要在系统提示词里拼接每次请求变化的动态数据**（动态数据全部拼入 `run_agent()` 的 `user_input`），以稳定前缀命中服务端 KV Cache。
2.若输入中已预取了充足的上下文证据，在提示词中明确写清“证据足够时不要调用工具，直接输出”，并收紧 `max_turns`（如 `2~4` 轮）且剔除多余的目录浏览工具，避免模型空转耗尽轮数。
3. 为节点定义强类型 Pydantic `output_model`：

```python
from functools import cache
from pydantic import BaseModel
from agentkit import AgentSpec

class AuditDecision(BaseModel):
    passed: bool
    reason: str

@cache
def audit_spec() -> AgentSpec:
    return AgentSpec(
        name="order_audit",
        model_slot="search_model",
        system_prompt=load_prompt("order_audit"),
        tools=(query_order,),
        output_model=AuditDecision,
        max_turns=3,
    )
```

## 4. 用普通 Python 编排多步流程

- 确定性的条件分支、数据库事务落盘、路径/标识符归一化（切勿直接信任模型自由填写的文件路径用于 SQL `GROUP BY`）一律用普通 Python 代码控制。
- **严禁在数据库事务块（`async with tenant_tx(...)`）内部 `await run_agent(...)`**：数据库设有 `idle_in_transaction_session_timeout = 60s`，必须在事务外完成模型推理，再开短事务原子落盘。
- 若存在后台单租户批处理任务，外层包裹 `async with try_advisory_lock(pool, f"<app>:<job>:{tenant_id}") as ok:` 防止重入。

## 5. 接入轨迹与护栏（`agentkit.trace` / `agentkit.telemetry`）

- 每次业务运行建一条轨迹：`Trace(name, metadata={"tenant_id": ...}, budget=Budget(max_cost=..., max_tokens=...))`，用 `with trace.activate():` 包住整段编排，结束时 `trace.finish(status, **摘要)` 后交给 `TraceStore.save()`。异常路径也要以 `failed` 落盘再抛出。Percolation 里直接用 `services.new_trace()` / `services.save_trace()`。
- `run_agent` 自动记录 agent/llm/tool span、完整 messages、思考链、工具未截断原文、用量、金额与 `spec_fingerprint`，无需手写埋点。确定性的业务步骤（检索、索引同步）用 `with trace.span("名称", kind="retrieval"|"chain") as s:` 包一层，`s.set(...)` 记结果。
- 新模型要在 `config/models.json` 补 `pricing`，否则成本记为未知。
- 默认 `max_identical_tool_calls=2` 拦截同参重复调用；确有需要重复（轮询类工具）再调大。
- 排障先看轨迹：`script/trace_cli.py list --name <运行名>` → `show <id> --payload`（思考链、工具原文）→ `show <id> --messages <agent>`（完整提示词数组）；改提示词后用 `stats` 按指纹对比。

## 6. 双层验证：离线 `ScriptedChatClient` + 临时租户真机验收

1. **离线分支单测（必写）**：使用 `agentkit.testing` 中的 `ScriptedChatClient`、`call_tool`、`reply` 构造确定性响应序列，验证工具异常回灌、JSON 修复与状态机全部分支（参考 `code/tests/test_agentkit_loop.py`）。
2. **真机端到端验收**：在 `script/` 下编写验收脚本，用迁移账号创建带时间戳前缀的独立测试租户，验证完整链路与跨租户隔离后清理测试租户数据与 NAS 子目录，不污染 `default` 租户。
