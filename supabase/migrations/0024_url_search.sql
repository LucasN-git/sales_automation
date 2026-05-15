-- 0024_url_search.sql
-- Dedicated URL-search step for exhibitors without a website.
-- Claude web-search runs before Short analysis, finds company URL + extras,
-- saves them to exhibitors, then Firecrawl scrapes the found URL.

-- 1. New columns on exhibitors
ALTER TABLE exhibitors
  ADD COLUMN IF NOT EXISTS url_search_status text NOT NULL DEFAULT 'skipped'
    CHECK (url_search_status IN ('skipped', 'pending', 'running', 'done', 'url_not_found', 'failed')),
  ADD COLUMN IF NOT EXISTS linkedin_url text;

-- 2. Extend short_status to include 'url_not_found' terminal state.
--    Drop the existing auto-named check constraint and re-create it.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'exhibitors'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%short_status%';
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE exhibitors DROP CONSTRAINT ' || quote_ident(cname);
  END IF;
END $$;

ALTER TABLE exhibitors ADD CONSTRAINT exhibitors_short_status_check
  CHECK (short_status IN ('pending', 'running', 'done', 'failed', 'url_not_found'));

-- 3. Index for fast bulk-short fan-out query
CREATE INDEX IF NOT EXISTS idx_exhibitors_url_search_status
  ON exhibitors (trade_show_id, url_search_status);
