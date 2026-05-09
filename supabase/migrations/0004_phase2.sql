-- Phase 2 schema: settings, tier-split (short/deep), chat, log, pause state.

-- 1) Settings-Singleton mit Prio-Kontext (per User)
create table if not exists app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prio_context text not null,
  short_model text not null default 'claude-haiku-4-5-20251001',
  deep_model text not null default 'claude-sonnet-4-6',
  updated_at timestamptz not null default now()
);

-- 2) Tier-Split: bisheriges exhibitor_intel wird zum Short-Tier
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'exhibitor_intel') then
    alter table exhibitor_intel rename to exhibitor_short;
  end if;
end $$;

alter table exhibitor_short
  drop column if exists reasoning,
  drop column if exists estimated_size,
  drop column if exists power_needs_hypothesis,
  drop column if exists isp_lifecycle_match;

alter table exhibitor_short
  add column if not exists priority_label text check (priority_label in ('hot','warm','cold')),
  add column if not exists one_liner text,
  add column if not exists tokens_in int,
  add column if not exists tokens_out int;

-- 3) Deep-Dive-Tier
create table if not exists exhibitor_deep (
  exhibitor_id uuid primary key references exhibitors(id) on delete cascade,
  business_summary text,
  decision_makers text,
  recent_news text,
  technical_pain_points text,
  opening_questions text,
  competition_context text,
  isp_lifecycle_match text[] default '{}',
  full_reasoning text,
  raw_response jsonb,
  tokens_in int,
  tokens_out int,
  updated_at timestamptz not null default now()
);

-- 4) Chat pro Messe
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  trade_show_id uuid not null references trade_shows(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_show on chat_messages (trade_show_id, created_at);

-- 5) Crawl-Log fuer Live-Anzeige + Audit
create table if not exists crawl_log (
  id bigint generated always as identity primary key,
  trade_show_id uuid not null references trade_shows(id) on delete cascade,
  level text not null default 'info' check (level in ('info','warn','error')),
  phase text,
  message text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_crawl_log_show on crawl_log (trade_show_id, created_at desc);

-- 6) Per-Aussteller Step-Log + Token-Counter
alter table exhibitors
  add column if not exists step_log jsonb default '[]'::jsonb,
  add column if not exists short_status text default 'pending' check (short_status in ('pending','running','done','failed')),
  add column if not exists deep_status text default 'none' check (deep_status in ('none','pending','running','done','failed'));

-- 8) Pause/Resume-State
alter table trade_shows
  drop constraint if exists trade_shows_status_check;
alter table trade_shows
  add constraint trade_shows_status_check
    check (status in ('queued','crawling','paused','ready','partial','failed'));

alter table trade_shows
  add column if not exists paused_phase text;

-- updated_at trigger fuer neue Tabellen
drop trigger if exists app_settings_updated_at on app_settings;
create trigger app_settings_updated_at before update on app_settings
  for each row execute function set_updated_at();

drop trigger if exists exhibitor_deep_updated_at on exhibitor_deep;
create trigger exhibitor_deep_updated_at before update on exhibitor_deep
  for each row execute function set_updated_at();

-- RLS
alter table app_settings enable row level security;
alter table exhibitor_deep enable row level security;
alter table chat_messages enable row level security;
alter table crawl_log enable row level security;

drop policy if exists "app_settings_owner_all" on app_settings;
create policy "app_settings_owner_all"
  on app_settings for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "exhibitor_deep_via_show" on exhibitor_deep;
create policy "exhibitor_deep_via_show"
  on exhibitor_deep for all
  using (
    exists (
      select 1 from exhibitors e
      join trade_shows ts on ts.id = e.trade_show_id
      where e.id = exhibitor_deep.exhibitor_id and ts.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from exhibitors e
      join trade_shows ts on ts.id = e.trade_show_id
      where e.id = exhibitor_deep.exhibitor_id and ts.user_id = auth.uid()
    )
  );

drop policy if exists "chat_messages_via_show" on chat_messages;
create policy "chat_messages_via_show"
  on chat_messages for all
  using (
    exists (select 1 from trade_shows ts where ts.id = chat_messages.trade_show_id and ts.user_id = auth.uid())
  )
  with check (
    exists (select 1 from trade_shows ts where ts.id = chat_messages.trade_show_id and ts.user_id = auth.uid())
  );

drop policy if exists "crawl_log_via_show" on crawl_log;
create policy "crawl_log_via_show"
  on crawl_log for all
  using (
    exists (select 1 from trade_shows ts where ts.id = crawl_log.trade_show_id and ts.user_id = auth.uid())
  )
  with check (
    exists (select 1 from trade_shows ts where ts.id = crawl_log.trade_show_id and ts.user_id = auth.uid())
  );

-- Rename existing RLS policy on exhibitor_intel (now exhibitor_short)
do $$
begin
  if exists (select 1 from pg_policies where tablename = 'exhibitor_short' and policyname = 'exhibitor_intel_via_show') then
    alter policy "exhibitor_intel_via_show" on exhibitor_short rename to "exhibitor_short_via_show";
  end if;
end $$;

-- Realtime-Publication idempotent
do $$
declare
  t text;
begin
  foreach t in array array['exhibitor_deep','chat_messages','crawl_log','app_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
