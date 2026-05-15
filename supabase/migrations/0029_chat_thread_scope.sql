-- 0029_chat_thread_scope.sql
-- Fuehrt eine explizite scope-Spalte auf chat_threads ein.
--
-- Vorher: scope wurde indirekt aus drei nullable-Feldern abgeleitet
-- (trade_show_id, company_focus, competitor_focus). Default in der UI war
-- "global"=Companies-Chat, was beim Verlassen einer Show-Page zu einem
-- semantisch falschen Reset fuehrte und den Cross-Scope-Verlauf-Drawer
-- unmoeglich machte.
--
-- Jetzt: vier saubere Scopes
--   dashboard   = Lifecycle-Chat (Messen anlegen, Discovery, uebergreifend)
--   show        = Pipeline-Orchestrator einer konkreten Messe
--   companies   = Cross-Show Firmen-Chat (vorher "global")
--   competitor  = Konkurrenten-Chat
--
-- Backfill leitet den Scope deterministisch aus den bestehenden Spalten ab.

-- 1) Spalte anlegen (default voruebergehend 'companies' fuer den Backfill).
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'companies';

-- 2) Backfill aus bestehenden Beziehungs-Spalten.
--    Reihenfolge: trade_show_id > competitor_focus > company_focus > companies.
UPDATE chat_threads
SET scope = CASE
  WHEN trade_show_id   IS NOT NULL THEN 'show'
  WHEN competitor_focus IS NOT NULL THEN 'competitor'
  WHEN company_focus    IS NOT NULL THEN 'companies'
  ELSE 'companies'
END
WHERE scope = 'companies';
-- Hinweis: rein "globale" Threads ohne jeglichen Fokus werden 'companies'
-- zugeordnet, weil der Default-Scope vor dieser Migration der Companies-
-- Chat war. Ein neuer dashboard-Thread ist nur via expliziten Insert
-- moeglich.

-- 3) CHECK-Constraint nach Backfill.
ALTER TABLE chat_threads
  DROP CONSTRAINT IF EXISTS chat_threads_scope_check;
ALTER TABLE chat_threads
  ADD CONSTRAINT chat_threads_scope_check
    CHECK (scope IN ('dashboard', 'show', 'companies', 'competitor'));

-- 4) Default fuer neue Inserts auf 'dashboard' setzen.
ALTER TABLE chat_threads
  ALTER COLUMN scope SET DEFAULT 'dashboard';

-- 5) Index fuer den Scope-Filter im History-Drawer.
CREATE INDEX IF NOT EXISTS idx_chat_threads_user_scope_recent
  ON chat_threads (user_id, scope, last_message_at DESC);
