-- 0025_chat_thread_type.sql
-- Adds is_orchestrator flag and exhibitor_name cache to chat_threads.
-- is_orchestrator: true for the first (system) thread created per show (set by API).
-- exhibitor_name: denormalized name so the chat history list can show it without a JOIN.

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS is_orchestrator boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exhibitor_name text;
