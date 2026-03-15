-- Add enrichment columns for pre-processed grant data
-- Run after 001_create_charities.sql

ALTER TABLE charities ADD COLUMN IF NOT EXISTS grant_url TEXT;
ALTER TABLE charities ADD COLUMN IF NOT EXISTS grant_summary TEXT;
ALTER TABLE charities ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMP;

-- Index for quick lookup of enriched vs unenriched
CREATE INDEX IF NOT EXISTS idx_charities_enriched ON charities(enriched_at) WHERE enriched_at IS NOT NULL;
