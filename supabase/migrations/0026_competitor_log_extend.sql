-- 0026_competitor_log_extend.sql
-- Erweitert competitor_discovery_log fuer allgemeine Competitor-Events
-- (Short-Analyse, manuelle Aktionen) ohne Pflicht-run_id.

-- run_id nullable machen (war NOT NULL fuer run-scoped logs)
ALTER TABLE competitor_discovery_log
  ALTER COLUMN run_id DROP NOT NULL;

-- Optionaler Bezug zu einem einzelnen Konkurrenten
ALTER TABLE competitor_discovery_log
  ADD COLUMN IF NOT EXISTS competitor_id uuid
    REFERENCES competitors(id) ON DELETE CASCADE;

-- Index fuer per-competitor lookups
CREATE INDEX IF NOT EXISTS idx_cdl_competitor
  ON competitor_discovery_log (competitor_id, created_at DESC)
  WHERE competitor_id IS NOT NULL;

-- Index fuer user-level log feed (neueste Eintraege zuerst)
CREATE INDEX IF NOT EXISTS idx_cdl_user_recent
  ON competitor_discovery_log (user_id, created_at DESC);
