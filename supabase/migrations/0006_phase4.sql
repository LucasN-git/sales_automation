-- Phase 4: Browserbase session-time tracking + provider field on logs.

alter table trade_shows
  add column if not exists browserbase_session_seconds int default 0;

alter table crawl_log
  add column if not exists provider text;
