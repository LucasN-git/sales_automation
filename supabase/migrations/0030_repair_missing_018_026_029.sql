-- 0030_repair_missing_018_026_029.sql
-- Repair-Migration: 0018, 0026 und 0029 waren nie auf der produktiven
-- Supabase-DB ausgefuehrt worden (sichtbar am Fehler
-- "column competitor_discovery_runs.current_phase does not exist" und
-- "table competitor_discovery_log not found"). Dieses Skript zieht alle
-- drei Migrationen idempotent nach und raeumt die stecken gebliebenen
-- pending-Discovery-Runs auf, die durch den Bug entstanden sind.
--
-- Sicher mehrfach ausfuehrbar (IF NOT EXISTS, DROP+ADD CHECK etc.).

-- ─────────────────────────────────────────────────────────────────────────────
-- Aus 0018_competitor_discovery_log.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE competitor_discovery_runs
  ADD COLUMN IF NOT EXISTS current_phase text;

CREATE TABLE IF NOT EXISTS competitor_discovery_log (
  id bigint generated always as identity primary key,
  run_id uuid REFERENCES competitor_discovery_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  phase text,
  message text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cdl_run_recent
  ON competitor_discovery_log (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cdl_user
  ON competitor_discovery_log (user_id, created_at DESC);

ALTER TABLE competitor_discovery_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cdl_owner_all" ON competitor_discovery_log;
CREATE POLICY "cdl_owner_all" ON competitor_discovery_log FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'competitor_discovery_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.competitor_discovery_log;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Aus 0026_competitor_log_extend.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE competitor_discovery_log
  ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE competitor_discovery_log
  ADD COLUMN IF NOT EXISTS competitor_id uuid
    REFERENCES competitors(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cdl_competitor
  ON competitor_discovery_log (competitor_id, created_at DESC)
  WHERE competitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cdl_user_recent
  ON competitor_discovery_log (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Aus 0029_chat_thread_scope.sql
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'companies';

UPDATE chat_threads
SET scope = CASE
  WHEN trade_show_id    IS NOT NULL THEN 'show'
  WHEN competitor_focus IS NOT NULL THEN 'competitor'
  WHEN company_focus    IS NOT NULL THEN 'companies'
  ELSE 'companies'
END
WHERE scope = 'companies';

ALTER TABLE chat_threads
  DROP CONSTRAINT IF EXISTS chat_threads_scope_check;
ALTER TABLE chat_threads
  ADD CONSTRAINT chat_threads_scope_check
    CHECK (scope IN ('dashboard', 'show', 'companies', 'competitor'));

ALTER TABLE chat_threads
  ALTER COLUMN scope SET DEFAULT 'dashboard';

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_scope_recent
  ON chat_threads (user_id, scope, last_message_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup: die 5 (oder mehr) pending-Leichen, die nie ein "running" sehen
-- konnten, weil mark-running an der fehlenden current_phase-Spalte gescheitert
-- ist. Markieren wir als failed, damit get_discovery_status sie sauber zeigt
-- und nichts mehr im Loadstate als "aktiv" durchkommt.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE competitor_discovery_runs
SET status = 'failed',
    current_phase = 'failed',
    error_message = COALESCE(error_message, 'aufgegeben durch 0030_repair: mark-running hat nie laufen koennen (Schema-Drift 0018 fehlte)'),
    finished_at = COALESCE(finished_at, now())
WHERE status = 'pending'
  AND created_at < now() - interval '1 minute';
