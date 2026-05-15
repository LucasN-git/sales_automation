-- Phase 9: Competitor Analysis als dritte Hauptfunktion neben Messen + Unternehmen.
--
-- Auto-discovered Wettbewerber via Claude + Anthropic-Web-Search. Tier-System
-- (short/deep) analog Aussteller, aber mit Snapshot-Versionierung pro Re-Scan
-- und strukturiertem Diff zwischen Versionen. Cross-Refs zu companies (behauptete
-- Kunden eines Competitors) und trade_shows (Messeauftritte des Competitors).
--
-- Kein Cron, kein Auto-Re-Scan: User triggert manuell, Diff sichtbar in UI.
-- Pattern-Vorlage: 0010_companies.sql (RLS, Partial-Unique-Indices, View).

-- 1) Anker: ein Row pro Competitor. status durchlaeuft suggested -> active
--    -> archived/rejected. current_version_id zeigt auf juengsten Snapshot.
create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  domain text,
  website text,
  hq_country text,
  status text not null default 'suggested'
    check (status in ('suggested','active','archived','rejected')),
  source_event text,           -- 'auto_discovery' | 'manual'
  discovery_run_id uuid,       -- FK auf competitor_discovery_runs (nachgezogen, weil zirkulaer-frei aber spaeter angelegt)
  -- current_version_id wird nach competitor_versions-DDL hinzugefuegt
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Race-safe Dedup analog companies (0010): Domain wenn vorhanden, sonst Name.
create unique index if not exists uniq_competitors_user_domain
  on competitors (user_id, domain) where domain is not null;
create unique index if not exists uniq_competitors_user_normname
  on competitors (user_id, normalized_name);

create index if not exists idx_competitors_user_status
  on competitors (user_id, status);
create index if not exists idx_competitors_name_trgm
  on competitors using gin (display_name gin_trgm_ops);

drop trigger if exists competitors_updated_at on competitors;
create trigger competitors_updated_at before update on competitors
  for each row execute function set_updated_at();

alter table competitors enable row level security;
drop policy if exists "competitors_owner_all" on competitors;
create policy "competitors_owner_all" on competitors for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- 2) Snapshot-Versionen: ein Row pro Re-Scan (NICHT pro Feld). Diff zwischen
--    v_n und v_{n-1} wird in lib/competitors/diff.ts berechnet, kein DB-Trigger.
--    user_id denormalisiert fuer RLS-Performance (analog chat_messages in 0010).
create table if not exists competitor_versions (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  user_id uuid not null,
  version_no int not null,
  scan_kind text not null check (scan_kind in ('short','deep')),

  -- Diff-relevante typisierte Felder
  one_liner text,
  positioning text,
  portfolio jsonb,                -- {products:[], focus:[], categories:[]}
  isp_sector_match text[],        -- gegen SECTOR_IDS aus lib/isp-catalog.ts
  growth_signals jsonb,           -- {employees, employees_trend_pct, hiring_count, funding_events:[]}
  customers jsonb,                -- [{name, domain, evidence_url, since}]
  references_summary text,
  recent_news jsonb,              -- [{title, url, date}]
  competitive_angles_vs_isp text[],
  threat_level text check (threat_level in ('low','medium','high')),

  -- Audit + Replay (full Claude-Output)
  raw_snapshot jsonb not null,

  -- Cost-Tracking. web_search_cost_usd separat, weil pricing.ts nur Tokens kennt.
  tokens_in int,
  tokens_out int,
  web_search_uses int default 0,
  web_search_cost_usd numeric(10,5),
  model text,
  prompt_hash text,

  created_at timestamptz not null default now(),
  unique(competitor_id, version_no)
);
create index if not exists idx_competitor_versions_recent
  on competitor_versions (competitor_id, created_at desc);
create index if not exists idx_competitor_versions_user
  on competitor_versions (user_id, created_at desc);

alter table competitor_versions enable row level security;
drop policy if exists "competitor_versions_owner_all" on competitor_versions;
create policy "competitor_versions_owner_all" on competitor_versions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- 3) FK current_version_id auf competitor_versions nachziehen (zirkulaer-frei,
--    aber competitor_versions referenziert competitors -> deshalb hier nachgezogen).
alter table competitors
  add column if not exists current_version_id uuid references competitor_versions(id) on delete set null;
create index if not exists idx_competitors_current_version
  on competitors (current_version_id);


-- 4) Behauptete Kunden eines Competitors. Match-Pipeline (lib/competitors/match.ts)
--    setzt company_id wenn moeglich (Domain > Normname > Trigram-Vorschlag).
--    manual_confirmed lockt gegen Auto-Rematch.
create table if not exists competitor_customer_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  competitor_id uuid not null references competitors(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  raw_customer_name text not null,
  raw_customer_domain text,
  evidence_url text,
  evidence_quote text,
  match_method text check (match_method in ('domain','normname','trigram','manual','none')),
  confidence numeric(3,2),
  manual_confirmed boolean not null default false,
  manual_rejected boolean not null default false,
  first_seen_version_id uuid references competitor_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(competitor_id, raw_customer_name)
);
create index if not exists idx_ccl_user_company
  on competitor_customer_links (user_id, company_id) where company_id is not null;
create index if not exists idx_ccl_competitor
  on competitor_customer_links (competitor_id);

drop trigger if exists ccl_updated_at on competitor_customer_links;
create trigger ccl_updated_at before update on competitor_customer_links
  for each row execute function set_updated_at();

alter table competitor_customer_links enable row level security;
drop policy if exists "ccl_owner_all" on competitor_customer_links;
create policy "ccl_owner_all" on competitor_customer_links for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- 5) Cross-Ref: Competitor als Aussteller auf welcher Messe. Optionaler exhibitor_id-Match
--    wenn 1:1 zuordenbar (gleiche Domain/Normname). Sonst nur trade_show_id.
create table if not exists competitor_show_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  competitor_id uuid not null references competitors(id) on delete cascade,
  trade_show_id uuid not null references trade_shows(id) on delete cascade,
  exhibitor_id uuid references exhibitors(id) on delete set null,
  match_method text check (match_method in ('domain','normname','trigram','manual','none')),
  confidence numeric(3,2),
  manual_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(competitor_id, trade_show_id)
);
create index if not exists idx_csl_show on competitor_show_links (trade_show_id);
create index if not exists idx_csl_competitor on competitor_show_links (competitor_id);

alter table competitor_show_links enable row level security;
drop policy if exists "csl_owner_all" on competitor_show_links;
create policy "csl_owner_all" on competitor_show_links for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- 6) Discovery-Run-Audit: Cost + Outcome pro Auto-Discovery-Lauf.
create table if not exists competitor_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','running','done','failed')),
  prompt_hash text,
  model text,
  candidates_total int,
  candidates_kept int,
  tokens_in int,
  tokens_out int,
  web_search_uses int,
  web_search_cost_usd numeric(10,5),
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_cdr_user_recent
  on competitor_discovery_runs (user_id, created_at desc);

alter table competitor_discovery_runs enable row level security;
drop policy if exists "cdr_owner_all" on competitor_discovery_runs;
create policy "cdr_owner_all" on competitor_discovery_runs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- FK competitors.discovery_run_id nachgezogen (Tabelle existiert jetzt).
alter table competitors
  drop constraint if exists fk_competitors_discovery_run,
  add constraint fk_competitors_discovery_run
    foreign key (discovery_run_id)
    references competitor_discovery_runs(id) on delete set null;


-- 7) View competitors_overview: pro Competitor die juengste Version + Counts.
--    security_invoker = on -> RLS der zugrundeliegenden Tabellen greift.
create or replace view competitors_overview
with (security_invoker = on) as
select
  c.id,
  c.user_id,
  c.display_name,
  c.normalized_name,
  c.domain,
  c.website,
  c.hq_country,
  c.status,
  c.source_event,
  c.discovery_run_id,
  c.current_version_id,
  c.created_at,
  c.updated_at,
  v.scan_kind          as latest_scan_kind,
  v.one_liner,
  v.positioning,
  v.portfolio,
  v.isp_sector_match,
  v.growth_signals,
  v.customers,
  v.threat_level,
  v.created_at         as latest_version_at,
  (
    select count(*) from competitor_versions cv
    where cv.competitor_id = c.id
  ) as version_count,
  (
    select count(*) from competitor_customer_links l
    where l.competitor_id = c.id and l.manual_rejected = false
  ) as customer_link_count,
  (
    select count(*) from competitor_customer_links l
    where l.competitor_id = c.id and l.company_id is not null and l.manual_rejected = false
  ) as matched_customer_count,
  (
    select count(*) from competitor_show_links s
    where s.competitor_id = c.id
  ) as show_link_count
from competitors c
left join competitor_versions v on v.id = c.current_version_id;


-- 8) Realtime publication (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'competitors'
  ) then
    alter publication supabase_realtime add table public.competitors;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'competitor_versions'
  ) then
    alter publication supabase_realtime add table public.competitor_versions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'competitor_discovery_runs'
  ) then
    alter publication supabase_realtime add table public.competitor_discovery_runs;
  end if;
end $$;
