# percolation

个人碎片记忆系统的业务层，建立在 `agentkit` 之上。

完整架构图、在线检索与夜间整理工作流程图、6 个节点的工具权限矩阵与全部 System Prompt / Skill 规范见 `../../wiki/percolation/` 专题目录。

## 结构

| 文件 | 作用 |
| --- | --- |
| `config.py` | 读 `config/db.env`、`storage.env`、`observability.env`、`llm.env`、`models.json`、`facets.json` |
| `services.py` | 进程级依赖 `Services`（连接池、模型、沙箱、轨迹仓），作为 `RunContext.deps`；`resolve_user(slug)`、`tx(user)`、`context()`、`new_trace()`、`save_trace()` |
| `memory_fs.py` | 工作区目录约定、热区写入规则、git 快照与回滚 |
| `capture.py` | 录入，只走数据库函数 `capture_message` |
| `wiki.py` | 主题页确定性解析：frontmatter（`type`/`facets`）、小节切片、行内 `[dim:val]`、`[@YYYY-MM-DD]` 事件时间、`[#msg_N]`、`[confirmed]/[inferred]`、`[[rel::target|label]]` 类型链接，以及受控词表合并 |
| `indexer.py` | `sync_wiki`：按 `content_hash` 增量算向量，单事务幂等刷新 `wiki_pages`、`page_facets`、`message_facets`、`message_events`、`wiki_chunks` 和 `wiki_links` |
| `retriever.py` | 双轨四路多维混合召回 `search()`（全文 + trgm + 向量 + 正交维度/日期区间），原话读取 `fetch_raw()` |
| `graph.py` | 异构多维拓扑图组装 `build_graph()`（页面节点 + 虚拟维度枢纽 + 原话节点 + 类型关系边 + `WITH RECURSIVE` 子图）与维度总览 `build_facets_overview()` |
| `tools.py` | 业务工具 `hybrid_search`（支持 `queries`、`facets`、日期范围）、`fetch_raw_messages`，以及按角色组装的文件工具 |
| `agents/search.py` | Search Agent 四步状态机，`ask()`、`clarify()` |
| `agents/dream.py` | Dreaming Agent，`run_for_user()`、`run_dirty_queue()` |
| `prompts/*.md` | 五个节点的系统提示词 |
| `skills/wiki-format/SKILL.md` | 记忆文件写法规范，整理节点按需读取 |
| `api.py` | FastAPI 接口 |

## 每个节点的权限

| 节点 | 模型槽位 | 工具 |
| --- | --- | --- |
| `search_router` | `router_model` | 无 |
| `search_answer` | `search_model` | `hybrid_search`、`fetch_raw_messages`、只读 `wiki/` |
| `search_cache_probe` | `search_model` | 只读 `MEMORY_CACHE/`（沙箱里只挂这个目录） |
| `dream_archive` | `dream_model` | 检索、原话、读写 `wiki/` 和 `MEMORY_CACHE/`；不能写 `MEMORY.md` |
| `dream_tiering` | `dream_model` | 读写 `MEMORY.md` 和 `MEMORY_CACHE/` |
| `dream_tiering_defrag` | `dream_model` | 再加读写删 `wiki/` |

所有写入都过 `memory_validators`：`MEMORY.md` 不超过 `MEMORY_LINE_LIMIT` 行且不能含 `[inferred]`；`wiki/` 和 `MEMORY_CACHE/` 文件名只能是英文、数字、点、横线、下划线（`wiki_chunks.doc_path` 有同样的约束）。

## Search Agent 流程

1. `search_router` 读热区和提问，输出检索词、未知暗语、用到的热区条目。只有提问完全没有可检索内容时才直接追问（`clarify_immediate`）。
2. `retriever.search` 召回，预取锚点原话及同批次前后消息，`search_answer` 核验作答。答上了就是 `primary_direct`。
3. 答不上且候选区有文件：`search_cache_probe` 在沙箱里 `ls`/`rg` 候选区，找到映射就改写检索词再走一次第 2 步，`route_path = cache_fallback`。答上时累加 `users.pending_cache_hits` 并置脏标记。
4. 仍答不上：有歧义或未知暗语时输出一句追问（`clarify_asked`），否则 `not_found`。用户回复追问走 `clarify()`：作为 `clarification` 原话入库，再用原问题重查。

每次检索写一条 `search_logs`，完整轨迹写进 NAS 轨迹仓（见下文“轨迹”）。

召回细节：wiki 切片走全文（OR 语义的重叠二字 tsquery，标题别名权重 A、小节与维度词元权重 B、正文 C）、trgm/子串、向量，以及**第四路正交维度与事件日期召回**（按 `page_facets` 命中维度数排序 + `message_events` 区间匹配），RRF（k=60）融合；原话走全文、trgm、子串、原话级维度/日期命中，另把最近 60 条 pending 原话全部放进候选。合并后最多 40 条交给 `gte-rerank-v2`，取前 6。最后沿 `wiki_links` 补带 `rel_type` 与页面维度的一跳邻居页。库里还没有切片时不调向量接口。

## Dreaming Agent 流程

1. `list_dirty_users()` 取脏租户，`try_advisory_lock` 防重入，拿不到锁返回 `locked`。
2. 节奏：`MEMORY.md` 超过 90% 上限、悬空链接 ≥ 5、或距上次重整（或建号）≥ 7 天时为 `defrag`，否则 `incremental`。没有待整理原话、也没有升降级需求时直接 `noop`。
3. `dream_archive` 按连发批次（每组 ≤ 40 条，不拆批次）归档。
4. `sync_wiki` 同步索引。
5. 有晋升候选（14 天内命中 ≥ 2 次）、热区超水位或 `defrag` 时跑升降级节点；改了 wiki 就再同步一次。
6. 对账：模型报告的序号与文件里实际出现的 `#msg_N` 取并集作为已归档，报告跳过的标 `skipped`，其余保持 `pending`。单事务推进原话状态、重算待整理数、清脏标记、写 `dream_runs`。
7. 工作区 `git commit`。失败时 `git reset --hard` + `git clean`，按文件重建索引，`dream_runs` 记 `failed`。

## 轨迹

- 每次 `ask()` / 做梦各是一条轨迹：`services.new_trace(name, user)` 带上租户与预算，结束时 `services.save_trace()` 落盘；业务异常也会以 `failed` 落盘后再抛出。
- 仓库位置 `TELEMETRY_ROOT`（默认 `/mnt/percolation/telemetry`），与 `workspaces/` 平级、0700，不挂进任何沙箱；`Services.trace_store` 拒绝把它放在 `workspaces/` 之下。落盘前抹掉模型密钥、OTLP 凭据和数据库密码。
- span 树：`search` → `search_router` / `retrieval` / `search_answer`（含 llm、tool、嵌套 retrieval）/ `search_cache_probe`；`dream` → `dream_archive` / `sync_wiki` / `dream_tiering`。
- 同一份轨迹实时推给本机 Phoenix（`OTLP_ENDPOINT`），推送失败不影响业务和落盘。
- `SearchOutcome` / `DreamOutcome` 带回 `cost_cny` 和 `trace_id`，可以直接拿 trace_id 去查。
- 查询与回放：`script/trace_cli.py`（list/show/hydrate/stats/sql/export-otlp/du）。

## 运行

```bash
code/.venv/bin/python script/percolation_cli.py capture "cforce 15.6 oled 999蹲"
code/.venv/bin/python script/percolation_cli.py ask "之前想买的便携屏多少钱"
code/.venv/bin/python script/percolation_cli.py dream
code/.venv/bin/python script/percolation_cli.py graph --facet domain=学习 --json
code/.venv/bin/python script/percolation_cli.py facets
cd code && .venv/bin/uvicorn percolation.api:app --host 127.0.0.1 --port 8710
```

HTTP 接口：`POST /v1/capture`、`/v1/search`、`/v1/clarify`、`/v1/dream`，`GET /v1/graph`、`/v1/facets`、`/healthz`。请求头 `X-User-Slug` 选租户，缺省为默认用户。

端到端验收：`code/.venv/bin/python script/e2e_percolation.py`，会临时建一个 `e2e-<时间戳>` 租户并在结束后清理。
