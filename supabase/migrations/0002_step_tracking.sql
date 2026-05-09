-- Step-Tracking für Live-Diagnostik in der App-Sidebar

alter table trade_shows
  add column if not exists current_step text;

alter table exhibitors
  add column if not exists current_step text;

-- Realtime-Publication ist schon aktiv für beide Tabellen aus 0001 — neue Spalten
-- werden automatisch mit gestreamt.
