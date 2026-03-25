-- Migration 004: Add funder_type to charities table
-- Classifies funders for better scoring context

ALTER TABLE charities ADD COLUMN IF NOT EXISTS funder_type TEXT;

-- Index for filtering/grouping
CREATE INDEX IF NOT EXISTS idx_charities_funder_type ON charities(funder_type) WHERE funder_type IS NOT NULL;
