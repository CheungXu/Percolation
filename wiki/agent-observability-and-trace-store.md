# Agent 可观测性：自建轨迹仓 + OTLP 派生面板

适用于自研（零框架）Agent 内核：想“完整 Prompt、思考链、工具超长原文都要留”，又不想把真相源交给某个可观测平台。

## 1. 总体做法：一份轨迹，两个去处

```
run_agent / 业务编排 ──► Trace（内存 span 树）
                          ├─► TraceStore：文件仓（真相源，全量、可回放、可 DuckDB 查询）
                          └─► OtlpExporter：OTLP protobuf ──► Phoenix / Langfuse / 任何 OTel 后端（派生视图）
```

- 真相源放在自己掌控的存储上（NAS / 对象存储），平台只当看板，可以随时换、删、重放。
- 导出失败不能影响落盘，落盘失败不能影响业务结果。

## 2. 轨迹结构

- span 树：`workflow(根) → agent → llm / tool / retrieval / 业务步骤`。
- 每个 span 分两层：`attributes` 放可索引小字段（模型、轮次、指纹、用量、金额、状态），`payload` 放大文本（messages、思考链、工具原文、召回文档）。“摘要级别”只丢 payload，结构不变。
- **避免平方级存储**：多轮 agent 每次请求都是“之前全部 messages + 新的一条”。只在 agent span 存一次最终 messages，llm span 记 `input_messages=N`，回放时取前 N 条即可还原每次请求原文。
- **工具双份输出**：工具层同时返回“未截断原文”（进轨迹）和“截断后回灌文本”（进 messages）。只存回灌版会丢掉排障最需要的信息。
- **按内容寻址去重**：系统提示词、工具 Schema、超过阈值（如 16KB）的字符串写进 `blobs/sha256/<2位>/<hash>.zst`，轨迹里留 `{"$ref": "sha256:…"}`。同一版本提示词全仓只存一份。
- **版本指纹**：`sha256(系统提示词 + 工具 Schema + 模型 + 参数)` 截前 16 位挂在 agent span 上。改了提示词，统计里立刻能按指纹分组对比效果和成本。
- 拿不到运行上下文的客户端（embedding、rerank）通过 ContextVar 找到“当前 span”记账，不必层层传参。

## 3. 文件仓布局

```
telemetry/                      0700，和用户数据目录平级，不挂进任何沙箱
  traces/YYYY/MM/DD/<trace_id>.json.zst
  index/YYYY-MM.runs.jsonl      每条轨迹一行摘要（状态、耗时、用量、金额、指纹、路径）
  blobs/sha256/ab/<hash>.zst
  datasets/                     从轨迹沉淀评测集
```

- 写入：临时文件 + `os.replace` 原子落盘，文件 0600；索引用 `O_APPEND` 单行追加（单机写入足够；多机并发写同一 NFS 文件需要改成每进程一个索引分片）。
- 脱敏：序列化成 JSON 文本后整体替换密钥，再按脱敏后的内容重算资产哈希（否则引用对不上）。
- 查询：DuckDB `read_ndjson_auto('index/*.runs.jsonl', union_by_name=true)` 直接当表用；注意 ISO 时间会被推断成 `TIMESTAMPTZ`，要用 `strftime` 而不是 `substr/LIKE`。键名动态的字段（按模型、按 agent 的字典）用 Python 汇总更稳。
- 实测（zstd level 10）：一次检索 3~7KB、一次整理 7~12KB，提示词等共享 blob 首次写入后不再增长；个人量级一年在百 MB 以内。

## 4. OTLP 导出要点

- 事后整体导出时不要走 OTel SDK（无法指定历史 trace_id/时间戳），直接用 `opentelemetry-proto` 拼 `ExportTraceServiceRequest`，POST 到 `/v1/traces`（`Content-Type: application/x-protobuf`）。实时导出和历史回放得到同一棵树。
- 属性写两套：OpenInference（`openinference.span.kind`、`llm.input_messages.{i}.message.*`、`llm.output_messages.*`、`llm.tools.{i}.tool.json_schema`、`tool.name`、`retrieval.documents.{i}.document.*`、`session.id`、`user.id`）给 Phoenix 原生识别；GenAI semconv（`gen_ai.operation.name`、`gen_ai.request.model`、`gen_ai.usage.*`）留给其他后端。项目名用资源属性 `openinference.project.name`。
- token 只写在 LLM span 上，agent 汇总用自定义属性，否则后端会重复累计。
- 非美元成本不要写进 `llm.cost.*`，用自定义属性（如 `agentkit.cost_cny`）。
- 单条消息导出时截断（如 16K 字），完整内容以文件仓为准。

## 5. Phoenix 自托管踩坑（v21）

| 现象 | 原因 / 解法 |
| --- | --- |
| 容器连不上云数据库内网域名 | 宿主机用 `127.0.0.53`（systemd-resolved）时，docker bridge 网络会退回公网 DNS。用 `--network host` + `PHOENIX_HOST=127.0.0.1`，只监听回环。 |
| 迁移报 `permission denied for schema public` | 共享实例的 `public` schema 不归新角色。设 `PHOENIX_SQL_DATABASE_SCHEMA=phoenix`，库 owner 会自动建自己的 schema。 |
| 推送返回 401 | Docker 镜像默认开认证。用 `PHOENIX_ADMIN_SECRET` 作 `Authorization: Bearer`，或在 UI 里建 System API Key。 |
| 不想让面板外发请求 | `PHOENIX_TELEMETRY_ENABLED=false`、`PHOENIX_DISABLE_MODEL_COST_AUTO_UPDATE=true`。 |
| 别用 SQLite 放 NFS | 锁语义不可靠。用独立 PostgreSQL 库/角色（`NOSUPERUSER NOBYPASSRLS`），与业务库分开。 |

资源：单容器常驻约 460MB；`DELETE /v1/projects/<name>` 可删测试项目；REST `GET /v1/projects/<name>/spans` 可做自动化校验。

## 6. 治理护栏（放在内核里，而不是平台里）

- 预算：每条轨迹累计金额 / token 超限即抛错终止，记为失败轨迹。
- 死循环：同工具同参数连续执行超过 N 次就拦截并回灌提示，不真正执行。
- 成本账本：模型目录里配单价（输入 / 缓存命中输入 / 输出），每次调用折算金额；没配单价的记“未知”而不是 0。

## 7. 轨迹的直接收益（实例）

一次回归里“第二次应走候选区却直接答出”的失败，靠 `trace_cli show --payload` 看到作答模型的思考链在凭品牌联想猜暗语，十分钟定位为提示词约束缺失；修好后统计里该节点指纹随之变化，新旧版本可直接对比。

## 8. 从“看轨迹”到“复现运行”

轨迹只回答“模型看到了什么”。要在相同环境里重跑，还需要在根 span 记执行环境锚点（工作区版本、库水位与时钟、代码/依赖/配置指纹、模式判定），并让写入方的中间状态对读者不可见。做法与回放租户、副作用护栏、轨迹清理（blob 标记-清扫）见 `agent-execution-env-reproduction.md`。
