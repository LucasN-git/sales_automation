-- 0025_competitor_chat.sql
-- Adds competitor_focus to chat_threads and short_status to competitors
-- for the competitor orchestrator chat feature.

-- chat_threads: allow threads to be scoped to a specific competitor
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS competitor_focus uuid
    REFERENCES competitors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_threads_competitor_focus
  ON chat_threads(competitor_focus) WHERE competitor_focus IS NOT NULL;

-- competitors: track short-analysis status per competitor
ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS short_status text
    NOT NULL DEFAULT 'pending'
    CHECK (short_status IN ('pending', 'running', 'done', 'failed'));

-- Rebuild competitors_overview to include short_status
-- DROP first because CREATE OR REPLACE cannot change column order
DROP VIEW IF EXISTS competitors_overview;
CREATE VIEW competitors_overview
WITH (security_invoker = on) AS
SELECT
  c.id,
  c.user_id,
  c.display_name,
  c.normalized_name,
  c.domain,
  c.website,
  c.hq_country,
  c.status,
  c.short_status,
  c.source_event,
  c.discovery_run_id,
  c.current_version_id,
  c.created_at,
  c.updated_at,
  v.scan_kind          AS latest_scan_kind,
  v.one_liner,
  v.positioning,
  v.portfolio,
  v.isp_sector_match,
  v.growth_signals,
  v.customers,
  v.threat_level,
  v.created_at         AS latest_version_at,
  (
    SELECT count(*) FROM competitor_versions cv
    WHERE cv.competitor_id = c.id
  ) AS version_count,
  (
    SELECT count(*) FROM competitor_customer_links l
    WHERE l.competitor_id = c.id AND l.manual_rejected = false
  ) AS customer_link_count,
  (
    SELECT count(*) FROM competitor_customer_links l
    WHERE l.competitor_id = c.id AND l.company_id IS NOT NULL AND l.manual_rejected = false
  ) AS matched_customer_count,
  (
    SELECT count(*) FROM competitor_show_links s
    WHERE s.competitor_id = c.id
  ) AS show_link_count
FROM competitors c
LEFT JOIN competitor_versions v ON v.id = c.current_version_id;
