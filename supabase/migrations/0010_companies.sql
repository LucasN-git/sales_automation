-- Phase 6: globale Unternehmensuebersicht ueber alle Trade-Shows hinweg.
--
-- Bisher: jede Messe hat eigene exhibitors-Rows (UNIQUE(trade_show_id, company_name)).
-- Eine Firma auf 3 Messen = 3 entkoppelte Rows. Keine Cross-Show-Sicht.
--
-- Jetzt: companies-Tabelle als deduplizierter Anker pro user_id. Match-Key
-- 1) Domain (registered host, lowercased, ohne www.) wenn vorhanden,
-- 2) normalized_name (lowercase + Legal-Suffix gestrippt) als Fallback.
-- exhibitors bekommt company_id-FK; pro-Messe-Daten (booth, listing_raw, short, deep)
-- bleiben pro Aussteller-Row erhalten. View companies_overview aggregiert pro Firma.
--
-- chat_threads + chat_messages werden generalisiert: trade_show_id nullable,
-- user_id direkt drauf, company_focus optional. Ermoeglicht globalen Companies-Chat.

-- 1) companies-Tabelle
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  domain text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Race-safe Dedup ueber Partial-Unique-Indices: Domain wenn vorhanden, sonst Name.
create unique index if not exists uniq_companies_user_domain
  on companies (user_id, domain) where domain is not null;
create unique index if not exists uniq_companies_user_normname
  on companies (user_id, normalized_name);

create index if not exists idx_companies_user_name on companies (user_id, display_name);
create index if not exists idx_companies_name_trgm on companies using gin (display_name gin_trgm_ops);

drop trigger if exists companies_updated_at on companies;
create trigger companies_updated_at before update on companies
  for each row execute function set_updated_at();

alter table companies enable row level security;
drop policy if exists "companies_owner_all" on companies;
create policy "companies_owner_all" on companies for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2) FK auf exhibitors
alter table exhibitors
  add column if not exists company_id uuid references companies(id) on delete set null;
create index if not exists idx_exhibitors_company on exhibitors (company_id);

-- 3) chat_threads + chat_messages generalisieren
--    Ziel: trade_show_id nullable (NULL = global scope), user_id direkt fuer RLS,
--    company_focus optional analog zu exhibitor_focus.

-- 3a) Spalten anlegen
alter table chat_threads
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists company_focus uuid references companies(id) on delete set null;

alter table chat_messages
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 3b) Backfill user_id aus zugehoeriger trade_shows-Row
update chat_threads ct
set user_id = ts.user_id
from trade_shows ts
where ct.trade_show_id = ts.id and ct.user_id is null;

update chat_messages cm
set user_id = ct.user_id
from chat_threads ct
where cm.thread_id = ct.id and cm.user_id is null;

-- Edge-Case: chat_messages ohne thread_id (sollte es nicht geben, aber safe-guard)
update chat_messages cm
set user_id = ts.user_id
from trade_shows ts
where cm.trade_show_id = ts.id and cm.user_id is null;

-- 3c) Constraints anziehen
alter table chat_threads alter column user_id set not null;
alter table chat_threads alter column trade_show_id drop not null;

alter table chat_messages alter column user_id set not null;
alter table chat_messages alter column trade_show_id drop not null;

-- 3d) RLS auf user_id direkt (alte show-basierte Policies droppen)
drop policy if exists "chat_threads_via_show" on chat_threads;
create policy "chat_threads_owner_all" on chat_threads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "chat_messages_via_show" on chat_messages;
create policy "chat_messages_owner_all" on chat_messages for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3e) Index fuer globalen Thread-Filter (company-fokussiert oder ohne Show)
create index if not exists idx_chat_threads_user_company
  on chat_threads (user_id, company_focus, last_message_at desc);
create index if not exists idx_chat_threads_user_global
  on chat_threads (user_id, last_message_at desc)
  where trade_show_id is null;

-- 4) Backfill: companies-Rows aus existierenden exhibitors ableiten + FK setzen.
--    Idempotent: arbeitet nur auf exhibitors mit company_id IS NULL und nutzt
--    ON CONFLICT DO NOTHING gegen die Partial-Unique-Indices.

-- Helper-Functions: identische Logik zu lib/companies.ts (Single Source of Truth ist TS,
-- aber fuer den initialen Backfill brauchen wir SQL-Equivalent).
create or replace function _normalize_company_name(n text) returns text
language sql immutable as $$
  select regexp_replace(
    lower(trim(n)),
    '\s+(gmbh|ag|ltd|inc|corp\.?|llc|co\.?|s\.?a\.?|s\.?r\.?l\.?|kg|ohg|ug|se|plc|pty|bv|nv|oy|ab)$',
    '', 'i')
$$;

create or replace function _extract_domain(url text) returns text
language sql immutable as $$
  select case
    when url is null or trim(url) = '' then null
    else nullif(lower(regexp_replace(
      regexp_replace(url, '^https?://(www\.)?', ''),
      '/.*$', '')), '')
  end
$$;

-- 4a) Insert companies. DISTINCT ON gruppiert pro user_id + Match-Key
--     (Domain wenn vorhanden, sonst normalized_name). Rows mit Domain
--     gewinnen, weil coalesce(domain, name) sortiert sie zusammen.
insert into companies (user_id, display_name, normalized_name, domain, website)
select distinct on (
  ts.user_id,
  coalesce(_extract_domain(e.website), _normalize_company_name(e.company_name))
)
  ts.user_id,
  e.company_name,
  _normalize_company_name(e.company_name),
  _extract_domain(e.website),
  e.website
from exhibitors e
join trade_shows ts on ts.id = e.trade_show_id
where e.company_id is null
order by
  ts.user_id,
  coalesce(_extract_domain(e.website), _normalize_company_name(e.company_name)),
  -- Bevorzuge Rows mit Domain bei der Wahl von display_name/website
  case when _extract_domain(e.website) is not null then 0 else 1 end,
  e.created_at asc
on conflict do nothing;

-- 4b) FK ueber Match-Logik nachziehen.
update exhibitors e
set company_id = c.id
from trade_shows ts, companies c
where e.trade_show_id = ts.id
  and e.company_id is null
  and c.user_id = ts.user_id
  and (
    (c.domain is not null and c.domain = _extract_domain(e.website))
    or (c.domain is null and c.normalized_name = _normalize_company_name(e.company_name))
  );

-- Helper droppen, damit lib/companies.ts die einzige Quelle der Wahrheit bleibt.
drop function if exists _normalize_company_name(text);
drop function if exists _extract_domain(text);

-- 5) View companies_overview: pro company aggregiert ueber alle exhibitors-Teilnahmen.
--    security_invoker = on -> RLS der zugrundeliegenden Tabellen greift.
--    Aggregate als unabhaengige Sub-Selects pro Spalte: einfacher zu lesen
--    als ein verschachtelter GROUP BY mit DISTINCT-Aggregaten und vermeidet
--    PostgreSQL-Foot-Guns mit jsonb_agg(distinct ... order by ...).
create or replace view companies_overview
with (security_invoker = on) as
select
  c.id,
  c.user_id,
  c.display_name,
  c.domain,
  c.website,
  c.created_at,
  (
    select count(*) from exhibitors e where e.company_id = c.id
  ) as exhibitor_row_count,
  (
    select count(distinct e.trade_show_id)
    from exhibitors e
    where e.company_id = c.id
  ) as show_count,
  (
    select coalesce(jsonb_agg(j order by j->>'name'), '[]'::jsonb)
    from (
      select distinct jsonb_build_object('id', ts.id, 'name', ts.name) as j
      from exhibitors e
      join trade_shows ts on ts.id = e.trade_show_id
      where e.company_id = c.id
    ) sub
  ) as shows,
  (
    select max(s.match_confidence)
    from exhibitors e
    join exhibitor_short s on s.exhibitor_id = e.id
    where e.company_id = c.id
  ) as best_match_confidence,
  (
    select case
      when bool_or(s.priority_label = 'hot') then 'hot'
      when bool_or(s.priority_label = 'warm') then 'warm'
      when bool_or(s.priority_label = 'cold') then 'cold'
      else null
    end
    from exhibitors e
    join exhibitor_short s on s.exhibitor_id = e.id
    where e.company_id = c.id
  ) as best_priority,
  (
    select coalesce(array_agg(distinct t.sec), '{}'::text[])
    from exhibitors e
    join exhibitor_short s on s.exhibitor_id = e.id
    cross join lateral unnest(coalesce(s.isp_sector_match, '{}'::text[])) as t(sec)
    where e.company_id = c.id
  ) as union_sectors
from companies c;

-- 6) get_global_token_stats: analog zu get_token_stats, aber ueber alle Shows
--    eines Users. Fuer die Cost-Tab in der Companies-Sidebar.
create or replace function public.get_global_token_stats(p_user_id uuid)
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'short', (
      select json_build_object(
        'tin',  coalesce(sum(s.tokens_in),  0),
        'tout', coalesce(sum(s.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(s.tokens_in, 0) > 0 or coalesce(s.tokens_out, 0) > 0
        )
      )
      from exhibitor_short s
      join exhibitors e on e.id = s.exhibitor_id
      join trade_shows ts on ts.id = e.trade_show_id
      where ts.user_id = p_user_id
    ),
    'deep', (
      select json_build_object(
        'tin',  coalesce(sum(d.tokens_in),  0),
        'tout', coalesce(sum(d.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(d.tokens_in, 0) > 0 or coalesce(d.tokens_out, 0) > 0
        )
      )
      from exhibitor_deep d
      join exhibitors e on e.id = d.exhibitor_id
      join trade_shows ts on ts.id = e.trade_show_id
      where ts.user_id = p_user_id
    ),
    'chat', (
      select json_build_object(
        'tin',  coalesce(sum(c.tokens_in),  0),
        'tout', coalesce(sum(c.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(c.tokens_in, 0) > 0 or coalesce(c.tokens_out, 0) > 0
        )
      )
      from chat_messages c
      where c.user_id = p_user_id
    ),
    'browser_seconds', (
      select coalesce(sum(browserbase_session_seconds), 0)
      from trade_shows
      where user_id = p_user_id
    )
  );
$$;

grant execute on function public.get_global_token_stats(uuid) to authenticated;

-- 7) Realtime publication (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'companies'
  ) then
    alter publication supabase_realtime add table public.companies;
  end if;
end $$;
