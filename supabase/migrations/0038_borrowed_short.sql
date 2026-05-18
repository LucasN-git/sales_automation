-- Borrowed Short Overview
-- When an exhibitor at a new show belongs to a company that already has a
-- completed short analysis from a previous show, the Inngest function copies
-- that short data instead of running a new Claude + Firecrawl call.
-- borrowed_short_from_exhibitor_id: FK to the source exhibitor
-- borrowed_from_show_name (on exhibitor_short): denormalized show name for the
-- disclaimer displayed on the detail page (avoids a join at render time)

ALTER TABLE exhibitors
  ADD COLUMN IF NOT EXISTS borrowed_short_from_exhibitor_id UUID
    REFERENCES exhibitors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exhibitors_borrowed_short
  ON exhibitors (borrowed_short_from_exhibitor_id)
  WHERE borrowed_short_from_exhibitor_id IS NOT NULL;

ALTER TABLE exhibitor_short
  ADD COLUMN IF NOT EXISTS borrowed_from_show_name TEXT;
