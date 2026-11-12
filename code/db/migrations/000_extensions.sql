-- 由 RDS 高权限账号在 percolation 库执行一次。
-- 不要安装 pg_jieba 或 zhparser：二者都要求把插件写入 shared_preload_libraries
-- 并重启整个实例，而这台实例还承载相邻业务。
-- 中文全文改由 001_init.sql 里的重叠二字函数生成，不依赖外部词典。

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER DATABASE percolation SET timezone = 'Asia/Shanghai';
ALTER DATABASE percolation SET idle_in_transaction_session_timeout = '60s';
ALTER DATABASE percolation SET hnsw.ef_search = 60;
