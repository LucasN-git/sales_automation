-- Phase 9b: Account-Drawer-Settings fuer Competitor-Analysis.
--
-- Pattern analog 0013/0014: NULL = Code-Default aus lib/claude.ts /
-- lib/competitors/. User editiert in Account-Drawer.
--
-- discovery_max_web_searches: hartes Cap fuer Anthropic-Web-Search-Cost
-- pro Discovery-Lauf. Default 15, max 30. Short-Tier 3 (default), Deep-Tier 8.
-- web_search ist obligatorisch fuer Competitors (anders als Aussteller-Tier),
-- weil Customer-Inferenz und Growth-Signals ohne Web nicht moeglich sind.

alter table app_settings
  add column if not exists competitor_short_model text,
  add column if not exists competitor_deep_model text,
  add column if not exists competitor_discovery_model text,

  add column if not exists competitor_discovery_system_prompt text,
  add column if not exists competitor_discovery_user_template text,
  add column if not exists competitor_short_system_prompt text,
  add column if not exists competitor_short_user_template text,
  add column if not exists competitor_deep_system_prompt text,
  add column if not exists competitor_deep_user_template text,

  add column if not exists competitor_short_max_tokens int,
  add column if not exists competitor_deep_max_tokens int,
  add column if not exists competitor_discovery_max_tokens int,

  add column if not exists competitor_short_web_search_max_uses int,
  add column if not exists competitor_deep_web_search_max_uses int,
  add column if not exists competitor_discovery_max_web_searches int;

-- Sanity-Bounds analog 0014. Werte grosszuegig genug fuer realistische Use-Cases.
alter table app_settings
  drop constraint if exists app_settings_competitor_short_max_tokens_range,
  add constraint app_settings_competitor_short_max_tokens_range
    check (competitor_short_max_tokens is null
           or (competitor_short_max_tokens between 200 and 8000));

alter table app_settings
  drop constraint if exists app_settings_competitor_deep_max_tokens_range,
  add constraint app_settings_competitor_deep_max_tokens_range
    check (competitor_deep_max_tokens is null
           or (competitor_deep_max_tokens between 500 and 16000));

alter table app_settings
  drop constraint if exists app_settings_competitor_discovery_max_tokens_range,
  add constraint app_settings_competitor_discovery_max_tokens_range
    check (competitor_discovery_max_tokens is null
           or (competitor_discovery_max_tokens between 500 and 16000));

alter table app_settings
  drop constraint if exists app_settings_competitor_short_web_search_range,
  add constraint app_settings_competitor_short_web_search_range
    check (competitor_short_web_search_max_uses is null
           or (competitor_short_web_search_max_uses between 0 and 10));

alter table app_settings
  drop constraint if exists app_settings_competitor_deep_web_search_range,
  add constraint app_settings_competitor_deep_web_search_range
    check (competitor_deep_web_search_max_uses is null
           or (competitor_deep_web_search_max_uses between 0 and 20));

alter table app_settings
  drop constraint if exists app_settings_competitor_discovery_max_web_searches_range,
  add constraint app_settings_competitor_discovery_max_web_searches_range
    check (competitor_discovery_max_web_searches is null
           or (competitor_discovery_max_web_searches between 0 and 30));
