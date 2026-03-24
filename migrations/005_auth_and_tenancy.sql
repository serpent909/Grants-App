-- 005: Multi-tenancy - organisations, users, invitations + org_id on all tenant tables

-- ─── New tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified TIMESTAMPTZ,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  org_id TEXT NOT NULL REFERENCES organisations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id);

-- ─── Add org_id to tenant-scoped tables ────────────────────────────────────
-- NOTE: The migration script (scripts/migrate-to-multi-tenant.ts) handles:
--   1. Adding org_id as nullable
--   2. Backfilling with seed org
--   3. Setting NOT NULL + FK + indexes
--   4. Updating primary keys to composite (org_id, grant_id)
-- This file is the DDL reference. Run the script for the actual migration.
