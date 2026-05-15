-- 0021_show_discovery_exhibitor_url.sql
-- Adds exhibitor list URL tracking to show_discovery_results.
-- Claude now identifies the exhibitor-list subpage per show during discovery.

ALTER TABLE show_discovery_results
  ADD COLUMN IF NOT EXISTS exhibitor_list_url       text,
  ADD COLUMN IF NOT EXISTS exhibitor_list_available boolean;
