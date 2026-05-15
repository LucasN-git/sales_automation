-- 0023_chat_orchestrator.sql
-- Adds pipeline_action column to chat_messages for orchestrator tool-call persistence.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS pipeline_action jsonb;

CREATE INDEX IF NOT EXISTS idx_chat_messages_pipeline_action
  ON chat_messages USING gin(pipeline_action)
  WHERE pipeline_action IS NOT NULL;
