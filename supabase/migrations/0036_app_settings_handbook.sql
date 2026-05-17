-- 0036_app_settings_handbook.sql
-- Adds a single text column to app_settings that stores a per-user handbook
-- (Markdown). The Markdown is fetched on-demand by the chat orchestrators via
-- the `read_handbook` tool and is NOT injected into any default system prompt.
-- A NULL value means "use the code default" (see lib/settings.ts defaultHandbook()).

alter table app_settings
  add column if not exists handbook text;
