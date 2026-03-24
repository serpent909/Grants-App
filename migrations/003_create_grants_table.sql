-- Migration 003: Create grants table and extend charities table
-- Purely additive — no existing tables are modified destructively.
-- Safe to run against a shared dev/prod database.

-- ── Extend charities table (the funders list) ─────────────────────────────────

-- Track where this funder record came from
ALTER TABLE charities ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'register';

-- For curated funders: the known grant page URL (skip homepage crawl in enrichment)
ALTER TABLE charities ADD COLUMN IF NOT EXISTS curated_grant_url TEXT;

-- Geographic scope of the funder (null = national)
ALTER TABLE charities ADD COLUMN IF NOT EXISTS regions TEXT[];

-- ── Grants table: individual grant programs ───────────────────────────────────

CREATE TABLE IF NOT EXISTS grants (
  -- Identity
  id TEXT PRIMARY KEY,                        -- deterministic: 'g_' + sha256(funder|name|url)[:16]
  funder_id INTEGER REFERENCES charities(id), -- nullable: allows grants not yet linked to a funder row
  funder_name TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Other',         -- 'Government' | 'Foundation' | 'Corporate' | 'Community' | 'International' | 'Other'

  -- Core details
  description TEXT,
  url TEXT NOT NULL,                          -- grant page URL

  -- Funding amounts (NZD)
  amount_min INTEGER,
  amount_max INTEGER,

  -- Targeting
  regions TEXT[],                             -- null = national; array of region IDs from lib/markets/nz.ts
  sectors TEXT[],                             -- sector IDs from lib/constants.ts

  -- Eligibility & application
  eligibility TEXT[],
  deadline TEXT,                              -- ISO date string, "rolling", "annual - typically March", etc.
  is_recurring BOOLEAN DEFAULT true,
  round_frequency TEXT,                       -- 'annual' | 'quarterly' | 'rolling' | 'irregular'
  application_form_url TEXT,
  checklist JSONB,                            -- DeepSearchChecklistItem[] — populated by deep search
  key_contacts TEXT,

  -- Freshness tracking
  source_url TEXT,                            -- the page this grant was extracted from
  last_scraped_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,             -- set false if grant page 404s or program ends
  scrape_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search across grant name, description, and funder name
CREATE INDEX IF NOT EXISTS idx_grants_fts ON grants
  USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '') || ' ' || funder_name));

-- Array containment for region and sector filtering
CREATE INDEX IF NOT EXISTS idx_grants_regions  ON grants USING gin(regions);
CREATE INDEX IF NOT EXISTS idx_grants_sectors  ON grants USING gin(sectors);

-- Scalar lookups
CREATE INDEX IF NOT EXISTS idx_grants_type       ON grants(type);
CREATE INDEX IF NOT EXISTS idx_grants_active     ON grants(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_grants_funder     ON grants(funder_id);
CREATE INDEX IF NOT EXISTS idx_grants_scraped    ON grants(last_scraped_at NULLS FIRST);
