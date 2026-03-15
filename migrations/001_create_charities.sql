-- Create charities table for NZ Charities Register data
-- Run against your Neon/Vercel Postgres database

CREATE TABLE IF NOT EXISTS charities (
  id SERIAL PRIMARY KEY,
  charity_number VARCHAR(10) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  website_url TEXT,
  purpose TEXT,
  sector_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Full-text search indexes for matching against org sectors/purpose
CREATE INDEX IF NOT EXISTS idx_charities_name_purpose_fts
  ON charities USING gin(to_tsvector('english', name || ' ' || COALESCE(purpose, '')));

CREATE INDEX IF NOT EXISTS idx_charities_sector
  ON charities(sector_id);

CREATE INDEX IF NOT EXISTS idx_charities_website
  ON charities(website_url) WHERE website_url IS NOT NULL;
