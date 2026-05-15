-- Phase 8: Editierbare Prompts und User-Message-Templates fuer Short / Deep.
--
-- Bisher waren SHORT_SYSTEM, DEEP_SYSTEM und die User-Message-Bauanleitung
-- in lib/claude.ts hartcodiert. Jetzt sollen diese Texte aus dem Account-Drawer
-- editierbar sein. Falls eine Spalte NULL bleibt, faellt die App auf den
-- Code-Default zurueck. So bricht nichts, wenn die Migration laeuft, ohne
-- dass User explizit speichern.

alter table app_settings
  add column if not exists short_system_prompt text,
  add column if not exists short_user_template text,
  add column if not exists deep_system_prompt text,
  add column if not exists deep_user_template text;
