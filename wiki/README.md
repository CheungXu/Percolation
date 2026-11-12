# wiki

团队知识库，区别于日常工作流水，沉淀可跨项目复用的通用架构准则与子项目核心架构资产。

---

## 一、 跨项目通用知识

- `agent-memory-and-harness-design.md`：Agent 跨会话记忆架构与轻量执行内核（Harness）设计指南。涵盖读写分离与离线 Dreaming、原文事实锚定、热温缓存升降级置换、轻量白盒循环构建法则，以及云存储与沙箱隔离选型避坑清单。
- `reusable-agent-harness.md`：可复用轻量 Agent 内核的拆分边界与真机踩坑经验。总结循环/资源/约束与业务的四分法、普通代码编排 vs. 模型单点判断、标识符归一、预取证据后收紧工具轮数、文件锚点对账与 Git 整体回滚等实战准则。
- `agent-observability-and-trace-store.md`：Agent 可观测性落地方案。自建文件轨迹仓作真相源（span 树、线性存储 messages、工具原文双份、CAS 去重、版本指纹、DuckDB 查询）+ OTLP 派生面板（OpenInference/GenAI 属性映射、历史回放），Phoenix 自托管踩坑与内核级预算/死循环/成本护栏。
- `aliyun-swas-nas-mount.md`：轻量应用服务器挂载阿里云通用型 NAS 的做法。核心是避开与默认专有网络重叠的 `172.16.0.0/12`，另建网段后做内网互通；并用 TCP 2049 而不是 ping 判断连通性。
- `aliyun-rds-pg-multitenant-and-hybrid-search.md`：共享阿里云 RDS PostgreSQL 实例构建多租户与混合检索库的实战指南。涵盖双角色拆分规避 `rolbypassrls` 静默失效、`ENABLE + FORCE RLS` 策略配对、只追加事实表防护，以及免重启实例的中文重叠二字 `tsvector` + `pg_trgm` + `halfvec(1024)` 方案。

---

## 二、 子项目专有知识：`percolation/`（Agent 核心、架构与工作流专题）

入口导览见 `percolation/README.md`：

- `percolation/01-agentkit-core-and-architecture.md`：总体分层架构图（内核 + 两个业务 Agent）、`agentkit` 核心原语设计、`run_agent` 157 行白盒工具循环流程图、受限工作区与 `BwrapSandbox`、强制 RLS 事务与会话咨询锁。
- `percolation/02-search-and-dreaming-workflows.md`：碎片录入与 `Search Agent` 四步在线混合检索流程图、双轨多路召回（RRF + Rerank + 一跳邻居）、`Dreaming Agent` 五步夜间离线整理流程图、双节奏自动切换与失败回滚机制。
- `percolation/03-tools-prompts-and-skills-reference.md`：9 个原子工具清单与安全边界、6 个 `AgentSpec` 节点的最小权限矩阵、5 份 System Prompt 原文对照与 `wiki-format` 渐进式披露 Skill 规范。
