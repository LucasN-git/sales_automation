-- 0042: Company-Level Intel — Single Source of Truth
--
-- Verschiebt Short- und Deep-Analyse auf company-Level.
-- exhibitor_short / exhibitor_deep bleiben als Legacy-Mirror bestehen.
-- Neue Tabellen: company_short, company_deep, webhook_endpoints.
-- companies bekommt short_status + deep_status Columns.
-- Backfill: bestes exhibitor_short / exhibitor_deep pro Company hochheben.

-- ─── 1. company_short ────────────────────────────────────────────────────────

create table if not exists company_short (
  company_id       uuid primary key references companies(id) on delete cascade,
  one_liner        text,
  priority_label   text check (priority_label in ('hoch','mittel','niedrig')),
  match_confidence int  check (match_confidence between 0 and 100),
  isp_sector_match text[]  not null default '{}',
  reasoning_bullets text,
  user_group       text,
  battery_need     text,
  drone_relevance  text,
  service_need     text[]  not null default '{}',
  tokens_in        int,
  tokens_out       int,
  firecrawl_credits int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists company_short_updated_at on company_short;
create trigger company_short_updated_at
  before update on company_short
  for each row execute function set_updated_at();

alter table company_short enable row level security;

drop policy if exists "company_short_owner_all" on company_short;
create policy "company_short_owner_all" on company_short for all
  using (
    exists (
      select 1 from companies c
      where c.id = company_short.company_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from companies c
      where c.id = company_short.company_id and c.user_id = auth.uid()
    )
  );

-- ─── 2. company_deep ─────────────────────────────────────────────────────────

create table if not exists company_deep (
  company_id            uuid primary key references companies(id) on delete cascade,
  business_summary      text,
  decision_makers       text,
  recent_news           text,
  technical_pain_points text,
  opening_questions     text,
  competition_context   text,
  isp_lifecycle_match   text[] not null default '{}',
  isp_service_fit       text,
  full_reasoning        text,
  tokens_in             int,
  tokens_out            int,
  firecrawl_credits     int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists company_deep_updated_at on company_deep;
create trigger company_deep_updated_at
  before update on company_deep
  for each row execute function set_updated_at();

alter table company_deep enable row level security;

drop policy if exists "company_deep_owner_all" on company_deep;
create policy "company_deep_owner_all" on company_deep for all
  using (
    exists (
      select 1 from companies c
      where c.id = company_deep.company_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from companies c
      where c.id = company_deep.company_id and c.user_id = auth.uid()
    )
  );

-- ─── 3. webhook_endpoints ────────────────────────────────────────────────────

create table if not exists webhook_endpoints (
  id         uuid    primary key default gen_random_uuid(),
  user_id    uuid    not null references auth.users(id) on delete cascade,
  url        text    not null,
  secret     text,
  events     text[]  not null default '{"company_short.upserted","company_deep.upserted"}',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table webhook_endpoints enable row level security;

drop policy if exists "webhook_endpoints_owner_all" on webhook_endpoints;
create policy "webhook_endpoints_owner_all" on webhook_endpoints for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── 4. Status-Columns auf companies ─────────────────────────────────────────

alter table companies
  add column if not exists short_status text not null default 'pending'
    check (short_status in ('pending','running','done','failed','url_not_found')),
  add column if not exists deep_status  text not null default 'none'
    check (deep_status  in ('none','pending','running','done','failed'));

-- ─── 5. Backfill: bestes exhibitor_short → company_short ─────────────────────
-- DISTINCT ON: pro company_id den exhibitor_short mit hoechstem match_confidence.
-- ON CONFLICT DO NOTHING → idempotent.

insert into company_short (
  company_id, one_liner, priority_label, match_confidence, isp_sector_match,
  reasoning_bullets, user_group, battery_need, drone_relevance, service_need,
  tokens_in, tokens_out, firecrawl_credits
)
select distinct on (e.company_id)
  e.company_id,
  s.one_liner,
  s.priority_label,
  s.match_confidence,
  coalesce(s.isp_sector_match, '{}'),
  s.reasoning_bullets,
  s.user_group,
  s.battery_need,
  s.drone_relevance,
  coalesce(s.service_need, '{}'),
  coalesce(s.tokens_in, 0),
  coalesce(s.tokens_out, 0),
  coalesce(s.firecrawl_credits, 0)
from exhibitor_short s
join exhibitors e on e.id = s.exhibitor_id
where e.company_id is not null
order by e.company_id, s.match_confidence desc nulls last, e.created_at asc
on conflict (company_id) do nothing;

-- ─── 6. Backfill: bestes exhibitor_deep → company_deep ───────────────────────
-- Neueste deep-Row pro Company (updated_at desc).

insert into company_deep (
  company_id, business_summary, decision_makers, recent_news,
  technical_pain_points, opening_questions, competition_context,
  isp_lifecycle_match, isp_service_fit, full_reasoning, tokens_in, tokens_out
)
select distinct on (e.company_id)
  e.company_id,
  d.business_summary,
  d.decision_makers,
  d.recent_news,
  d.technical_pain_points,
  d.opening_questions,
  d.competition_context,
  coalesce(d.isp_lifecycle_match, '{}'),
  d.isp_service_fit,
  d.full_reasoning,
  coalesce(d.tokens_in, 0),
  coalesce(d.tokens_out, 0)
from exhibitor_deep d
join exhibitors e on e.id = d.exhibitor_id
where e.company_id is not null
order by e.company_id, d.updated_at desc nulls last
on conflict (company_id) do nothing;

-- ─── 7. Backfill companies.short_status / deep_status ────────────────────────

update companies c
set short_status = 'done'
where exists (select 1 from company_short cs where cs.company_id = c.id)
  and short_status = 'pending';

update companies c
set deep_status = 'done'
where exists (select 1 from company_deep cd where cd.company_id = c.id)
  and deep_status = 'none';
