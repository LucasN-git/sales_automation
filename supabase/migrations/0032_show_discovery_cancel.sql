-- Add 'cancelled' status to show_discovery_runs so users can stop in-flight or
-- past runs from the UI. Cancellation is a soft signal: the Inngest function
-- checks the status at safe checkpoints (after Claude, before fan-out) and
-- skips remaining work. Already-running Claude calls cannot be aborted.

alter table show_discovery_runs
  drop constraint if exists show_discovery_runs_status_check;

alter table show_discovery_runs
  add constraint show_discovery_runs_status_check
  check (status in ('pending','running','done','failed','cancelled'));
