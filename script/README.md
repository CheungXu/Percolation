# script

运维、调试和验收脚本。除 `probe_retrieval_models.py` 外都用 `code/.venv/bin/python` 运行。

- `probe_retrieval_models.py`：读取 `config/llm.env` 和 `config/models.json`，探测文本向量和重排是否可调用。输出只有模型名、维度和分数，不输出密钥。
- `percolation_cli.py`：命令行入口，子命令 `capture`、`ask`、`clarify`、`dream [--mode] [--all]`、`graph [--center --depth --facet --json]`、`facets`、`status`、`reindex`；`--user` 指定租户 slug。夜间定时任务调用 `dream --all`。`reindex` 与整理共用租户锁，整理进行中直接退出；它会先把工作区里的人工改动提交并发布。
- `trace_cli.py`：NAS 轨迹仓查询。`list [--name --status --user --include-replays]`、`show <id前缀> [--payload] [--messages AGENT]`（调用树、用量、成本、思考链、工具原文、完整 messages、环境摘要）、`hydrate <id> [-o]`（还原外置原文的完整 JSON）、`stats [--month --include-replays]`（DuckDB 按类型/天/结果/模型/agent 指纹汇总）、`sql "<SQL>"`（索引视图名 `runs`）、`export-otlp <id...> | --since`（回放到 Phoenix）、`du`。
  - `reproduce <id> [--runs 3] [--keep] [--json]`：按轨迹里的执行环境锚点建 `replay-*` 租户（克隆工作区到原提交、复制库水位、重建索引），以原入参重跑 N 次并打印对比报告（结果一致项/差异项/稳定性/水位核对/环境差异/旧代码复现命令）。需要 `config/db.env` 的 `MIGRATE_DATABASE_URL`；会真实调用模型。
  - `purge --tenant <uid> [--dry-run] [--force]`：删某租户全部轨迹并清扫无人引用的 blob；非 `e2e-`/`replay-` 租户要加 `--force`。
  - `list`/`stats` 默认排除回放轨迹（`metadata.replay_of`）。
- `backfill_workspace_head.py [--dry-run]`：迁移 004 之后的一次性回填，把每个租户 `users.workspace_head` 设成工作区当前 HEAD（建表账号，只填 NULL）。
- `phoenix.sh`：Arize Phoenix 单容器运维。`init-db`（用相邻项目管理账号建独立库/角色 `percolation_obs`，生成 `config/phoenix.env`）、`up`、`down`、`status`、`logs`。容器走 host 网络、只监听 127.0.0.1:6006/4317、开启认证、内存上限 1G。本地查看：`ssh -L 6006:127.0.0.1:6006 <server>` 后打开 `http://127.0.0.1:6006`，账号 `admin@localhost`，初始密码在 `config/phoenix.env`（首次登录要求修改）。
- `e2e_percolation.py`：端到端验收。用建表账号临时建 `e2e-<时间戳>` 租户，跑录入直查、增量整理、候选区穿透与晋升（人工编辑经 reindex 发布）、追问澄清、多维正交归档检索与异构拓扑图及 RLS 隔离、整理期间并发检索与发布失败隔离、按锚点复现三类运行共七个场景，逐项打印 PASS/FAIL，结束后清理（轨迹保留）。`--keep` 保留数据便于查看，`--drop <slug>` 单独清理 `e2e-`/`replay-` 租户。会真实调用模型。
