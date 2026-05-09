-- Per-Show settings: free-text chat-context that gets prepended to every
-- chat for this trade show as an additional system block (next to the global
-- prio_context). Use case: messe-spezifische hinweise wie "leitmesse fuer
-- defense-uavs", besucherprofil, oder spezielle ziele dieses einsatzes.

alter table trade_shows
  add column if not exists chat_context text;
