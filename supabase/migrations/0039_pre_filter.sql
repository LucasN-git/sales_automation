-- Pre-Filter Step: Schnelle Claude-Vorfilterung nach dem Listing
-- Markiert Aussteller ohne ISP-Schnittstelle (Kleidung, Lebensmittel etc.)
-- bevor der teure Short-Overview läuft.
-- pre_filter_status: pending → running → passed | filtered_out
-- filtered_out-Einträge werden aus dem Bulk-Short ausgeschlossen,
-- bleiben aber über /api/exhibitors/[id]/pre-filter-override manuell triggerable.

ALTER TABLE exhibitors
  ADD COLUMN IF NOT EXISTS pre_filter_status text DEFAULT 'pending'
    CHECK (pre_filter_status IN ('pending', 'running', 'passed', 'filtered_out')),
  ADD COLUMN IF NOT EXISTS pre_filter_reason text;

-- Backfill: Einträge mit abgeschlossenem Short rückwirkend als 'passed' markieren
UPDATE exhibitors
  SET pre_filter_status = 'passed'
  WHERE short_status IN ('done', 'url_not_found');

CREATE INDEX IF NOT EXISTS idx_exhibitors_pre_filter_status
  ON exhibitors (trade_show_id, pre_filter_status);
