-- Migration 006: Add confidence tracking columns for pipeline v2 rebuild
-- Purely additive — safe to run against a shared dev/prod database.

-- ── Charities table extensions ──────────────────────────────────────────────

-- Overall confidence level for the funder record
ALTER TABLE charities ADD COLUMN IF NOT EXISTS data_confidence TEXT;

-- How this funder was discovered: 'register' | 'curated' | 'directory' | 'search'
ALTER TABLE charities ADD COLUMN IF NOT EXISTS discovery_source TEXT;

-- When the funder record was last verified as accurate
ALTER TABLE charities ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

-- Notes from verification (e.g. "website dead", "confirmed active grant-maker")
ALTER TABLE charities ADD COLUMN IF NOT EXISTS verification_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_charities_confidence
  ON charities(data_confidence) WHERE data_confidence IS NOT NULL;

-- ── Grants table extensions ─────────────────────────────────────────────────

-- Per-field provenance: {"description": "extracted", "deadline": "inferred", ...}
-- Values: "verified" | "extracted" | "inferred" | "default"
ALTER TABLE grants ADD COLUMN IF NOT EXISTS field_confidence JSONB DEFAULT '{}';

-- Which model performed the extraction: 'gpt-4o' | 'gpt-4o-mini' | 'manual'
ALTER TABLE grants ADD COLUMN IF NOT EXISTS extraction_model TEXT;

-- URLs used during the extraction (grant page + sub-pages)
ALTER TABLE grants ADD COLUMN IF NOT EXISTS extraction_pages TEXT[];

-- Computed quality score 0-100 based on field completeness
ALTER TABLE grants ADD COLUMN IF NOT EXISTS data_quality_score INTEGER;

-- Pipeline version: 1 = legacy, 2 = rebuild
ALTER TABLE grants ADD COLUMN IF NOT EXISTS pipeline_version INTEGER DEFAULT 1;

-- Flag for grants only available to individuals (not organisations)
ALTER TABLE grants ADD COLUMN IF NOT EXISTS individual_only BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_grants_quality
  ON grants(data_quality_score) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_grants_pipeline
  ON grants(pipeline_version);
