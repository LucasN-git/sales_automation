-- Phase 8b: Editierbare Parameter pro Task plus Chat-System-Prompt.
--
-- Bisher waren max_tokens, max_input_chars (Slice-Cap fuer scraped content)
-- und chat web_search_max_uses in lib/claude.ts hartkodiert. Jetzt im
-- Account-Drawer pro Task editierbar.
--
-- chat_system_prompt: Pendant zu short_system_prompt / deep_system_prompt -
-- definiert Rolle und Regeln des Chats. NULL = Code-Default aus lib/claude.ts.
--
-- max_input_chars gibt es fuer Chat absichtlich nicht: der Input besteht
-- dort aus Thread-History + JSON-Aussteller-Block, kein Markdown-Slice.

alter table app_settings
  add column if not exists short_max_tokens int,
  add column if not exists short_max_input_chars int,
  add column if not exists deep_max_tokens int,
  add column if not exists deep_max_input_chars int,
  add column if not exists chat_system_prompt text,
  add column if not exists chat_max_tokens int,
  add column if not exists chat_web_search_max_uses int;

-- Sanity-Bounds, damit Frontend-Bugs oder Copy-Paste nicht 200k-Token-Calls
-- ausloesen. Werte grosszuegig genug fuer alle realistischen Use-Cases.
alter table app_settings
  drop constraint if exists app_settings_short_max_tokens_range,
  add constraint app_settings_short_max_tokens_range
    check (short_max_tokens is null or (short_max_tokens between 100 and 8000));

alter table app_settings
  drop constraint if exists app_settings_short_max_input_chars_range,
  add constraint app_settings_short_max_input_chars_range
    check (short_max_input_chars is null or (short_max_input_chars between 500 and 200000));

alter table app_settings
  drop constraint if exists app_settings_deep_max_tokens_range,
  add constraint app_settings_deep_max_tokens_range
    check (deep_max_tokens is null or (deep_max_tokens between 200 and 16000));

alter table app_settings
  drop constraint if exists app_settings_deep_max_input_chars_range,
  add constraint app_settings_deep_max_input_chars_range
    check (deep_max_input_chars is null or (deep_max_input_chars between 1000 and 500000));

alter table app_settings
  drop constraint if exists app_settings_chat_max_tokens_range,
  add constraint app_settings_chat_max_tokens_range
    check (chat_max_tokens is null or (chat_max_tokens between 200 and 16000));

alter table app_settings
  drop constraint if exists app_settings_chat_web_search_range,
  add constraint app_settings_chat_web_search_range
    check (chat_web_search_max_uses is null or (chat_web_search_max_uses between 0 and 20));
