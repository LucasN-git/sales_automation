-- 0043: companies_overview View auf company_short / company_deep umstellen.
--
-- Vorher: mehrfache Subqueries durch exhibitor_short (teuer, falsche Priority-Labels).
-- Jetzt: direkter LEFT JOIN auf company_short + company_deep (O(1) pro Company).
-- Neu: short_status, deep_status aus companies-Tabelle direkt verfuegbar.
--
-- DROP + CREATE weil CREATE OR REPLACE die Spaltenliste nicht aendern darf.

drop view if exists companies_overview;

create view companies_overview
with (security_invoker = on) as
select
  c.id,
  c.user_id,
  c.display_name,
  c.domain,
  c.website,
  c.short_status,
  c.deep_status,
  c.created_at,
  cs.one_liner        as best_one_liner,
  cs.priority_label   as best_priority,
  cs.match_confidence as best_match_confidence,
  cs.isp_sector_match as union_sectors,
  cd.business_summary,
  (
    select count(*)
    from exhibitors e
    where e.company_id = c.id
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
  ) as shows
from companies c
left join company_short cs on cs.company_id = c.id
left join company_deep  cd on cd.company_id = c.id;
