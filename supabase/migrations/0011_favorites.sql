-- Phase 7a: Favoriten fuer Trade Shows.
--
-- User pinnt einzelne Messen, gepinnte Items erscheinen in der globalen Sidebar
-- unter dem "Messen"-Top-Nav-Item. Boolean-Spalte reicht aus, weil pro User
-- nur wenige Favoriten erwartet werden. Partial-Index auf is_favorite=true
-- haelt die Sidebar-Query (favoriten pro user, neueste zuerst) klein.

alter table trade_shows
  add column if not exists is_favorite boolean not null default false;

create index if not exists idx_trade_shows_user_favorite
  on trade_shows (user_id, is_favorite, created_at desc)
  where is_favorite = true;
