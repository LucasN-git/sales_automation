-- Phase 9c: Detailliertes Step-Log + Phase-Tracking fuer Competitor-Discovery-Runs.
--
-- Pattern entlehnt von crawl_log (0004_phase2.sql) und competitor_versions (0016).
-- user_id denormalisiert fuer schlanke RLS analog competitor_versions; FK zum Run
-- per ON DELETE CASCADE, damit Logs mit dem Run verschwinden.

-- 1) Phase-Spalte am Run, damit das UI in Echtzeit weiss, wo wir gerade stecken.
alter table competitor_discovery_runs
  add column if not exists current_phase text;

-- 2) Detail-Log fuer Discovery-Runs.
create table if not exists competitor_discovery_log (
  id bigint generated always as identity primary key,
  run_id uuid not null references competitor_discovery_runs(id) on delete cascade,
  user_id uuid not null,
  level text not null default 'info' check (level in ('info','warn','error')),
  phase text,
  message text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_cdl_run_recent
  on competitor_discovery_log (run_id, created_at desc);
create index if not exists idx_cdl_user
  on competitor_discovery_log (user_id, created_at desc);

alter table competitor_discovery_log enable row level security;
drop policy if exists "cdl_owner_all" on competitor_discovery_log;
create policy "cdl_owner_all" on competitor_discovery_log for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3) Realtime-Publication idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'competitor_discovery_log'
  ) then
    alter publication supabase_realtime add table public.competitor_discovery_log;
  end if;
end $$;
