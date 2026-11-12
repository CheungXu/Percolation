-- Percolation 初始结构。由 percolation_owner 在空库上执行一次，不要重复执行。
-- 文件自带事务，执行时不要再加 --single-transaction。
-- 前置条件见 000_extensions.sql：vector、pg_trgm 已安装。
-- 应用运行时只能使用 percolation_app，并在事务内设置 app.current_user_id。

BEGIN;

CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

ALTER FUNCTION app_current_user_id() SET search_path = pg_catalog;

-- 汉字取重叠二字，英文、数字和型号保持整词。查询侧用同一个切法。
CREATE FUNCTION percolation_tokens(input text) RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $fn$
DECLARE
  i integer;
  ch text;
  code integer;
  prev text := '';
  buf text := '';
  tokens text[] := ARRAY[]::text[];
BEGIN
  IF input IS NULL OR btrim(input) = '' THEN
    RETURN tokens;
  END IF;

  FOR i IN 1..char_length(input) LOOP
    ch := substr(input, i, 1);
    code := ascii(ch);
    IF code >= 65 AND code <= 90 THEN
      ch := chr(code + 32);
      code := code + 32;
    END IF;

    IF (code >= 48 AND code <= 57)
       OR (code >= 97 AND code <= 122)
       OR (buf <> '' AND (ch = '.' OR ch = '-')) THEN
      buf := buf || ch;
      prev := '';
    ELSE
      IF buf <> '' THEN
        buf := regexp_replace(buf, '[.-]+$', '');
        IF buf <> '' THEN
          tokens := tokens || buf;
        END IF;
        buf := '';
      END IF;
      IF code >= 19968 AND code <= 40959 THEN
        IF prev <> '' THEN
          tokens := tokens || (prev || ch);
        END IF;
        prev := ch;
      ELSE
        prev := '';
      END IF;
    END IF;
  END LOOP;

  IF buf <> '' THEN
    buf := regexp_replace(buf, '[.-]+$', '');
    IF buf <> '' THEN
      tokens := tokens || buf;
    END IF;
  END IF;

  RETURN tokens;
END;
$fn$;

CREATE FUNCTION percolation_tsv(input text) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN cardinality(percolation_tokens(input)) = 0 THEN ''::tsvector
    ELSE to_tsvector('simple', array_to_string(percolation_tokens(input), ' '))
  END
$$;

CREATE FUNCTION percolation_tsquery(input text) RETURNS tsquery
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT string_agg(quote_literal(token), ' & ')::tsquery
  FROM unnest(percolation_tokens(input)) AS token
$$;

CREATE FUNCTION percolation_weighted_tsv(
  title text,
  aliases text[],
  heading text,
  body text
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    setweight(percolation_tsv(coalesce(title, '')), 'A')
    || setweight(percolation_tsv(coalesce(array_to_string(aliases, ' '), '')), 'A')
    || setweight(percolation_tsv(coalesce(heading, '')), 'B')
    || setweight(percolation_tsv(coalesce(body, '')), 'C')
$$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  external_slug text NOT NULL UNIQUE,
  workspace_rel_path text NOT NULL UNIQUE,
  next_msg_seq bigint NOT NULL DEFAULT 1,
  dirty_since timestamptz,
  pending_msg_count integer NOT NULL DEFAULT 0,
  pending_cache_hits integer NOT NULL DEFAULT 0,
  memory_line_count integer NOT NULL DEFAULT 0,
  last_dream_at timestamptz,
  last_defrag_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_slug_format CHECK (external_slug ~ '^[a-z][a-z0-9_-]{0,62}$'),
  CONSTRAINT users_workspace_format CHECK (
    workspace_rel_path ~ '^workspaces/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT users_seq_positive CHECK (next_msg_seq >= 1),
  CONSTRAINT users_pending_nonnegative CHECK (pending_msg_count >= 0 AND pending_cache_hits >= 0),
  CONSTRAINT users_memory_lines_nonnegative CHECK (memory_line_count >= 0)
);

CREATE FUNCTION users_guard() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.id IS NULL THEN
      NEW.id := uuidv7();
    END IF;
    NEW.workspace_rel_path := 'workspaces/' || NEW.id::text;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_rel_path IS DISTINCT FROM OLD.workspace_rel_path THEN
    RAISE EXCEPTION 'users.id and workspace_rel_path cannot change';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER users_guard
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_guard();

CREATE INDEX idx_users_dirty_queue
  ON users (dirty_since)
  WHERE dirty_since IS NOT NULL;

CREATE TABLE search_logs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  query_text text NOT NULL,
  route_path text NOT NULL,
  outcome text NOT NULL,
  rewritten_queries text[] NOT NULL DEFAULT '{}',
  memory_clues_used text[] NOT NULL DEFAULT '{}',
  cache_files_probed text[] NOT NULL DEFAULT '{}',
  cache_hit_entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  hit_doc_paths text[] NOT NULL DEFAULT '{}',
  verified_msg_seqs bigint[] NOT NULL DEFAULT '{}',
  latency_ms integer,
  token_usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_logs_query_not_blank CHECK (btrim(query_text) <> ''),
  CONSTRAINT search_logs_route_path CHECK (
    route_path IN ('primary_direct', 'cache_fallback', 'clarify_immediate')
  ),
  CONSTRAINT search_logs_outcome CHECK (
    outcome IN ('answered', 'clarify_asked', 'not_found', 'error')
  ),
  CONSTRAINT search_logs_cache_hits_are_array CHECK (jsonb_typeof(cache_hit_entries) = 'array'),
  CONSTRAINT search_logs_token_usage_is_object CHECK (
    token_usage IS NULL OR jsonb_typeof(token_usage) = 'object'
  ),
  CONSTRAINT search_logs_latency_nonnegative CHECK (latency_ms IS NULL OR latency_ms >= 0)
);

CREATE INDEX idx_search_logs_user_time
  ON search_logs (user_id, created_at DESC);

CREATE INDEX idx_search_logs_cache_hits
  ON search_logs (user_id, created_at DESC)
  WHERE route_path = 'cache_fallback'
    AND jsonb_array_length(cache_hit_entries) > 0;

CREATE TABLE raw_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  msg_seq bigint NOT NULL,
  batch_id uuid NOT NULL,
  source_kind text NOT NULL DEFAULT 'capture',
  reply_to_search_id uuid REFERENCES search_logs (id) ON DELETE RESTRICT,
  content text NOT NULL,
  client_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  tsv tsvector GENERATED ALWAYS AS (percolation_tsv(content)) STORED,
  dream_status text NOT NULL DEFAULT 'pending',
  captured_at timestamptz NOT NULL DEFAULT now(),
  dreamed_at timestamptz,
  CONSTRAINT raw_messages_user_seq UNIQUE (user_id, msg_seq),
  CONSTRAINT raw_messages_content_not_blank CHECK (btrim(content) <> ''),
  CONSTRAINT raw_messages_source_kind CHECK (source_kind IN ('capture', 'clarification', 'import')),
  CONSTRAINT raw_messages_meta_is_object CHECK (jsonb_typeof(client_meta) = 'object'),
  CONSTRAINT raw_messages_dream_status CHECK (dream_status IN ('pending', 'archived', 'skipped')),
  CONSTRAINT raw_messages_seq_positive CHECK (msg_seq >= 1)
);

CREATE FUNCTION raw_messages_guard() RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'raw_messages is append-only and cannot be deleted';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.msg_seq IS DISTINCT FROM OLD.msg_seq
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.reply_to_search_id IS DISTINCT FROM OLD.reply_to_search_id
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.client_meta IS DISTINCT FROM OLD.client_meta
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION 'raw_messages only allows dream_status and dreamed_at to change';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER raw_messages_guard
  BEFORE UPDATE OR DELETE ON raw_messages
  FOR EACH ROW
  EXECUTE FUNCTION raw_messages_guard();

CREATE INDEX idx_raw_messages_pending
  ON raw_messages (user_id, msg_seq)
  WHERE dream_status = 'pending';

CREATE INDEX idx_raw_messages_batch
  ON raw_messages (user_id, batch_id, msg_seq);

CREATE INDEX idx_raw_messages_tsv
  ON raw_messages USING gin (tsv);

CREATE INDEX idx_raw_messages_trgm
  ON raw_messages USING gin (content gin_trgm_ops);

CREATE INDEX idx_raw_messages_reply
  ON raw_messages (reply_to_search_id)
  WHERE reply_to_search_id IS NOT NULL;

CREATE TABLE wiki_chunks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  doc_path text NOT NULL,
  chunk_index integer NOT NULL,
  page_title text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  section_heading text NOT NULL DEFAULT '',
  content text NOT NULL,
  certainty text NOT NULL DEFAULT 'confirmed',
  source_msg_seqs bigint[] NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    percolation_weighted_tsv(page_title, aliases, section_heading, content)
  ) STORED,
  embedding halfvec(1024) NOT NULL,
  file_mtime timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wiki_chunks_doc_order UNIQUE (user_id, doc_path, chunk_index),
  CONSTRAINT wiki_chunks_doc_path_format CHECK (doc_path ~ '^wiki/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}\.md$'),
  CONSTRAINT wiki_chunks_index_nonnegative CHECK (chunk_index >= 0),
  CONSTRAINT wiki_chunks_title_not_blank CHECK (btrim(page_title) <> ''),
  CONSTRAINT wiki_chunks_content_not_blank CHECK (btrim(content) <> ''),
  CONSTRAINT wiki_chunks_certainty CHECK (certainty IN ('confirmed', 'inferred')),
  CONSTRAINT wiki_chunks_hash_format CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_wiki_chunks_hnsw
  ON wiki_chunks USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_wiki_chunks_tsv
  ON wiki_chunks USING gin (tsv);

CREATE INDEX idx_wiki_chunks_trgm
  ON wiki_chunks USING gin (content gin_trgm_ops);

CREATE INDEX idx_wiki_chunks_msg_seqs
  ON wiki_chunks USING gin (source_msg_seqs);

CREATE TABLE wiki_links (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  from_doc_path text NOT NULL,
  to_target text NOT NULL,
  to_doc_path text,
  anchor_text text NOT NULL DEFAULT '',
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wiki_links_edge UNIQUE (user_id, from_doc_path, to_target),
  CONSTRAINT wiki_links_from_format CHECK (from_doc_path ~ '^wiki/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}\.md$'),
  CONSTRAINT wiki_links_to_format CHECK (
    to_doc_path IS NULL OR to_doc_path ~ '^wiki/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}\.md$'
  ),
  CONSTRAINT wiki_links_target_not_blank CHECK (btrim(to_target) <> '')
);

CREATE INDEX idx_wiki_links_backlinks
  ON wiki_links (user_id, to_doc_path);

CREATE INDEX idx_wiki_links_dangling
  ON wiki_links (user_id, from_doc_path)
  WHERE to_doc_path IS NULL;

CREATE TABLE dream_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  run_mode text NOT NULL,
  status text NOT NULL,
  msg_seq_from bigint,
  msg_seq_to bigint,
  wiki_files_changed text[] NOT NULL DEFAULT '{}',
  cache_promotions jsonb NOT NULL DEFAULT '[]'::jsonb,
  memory_demotions jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_usage jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT dream_runs_mode CHECK (run_mode IN ('incremental', 'defrag')),
  CONSTRAINT dream_runs_status CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT dream_runs_seq_order CHECK (
    msg_seq_from IS NULL OR msg_seq_to IS NULL OR msg_seq_from <= msg_seq_to
  ),
  CONSTRAINT dream_runs_promotions_are_array CHECK (jsonb_typeof(cache_promotions) = 'array'),
  CONSTRAINT dream_runs_demotions_are_array CHECK (jsonb_typeof(memory_demotions) = 'array'),
  CONSTRAINT dream_runs_token_usage_is_object CHECK (
    token_usage IS NULL OR jsonb_typeof(token_usage) = 'object'
  )
);

CREATE INDEX idx_dream_runs_user_time
  ON dream_runs (user_id, started_at DESC);

CREATE FUNCTION capture_message(
  p_content text,
  p_source_kind text DEFAULT 'capture',
  p_reply_to_search_id uuid DEFAULT NULL,
  p_client_meta jsonb DEFAULT '{}'::jsonb,
  p_burst_window interval DEFAULT interval '180 seconds'
) RETURNS raw_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_user_id uuid;
  v_seq bigint;
  v_batch uuid;
  v_row raw_messages;
BEGIN
  v_user_id := app_current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'app.current_user_id is required';
  END IF;
  IF p_source_kind NOT IN ('capture', 'clarification', 'import') THEN
    RAISE EXCEPTION 'invalid source_kind';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'content is empty';
  END IF;
  IF p_client_meta IS NULL OR jsonb_typeof(p_client_meta) <> 'object' THEN
    RAISE EXCEPTION 'client_meta must be a json object';
  END IF;
  IF p_burst_window IS NULL
     OR p_burst_window <= interval '0 seconds'
     OR p_burst_window > interval '1 hour' THEN
    RAISE EXCEPTION 'burst window must be between 0 and 1 hour';
  END IF;

  SELECT next_msg_seq
  INTO v_seq
  FROM users
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  IF p_reply_to_search_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM search_logs
    WHERE id = p_reply_to_search_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'reply target not found';
  END IF;

  SELECT batch_id
  INTO v_batch
  FROM raw_messages
  WHERE user_id = v_user_id
    AND captured_at >= now() - p_burst_window
  ORDER BY msg_seq DESC
  LIMIT 1;

  IF v_batch IS NULL THEN
    v_batch := uuidv7();
  END IF;

  INSERT INTO raw_messages (
    user_id, msg_seq, batch_id, source_kind, reply_to_search_id, content, client_meta
  ) VALUES (
    v_user_id, v_seq, v_batch, p_source_kind, p_reply_to_search_id, p_content, p_client_meta
  )
  RETURNING * INTO v_row;

  UPDATE users
  SET next_msg_seq = v_seq + 1,
      dirty_since = coalesce(dirty_since, now()),
      pending_msg_count = pending_msg_count + 1
  WHERE id = v_user_id;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION capture_message(text, text, uuid, jsonb, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION capture_message(text, text, uuid, jsonb, interval) TO percolation_app;

INSERT INTO users (external_slug)
VALUES ('default')
ON CONFLICT (external_slug) DO NOTHING;

GRANT USAGE ON SCHEMA public TO percolation_app;

GRANT SELECT ON users TO percolation_app;
GRANT UPDATE (
  dirty_since,
  pending_msg_count,
  pending_cache_hits,
  memory_line_count,
  last_dream_at,
  last_defrag_at
) ON users TO percolation_app;

GRANT SELECT ON raw_messages TO percolation_app;
GRANT UPDATE (dream_status, dreamed_at) ON raw_messages TO percolation_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON search_logs TO percolation_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_chunks TO percolation_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_links TO percolation_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dream_runs TO percolation_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  FOR ALL TO percolation_app
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());
CREATE POLICY owner_maintenance ON users
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

ALTER TABLE raw_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON raw_messages
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
CREATE POLICY owner_maintenance ON raw_messages
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON search_logs
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
CREATE POLICY owner_maintenance ON search_logs
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

ALTER TABLE wiki_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wiki_chunks
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
CREATE POLICY owner_maintenance ON wiki_chunks
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

ALTER TABLE wiki_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wiki_links
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
CREATE POLICY owner_maintenance ON wiki_links
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

ALTER TABLE dream_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dream_runs
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
CREATE POLICY owner_maintenance ON dream_runs
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE raw_messages IS
  '只追加的原始记录。录入时不算向量；向量只出现在已归档的 wiki_chunks。';

COMMIT;
