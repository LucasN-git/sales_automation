-- Rename priority labels: hot→hoch, warm→mittel, cold→niedrig
-- 1. Drop old check constraint
ALTER TABLE exhibitor_short DROP CONSTRAINT IF EXISTS exhibitor_short_priority_label_check;

-- 2. Rename values
UPDATE exhibitor_short SET priority_label = 'hoch'    WHERE priority_label = 'hot';
UPDATE exhibitor_short SET priority_label = 'mittel'  WHERE priority_label = 'warm';
UPDATE exhibitor_short SET priority_label = 'niedrig' WHERE priority_label = 'cold';

-- 3. Add new check constraint
ALTER TABLE exhibitor_short
  ADD CONSTRAINT exhibitor_short_priority_label_check
  CHECK (priority_label IN ('hoch', 'mittel', 'niedrig'));
