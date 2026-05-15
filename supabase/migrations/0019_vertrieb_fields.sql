-- 0019_vertrieb_fields.sql
-- Adds structured sales-intel fields requested by Head of Vertrieb:
-- user_group, battery_need, drone_relevance, service_need on exhibitor_short
-- isp_service_fit on exhibitor_deep

ALTER TABLE exhibitor_short
  ADD COLUMN IF NOT EXISTS user_group      TEXT,
  ADD COLUMN IF NOT EXISTS battery_need    TEXT,
  ADD COLUMN IF NOT EXISTS drone_relevance TEXT,
  ADD COLUMN IF NOT EXISTS service_need    TEXT[];

ALTER TABLE exhibitor_deep
  ADD COLUMN IF NOT EXISTS isp_service_fit TEXT;
