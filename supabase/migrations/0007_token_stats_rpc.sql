-- get_token_stats: aggregate token usage for a trade show in one round-trip.
-- Replaces three separate selects in app/shows/[id]/layout.tsx.
-- security invoker so RLS on exhibitor_short / exhibitor_deep / chat_messages
-- still applies through the joined exhibitors / trade_shows ownership chain.

create or replace function public.get_token_stats(p_trade_show_id uuid)
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
      join exhibitors e on e.id = s.exhibitor_id
      where e.trade_show_id = p_trade_show_id
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
      join exhibitors e on e.id = d.exhibitor_id
      where e.trade_show_id = p_trade_show_id
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
      where c.trade_show_id = p_trade_show_id
    )
  );
$$;

grant execute on function public.get_token_stats(uuid) to authenticated;
