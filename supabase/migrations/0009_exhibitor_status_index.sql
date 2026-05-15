-- Compound indexes for show-detail queries that filter by trade_show_id
-- and the per-exhibitor status columns (short_status, deep_status).
-- The single-column idx_exhibitors_trade_show in 0001 already exists; these
-- compounds let Postgres seek directly into "show X + status Y" partitions
-- which is the exact filter pattern that:
--   - lib/show-status.ts:getShowExhibitorStatus uses on every page load
--   - app/shows/[id]/page.tsx uses for the listing query
--   - lib/inngest/functions.ts uses for bulk-short triggers
--     (.eq trade_show_id + .in short_status [pending, failed]).

create index if not exists idx_exhibitors_show_short_status
  on exhibitors (trade_show_id, short_status);

create index if not exists idx_exhibitors_show_deep_status
  on exhibitors (trade_show_id, deep_status);
