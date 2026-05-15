-- Phase 10: "Messen suchen" — automatische Messefindung via Claude + Web-Search.
--
-- Pattern analog zu Phase 9 (Competitor Discovery, 0016/0018):
-- - show_discovery_runs:    ein Row pro Suchlauf (Audit + Cost-Tracking)
-- - show_discovery_results: ein Row pro gefundener Messe-Kandidat
-- - show_discovery_log:     Liveprotokoll fuer Flowchart-UI
-- - app_settings-Erweiterung: show_discovery_system_prompt

-- 1) Suchlauf-Audit
create table if not exists show_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','running','done','failed')),
  current_phase text,
  user_prompt text,
  -- Stats
  candidates_total int,
  candidates_validated int,
  candidates_added int,
  -- Cost-Tracking
  model text,
  tokens_in int,
  tokens_out int,
  web_search_uses int,
  firecrawl_calls int,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_sdr_user_recent
  on show_discovery_runs (user_id, created_at desc);

alter table show_discovery_runs enable row level security;
drop policy if exists "sdr_owner_all" on show_discovery_runs;
create policy "sdr_owner_all" on show_discovery_runs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- 2) Pro-Messe-Kandidat (ein Row pro Claude-Ergebnis + Firecrawl-Validierung)
create table if not exists show_discovery_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references show_discovery_runs(id) on delete cascade,
  user_id uuid not null,
  -- Claude-generierte Felder
  name text not null,
  website text,
  location_city text,
  location_country text,
  dates_raw text,
  dates_start date,
  dates_end date,
  focus_description text,
  target_audience text,
  isp_sector_match text[],
  relevance_score int check (relevance_score between 0 and 10),
  relevance_reasoning text,
  evidence_urls text[] not null default '{}',
  is_recurring boolean,
  recurrence_note text,
  -- Firecrawl-Validierung
  firecrawl_status text not null default 'pending'
    check (firecrawl_status in ('pending','running','done','failed','skipped')),
  firecrawl_confirmed_url text,
  firecrawl_extracted jsonb,
  -- User-Aktion
  dismissed boolean not null default false,
  added_trade_show_id uuid references trade_shows(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sdrr_run_score
  on show_discovery_results (run_id, relevance_score desc);
create index if not exists idx_sdrr_user_recent
  on show_discovery_results (user_id, created_at desc);

drop trigger if exists sdrr_updated_at on show_discovery_results;
create trigger sdrr_updated_at before update on show_discovery_results
  for each row execute function set_updated_at();

alter table show_discovery_results enable row level security;
drop policy if exists "sdrr_owner_all" on show_discovery_results;
create policy "sdrr_owner_all" on show_discovery_results for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- 3) Liveprotokoll — Pattern = 0018_competitor_discovery_log.sql
--    meta jsonb fuer strukturierte Phase-Infos (web_search, firecrawl_start/done, etc.)
create table if not exists show_discovery_log (
  id bigint generated always as identity primary key,
  run_id uuid not null references show_discovery_runs(id) on delete cascade,
  user_id uuid not null,
  level text not null default 'info' check (level in ('info','warn','error')),
  phase text,
  message text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sdl_run_recent
  on show_discovery_log (run_id, created_at asc);
create index if not exists idx_sdl_user
  on show_discovery_log (user_id, created_at desc);

alter table show_discovery_log enable row level security;
drop policy if exists "sdl_owner_all" on show_discovery_log;
create policy "sdl_owner_all" on show_discovery_log for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- 4) app_settings: Neue Felder fuer Show-Discovery-Konfiguration
alter table app_settings
  add column if not exists show_discovery_system_prompt text,
  add column if not exists show_discovery_max_web_searches int,
  add column if not exists show_discovery_max_tokens int;

alter table app_settings
  drop constraint if exists app_settings_show_disc_web_searches_range;
alter table app_settings
  add constraint app_settings_show_disc_web_searches_range
    check (show_discovery_max_web_searches is null
           or (show_discovery_max_web_searches between 5 and 30));

alter table app_settings
  drop constraint if exists app_settings_show_disc_max_tokens_range;
alter table app_settings
  add constraint app_settings_show_disc_max_tokens_range
    check (show_discovery_max_tokens is null
           or (show_discovery_max_tokens between 2000 and 16000));


-- 5) Realtime-Publications (idempotent) — nur runs + log, results wird gepollt
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'show_discovery_runs'
  ) then
    alter publication supabase_realtime add table public.show_discovery_runs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'show_discovery_log'
  ) then
    alter publication supabase_realtime add table public.show_discovery_log;
  end if;
end $$;
