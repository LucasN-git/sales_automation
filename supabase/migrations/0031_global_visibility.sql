-- 0031_global_visibility.sql
-- Macht core entities (trade_shows, exhibitors, companies, competitors,
-- show/competitor-discovery + logs) global sichtbar fuer alle authentifizierten
-- User. user_id bleibt als Provenienz-Tracking ("wer hat angelegt"), filtert
-- aber nicht mehr.
-- Per-User bleibt: app_settings, user_profiles, chat_threads, chat_messages.

-- ====================================================================
-- 1) Shared-tables: RLS auf "any authenticated user" umschreiben
-- ====================================================================

drop policy if exists "trade_shows_owner_all" on trade_shows;
create policy "trade_shows_authenticated_all" on trade_shows for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "exhibitors_via_show" on exhibitors;
create policy "exhibitors_authenticated_all" on exhibitors for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "exhibitor_short_via_show" on exhibitor_short;
create policy "exhibitor_short_authenticated_all" on exhibitor_short for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "exhibitor_deep_via_show" on exhibitor_deep;
create policy "exhibitor_deep_authenticated_all" on exhibitor_deep for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "crawl_log_via_show" on crawl_log;
create policy "crawl_log_authenticated_all" on crawl_log for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "companies_owner_all" on companies;
create policy "companies_authenticated_all" on companies for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "competitors_owner_all" on competitors;
create policy "competitors_authenticated_all" on competitors for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "competitor_versions_owner_all" on competitor_versions;
create policy "competitor_versions_authenticated_all" on competitor_versions for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "ccl_owner_all" on competitor_customer_links;
create policy "ccl_authenticated_all" on competitor_customer_links for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "csl_owner_all" on competitor_show_links;
create policy "csl_authenticated_all" on competitor_show_links for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "cdr_owner_all" on competitor_discovery_runs;
create policy "cdr_authenticated_all" on competitor_discovery_runs for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "cdl_owner_all" on competitor_discovery_log;
create policy "cdl_authenticated_all" on competitor_discovery_log for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "sdr_owner_all" on show_discovery_runs;
create policy "sdr_authenticated_all" on show_discovery_runs for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "sdrr_owner_all" on show_discovery_results;
create policy "sdrr_authenticated_all" on show_discovery_results for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

drop policy if exists "sdl_owner_all" on show_discovery_log;
create policy "sdl_authenticated_all" on show_discovery_log for all
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ====================================================================
-- 2) Companies-Indexe: globale Deduplizierung statt pro-User
-- ====================================================================

drop index if exists idx_companies_user_domain;
drop index if exists idx_companies_user_normname;

create unique index if not exists idx_companies_domain
  on companies (domain) where domain is not null;
create unique index if not exists idx_companies_normalized_name
  on companies (normalized_name);

-- ====================================================================
-- 3) get_global_token_stats: shared global, chat bleibt pro User
-- ====================================================================

create or replace function public.get_global_token_stats(p_user_id uuid)
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'short', (
      select json_build_object(
        'tin',  coalesce(sum(s.tokens_in),  0),
        'tout', coalesce(sum(s.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(s.tokens_in, 0) > 0 or coalesce(s.tokens_out, 0) > 0
        )
      )
      from exhibitor_short s
    ),
    'deep', (
      select json_build_object(
        'tin',  coalesce(sum(d.tokens_in),  0),
        'tout', coalesce(sum(d.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(d.tokens_in, 0) > 0 or coalesce(d.tokens_out, 0) > 0
        )
      )
      from exhibitor_deep d
    ),
    'chat', (
      select json_build_object(
        'tin',  coalesce(sum(m.tokens_in),  0),
        'tout', coalesce(sum(m.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(m.tokens_in, 0) > 0 or coalesce(m.tokens_out, 0) > 0
        )
      )
      from chat_messages m
      where m.user_id = p_user_id
    ),
    'browser_seconds', (
      select coalesce(sum(browserbase_session_seconds), 0)
      from trade_shows
    )
  )
$$;

grant execute on function public.get_global_token_stats(uuid) to authenticated;

-- ====================================================================
-- 4) get_full_cost_stats: shared global, chat bleibt pro User.
--    Output-Shape (Keys + Reihenfolge) identisch zu 0027, nur user_id-
--    Filter entfernt ausser bei chat_messages.
-- ====================================================================

create or replace function public.get_full_cost_stats(p_user_id uuid)
returns json
language sql
stable
security invoker
as $$
  select json_build_object(

    'exhibitor_short', (
      select json_build_object(
        'tin',  coalesce(sum(s.tokens_in),  0),
        'tout', coalesce(sum(s.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(s.tokens_in, 0) > 0 or coalesce(s.tokens_out, 0) > 0
        )
      )
      from exhibitor_short s
    ),

    'exhibitor_deep', (
      select json_build_object(
        'tin',  coalesce(sum(d.tokens_in),  0),
        'tout', coalesce(sum(d.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(d.tokens_in, 0) > 0 or coalesce(d.tokens_out, 0) > 0
        )
      )
      from exhibitor_deep d
    ),

    'chat', (
      select json_build_object(
        'tin',  coalesce(sum(c.tokens_in),  0),
        'tout', coalesce(sum(c.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(c.tokens_in, 0) > 0 or coalesce(c.tokens_out, 0) > 0
        )
      )
      from chat_messages c
      where c.user_id = p_user_id
    ),

    'competitor_discovery', (
      select json_build_object(
        'tin',                 coalesce(sum(tokens_in),  0),
        'tout',                coalesce(sum(tokens_out), 0),
        'cnt',                 count(*) filter (where status = 'done'),
        'web_search_uses',     coalesce(sum(web_search_uses), 0),
        'web_search_cost_usd', coalesce(sum(web_search_cost_usd), 0)
      )
      from competitor_discovery_runs
    ),

    'competitor_versions', (
      select json_build_object(
        'tin',  coalesce(sum(cv.tokens_in),  0),
        'tout', coalesce(sum(cv.tokens_out), 0),
        'cnt',  count(*) filter (
          where coalesce(cv.tokens_in, 0) > 0 or coalesce(cv.tokens_out, 0) > 0
        )
      )
      from competitor_versions cv
    ),

    'show_discovery', (
      select json_build_object(
        'tin',             coalesce(sum(tokens_in),  0),
        'tout',            coalesce(sum(tokens_out), 0),
        'cnt',             count(*) filter (where status = 'done'),
        'web_search_uses', coalesce(sum(web_search_uses), 0)
      )
      from show_discovery_runs
    ),

    'browser_seconds', (
      select coalesce(sum(browserbase_session_seconds), 0)
      from trade_shows
    ),

    'shows', (
      select coalesce(json_agg(
        json_build_object(
          'id',              ts.id,
          'name',            ts.name,
          'year',            ts.year,
          'browser_seconds', coalesce(ts.browserbase_session_seconds, 0),
          'short_in', (
            select coalesce(sum(s2.tokens_in), 0)
            from exhibitor_short s2
            join exhibitors e2 on e2.id = s2.exhibitor_id
            where e2.trade_show_id = ts.id
          ),
          'short_out', (
            select coalesce(sum(s2.tokens_out), 0)
            from exhibitor_short s2
            join exhibitors e2 on e2.id = s2.exhibitor_id
            where e2.trade_show_id = ts.id
          ),
          'short_cnt', (
            select count(*) filter (
              where coalesce(s2.tokens_in, 0) > 0 or coalesce(s2.tokens_out, 0) > 0
            )
            from exhibitor_short s2
            join exhibitors e2 on e2.id = s2.exhibitor_id
            where e2.trade_show_id = ts.id
          ),
          'deep_in', (
            select coalesce(sum(d2.tokens_in), 0)
            from exhibitor_deep d2
            join exhibitors e2 on e2.id = d2.exhibitor_id
            where e2.trade_show_id = ts.id
          ),
          'deep_out', (
            select coalesce(sum(d2.tokens_out), 0)
            from exhibitor_deep d2
            join exhibitors e2 on e2.id = d2.exhibitor_id
            where e2.trade_show_id = ts.id
          ),
          'deep_cnt', (
            select count(*) filter (
              where coalesce(d2.tokens_in, 0) > 0 or coalesce(d2.tokens_out, 0) > 0
            )
            from exhibitor_deep d2
            join exhibitors e2 on e2.id = d2.exhibitor_id
            where e2.trade_show_id = ts.id
          ),
          'chat_in', (
            select coalesce(sum(c2.tokens_in), 0)
            from chat_messages c2
            where c2.trade_show_id = ts.id and c2.user_id = p_user_id
          ),
          'chat_out', (
            select coalesce(sum(c2.tokens_out), 0)
            from chat_messages c2
            where c2.trade_show_id = ts.id and c2.user_id = p_user_id
          ),
          'chat_cnt', (
            select count(*) filter (
              where coalesce(c2.tokens_in, 0) > 0 or coalesce(c2.tokens_out, 0) > 0
            )
            from chat_messages c2
            where c2.trade_show_id = ts.id and c2.user_id = p_user_id
          )
        )
        order by ts.created_at desc
      ), '[]'::json)
      from trade_shows ts
    ),

    'competitor_runs', (
      select coalesce(json_agg(
        json_build_object(
          'id',                  id,
          'status',              status,
          'model',               model,
          'tokens_in',           coalesce(tokens_in,  0),
          'tokens_out',          coalesce(tokens_out, 0),
          'web_search_uses',     coalesce(web_search_uses, 0),
          'web_search_cost_usd', coalesce(web_search_cost_usd, 0),
          'started_at',          created_at,
          'finished_at',         finished_at
        )
        order by created_at desc nulls last
      ), '[]'::json)
      from competitor_discovery_runs
    ),

    'show_discovery_list', (
      select coalesce(json_agg(
        json_build_object(
          'id',              id,
          'user_prompt',     user_prompt,
          'status',          status,
          'model',           model,
          'tokens_in',       coalesce(tokens_in,  0),
          'tokens_out',      coalesce(tokens_out, 0),
          'web_search_uses', coalesce(web_search_uses, 0),
          'started_at',      created_at,
          'finished_at',     finished_at
        )
        order by created_at desc nulls last
      ), '[]'::json)
      from show_discovery_runs
    )

  );
$$;

grant execute on function public.get_full_cost_stats(uuid) to authenticated;
