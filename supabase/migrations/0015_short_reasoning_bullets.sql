-- Phase 9a: Begruendungs-Bullets fuer Short-Overview, damit der Vertriebler
-- die Score-/Prio-Einordnung ohne Deep-Dive nachvollziehen kann.
--
-- 3-5 Bullets als Markdown-Liste, jeder Bullet erklaert einen Faktor
-- (Sektor-Match, Groesse/Outsourcing-Wahrscheinlichkeit, Bekanntheit,
-- technischer Power-Bedarf, Disqualifier). Schema bleibt einfach: ein
-- text-Feld, Bullets im Inhalt.
--
-- Nullable, kein Backfill: Alte Rows behalten NULL, werden beim naechsten
-- Bulk-Short oder pro-Aussteller-Trigger neu befuellt.

alter table exhibitor_short
  add column if not exists reasoning_bullets text;
