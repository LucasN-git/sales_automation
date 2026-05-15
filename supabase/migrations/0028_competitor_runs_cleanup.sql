-- 0028_competitor_runs_cleanup.sql
-- Zwei Bug-Fixes fuer das Competitors-Feature:
--
-- 1. started_at auf competitor_discovery_runs
--    Die Spalte wurde im Code erwartet (ORDER BY started_at, SELECT started_at),
--    existierte aber nicht in 0016. Bestandsdaten werden mit created_at befuellt.
--
-- 2. threat_level CHECK auf competitor_versions um 'critical' erweitern
--    lib/competitor-short.ts und das Tool-Schema erlauben 'critical',
--    der DB-Constraint in 0016 hat es vergessen.

-- ── 1) started_at ────────────────────────────────────────────────────────────

ALTER TABLE competitor_discovery_runs
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Backfill: existing rows get created_at as approximation
UPDATE competitor_discovery_runs
  SET started_at = created_at
  WHERE started_at IS NULL;

ALTER TABLE competitor_discovery_runs
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN started_at SET DEFAULT now();

-- Replace the existing user/recent index (was on created_at) with started_at variant
DROP INDEX IF EXISTS idx_cdr_user_recent;
CREATE INDEX IF NOT EXISTS idx_cdr_user_started
  ON competitor_discovery_runs (user_id, started_at DESC);

-- ── 2) threat_level: add 'critical' ─────────────────────────────────────────

ALTER TABLE competitor_versions
  DROP CONSTRAINT IF EXISTS competitor_versions_threat_level_check;

ALTER TABLE competitor_versions
  ADD CONSTRAINT competitor_versions_threat_level_check
    CHECK (threat_level IN ('low', 'medium', 'high', 'critical'));
