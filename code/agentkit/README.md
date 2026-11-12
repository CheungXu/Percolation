# agentkit

零框架、白盒的轻量 agent 内核。不依赖任何 Percolation 业务代码，可以整个目录复制到别的项目，或者 `pip install -e code` 后直接 import。

完整的分层架构图与 `run_agent` 循环流程图见 `../../wiki/percolation/01-agentkit-core-and-architecture.md`；新建业务 Agent 的标准操作步骤见 `../../skills/build-agentkit-agent/SKILL.md`。

依赖只有 `httpx`、`pydantic`、`pyyaml`，用到 `tenancy` 时再加 `psycopg[pool]`，用到 `telemetry` 时再加 `zstandard`、`opentelemetry-proto`。

## 新建一个 agent 的三步

1. 写工具：参数用 pydantic 模型，处理函数从 `ctx` 拿资源。
2. 写 `AgentSpec`：模型槽位、固定的系统提示词、工具、输出模型。
3. 调 `run_agent`。多步流程用普通 Python 串起来，不要塞进一个大提示词。

```python
from pydantic import BaseModel
from agentkit import AgentSpec, RunContext, run_agent, tool
from agentkit.llm import ModelRegistry
from agentkit.workspace import Workspace, workspace_tools

class LookupArgs(BaseModel):
    keyword: str

@tool(description="按关键词查待办")
async def lookup(args: LookupArgs, ctx):
    return await ctx.deps.find_todos(ctx.tenant_id, args.keyword)

class Plan(BaseModel):
    items: list[str]

spec = AgentSpec(
    name="todo_planner",
    model_slot="router_model",
    system_prompt="你帮用户整理待办……",
    tools=(lookup, *workspace_tools(scope="notes")),
    output_model=Plan,
    max_turns=4,
)
ctx = RunContext(
    tenant_id=user_id,
    models=ModelRegistry.from_files(Path("config/models.json"), [Path("config/llm.env")]),
    workspace=Workspace(user_dir),
    deps=my_services,
)
result = await run_agent(spec, "整理一下下周待办", ctx)
result.output          # Plan 实例，已校验
result.cost            # 本 agent 的金额（models.json 配了 pricing 才有）
result.spec_fingerprint
ctx.trace.usage        # 累计 token
TraceStore(Path("/data/telemetry")).save(ctx.trace)   # 落盘完整轨迹
```

## 模块

| 模块 | 作用 |
| --- | --- |
| `llm/registry.py` | 读 `models.json` 和 env 文件，按槽位取模型；`redact()` 把密钥从文本里抹掉 |
| `llm/chat.py` | OpenAI 兼容 chat/completions，一律流式，拼回流式 tool_calls，可重试错误指数退避 |
| `llm/embedding.py` / `llm/rerank.py` | 向量（每批 10 条）和 DashScope 原生重排；`to_vector_literal` 生成 pgvector 字面量 |
| `tools.py` | `Tool` 和 `@tool`。参数 Schema 由 pydantic 生成；输出默认截断到 8000 字；任何异常都变成 `ERROR: …` 回灌，不让循环崩 |
| `agent.py` | `AgentSpec` |
| `loop.py` | `run_agent`，见下 |
| `context.py` | `RunContext`：租户、模型、工作区、沙箱、追踪、业务依赖 `deps`、测试替身 `chat_clients` |
| `skills.py` | 扫描 `skills_dir/*/SKILL.md`，提示词里只放一行索引，自动加 `read_skill` 工具 |
| `sandbox.py` | `SandboxExecutor` 接口和 `BwrapSandbox`（断网、清空环境变量、只挂显式目录、超时杀进程） |
| `workspace.py` | `Workspace`（路径不越界、`.git` 不可见、原子写）和 `workspace_tools()` 工厂 |
| `tenancy.py` | `create_pool`、`tenant_tx`（事务内 `set_config(..., true)`）、`try_advisory_lock` |
| `trace.py` | span 树（workflow → agent → llm/tool/retrieval）、兼容旧接口的事件流、用量与成本账本、`Budget` 预算护栏、`record_model_usage()` |
| `llm/pricing.py` | 按 `models.json` 的 `pricing` 把用量折成金额 |
| `telemetry/store.py` | `TraceStore`：zstd 轨迹文件 + 月度索引 + 内容寻址 blobs，落盘前脱敏 |
| `telemetry/otlp.py` | `OtlpExporter`：转成 OTLP protobuf（OpenInference + GenAI 属性），推给 Phoenix 等后端 |
| `testing.py` | `ScriptedChatClient`、`reply()`、`call_tool()`，单测不调真实模型 |

## 循环语义

1. 调模型（带工具）。
2. 没有工具调用：有 `output_model` 就解析 JSON 并校验，失败把错误回灌、撤掉工具再要一次（`max_repairs` 次，默认 1），仍失败抛 `AgentOutputError`。
3. 有工具调用：逐个执行，结果作为 `tool` 消息回灌，继续。
4. 超过 `max_turns`：追加一句“轮数已用完”，撤掉工具，强制给最终输出。

有 `output_model` 时，循环会把它的 JSON Schema 追加到系统提示词末尾。系统提示词保持固定，动态内容放进 `run_agent` 的输入，便于命中模型侧前缀缓存。

护栏：
- 同一工具 + 同样参数连续执行超过 `AgentSpec.max_identical_tool_calls`（默认 2）次，第三次起不执行，直接回灌“已拦截”。
- 每次模型调用后检查 `trace.budget`（`max_cost` / `max_tokens`，按整条轨迹累计），超出抛 `BudgetExceeded`，不回灌给模型。

## 轨迹与可观测性

`run_agent` 自动往 `ctx.trace` 里写：

| span | attributes（小字段，总会保存） | payload（大文本，`level=full` 才保存） |
| --- | --- | --- |
| agent | 模型、槽位、参数、`spec_fingerprint`、`prompt_hash`、`tools_hash`、轮数 | 完整 messages、最终输出 |
| llm | 轮次、`input_messages`（本次请求 = messages 的前 N 条）、finish_reason、延迟、用量、金额 | 回复、思考链 `reasoning`、tool_calls |
| tool | 参数、ok、blocked、truncated、原文/回灌字数 | 未截断原文 `output`（回灌给模型的截断版在 messages 里） |

- 每轮请求不重复存 messages：llm span 只记前缀长度 N，回放时取 agent 的 messages[:N]，存储是线性的，不是平方级。
- 系统提示词和工具 Schema 用 `trace.asset()` 按哈希登记，落盘进 CAS，同版本只存一份。
- `spec_fingerprint` = sha256(系统提示词 + 工具 Schema + 模型 + 参数) 前 16 位，改提示词就换指纹，便于把效果波动对到版本。
- 业务步骤可以自己开 span：`with ctx.trace.span("sync_wiki", kind="chain") as s: ...; s.set(...)`。embedding/rerank 客户端通过 ContextVar 把用量记到当前 span。

`TraceStore(root, level="full"|"summary", blob_threshold=16384, redact=fn, exporters=[...])`：
- `traces/YYYY/MM/DD/<trace_id>.json.zst`、`index/YYYY-MM.runs.jsonl`、`blobs/sha256/<2位>/<hash>.zst`，目录 0700、文件 0600，原子写。
- 超过阈值的字符串、以及资产原文外置为 `{"$ref": "sha256:…", "chars": N}`；`load(id, hydrate=True)` 还原。
- `redact` 在落盘与导出前作用于整份 JSON；导出失败只打 stderr，不影响落盘。

`OtlpExporter(endpoint, headers=..., project=...)` 直接拼 protobuf，保留原 trace_id/span_id/时间戳，所以实时导出和事后回放得到同一棵树。成本以 `agentkit.cost_cny` 导出，不冒充 `llm.cost`（美元）；token 只写在 LLM span 上，避免后端重复累计。

## workspace_tools 的权限开关

- `scope="MEMORY_CACHE"`：所有路径都必须在这个子目录里，`bash` 只挂载这个子目录。
- `writable=True` 才有 `write_file`、`edit_file`；再加 `allow_delete=True` 才有 `delete_file`。
- `write_prefixes=("wiki/",)`：只允许写这些前缀。
- `validators=(fn, ...)`：`fn(rel_path, new_text) -> 错误信息 | None`，用来挂业务规则（例如热区行数上限）。

`bash` 永远是只读挂载。需要写文件时用写工具，由 Python 校验路径和规则。

## 沙箱参数

`BwrapSandbox` 用 `--unshare-all --die-with-parent --new-session --clearenv`，只读挂载 `/usr /lib /lib64 /bin /sbin`（符号链接按原样重建），`/tmp` 是 tmpfs。业务目录通过 `Bind(source, target, readonly)` 显式传入。换成云端沙箱时实现同一个 `run()` 接口即可。

## 测试

```bash
cd code && .venv/bin/pytest -q
```

`tests/test_agentkit_*.py` 覆盖工具回灌、工具报错不崩、输出修复、轮数收敛、路径越界、只读沙箱、技能加载，以及连真实库的租户上下文和咨询锁（没有 `config/db.env` 时跳过）。`test_agentkit_trace.py` 覆盖 span 树、原文不截断、成本、指纹、重复调用拦截、预算、落盘/外置/脱敏/权限、summary 级别和 OTLP 属性。
