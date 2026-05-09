-- Messe-Sales-Automation initial schema
-- Single-user app: every row is owned by trade_shows.user_id, RLS enforces it.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists trade_shows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  source_url text,
  year int,
  status text not null default 'queued'
    check (status in ('queued','crawling','ready','partial','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exhibitors (
  id uuid primary key default gen_random_uuid(),
  trade_show_id uuid not null references trade_shows(id) on delete cascade,
  company_name text not null,
  website text,
  booth text,
  listing_raw jsonb,
  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending','running','done','failed')),
  enrichment_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trade_show_id, company_name)
);

create table if not exists exhibitor_intel (
  exhibitor_id uuid primary key references exhibitors(id) on delete cascade,
  business_field text,
  estimated_size text,
  power_needs_hypothesis text,
  isp_sector_match text[] default '{}',
  isp_lifecycle_match text[] default '{}',
  match_confidence smallint check (match_confidence between 0 and 100),
  pitch_hook text,
  reasoning text,
  raw_response jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_exhibitors_trade_show on exhibitors (trade_show_id);
create index if not exists idx_exhibitors_status on exhibitors (enrichment_status);
create index if not exists idx_exhibitors_name_trgm on exhibitors using gin (company_name gin_trgm_ops);
create index if not exists idx_intel_sector on exhibitor_intel using gin (isp_sector_match);
create index if not exists idx_intel_lifecycle on exhibitor_intel using gin (isp_lifecycle_match);

-- updated_at trigger
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trade_shows_updated_at on trade_shows;
create trigger trade_shows_updated_at before update on trade_shows
  for each row execute function set_updated_at();

drop trigger if exists exhibitors_updated_at on exhibitors;
create trigger exhibitors_updated_at before update on exhibitors
  for each row execute function set_updated_at();

drop trigger if exists exhibitor_intel_updated_at on exhibitor_intel;
create trigger exhibitor_intel_updated_at before update on exhibitor_intel
  for each row execute function set_updated_at();

-- Row-Level Security: users only see their own trade_shows + child rows.
alter table trade_shows enable row level security;
alter table exhibitors enable row level security;
alter table exhibitor_intel enable row level security;

drop policy if exists "trade_shows_owner_all" on trade_shows;
create policy "trade_shows_owner_all"
  on trade_shows for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "exhibitors_via_show" on exhibitors;
create policy "exhibitors_via_show"
  on exhibitors for all
  using (
    exists (
      select 1 from trade_shows ts
      where ts.id = exhibitors.trade_show_id and ts.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from trade_shows ts
      where ts.id = exhibitors.trade_show_id and ts.user_id = auth.uid()
    )
  );

drop policy if exists "exhibitor_intel_via_show" on exhibitor_intel;
create policy "exhibitor_intel_via_show"
  on exhibitor_intel for all
  using (
    exists (
      select 1 from exhibitors e
      join trade_shows ts on ts.id = e.trade_show_id
      where e.id = exhibitor_intel.exhibitor_id and ts.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from exhibitors e
      join trade_shows ts on ts.id = e.trade_show_id
      where e.id = exhibitor_intel.exhibitor_id and ts.user_id = auth.uid()
    )
  );

-- Realtime publication (idempotent — only adds if not yet in publication)
do $$
declare
  t text;
begin
  foreach t in array array['trade_shows','exhibitors','exhibitor_intel'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
