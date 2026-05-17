-- 0035_show_discovery_chat.sql
-- Orchestrator-Chat fuer Show-Discovery: neuer Scope + Run-Focus-Spalte.
--
-- Bisher hatte das "Messen suchen"-Feature keinen Chat-Layer; Bedienung lief
-- ausschliesslich ueber das Formular plus REST-Routen. Mit dem neuen
-- show_discovery-Scope kann der ChatPanelContainer pro Seite einen
-- Orchestrator anbinden, der die Discovery-Pipeline natuerlichsprachlich
-- steuert. show_discovery_run_focus ist optional: ein durchgehender
-- User-Thread bleibt der Default, der Focus aktualisiert sich beim
-- Wechsel des aktiven Runs in der UI.

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS show_discovery_run_focus uuid
    REFERENCES show_discovery_runs(id) ON DELETE SET NULL;

ALTER TABLE chat_threads
  DROP CONSTRAINT IF EXISTS chat_threads_scope_check;
ALTER TABLE chat_threads
  ADD CONSTRAINT chat_threads_scope_check
    CHECK (scope IN ('dashboard','show','companies','competitor','show_discovery'));

CREATE INDEX IF NOT EXISTS idx_chat_threads_show_discovery_focus
  ON chat_threads (user_id, show_discovery_run_focus)
  WHERE show_discovery_run_focus IS NOT NULL;
