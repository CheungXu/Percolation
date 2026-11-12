-- Percolation 002 迁移：为夜间 Dreaming 调度器与外部 slug 路由提供受控只读查询函数。
-- 由 percolation_owner 执行，幂等可重复运行（CREATE OR REPLACE）。
-- 设计原则：仅返回最小调度元数据（user_id 与队列计数），绝不暴露任何用户文本或业务明细；
-- 真正执行整理或检索时，仍必须切回单租户事务（set_config('app.current_user_id', ...)）受强制 RLS 约束。

BEGIN;

CREATE OR REPLACE FUNCTION list_dirty_users(p_limit integer DEFAULT 100)
RETURNS TABLE (
  user_id uuid,
  external_slug text,
  workspace_rel_path text,
  dirty_since timestamptz,
  pending_msg_count integer,
  pending_cache_hits integer,
  memory_line_count integer,
  last_dream_at timestamptz,
  last_defrag_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    u.id AS user_id,
    u.external_slug,
    u.workspace_rel_path,
    u.dirty_since,
    u.pending_msg_count,
    u.pending_cache_hits,
    u.memory_line_count,
    u.last_dream_at,
    u.last_defrag_at
  FROM public.users u
  WHERE u.dirty_since IS NOT NULL
     OR u.pending_msg_count > 0
     OR u.pending_cache_hits > 0
  ORDER BY u.dirty_since ASC NULLS LAST, u.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000));
$$;

REVOKE ALL ON FUNCTION list_dirty_users(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_dirty_users(integer) TO percolation_app;

CREATE OR REPLACE FUNCTION resolve_user_by_slug(p_slug text)
RETURNS TABLE (
  user_id uuid,
  external_slug text,
  workspace_rel_path text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    u.id AS user_id,
    u.external_slug,
    u.workspace_rel_path
  FROM public.users u
  WHERE u.external_slug = p_slug
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_user_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_user_by_slug(text) TO percolation_app;

COMMIT;
