-- Phase 5: rich exhibitor profiles.
--
-- Background: Algolia listings carry far more per-exhibitor data than we
-- previously captured (address, email, sector categories, co-exhibitors).
-- Plus, the trade-show profile page itself usually links to the exhibitor's
-- real external website. We split this into two columns so the Algolia path
-- can fill `profile_data` instantly while the slower Firecrawl scrape
-- enriches it in a follow-up phase.

alter table exhibitors
  add column if not exists profile_url text,
  add column if not exists profile_data jsonb,
  add column if not exists profile_enrich_status text not null default 'idle';

-- profile_enrich_status values:
--   'idle'    — no profile_url to scrape (non-Algolia listing or not applicable)
--   'pending' — has profile_url, waiting for enrich phase
--   'running' — Firecrawl scrape currently in flight
--   'done'    — scrape completed, profile_data is fully merged
--   'failed'  — scrape failed permanently after retries

create index if not exists idx_exhibitors_profile_enrich_status
  on exhibitors (trade_show_id, profile_enrich_status)
  where profile_enrich_status in ('pending', 'failed');
