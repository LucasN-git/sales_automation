-- 0034_orchestrator_completion_notify.sql
-- Auto-Notification: nach Bulk-Short-Abschluss soll einmalig eine Meldung in den
-- Orchestrator-Thread gepostet werden. Per-Exhibitor-Jobs laufen mit concurrency=5,
-- d.h. mehrere Workers koennten gleichzeitig sehen "kein pending/running mehr".
-- Wir loesen das per atomic-claim: nur die UPDATE-Query mit IS NULL + NOT EXISTS
-- gewinnt, alle anderen sehen leer und ueberspringen die Notification.
--
-- Listing- und Deep-Dive-Notifications brauchen kein Flag:
--   Listing: laeuft exakt einmal pro Run, das mark-listing-ready step.run
--            (Inngest-idempotent) postet einmalig.
--   Deep-Dive: per-Exhibitor, laeuft einmal pro Trigger, kein Race-Risiko.

ALTER TABLE trade_shows
  ADD COLUMN IF NOT EXISTS short_bulk_notified_at timestamptz;
