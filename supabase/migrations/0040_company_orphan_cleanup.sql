-- Automatisches Loeschen von Companies ohne Aussteller-Eintraege.
--
-- Hintergrund: companies sind cross-show dedupliziert. Wenn eine Messe geloescht
-- wird, kaskadiert die DB exhibitors weg (exhibitors.trade_show_id CASCADE). Die
-- Company-Row blieb bisher als Waise uebrig, weil exhibitors.company_id nur SET NULL
-- in die andere Richtung (Company geloescht → exhibitor.company_id = null) wirkt.
--
-- Loesung: AFTER DELETE Trigger auf exhibitors prueft nach jeder Loeschung ob die
-- referenzierte Company noch Aussteller hat. Falls nicht → Company loeschen.
-- Greift auch bei Massen-Kaskaden (Messe-Delete cascadet N exhibitor-Rows,
-- Trigger laeuft fuer jede Row einzeln).

-- 1) Trigger-Function
create or replace function cleanup_orphaned_company()
returns trigger
language plpgsql
as $$
begin
  -- Nichts zu tun wenn der Aussteller keiner Company zugeordnet war.
  if OLD.company_id is null then
    return OLD;
  end if;

  -- Company loeschen wenn keine Aussteller mehr darauf zeigen.
  delete from companies
  where id = OLD.company_id
    and not exists (
      select 1 from exhibitors where company_id = OLD.company_id
    );

  return OLD;
end;
$$;

-- 2) Trigger anlegen (idempotent)
drop trigger if exists exhibitor_company_cleanup on exhibitors;
create trigger exhibitor_company_cleanup
  after delete on exhibitors
  for each row
  execute function cleanup_orphaned_company();

-- 3) Einmalige Bereinigung: bestehende Waisen-Companies loeschen.
--    (Companies die aktuell keine Aussteller-Row mehr haben.)
delete from companies
where not exists (
  select 1 from exhibitors e where e.company_id = companies.id
);
