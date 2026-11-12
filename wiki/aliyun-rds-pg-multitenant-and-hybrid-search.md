# 阿里云共享 RDS PostgreSQL 多租户隔离与免重启中文混合检索指南

当多个项目共用同一台阿里云 RDS PostgreSQL 实例（按库隔离）构建多租户 AI 应用时，直接照搬本地单机 PostgreSQL 教程极易踩中**行级安全（RLS）静默失效**与**中文分词插件要求重启整台实例**两大陷阱。本文沉淀经生产环境实测验证的标准做法。

---

## 一、 多租户强制 RLS 的三大避坑铁律

### 1. 严禁直接用 RDS 控制台初始账号跑业务连接
阿里云 RDS 创建的高权限账号（加入 `pg_rds_superuser` 组）默认带有 `rolbypassrls = true` 属性。只要应用使用该账号连接数据库，表上配置的一切 `ROW LEVEL SECURITY` 策略都会被静默绕过，任意漏写 `WHERE user_id = ...` 的查询都会直接跨租户泄漏全表数据。

**标准做法：双角色物理拆分**
- **`<app>_owner`（迁移属主角色）**：`NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`，作为独立业务库及所有表的 Owner，**仅在执行 DDL 迁移脚本时使用**。
- **`<app>_app`（业务运行角色）**：同样开启 `NOBYPASSRLS`，仅授予必要的 `SELECT / INSERT / UPDATE / DELETE` 及受控函数 `EXECUTE` 权限，供线上 API 与后台 Worker 日常连接。

> **PostgreSQL 18 密码加密注意**：在部分 RDS 实例默认会话下直接执行 `CREATE ROLE ... PASSWORD '...'` 可能回退到已弃用的 MD5 哈希并产生告警。改密或建号前先在会话内执行 `SET password_encryption = 'scram-sha-256';`。

### 2. 同时开启 `ENABLE` 与 `FORCE`，并为 Owner 显式留维护策略
- 仅执行 `ALTER TABLE t ENABLE ROW LEVEL SECURITY` 时，表的所有者默认仍免受策略约束；配合 `ALTER TABLE t FORCE ROW LEVEL SECURITY` 可彻底封死角色误用风险。
- 但开启 `FORCE` 后，连 `<app>_owner` 自己在迁移脚本中写入种子数据或做数据修复时也会被拦住。因此每张表应成对声明两条策略：
  1. 面向 `<app>_app`：校验 `user_id = app_current_user_id()`；
  2. 面向 `<app>_owner`：`USING (true) WITH CHECK (true)`，专供运维与迁移使用。

### 3. Fail-Closed（默认全拒）的事务级租户上下文
不要依赖连接池会话级全局变量（归还连接若未清理会串租户）。一律在事务内通过 `set_config(..., true)`（第三个参数 `is_local = true`，事务结束自动清空）注入租户身份，并让读取函数在未设置时返回 `NULL`：

```sql
CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;
ALTER FUNCTION app_current_user_id() SET search_path = pg_catalog;
```

由于在 SQL 中 `user_id = NULL` 恒为 Unknown（非 True），只要业务代码忘设租户 ID，查询结果自动为空集、写入自动报错拒绝，实现**默认安全（Fail-Closed）**。

---

## 二、 只追加事实表的“权限收回 + 触发器 + `SECURITY DEFINER`”组合拳

当某张表需要严格保证“只追加、原文不可篡改，仅允许后台推进处理状态”（如原始对话流、审计账本）时，单靠应用代码约定不够稳妥，推荐三层数据库级约束：

1. **列级写权限收敛**：不给 `<app>_app` 授予表的直接 `INSERT`、`DELETE` 或全列 `UPDATE` 权限，仅授予状态列的更新权限，例如 `GRANT UPDATE (status, processed_at) ON raw_messages TO <app>_app;`。
2. **受控入口函数原子落盘**：提供 `SECURITY DEFINER` 写入函数（务必显式固定 `SET search_path = pg_catalog, public` 防止搜索路径劫持），在函数内校验 `app_current_user_id()` 非空、加行锁分配租户内递增序号并更新租户汇总计数。
3. **触发器兜底防误改**：挂载 `BEFORE UPDATE OR DELETE` 触发器，禁止一切 `DELETE`，并在 `UPDATE` 时用 `IS DISTINCT FROM` 逐列比对不可变字段——即使运维人员误用 `<app>_owner` 手工改原文也会被直接拦截。

---

## 三、 共享 RDS 实例免重启的中文 + 型号 + 向量混合检索方案

### 1. 为什么不能盲装 `pg_jieba` 或 `zhparser`
在阿里云 RDS PostgreSQL 上，`pg_available_extensions` 中虽然能看到 `pg_jieba` 与 `zhparser`，但这两款 C 分词扩展都要求先加入实例级参数 `shared_preload_libraries` 并**重启整个 RDS 实例**才能初始化词典（否则调用时直接报错 `must be loaded in shared_preload_libraries` 或 `zhparser has not be initialized`）。在承载线上其他业务的共享实例上，绝不能为了新建一个子项目库去重启整台数据库。

*(备选注记：`pgroonga` 在 RDS PG 18 上无需预加载即可直接建索引，但其使用独立算子 `&@~` 且不支持原生 `tsvector` 的 `setweight` A/B/C 多级字段权重融合。)*

### 2. 零外部依赖方案：库内重叠二字 `tsvector` + `pg_trgm` + `halfvec`
无需重启实例，仅需启用免预加载的官方 `vector` 与 `pg_trgm` 扩展，即可覆盖中文短语、残缺英文型号与模糊语义三类召回：

| 检索维度 | 实现机制 | 解决的典型查询 |
| --- | --- | --- |
| 中文词组与多级标题加权 | `IMMUTABLE` 函数将连续汉字切为重叠二字（`便携显示器` → `便携 携显 显示 示器`）、英文数字保整词，通过 `to_tsvector('simple', ...)` 配合 `setweight` 合成 `GENERATED ALWAYS AS ... STORED` 生成列 + GIN 索引 | 搜双字及以上中文词（如“显示器”、“承重”），且天然规避词典未登录新词切碎问题；标题/别名可赋 A 级高权重 |
| 英文型号、缩写与单字/残缺词 | `pg_trgm` 的 `gin_trgm_ops` 三元组索引 | 搜半截硬件型号（如 `cforc` 命中 `cforce 15.6`）、代号缩写 |
| 跨概念模糊语义近邻 | `pgvector` 0.8+ 的 `halfvec(1024)` 半精度向量 + `HNSW (halfvec_cosine_ops)`，库级设置 `ALTER DATABASE ... SET hnsw.ef_search = 60` | 表达完全不同但语义相关的印象式提问；比 `vector(1024)` 节省 50% 内存与存储，精度几乎无损 |

> **单字查询边界提醒**：重叠二字索引对**单个汉字**（如单搜一个“屏”字）不会生成二字词元，`percolation_tsquery` 会返回空或需在应用层检索器中对 1 字中文自动回退到 `ILIKE` / 向量分支。

---

## 四、 阿里云百炼向量与重排接口接入要点

- **文本向量（`text-embedding-v4`）**：直接走 OpenAI 兼容端点 `https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings`，在请求体显式传入 `"dimensions": 1024`，与数据库 `halfvec(1024)` 严格对齐。
- **语义重排（`gte-rerank-v2`）**：优先走 DashScope 原生端点 `https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank`，请求结构为 `{"model": "gte-rerank-v2", "input": {"query": "...", "documents": [...]}, "parameters": {"top_n": k, "return_documents": false}}`，响应从 `output.results[{index, relevance_score}]` 读取排序下标。
