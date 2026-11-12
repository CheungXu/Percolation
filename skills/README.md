# skills

可复用的操作技能。每个技能一个目录，入口是 `SKILL.md`。

- `build-agentkit-agent/`：基于零框架通用内核 `code/agentkit/` 新建业务 Agent 的五步标准流程（槽位选择、Pydantic 工具编写、最小权限 `AgentSpec` 与固定前缀提示词、普通 Python 事务外编排、`ScriptedChatClient` 单测与临时租户端到端验收）。
- `aliyun-swas-nas/`：在阿里云轻量应用服务器上创建并挂载通用型 NAS，含网段重叠时的内网互通做法。Percolation 的 NAS 已经挂在 `/mnt/percolation`，重复执行前先确认不要再建一套。
- `aliyun-rds-pg-tenant-db/`：在共享阿里云 RDS PostgreSQL 实例上零停机初始化独立多租户业务库（双角色防 RLS 绕过、只追加表防护、免重启中文与 `halfvec` 混合检索索引）。Percolation 的 `percolation` 库已按此建好，新项目复用时替换库名与角色前缀。
