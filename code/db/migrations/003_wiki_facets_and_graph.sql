-- Percolation 003 迁移：多维 Wiki 节点表、维度倒排表、条目级维度/事件时间表与有类型链接边。
-- 由 percolation_owner 执行。所有新增表全部来自 wiki/*.md 的确定性派生，配齐 ENABLE + FORCE RLS。

BEGIN;

-- 1. wiki_chunks 补充 facet_text 与切片级 facets 列，并纳入全文索引权重 B
ALTER TABLE wiki_chunks
  ADD COLUMN IF NOT EXISTS facet_text text NOT NULL DEFAULT '';

ALTER TABLE wiki_chunks
  ADD COLUMN IF NOT EXISTS facets jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE wiki_chunks
  DROP CONSTRAINT IF EXISTS wiki_chunks_facets_is_object;
ALTER TABLE wiki_chunks
  ADD CONSTRAINT wiki_chunks_facets_is_object CHECK (jsonb_typeof(facets) = 'object');

CREATE INDEX IF NOT EXISTS idx_wiki_chunks_facets
  ON wiki_chunks USING gin (facets jsonb_path_ops);

ALTER TABLE wiki_chunks
  ALTER COLUMN tsv SET EXPRESSION AS (
    percolation_weighted_tsv(
      page_title,
      aliases,
      btrim(coalesce(section_heading, '') || ' ' || coalesce(facet_text, '')),
      content
    )
  );

-- 2. wiki_pages：页面级节点表
CREATE TABLE IF NOT EXISTS wiki_pages (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  doc_path text NOT NULL,
  page_title text NOT NULL,
  page_type text NOT NULL DEFAULT 'topic',
  aliases text[] NOT NULL DEFAULT '{}',
  facets jsonb NOT NULL DEFAULT '{}'::jsonb,
  chunk_count integer NOT NULL DEFAULT 0,
  source_msg_seqs bigint[] NOT NULL DEFAULT '{}',
  file_mtime timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, doc_path),
  CONSTRAINT wiki_pages_doc_path_format CHECK (doc_path ~ '^wiki/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}\.md$'),
  CONSTRAINT wiki_pages_title_not_blank CHECK (btrim(page_title) <> ''),
  CONSTRAINT wiki_pages_type_check CHECK (page_type IN ('topic', 'entity', 'person', 'project', 'resource', 'event')),
  CONSTRAINT wiki_pages_facets_is_object CHECK (jsonb_typeof(facets) = 'object'),
  CONSTRAINT wiki_pages_chunk_count_nonneg CHECK (chunk_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_type
  ON wiki_pages (user_id, page_type);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_msg_seqs
  ON wiki_pages USING gin (source_msg_seqs);

-- 3. page_facets：页面级多维倒排表
CREATE TABLE IF NOT EXISTS page_facets (
  user_id uuid NOT NULL,
  doc_path text NOT NULL,
  dim text NOT NULL,
  val text NOT NULL,
  PRIMARY KEY (user_id, doc_path, dim, val),
  FOREIGN KEY (user_id, doc_path) REFERENCES wiki_pages (user_id, doc_path) ON DELETE CASCADE,
  CONSTRAINT page_facets_dim_format CHECK (dim ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT page_facets_val_not_blank CHECK (btrim(val) <> '' AND char_length(val) <= 64)
);

CREATE INDEX IF NOT EXISTS idx_page_facets_lookup
  ON page_facets (user_id, dim, val);

-- 4. message_facets：原话级多维派生表（继承所在页面维度 + 行内维度）
CREATE TABLE IF NOT EXISTS message_facets (
  user_id uuid NOT NULL,
  msg_seq bigint NOT NULL,
  doc_path text NOT NULL,
  dim text NOT NULL,
  val text NOT NULL,
  PRIMARY KEY (user_id, msg_seq, doc_path, dim, val),
  FOREIGN KEY (user_id, doc_path) REFERENCES wiki_pages (user_id, doc_path) ON DELETE CASCADE,
  CONSTRAINT message_facets_seq_pos CHECK (msg_seq > 0),
  CONSTRAINT message_facets_dim_format CHECK (dim ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT message_facets_val_not_blank CHECK (btrim(val) <> '' AND char_length(val) <= 64)
);

CREATE INDEX IF NOT EXISTS idx_message_facets_lookup
  ON message_facets (user_id, dim, val);

CREATE INDEX IF NOT EXISTS idx_message_facets_msg
  ON message_facets (user_id, msg_seq);

-- 5. message_events：原话级事件日期区间派生表（区别于录入时间 captured_at）
CREATE TABLE IF NOT EXISTS message_events (
  user_id uuid NOT NULL,
  msg_seq bigint NOT NULL,
  doc_path text NOT NULL,
  event_start date NOT NULL,
  event_end date NOT NULL,
  PRIMARY KEY (user_id, msg_seq, doc_path, event_start, event_end),
  FOREIGN KEY (user_id, doc_path) REFERENCES wiki_pages (user_id, doc_path) ON DELETE CASCADE,
  CONSTRAINT message_events_seq_pos CHECK (msg_seq > 0),
  CONSTRAINT message_events_order CHECK (event_start <= event_end)
);

CREATE INDEX IF NOT EXISTS idx_message_events_range
  ON message_events (user_id, event_start, event_end);

CREATE INDEX IF NOT EXISTS idx_message_events_msg
  ON message_events (user_id, msg_seq);

-- 6. wiki_links：增加有类型关系列 rel_type
ALTER TABLE wiki_links
  ADD COLUMN IF NOT EXISTS rel_type text NOT NULL DEFAULT 'related';

ALTER TABLE wiki_links
  DROP CONSTRAINT IF EXISTS wiki_links_rel_type_format;
ALTER TABLE wiki_links
  ADD CONSTRAINT wiki_links_rel_type_format CHECK (rel_type ~ '^[a-z][a-z0-9_]{0,31}$');

ALTER TABLE wiki_links
  DROP CONSTRAINT IF EXISTS wiki_links_edge;
ALTER TABLE wiki_links
  ADD CONSTRAINT wiki_links_edge UNIQUE (user_id, from_doc_path, to_target, rel_type);

CREATE INDEX IF NOT EXISTS idx_wiki_links_rel_type
  ON wiki_links (user_id, rel_type);

-- 7. 权限与强制行级安全（ENABLE + FORCE RLS）
REVOKE ALL ON TABLE wiki_pages, page_facets, message_facets, message_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON wiki_pages, page_facets, message_facets, message_events TO percolation_app;

ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_pages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wiki_pages;
CREATE POLICY tenant_isolation ON wiki_pages
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
DROP POLICY IF EXISTS owner_maintenance ON wiki_pages;
CREATE POLICY owner_maintenance ON wiki_pages
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

ALTER TABLE page_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_facets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON page_facets;
CREATE POLICY tenant_isolation ON page_facets
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
DROP POLICY IF EXISTS owner_maintenance ON page_facets;
CREATE POLICY owner_maintenance ON page_facets
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

ALTER TABLE message_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_facets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON message_facets;
CREATE POLICY tenant_isolation ON message_facets
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
DROP POLICY IF EXISTS owner_maintenance ON message_facets;
CREATE POLICY owner_maintenance ON message_facets
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

ALTER TABLE message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON message_events;
CREATE POLICY tenant_isolation ON message_events
  FOR ALL TO percolation_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
DROP POLICY IF EXISTS owner_maintenance ON message_events;
CREATE POLICY owner_maintenance ON message_events
  FOR ALL TO percolation_owner
  USING (true)
  WITH CHECK (true);

COMMIT;
