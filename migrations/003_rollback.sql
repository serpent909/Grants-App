-- Rollback for migration 003
-- Removes everything added by 003_create_grants_table.sql and the import scripts.
--
-- What this DOES cover:
--   - Drops the grants table (all new data)
--   - Removes curated funder rows from charities (source='curated')
--   - Removes the three new columns added to charities
--
-- What this does NOT cover:
--   - Updates to existing register records (name, website_url, purpose, grant_url, grant_summary)
--     from re-running import-charities.ts or enrich-charities.ts.
--     For those, restore from your Neon snapshot.
--
-- Run with:
--   psql $DATABASE_URL -f migrations/003_rollback.sql

-- 1. Drop the grants table entirely (only new data, safe to remove)
DROP TABLE IF EXISTS grants;

-- 2. Remove curated funder rows (only added by import-curated-funders.ts)
DELETE FROM charities WHERE source = 'curated';

-- 3. Drop the new columns added to charities
ALTER TABLE charities DROP COLUMN IF EXISTS source;
ALTER TABLE charities DROP COLUMN IF EXISTS curated_grant_url;
ALTER TABLE charities DROP COLUMN IF EXISTS regions;
