-- 0044: Company Search Feature
-- Neue Tabellen fuer KI-gestuetzte Kunden-Discovery (analog show_discovery_*)
-- Ausserdem: companies.source-Spalte fuer Herkunfts-Tracking

-- ----------------------------------------------------------------
-- 1. company_search_runs
-- ----------------------------------------------------------------
create table if not exists company_search_runs (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  user_prompt          text not null,
  status               text not null default 'pending'
                         check (status in ('pending','running','done','failed','cancelled')),
  current_phase        text,
  candidates_total     int default 0,
  candidates_validated int default 0,
  candidates_added     int default 0,
  model                text,
  tokens_in            bigint default 0,
  tokens_out           bigint default 0,
  web_search_uses      int default 0,
  firecrawl_credits    int default 0,
  error_message        text,
  started_at           timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz default now()
);

alter table company_search_runs enable row level security;

create policy "user owns company_search_run"
  on company_search_runs for all
  using (user_id = auth.uid());

create index if not exists idx_company_search_runs_user
  on company_search_runs (user_id, created_at desc);

-- ----------------------------------------------------------------
-- 2. company_search_results
-- ----------------------------------------------------------------
create table if not exists company_search_results (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid not null references company_search_runs(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,
  -- Discovery data (from Claude)
  name                    text not null,
  website                 text,
  domain                  text,
  location_city           text,
  location_country        text,
  description             text,
  isp_sector_match        text[],
  relevance_score         int check (relevance_score between 0 and 10),
  relevance_reasoning     text,
  evidence_urls           text[],
  -- Short overview (filled after Firecrawl + Claude Haiku enrich)
  one_liner               text,
  priority_label          text check (priority_label in ('hoch','mittel','niedrig')),
  match_confidence        int check (match_confidence between 0 and 100),
  isp_sector_match_detail text[],
  reasoning_bullets       text,
  battery_need            text,
  user_group              text,
  -- Firecrawl validation
  firecrawl_status        text default 'pending'
                            check (firecrawl_status in ('pending','running','done','failed','skipped')),
  firecrawl_confirmed_url text,
  firecrawl_extracted     jsonb,
  -- Actions
  dismissed               boolean default false,
  added_company_id        uuid references companies(id) on delete set null,
  created_at              timestamptz default now()
);

alter table company_search_results enable row level security;

create policy "user owns company_search_result"
  on company_search_results for all
  using (user_id = auth.uid());

create index if not exists idx_company_search_results_run
  on company_search_results (run_id, relevance_score desc);

create index if not exists idx_company_search_results_added
  on company_search_results (user_id, added_company_id)
  where added_company_id is not null;

-- ----------------------------------------------------------------
-- 3. company_search_log
-- ----------------------------------------------------------------
create table if not exists company_search_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  run_id     uuid references company_search_runs(id) on delete cascade,
  level      text not null check (level in ('info','warn','error')),
  phase      text,
  message    text not null,
  meta       jsonb,
  created_at timestamptz default now()
);

alter table company_search_log enable row level security;

create policy "user owns company_search_log"
  on company_search_log for all
  using (user_id = auth.uid());

create index if not exists idx_company_search_log_run
  on company_search_log (run_id, created_at);

-- ----------------------------------------------------------------
-- 4. companies.source  (Herkunft: exhibitor | manual | company_search)
-- ----------------------------------------------------------------
alter table companies
  add column if not exists source text default 'exhibitor';

-- ----------------------------------------------------------------
-- 5. app_settings: company_search columns
-- ----------------------------------------------------------------
alter table app_settings
  add column if not exists company_search_system_prompt     text,
  add column if not exists company_search_model             text default 'claude-opus-4-7',
  add column if not exists company_search_max_tokens        int  default 8000,
  add column if not exists company_search_max_web_searches  int  default 10;

-- ----------------------------------------------------------------
-- 6. chat_threads: company_search scope + run focus column
-- ----------------------------------------------------------------
alter table chat_threads
  add column if not exists company_search_run_focus uuid
    references company_search_runs(id) on delete set null;

alter table chat_threads
  drop constraint if exists chat_threads_scope_check;
alter table chat_threads
  add constraint chat_threads_scope_check
    check (scope in ('dashboard','show','companies','competitor','show_discovery','company_search'));

create index if not exists idx_chat_threads_company_search_focus
  on chat_threads (user_id, company_search_run_focus)
  where company_search_run_focus is not null;
