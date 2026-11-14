-- Percolation 005 迁移：产品端（拾记凝境网页）所需的最小结构补充。
-- 由 percolation_owner 执行，幂等可重复运行。
--
-- 1. search_logs 存下给用户看的回答与追问，并用 parent_search_id 把「追问 → 澄清后重查」串成一个对话线程，
--    网页刷新后能完整还原问答历史。旧行默认空串 / NULL。
-- 2. provision_user(p_slug)：外部账号（星页登录用户，slug = sp-<星页 user uuid>）首次访问时建租户。
--    运行角色看不见 users 的其他行，也没有 INSERT 权限，只能通过这个受控函数建号；
--    只接受 sp-<uuid> 形式的 slug，不能用它建 default / e2e- / replay- 等内部租户。

BEGIN;

ALTER TABLE search_logs
  ADD COLUMN IF NOT EXISTS answer_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS clarify_question text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS parent_search_id uuid REFERENCES search_logs (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_search_logs_thread
  ON search_logs (user_id, parent_search_id)
  WHERE parent_search_id IS NOT NULL;

COMMENT ON COLUMN search_logs.answer_text IS '展示给用户的回答原文';
COMMENT ON COLUMN search_logs.clarify_question IS '需要用户补充时的一句追问';
COMMENT ON COLUMN search_logs.parent_search_id IS '澄清后重查时指向线程第一问；第一问自身为 NULL';

CREATE OR REPLACE FUNCTION provision_user(p_slug text)
RETURNS TABLE (
  user_id uuid,
  external_slug text,
  workspace_rel_path text,
  created boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_new uuid;
BEGIN
  IF p_slug IS NULL
     OR p_slug !~ '^sp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'provision_user 只接受外部账号 slug（sp-<uuid>）：%', p_slug;
  END IF;

  INSERT INTO public.users (external_slug)
  VALUES (p_slug)
  ON CONFLICT (external_slug) DO NOTHING
  RETURNING id INTO v_new;

  RETURN QUERY
    SELECT u.id, u.external_slug, u.workspace_rel_path, v_new IS NOT NULL
    FROM public.users u
    WHERE u.external_slug = p_slug;
END;
$$;

REVOKE ALL ON FUNCTION provision_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_user(text) TO percolation_app;

COMMIT;
