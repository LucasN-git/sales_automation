-- 0027_global_cost_stats.sql
-- Umfassendes Kosten-RPC fuer die globale /costs-Seite.
-- Aggregiert alle Kosten-Quellen: Aussteller Short/Deep, Chat, Competitor-
-- Discovery/-Kurz, Show-Discovery, Browserbase -- je als Gesamt-Summe und
-- aufgeschluesselt nach Messe / Discovery-Run.

CREATE OR REPLACE FUNCTION public.get_full_cost_stats(p_user_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT json_build_object(

    -- ── Kategorie-Summen ─────────────────────────────────────────────────────

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
