---
name: aliyun-rds-pg-tenant-db
description: 在共享的阿里云 RDS PostgreSQL 实例上零停机初始化独立多租户业务库（双角色分离防 BYPASSRLS 绕过、ENABLE+FORCE RLS 默认全拒、免重启中文重叠二字 tsvector + pg_trgm + halfvec 混合检索索引）。当需要在现有阿里云 RDS PG 实例上为新项目建库、配置多租户行级安全或启用中文全文/向量检索时使用。
---

# 共享阿里云 RDS PostgreSQL 独立多租户混合检索库初始化

本技能用于在**已承载其他线上业务的共享阿里云 RDS PostgreSQL 实例**上，安全、零重启地开通一个全新的多租户 AI 业务库。

Percolation 项目的 `percolation` 库已按此流程建好（迁移文件见 `code/db/migrations/`，连接配置见 `config/db.env`）。给新项目复用前，先检查目标库和角色是否已存在，切勿覆盖已有库。

## 1. 前置检查（只读，绝不修改实例级需要重启的参数）

使用现有 RDS 高权限账号连接 `postgres` 库，核查四件事：

```sql
SELECT version(), current_user;
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user;
SHOW shared_preload_libraries;
SELECT name, default_version FROM pg_available_extensions
WHERE name IN ('vector', 'pg_trgm', 'pgroonga', 'pg_jieba', 'zhparser') ORDER BY name;
```

**红线**：
- 看到当前管理账号 `rolbypassrls = true` 属于正常现象，**绝不能**把该账号写入业务代码的运行时 `DATABASE_URL`。
- 若 `shared_preload_libraries` 中没有 `pg_jieba` 或 `zhparser`，**不要安装这两个扩展**，更不要去控制台改预加载库触发整机重启。中文全文改用库内 `IMMUTABLE` 重叠二字函数 + `simple` 分词器。

## 2. 创建双角色与独立业务库（SCRAM-SHA-256）

用 Python `secrets.token_urlsafe(24)` 生成两套独立随机密码，连接 `postgres` 库执行：

```sql
SET password_encryption = 'scram-sha-256';

CREATE ROLE <app>_owner LOGIN PASSWORD '<owner_pwd>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE <app>_app LOGIN PASSWORD '<app_pwd>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE DATABASE <app> OWNER <app>_owner ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE <app> FROM PUBLIC;
GRANT CONNECT ON DATABASE <app> TO <app>_owner, <app>_app;
```

## 3. 安装免重启扩展与库级参数

用 RDS 高权限账号连接刚建好的 `<app>` 库执行一次：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER DATABASE <app> SET timezone = 'Asia/Shanghai';
ALTER DATABASE <app> SET idle_in_transaction_session_timeout = '60s';
ALTER DATABASE <app> SET hnsw.ef_search = 60;
```

## 4. 建表、最小权限与强制 RLS 规范（由 `<app>_owner` 执行）

迁移 SQL 文件若自带 `BEGIN; ... COMMIT;`，调用 `psql` 时只传 `-v ON_ERROR_STOP=1 -f xxx.sql`，不要叠加 `--single-transaction`。

1. **事务级租户上下文函数（Fail-Closed）**：
   ```sql
   CREATE FUNCTION app_current_user_id() RETURNS uuid
   LANGUAGE sql STABLE PARALLEL SAFE AS $$
     SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
   $$;
   ALTER FUNCTION app_current_user_id() SET search_path = pg_catalog;
   ```
2. **所有业务表统一成对配置强制 RLS**：
   ```sql
   ALTER TABLE <tbl> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <tbl> FORCE ROW LEVEL SECURITY;

   CREATE POLICY tenant_isolation ON <tbl>
     FOR ALL TO <app>_app
     USING (user_id = app_current_user_id())
     WITH CHECK (user_id = app_current_user_id());

   CREATE POLICY owner_maintenance ON <tbl>
     FOR ALL TO <app>_owner
     USING (true) WITH CHECK (true);
   ```
3. **只追加表保护**：收回 `<app>_app` 的直接 `INSERT / DELETE` 权限，仅暴露 `SECURITY DEFINER`（带 `SET search_path = pg_catalog, public`）写入函数与状态列列级 `UPDATE`，并加 `BEFORE UPDATE OR DELETE` 触发器锁死原文列。
4. **混合检索索引**：
   - 中文多级加权全文：复用 `code/db/migrations/001_init.sql` 中的 `percolation_tokens` / `percolation_tsv` / `percolation_weighted_tsv` 生成 `STORED` `tsvector` 列并建 `GIN` 索引；
   - 型号与子串模糊：文本列建 `USING gin (content gin_trgm_ops)`；
   - 语义向量：列类型选 `halfvec(1024)`，建 `USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)`。

## 5. 必做验收项（全部在回滚事务或临时租户下完成，不留脏数据）

1. **未设租户默认全拒**：用 `<app>_app` 直接 `SELECT count(*) FROM users;`，必须返回 `0`。
2. **跨租户隔离**：插入两个租户数据，在事务内 `SELECT set_config('app.current_user_id', '<tenant_a>', true);`，确认只能看到租户 A、完全看不到租户 B。
3. **不可变防篡改**：用 `<app>_app` 直接 `INSERT` 或改原文列必须报 `permission denied`；用 `<app>_owner` 改原文列必须被触发器拦截。
4. **凭据落盘检查**：将 `<app>_app` 写入 `config/db.env` 的 `DATABASE_URL`，`<app>_owner` 写入 `MIGRATE_DATABASE_URL`，文件权限设为 `600`，并用 `git check-ignore -v config/db.env` 确认已被忽略，最后清理 `/tmp` 下的任何临时脚本。
