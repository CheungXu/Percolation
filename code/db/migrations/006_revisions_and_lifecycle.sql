-- Percolation 006 迁移：原话修订表、可撤销软删除、夜间整理清理后的原文物理抹除，以及问答重问/软删除。
-- 由 percolation_owner 执行，幂等可重复运行。
--
-- 设计不变式：
-- 1. raw_messages 的标识与录入元数据（id/user_id/msg_seq/batch_id/source_kind/captured_at 等）永不可改，行永不可 DELETE（保留序号占位）。
-- 2. 原话内容与生命周期列（content/edited_at/revision_count/deleted_at/purged_at）禁止直接 UPDATE，
--    只能经四个受控函数 revise_message / delete_messages / restore_messages / purge_messages 变更：
--    - 编辑：原子追加 raw_message_revisions，更新最新 content（自动刷新 tsv 与 trgm），置回 pending 待夜间整理同步；
--    - 删除：打上 deleted_at 立即从列表/检索/召回/近况中排除，撤销窗口内可 restore_messages 撤回；
--    - 抹除：撤销期已过且夜间整理清理完记忆页锚点后，purge_messages 清空 content 与全部修订记录，封存占位行。
-- 3. search_logs 增加 is_reask（问答「改了再问」挂在同一线程下，旧回答保留折叠）与 deleted_at（问答软删除与撤销）。

BEGIN;

-- 1. raw_messages 扩展生命周期列与约束
ALTER TABLE raw_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ever_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz;

ALTER TABLE raw_messages
  DROP CONSTRAINT IF EXISTS raw_messages_content_not_blank,
  DROP CONSTRAINT IF EXISTS raw_messages_purged_state,
  DROP CONSTRAINT IF EXISTS raw_messages_revision_nonneg;

ALTER TABLE raw_messages
  ADD CONSTRAINT raw_messages_content_not_blank
    CHECK (purged_at IS NOT NULL OR btrim(content) <> ''),
  ADD CONSTRAINT raw_messages_purged_state
    CHECK (purged_at IS NULL OR (deleted_at IS NOT NULL AND content = '')),
  ADD CONSTRAINT raw_messages_revision_nonneg
    CHECK (revision_count >= 0);

-- 2. 原话修订历史表（物理抹除时同步清空对应序号的修订）
CREATE TABLE IF NOT EXISTS raw_message_revisions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  msg_seq bigint NOT NULL,
  rev_no integer NOT NULL,
  prev_content text NOT NULL,
  new_content text NOT NULL,
  revised_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_message_revisions_unique UNIQUE (user_id, msg_seq, rev_no),
  CONSTRAINT raw_message_revisions_msg_fk FOREIGN KEY (user_id, msg_seq)
    REFERENCES raw_messages (user_id, msg_seq) ON DELETE CASCADE,
  CONSTRAINT raw_message_revisions_rev_pos CHECK (rev_no >= 1),
  CONSTRAINT raw_message_revisions_not_blank CHECK (btrim(prev_content) <> '' AND btrim(new_content) <> '')
);

CREATE INDEX IF NOT EXISTS idx_raw_message_revisions_lookup
  ON raw_message_revisions (user_id, msg_seq, rev_no);

REVOKE ALL ON TABLE raw_message_revisions FROM PUBLIC;
GRANT SELECT ON TABLE raw_message_revisions TO percolation_app;

ALTER TABLE raw_message_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_message_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_message_revisions;
CREATE POLICY tenant_isolation ON raw_message_revisions
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
DROP POLICY IF EXISTS owner_maintenance ON raw_message_revisions;
CREATE POLICY owner_maintenance ON raw_message_revisions
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

-- 3. search_logs 补充重问标记与软删除时间戳
ALTER TABLE search_logs
  ADD COLUMN IF NOT EXISTS is_reask boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_search_logs_active_roots
  ON search_logs (user_id, id DESC)
  WHERE parent_search_id IS NULL AND deleted_at IS NULL;

-- 4. 更新 raw_messages_guard 触发器与索引
CREATE OR REPLACE FUNCTION raw_messages_guard() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'raw_messages is append-only and cannot be deleted';
  END IF;

  IF OLD.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'purged raw_messages placeholder cannot be modified';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.msg_seq IS DISTINCT FROM OLD.msg_seq
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.reply_to_search_id IS DISTINCT FROM OLD.reply_to_search_id
     OR NEW.client_meta IS DISTINCT FROM OLD.client_meta
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION 'raw_messages identity and capture metadata cannot change';
  END IF;

  IF current_setting('app.raw_mutation', true) IS DISTINCT FROM 'allowed' THEN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
       OR NEW.revision_count IS DISTINCT FROM OLD.revision_count
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
      RAISE EXCEPTION 'raw_messages content/lifecycle must go through controlled functions';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

GRANT UPDATE (ever_archived) ON raw_messages TO percolation_app;

-- 回填存量已归档记录的 ever_archived 标记
UPDATE raw_messages
SET ever_archived = true
WHERE dream_status = 'archived' AND NOT ever_archived;

DROP INDEX IF EXISTS idx_raw_messages_pending;
CREATE INDEX idx_raw_messages_pending
  ON raw_messages (user_id, msg_seq)
  WHERE dream_status = 'pending' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_messages_active_seq
  ON raw_messages (user_id, msg_seq DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_messages_unpurged
  ON raw_messages (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL AND purged_at IS NULL;

-- 5. 受控原话变更函数
CREATE OR REPLACE FUNCTION _sync_user_dirty_state(p_user_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_pending integer;
  v_unpurged integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE dream_status = 'pending' AND deleted_at IS NULL)::integer,
    count(*) FILTER (WHERE deleted_at IS NOT NULL AND purged_at IS NULL)::integer
  INTO v_pending, v_unpurged
  FROM raw_messages
  WHERE user_id = p_user_id;

  UPDATE users
  SET pending_msg_count = v_pending,
      dirty_since = CASE
        WHEN v_pending > 0 OR v_unpurged > 0 OR pending_cache_hits > 0
          THEN coalesce(dirty_since, now())
        ELSE NULL
      END
  WHERE id = p_user_id;
END;
$fn$;

REVOKE ALL ON FUNCTION _sync_user_dirty_state(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION revise_message(
  p_msg_seq bigint,
  p_content text
) RETURNS raw_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_user_id uuid;
  v_row raw_messages;
  v_rev integer;
BEGIN
  v_user_id := app_current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'app.current_user_id is required';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'content is empty';
  END IF;

  PERFORM 1 FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  SELECT *
  INTO v_row
  FROM raw_messages
  WHERE user_id = v_user_id
    AND msg_seq = p_msg_seq
    AND deleted_at IS NULL
    AND purged_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'note not found';
  END IF;

  IF v_row.content = p_content THEN
    RETURN v_row;
  END IF;

  v_rev := v_row.revision_count + 1;

  INSERT INTO raw_message_revisions (
    user_id, msg_seq, rev_no, prev_content, new_content, revised_at
  ) VALUES (
    v_user_id, p_msg_seq, v_rev, v_row.content, p_content, now()
  );

  PERFORM set_config('app.raw_mutation', 'allowed', true);
  UPDATE raw_messages
  SET content = p_content,
      edited_at = now(),
      revision_count = v_rev,
      ever_archived = v_row.ever_archived OR (v_row.dream_status = 'archived'),
      dream_status = 'pending'
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM set_config('app.raw_mutation', '', true);

  PERFORM _sync_user_dirty_state(v_user_id);
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION revise_message(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revise_message(bigint, text) TO percolation_app;

CREATE OR REPLACE FUNCTION delete_messages(p_msg_seqs bigint[]) RETURNS SETOF bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_user_id uuid;
  v_deleted bigint[];
BEGIN
  v_user_id := app_current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'app.current_user_id is required';
  END IF;
  IF p_msg_seqs IS NULL OR cardinality(p_msg_seqs) = 0 THEN
    RETURN;
  END IF;

  PERFORM 1 FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  PERFORM set_config('app.raw_mutation', 'allowed', true);
  WITH marked AS (
    UPDATE raw_messages
    SET deleted_at = now(),
        ever_archived = ever_archived OR (dream_status = 'archived')
    WHERE user_id = v_user_id
      AND msg_seq = ANY(p_msg_seqs)
      AND deleted_at IS NULL
      AND purged_at IS NULL
    RETURNING msg_seq
  )
  SELECT coalesce(array_agg(msg_seq ORDER BY msg_seq), '{}') INTO v_deleted FROM marked;
  PERFORM set_config('app.raw_mutation', '', true);

  IF cardinality(v_deleted) > 0 THEN
    PERFORM _sync_user_dirty_state(v_user_id);
  END IF;

  RETURN QUERY SELECT unnest(v_deleted);
END;
$fn$;

REVOKE ALL ON FUNCTION delete_messages(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_messages(bigint[]) TO percolation_app;

CREATE OR REPLACE FUNCTION restore_messages(p_msg_seqs bigint[]) RETURNS SETOF bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_user_id uuid;
  v_restored bigint[];
BEGIN
  v_user_id := app_current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'app.current_user_id is required';
  END IF;
  IF p_msg_seqs IS NULL OR cardinality(p_msg_seqs) = 0 THEN
    RETURN;
  END IF;

  PERFORM 1 FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  PERFORM set_config('app.raw_mutation', 'allowed', true);
  WITH unmarked AS (
    UPDATE raw_messages
    SET deleted_at = NULL
    WHERE user_id = v_user_id
      AND msg_seq = ANY(p_msg_seqs)
      AND deleted_at IS NOT NULL
      AND purged_at IS NULL
    RETURNING msg_seq
  )
  SELECT coalesce(array_agg(msg_seq ORDER BY msg_seq), '{}') INTO v_restored FROM unmarked;
  PERFORM set_config('app.raw_mutation', '', true);

  IF cardinality(v_restored) > 0 THEN
    PERFORM _sync_user_dirty_state(v_user_id);
  END IF;

  RETURN QUERY SELECT unnest(v_restored);
END;
$fn$;

REVOKE ALL ON FUNCTION restore_messages(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION restore_messages(bigint[]) TO percolation_app;

CREATE OR REPLACE FUNCTION purge_messages(p_msg_seqs bigint[]) RETURNS SETOF bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_user_id uuid;
  v_purged bigint[];
BEGIN
  v_user_id := app_current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'app.current_user_id is required';
  END IF;
  IF p_msg_seqs IS NULL OR cardinality(p_msg_seqs) = 0 THEN
    RETURN;
  END IF;

  PERFORM 1 FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  PERFORM set_config('app.raw_mutation', 'allowed', true);
  WITH wiped AS (
    UPDATE raw_messages
    SET content = '',
        purged_at = now(),
        dream_status = 'skipped',
        dreamed_at = coalesce(dreamed_at, now())
    WHERE user_id = v_user_id
      AND msg_seq = ANY(p_msg_seqs)
      AND deleted_at IS NOT NULL
      AND purged_at IS NULL
    RETURNING msg_seq
  )
  SELECT coalesce(array_agg(msg_seq ORDER BY msg_seq), '{}') INTO v_purged FROM wiped;
  PERFORM set_config('app.raw_mutation', '', true);

  IF cardinality(v_purged) > 0 THEN
    DELETE FROM raw_message_revisions
    WHERE user_id = v_user_id
      AND msg_seq = ANY(v_purged);
    PERFORM _sync_user_dirty_state(v_user_id);
  END IF;

  RETURN QUERY SELECT unnest(v_purged);
END;
$fn$;

REVOKE ALL ON FUNCTION purge_messages(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_messages(bigint[]) TO percolation_app;

COMMIT;
