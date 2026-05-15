-- Phase 8.1: companies_overview um best_one_liner ergaenzt.
--
-- Hintergrund: Der globale Companies-Chat lieferte Claude bisher nur ein 50er
-- search_companies-Tool als Datenquelle. Jetzt wird die ganze Firmenliste in
-- den System-Prompt geladen. Damit Antworten substanziell sind, brauchen wir
-- auch den one_liner der besten Short-Einschaetzung pro Firma.
--
-- "Beste" = hoechste match_confidence; NULL-confidence-Rows verlieren.
-- Tie-Break: e.id asc fuer Determinismus.

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
  ) as union_sectors,
  -- NEU: one_liner der Short-Row mit hoechster match_confidence.
  (
    select s.one_liner
    from exhibitors e
    join exhibitor_short s on s.exhibitor_id = e.id
    where e.company_id = c.id
      and s.one_liner is not null
    order by s.match_confidence desc nulls last, e.id asc
    limit 1
  ) as best_one_liner
from companies c;
