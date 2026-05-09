-- Crawl-Plan: das Ergebnis der Discovery-Phase pro Trade-Show.
-- Wird von Claude erzeugt (siehe lib/discovery.ts) und ist re-usable für
-- Folgejahre derselben Messe.

alter table trade_shows
  add column if not exists crawl_plan jsonb,
  add column if not exists discovery_log text;
