-- 0044: Company Profile Fields
--
-- Neue Spalten auf company_short fuer strukturierte Profildaten
-- (Adresse, Typ, Kategorien, Produkte, Ansprechpartner).
-- Wird beim Short-Overview direkt aus exhibitors.profile_data befuellt
-- (kein neuer LLM-Call). Write-once per COALESCE im Upsert.
-- Quellenzuordnung in sources JSONB: {field -> {type, label, url?}}.

alter table company_short
  add column if not exists address           jsonb    default null,
  add column if not exists email             text     default null,
  add column if not exists phone             text     default null,
  add column if not exists company_type      text     default null,
  add column if not exists slogan            text     default null,
  add column if not exists categories        text[]   default null,
  add column if not exists products          text[]   default null,
  add column if not exists contact_persons   jsonb    default null,
  add column if not exists co_exhibitors     text[]   default null,
  add column if not exists company_description text   default null,
  add column if not exists logo_url          text     default null,
  add column if not exists employee_estimate text     default null,
  add column if not exists sources           jsonb    default null;

-- sources-Struktur (nicht erzwungen, nur dokumentiert):
-- {
--   "address": {"type": "algolia"|"messe_profil"|"messe_profil_scrape"|"website"|"web_search", "label": text, "url": text?},
--   "categories": {...},
--   "products": {...},
--   "contact_persons": {...},
--   "company_description": {...},
--   ...
-- }
