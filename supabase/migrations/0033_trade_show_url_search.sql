-- 0033_trade_show_url_search.sql
-- Orchestrator findet die Aussteller-Listen-URL automatisch nach Show-Anlage.
-- Status-Maschine und Evidence-Spalten auf trade_shows.

ALTER TABLE trade_shows
  ADD COLUMN IF NOT EXISTS url_search_status text NOT NULL DEFAULT 'idle'
    CHECK (url_search_status IN ('idle','pending','running','done','failed','url_not_found')),
  ADD COLUMN IF NOT EXISTS url_search_log jsonb,
  ADD COLUMN IF NOT EXISTS url_search_evidence jsonb;

-- Bestand: Shows mit gesetzter source_url als 'done' markieren (Legacy-Flow),
-- damit das Settings-Badge nicht "idle" anzeigt fuer manuell befuellte URLs.
UPDATE trade_shows
   SET url_search_status = 'done'
 WHERE source_url IS NOT NULL
   AND url_search_status = 'idle';

CREATE INDEX IF NOT EXISTS idx_trade_shows_url_search_status
  ON trade_shows (url_search_status);
