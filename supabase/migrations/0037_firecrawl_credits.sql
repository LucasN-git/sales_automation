-- 0037_firecrawl_credits.sql
-- Firecrawl-Credit-Tracking pro Scrape-Call.
-- Preise: 1 Credit = formats:markdown/rawHtml, 5 Credits = formats:json+schema (LLM-Extract).
--
-- exhibitor_short:     1 Credit pro scrapeCompanySite (markdown)
-- exhibitor_deep:      1 Credit pro scrapeCompanySite (markdown)
-- exhibitors:          5 Credits pro scrapeExhibitorProfile (json+schema)
-- competitor_versions: 1 Credit pro scrapeCompanySite (markdown)
-- show_discovery_runs: bereits firecrawl_calls (5 Credits/Call via scrapeShowSite)

ALTER TABLE exhibitor_short
  ADD COLUMN IF NOT EXISTS firecrawl_credits int NOT NULL DEFAULT 0;

ALTER TABLE exhibitor_deep
  ADD COLUMN IF NOT EXISTS firecrawl_credits int NOT NULL DEFAULT 0;

ALTER TABLE exhibitors
  ADD COLUMN IF NOT EXISTS firecrawl_credits_profile_enrich int NOT NULL DEFAULT 0;

ALTER TABLE competitor_versions
  ADD COLUMN IF NOT EXISTS firecrawl_credits int NOT NULL DEFAULT 0;

-- ── RPC updaten ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_full_cost_stats(p_user_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT json_build_object(

    -- ── Kategorie-Summen Claude ──────────────────────────────────────────────

    'exhibitor_short', (
      SELECT json_build_object(
        'tin',  COALESCE(SUM(s.tokens_in),  0),
        'tout', COALESCE(SUM(s.tokens_out), 0),
        'cnt',  COUNT(*) FILTER (
          WHERE COALESCE(s.tokens_in, 0) > 0 OR COALESCE(s.tokens_out, 0) > 0
        )
      )
      FROM exhibitor_short s
      JOIN exhibitors   e  ON e.id  = s.exhibitor_id
      JOIN trade_shows  ts ON ts.id = e.trade_show_id
      WHERE ts.user_id = p_user_id
    ),

    'exhibitor_deep', (
      SELECT json_build_object(
        'tin',  COALESCE(SUM(d.tokens_in),  0),
        'tout', COALESCE(SUM(d.tokens_out), 0),
        'cnt',  COUNT(*) FILTER (
          WHERE COALESCE(d.tokens_in, 0) > 0 OR COALESCE(d.tokens_out, 0) > 0
        )
      )
      FROM exhibitor_deep d
      JOIN exhibitors   e  ON e.id  = d.exhibitor_id
      JOIN trade_shows  ts ON ts.id = e.trade_show_id
      WHERE ts.user_id = p_user_id
    ),

    'chat', (
      SELECT json_build_object(
        'tin',  COALESCE(SUM(c.tokens_in),  0),
        'tout', COALESCE(SUM(c.tokens_out), 0),
        'cnt',  COUNT(*) FILTER (
          WHERE COALESCE(c.tokens_in, 0) > 0 OR COALESCE(c.tokens_out, 0) > 0
        )
      )
      FROM chat_messages c
      WHERE c.user_id = p_user_id
    ),

    'competitor_discovery', (
      SELECT json_build_object(
        'tin',                 COALESCE(SUM(tokens_in),  0),
        'tout',                COALESCE(SUM(tokens_out), 0),
        'cnt',                 COUNT(*) FILTER (WHERE status = 'done'),
        'web_search_uses',     COALESCE(SUM(web_search_uses), 0),
        'web_search_cost_usd', COALESCE(SUM(web_search_cost_usd), 0)
      )
      FROM competitor_discovery_runs
      WHERE user_id = p_user_id
    ),

    'competitor_versions', (
      SELECT json_build_object(
        'tin',  COALESCE(SUM(cv.tokens_in),  0),
        'tout', COALESCE(SUM(cv.tokens_out), 0),
        'cnt',  COUNT(*) FILTER (
          WHERE COALESCE(cv.tokens_in, 0) > 0 OR COALESCE(cv.tokens_out, 0) > 0
        )
      )
      FROM competitor_versions cv
      JOIN competitors c ON c.id = cv.competitor_id
      WHERE c.user_id = p_user_id
    ),

    'show_discovery', (
      SELECT json_build_object(
        'tin',             COALESCE(SUM(tokens_in),  0),
        'tout',            COALESCE(SUM(tokens_out), 0),
        'cnt',             COUNT(*) FILTER (WHERE status = 'done'),
        'web_search_uses', COALESCE(SUM(web_search_uses), 0)
      )
      FROM show_discovery_runs
      WHERE user_id = p_user_id
    ),

    'browser_seconds', (
      SELECT COALESCE(SUM(browserbase_session_seconds), 0)
      FROM trade_shows
      WHERE user_id = p_user_id
    ),

    -- ── Firecrawl-Credit-Summen ──────────────────────────────────────────────

    'fc_short', (
      SELECT json_build_object(
        'credits', COALESCE(SUM(s.firecrawl_credits), 0),
        'cnt',     COUNT(*) FILTER (WHERE s.firecrawl_credits > 0)
      )
      FROM exhibitor_short s
      JOIN exhibitors  e  ON e.id  = s.exhibitor_id
      JOIN trade_shows ts ON ts.id = e.trade_show_id
      WHERE ts.user_id = p_user_id
    ),

    'fc_deep', (
      SELECT json_build_object(
        'credits', COALESCE(SUM(d.firecrawl_credits), 0),
        'cnt',     COUNT(*) FILTER (WHERE d.firecrawl_credits > 0)
      )
      FROM exhibitor_deep d
      JOIN exhibitors  e  ON e.id  = d.exhibitor_id
      JOIN trade_shows ts ON ts.id = e.trade_show_id
      WHERE ts.user_id = p_user_id
    ),

    'fc_profile_enrich', (
      SELECT json_build_object(
        'credits', COALESCE(SUM(e.firecrawl_credits_profile_enrich), 0),
        'cnt',     COUNT(*) FILTER (WHERE e.firecrawl_credits_profile_enrich > 0)
      )
      FROM exhibitors  e
      JOIN trade_shows ts ON ts.id = e.trade_show_id
      WHERE ts.user_id = p_user_id
    ),

    'fc_competitor_short', (
      SELECT json_build_object(
        'credits', COALESCE(SUM(cv.firecrawl_credits), 0),
        'cnt',     COUNT(*) FILTER (WHERE cv.firecrawl_credits > 0)
      )
      FROM competitor_versions cv
      JOIN competitors c ON c.id = cv.competitor_id
      WHERE c.user_id = p_user_id
    ),

    'fc_show_discovery', (
      SELECT json_build_object(
        'credits', COALESCE(SUM(firecrawl_calls) * 5, 0),
        'cnt',     COALESCE(SUM(firecrawl_calls), 0)
      )
      FROM show_discovery_runs
      WHERE user_id = p_user_id
    ),

    -- ── Aufschluesselung nach Messe ──────────────────────────────────────────

    'shows', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',             ts.id,
          'name',           ts.name,
          'year',           ts.year,
          'browser_seconds', COALESCE(ts.browserbase_session_seconds, 0),
          'short_in', (
            SELECT COALESCE(SUM(s2.tokens_in), 0)
            FROM exhibitor_short s2
            JOIN exhibitors e2 ON e2.id = s2.exhibitor_id
            WHERE e2.trade_show_id = ts.id
          ),
          'short_out', (
            SELECT COALESCE(SUM(s2.tokens_out), 0)
            FROM exhibitor_short s2
            JOIN exhibitors e2 ON e2.id = s2.exhibitor_id
            WHERE e2.trade_show_id = ts.id
          ),
          'short_cnt', (
            SELECT COUNT(*) FILTER (
              WHERE COALESCE(s2.tokens_in, 0) > 0 OR COALESCE(s2.tokens_out, 0) > 0
            )
            FROM exhibitor_short s2
            JOIN exhibitors e2 ON e2.id = s2.exhibitor_id
            WHERE e2.trade_show_id = ts.id
          ),
          'deep_in', (
            SELECT COALESCE(SUM(d2.tokens_in), 0)
            FROM exhibitor_deep d2
            JOIN exhibitors e2 ON e2.id = d2.exhibitor_id
            WHERE e2.trade_show_id = ts.id
          ),
          'deep_out', (
            SELECT COALESCE(SUM(d2.tokens_out), 0)
            FROM exhibitor_deep d2
            JOIN exhibitors e2 ON e2.id = d2.exhibitor_id
            WHERE e2.trade_show_id = ts.id
          ),
          'deep_cnt', (
            SELECT COUNT(*) FILTER (
              WHERE COALESCE(d2.tokens_in, 0) > 0 OR COALESCE(d2.tokens_out, 0) > 0
            )
            FROM exhibitor_deep d2
            JOIN exhibitors e2 ON e2.id = d2.exhibitor_id
            WHERE e2.trade_show_id = ts.id
          ),
          'chat_in', (
            SELECT COALESCE(SUM(c2.tokens_in), 0)
            FROM chat_messages c2
            WHERE c2.trade_show_id = ts.id
          ),
          'chat_out', (
            SELECT COALESCE(SUM(c2.tokens_out), 0)
            FROM chat_messages c2
            WHERE c2.trade_show_id = ts.id
          ),
          'chat_cnt', (
            SELECT COUNT(*) FILTER (
              WHERE COALESCE(c2.tokens_in, 0) > 0 OR COALESCE(c2.tokens_out, 0) > 0
            )
            FROM chat_messages c2
            WHERE c2.trade_show_id = ts.id
          ),
          'fc_short_credits', (
            SELECT COALESCE(SUM(s2.firecrawl_credits), 0)
            FROM exhibitor_short s2
            JOIN exhibitors e2 ON e2.id = s2.exhibitor_id
            WHERE e2.trade_show_id = ts.id
          ),
          'fc_deep_credits', (
            SELECT COALESCE(SUM(d2.firecrawl_credits), 0)
            FROM exhibitor_deep d2
            JOIN exhibitors e2 ON e2.id = d2.exhibitor_id
            WHERE e2.trade_show_id = ts.id
          ),
          'fc_profile_credits', (
            SELECT COALESCE(SUM(e2.firecrawl_credits_profile_enrich), 0)
            FROM exhibitors e2
            WHERE e2.trade_show_id = ts.id
          )
        )
        ORDER BY ts.created_at DESC
      ), '[]'::json)
      FROM trade_shows ts
      WHERE ts.user_id = p_user_id
    ),

    -- ── Konkurrenz-Analyse-Laeufe ────────────────────────────────────────────

    'competitor_runs', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',                  id,
          'status',              status,
          'model',               model,
          'tokens_in',           COALESCE(tokens_in,  0),
          'tokens_out',          COALESCE(tokens_out, 0),
          'web_search_uses',     COALESCE(web_search_uses, 0),
          'web_search_cost_usd', COALESCE(web_search_cost_usd, 0),
          'started_at',          created_at,
          'finished_at',         finished_at
        )
        ORDER BY created_at DESC NULLS LAST
      ), '[]'::json)
      FROM competitor_discovery_runs
      WHERE user_id = p_user_id
    ),

    -- ── Messen-Suche-Laeufe ──────────────────────────────────────────────────

    'show_discovery_list', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',              id,
          'user_prompt',     user_prompt,
          'status',          status,
          'model',           model,
          'tokens_in',       COALESCE(tokens_in,  0),
          'tokens_out',      COALESCE(tokens_out, 0),
          'web_search_uses', COALESCE(web_search_uses, 0),
          'firecrawl_calls', COALESCE(firecrawl_calls, 0),
          'started_at',      created_at,
          'finished_at',     finished_at
        )
        ORDER BY created_at DESC NULLS LAST
      ), '[]'::json)
      FROM show_discovery_runs
      WHERE user_id = p_user_id
    )

  );
$$;

GRANT EXECUTE ON FUNCTION public.get_full_cost_stats(uuid) TO authenticated;
