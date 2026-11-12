# Percolation Agent 系统架构与流程专题库

本目录系统化沉淀 **Percolation** 个人碎片记忆系统的智能体核心（`agentkit`）、总体分层架构、在线检索与离线整理工作流，以及全部节点工具、System Prompt 与 Skill 规范。

跨项目通用的记忆理论与底层基建避坑参见上层 `wiki/` 目录；面向日常开发命令的速查说明参见 `code/agentkit/README.md` 与 `code/percolation/README.md`。

---

## 专题文档索引

| 文档 | 核心内容 | 适用场景 |
| --- | --- | --- |
| `01-agentkit-core-and-architecture.md` | **Agent 核心与总体分层架构**：`agentkit` 与业务层解耦原则、总体分层架构图、`run_agent` 157 行白盒工具循环流程图、核心原语（模型槽位、流式 Tool Calling、容错回灌、结构化自愈、受限工作区与 `bwrap` 沙箱、强制 RLS 事务与会话咨询锁） | 理解智能体底层运行机制，或将 `agentkit` 复用到新业务 Agent |
| `02-search-and-dreaming-workflows.md` | **在线检索与离线整理工作流程**：碎片录入 + `Search Agent` 四步检索状态机流程图、双轨混合召回（全文 + `trgm` + `halfvec` RRF + Rerank + 一跳邻居）、`Dreaming Agent` 五步夜间整理流程图、增量/重整双节奏判定、锚点双向对账与失败整体回滚 | 排查召回链路、调整冷热晋升阈值、优化整理与检索延迟 |
| `03-tools-prompts-and-skills-reference.md` | **工具矩阵、System Prompt 与 Skill 全景手册**：9 个原子工具的来源与安全边界、6 个 `AgentSpec` 节点的最小权限配置表、5 份 System Prompt 原文与设计约束、`wiki-format` 渐进式披露 Skill 规范 | 调优提示词、增删节点工具权限、扩展记忆文件解析规则 |

---

## 核心设计速览

1. **内核与业务彻底分层**：`code/agentkit/` 不包含任何记忆业务名词，专注解决“怎么安全可靠地调模型和跑工具”；`code/percolation/` 用普通 Python 代码控制状态流转，只在需要语义理解的环节调用 `run_agent()`。
2. **四层记忆 × 读写分离**：
   - **L4 热区（`MEMORY.md`）**：每次检索固定注入，硬上限 200 行，仅存放 `[confirmed]` 高频背景与个人暗语。
   - **L3 温区（`MEMORY_CACHE/*.md`）**：存放固定但低频的称呼、暗语与设定；默认不加载，首轮未命中时由只读沙箱静默穿透探查。
   - **L2 导航与多维图谱层（`wiki/*.md` + PostgreSQL 多维/邻接索引）**：扁平页面命名，通过 frontmatter `type`/`facets`、行内 `[dim:val]`、`[@YYYY-MM-DD]` 事件时间与 `[[rel::target|label]]` 有类型双向链接支持正交多维视角与异构拓扑图谱，强制绑定 `#msg_N` 原话锚点。
   - **L1 事实基准层（RDS PostgreSQL `raw_messages`）**：只追加不可篡改，180 秒内连发自动归并批次，录入零等待不算向量。
3. **最小权限与可验证闭环**：6 个 `AgentSpec` 节点各自拥有裁剪后的最小工具集（例如候选区探查沙箱看不见 `wiki/` 与 `MEMORY.md`；归档节点物理禁止写 `MEMORY.md`），依靠数据库强制 RLS、文件锚点对账与工作区 Git 快照保证多租户隔离与数据零失真。
