# percolation

个人碎片记忆系统的业务层，建立在 `agentkit` 之上。

完整架构图、在线检索与夜间整理工作流程图、6 个节点的工具权限矩阵与全部 System Prompt / Skill 规范见 `../../wiki/percolation/` 专题目录。

## 结构

| 文件 | 作用 |
| --- | --- |
| `config.py` | 读 `config/db.env`、`storage.env`、`observability.env`、`llm.env`、`models.json`、`facets.json` |
| `services.py` | 进程级依赖 `Services`（连接池、模型、沙箱、轨迹仓），作为 `RunContext.deps`；`resolve_user(slug)`、`tx(user)`、`context()`、`new_trace()`、`save_trace()` |
| `memory_fs.py` | 工作区目录约定、热区写入规则、git 快照；整理暂存区（`create_staging`/`remove_staging`/`fast_forward`/`ensure_published`/`prune_merged_staging_branches`）、残留 `index.lock` 清理与 `gc --auto`；git 子进程统一 60 秒超时 |
| `capture.py` | 录入，只走数据库函数 `capture_message` |
| `wiki.py` | 主题页确定性解析：frontmatter（`type`/`facets`）、小节切片、行内 `[dim:val]`、`[@YYYY-MM-DD]` 事件时间、`[#msg_N]`、`[confirmed]/[inferred]`、`[[rel::target|label]]` 类型链接，以及受控词表合并 |
| `indexer.py` | `plan_sync`（解析文件、按 `content_hash` 只给新切片算向量、预算悬空链接，不写库）+ `apply_sync(conn, …)`（在调用方事务里幂等刷新 `wiki_pages`、`page_facets`、`message_facets`、`message_events`、`wiki_chunks`、`wiki_links`）；`sync_wiki` 是两者组合 |
| `env_anchor.py` | 执行环境锚点 `capture_env`：工作区版本、库水位、代码/依赖/配置指纹，写进根 span 与索引行 |
| `replay.py` | `reproduce(trace_id, runs, keep)`：按锚点建 replay 租户、重跑、对比 |
| `tenants.py` | 临时租户（`e2e-` / `replay-`）的建立与清理，只用建表账号 |
| `retriever.py` | 双轨四路多维混合召回 `search()`（全文 + trgm + 向量 + 正交维度/日期区间），原话读取 `fetch_raw()` |
| `graph.py` | 异构多维拓扑图组装 `build_graph()`（页面节点 + 虚拟维度枢纽 + 原话节点 + 类型关系边 + `WITH RECURSIVE` 子图）与维度总览 `build_facets_overview()` |
| `tools.py` | 业务工具 `hybrid_search`（支持 `queries`、`facets`、日期范围）、`fetch_raw_messages`，以及按角色组装的文件工具 |
| `agents/search.py` | Search Agent 四步状态机，`ask()`、`clarify()` |
| `agents/dream.py` | Dreaming Agent，`run_for_user(mode, as_of)`、`run_dirty_queue()`、`reindex()`、`prepare_workspace()` |
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

1. `list_dirty_users()` 取脏租户，`try_advisory_lock("percolation:dream:<uid>")` 防重入，拿不到锁返回 `locked`。`reindex` 用同一把锁。
2. `prepare_workspace`：清理超过 10 分钟的 `index.lock`；`users.workspace_head` 领先主工作区时补快进（上次发布在快进前中断），并删掉已并入主线的 `dream/*` 残留分支；主工作区领先 `workspace_head`（人工提交过）或有未提交改动，就先提交、同步索引并登记新的 `workspace_head`。两者分叉、或登记的提交已不存在时报错，需要人工处理。之后主工作区干净、HEAD 等于 `workspace_head`、派生表与 HEAD 一致。
3. 记执行环境锚点（见下文），时钟 `as_of` 取库时钟（复现时注入原值）。
4. 节奏 `decide_mode(…, as_of)`：`MEMORY.md` 超过 90% 上限、悬空链接 ≥ 5、或距上次重整（或建号）≥ 7 天时为 `defrag`，否则 `incremental`；模式与理由写进锚点的 `decision`。没有待整理原话、也没有升降级需求时直接 `noop`。待整理原话只取锚点水位 `max_msg_seq` 以内的。
5. 建暂存 worktree：`/mnt/percolation/staging/<uid>/<run_id>`（0700），分支 `dream/<run_id>`。之后所有写入都只发生在这里，检索只读主工作区与已发布索引。
6. `dream_archive` 按连发批次（每组 ≤ 40 条，不拆批次）归档，“当前日期”用 `as_of`。
7. `plan_sync` 只算计划（新切片向量、悬空链接），不写库。
8. 有晋升候选（`as_of` 前 14 天内命中 ≥ 2 次）、热区超水位或 `defrag` 时跑升降级节点；`defrag` 的维度分布直接从暂存区文件统计，悬空链接来自计划；`defrag` 后再算一次计划（向量缓存复用）。
9. 对账：模型报告的序号与文件里实际出现的 `#msg_N` 取并集作为已归档，报告跳过的标 `skipped`，其余保持 `pending`。
10. 发布：暂存分支提交 → **一个事务**里 `apply_sync` 刷新六张派生表 + 推进原话状态 + 重算计数 + 写 `dream_runs` + 登记 `users.workspace_head` → 主工作区 `merge --ff-only` → `gc --auto`。
11. 发布事务之前任一步失败：删暂存区和分支，主工作区与索引从没被碰过，`dream_runs` 记 `failed`，原话保持 `pending`。事务一提交就把分支标为保留（主工作区追上前它是新提交唯一的引用），快进成功才删；快进失败时结果仍是 `succeeded`，但 `error` 写明“已保留分支”，下次第 2 步或下一次检索补快进。检索开头发现 `workspace_mismatch` 时调用 `dream.repair_fast_forward`：不阻塞地尝试拿整理锁，拿到就只做快进（不做索引同步），拿不到或失败都不影响检索，记 `workspace_repaired` / `workspace_repair_failed` 事件。

## 执行环境锚点与复现

每次 `ask()` 和整理开跑前调 `Services.capture_env()`，写进根 span 的 `env`（完整）、`env_digest`（代码+依赖+配置的摘要）和 `env_watermark`（关键水位，同时进索引行）：

- 工作区：`workspace_head`（库里登记的已发布版本）、`git_head`、`workspace_mismatch`、`git_clean`（只有检索检查；git 出错时记 `null`，不影响检索）。
- 库水位（单条语句读出）：`as_of`（库时钟）、`max_msg_seq`、当时 pending 的序号、检索日志条数与最晚时间、用户状态计数（含 `created_at`，节奏判定要用）。
- 代码与依赖（进程内只算一次）：`code_commit`、`code_dirty`、`code_digest`（`agentkit` + `percolation` 源码/提示词/技能）、最新迁移、Python 版本、依赖清单哈希、git/rg/bwrap 版本。
- 配置：`models.json`、`facets.json` 哈希，`MEMORY_LINE_LIMIT`、`BURST_WINDOW_SECONDS`、时区、检索常量、整理常量。
- 整理另有 `decision`：模式、理由、待整理序号、晋升候选。

时间相关的判断（“当前日期”三处、晋升命中窗口、热区使用统计窗口、`defrag` 间隔）全部用 `as_of`；写库的时间戳（`dreamed_at`、`last_dream_at`）仍是真实时间。

`trace_cli.py reproduce <trace_id> [--runs 3] [--keep]`（`replay.reproduce`）：

1. 没有锚点的旧轨迹、回放轨迹本身、`level=summary` 丢了入参的轨迹直接拒绝。
2. 每次重跑建一个全新 `replay-<trace8>-<ts>-rN` 租户（建之前先登记，中途失败也会被清理）；原工作区 `git clone` 后 reset 到锚点 `git_head`。
3. 建表账号单事务复制三张事实表：`as_of` 之前的检索日志（id 重映射）、`max_msg_seq` 以内的原话（保留序号/批次/录入时间/来源，锚点时 pending 的恢复为 pending，`reply_to_search_id` 按映射改写）、用户状态计数与 `next_msg_seq`。
4. 派生表不复制，按文件 `plan_sync`/`apply_sync` 重建，向量按 `content_hash` 复用原租户的。
5. 以原入参重跑（检索：原问题与澄清；整理：锚点里的模式），注入 `as_of`；新轨迹带 `replay_of`/`replay_run`，`RunContext.replay=True`，带 `side_effect` 标签的工具被循环拦截。
6. 报告：检索比 outcome/路由/维度与日期条件/核验序号/命中页/回答/成本/耗时/指纹；整理比状态/模式/归档与跳过集合/改动文件/晋升/索引计数，并逐文件比对原提交与重跑提交的内容；另列水位核对和代码/依赖/配置差异。锚点显示原运行时工作区有未提交改动（`git_clean=false`/`null`）或工作区与已发布索引不一致时，报告开头给出 `warnings`；原话引用了水位外检索日志的条数记在 `setup.unmapped_replies`。代码摘要不同时给出用原提交开 worktree 复现的命令。
7. 默认删掉 replay 租户（库行、工作区、暂存区），回放轨迹保留；`list`/`stats` 默认不含回放。

## 轨迹

- 每次 `ask()` / 做梦各是一条轨迹：`services.new_trace(name, user)` 带上租户与预算，结束时 `services.save_trace()` 落盘；业务异常也会以 `failed` 落盘后再抛出。
- 仓库位置 `TELEMETRY_ROOT`（默认 `/mnt/percolation/telemetry`），与 `workspaces/` 平级、0700，不挂进任何沙箱；`Services.trace_store` 拒绝把它放在 `workspaces/` 之下。落盘前抹掉模型密钥、OTLP 凭据和数据库密码。
- span 树：`search` → `search_router` / `retrieval` / `search_answer`（含 llm、tool、嵌套 retrieval）/ `search_cache_probe`；`dream` → `dream_archive` / `plan_sync` / `dream_tiering` / `plan_sync_after_tiering` / `publish`。
- 同一份轨迹实时推给本机 Phoenix（`OTLP_ENDPOINT`），推送失败不影响业务和落盘。
- `SearchOutcome` / `DreamOutcome` 带回 `cost_cny` 和 `trace_id`，可以直接拿 trace_id 去查。
- 查询与回放：`script/trace_cli.py`（list/show/hydrate/stats/sql/export-otlp/du/reproduce/purge）。
- 保留：轨迹默认长期保留（复现靠它）。临时租户的轨迹用 `trace_cli.py purge --tenant <uid>` 删，会顺带清扫无人引用且超过 1 小时的 blob；删真实用户的轨迹要加 `--force`。

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

`percolation_cli.py reindex` 走 `dream.reindex()`：与整理同锁，先提交并发布人工改动，再按主工作区文件重建派生表。手工改了工作区文件后用它发布，否则检索读到的是未提交文件、复现只能拿到上一次提交。
