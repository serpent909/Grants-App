import { Pool } from '@neondatabase/serverless';
import { createHash } from 'crypto';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL or POSTGRES_URL env var is required');
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

// ─── Grants Table Query ──────────────────────────────────────────────────────

export interface GrantRow {
  id: string;
  name: string;
  funder_name: string;
  funder_type: string | null;
  type: string;
  description: string | null;
  url: string;
  source_url: string | null;
  regions: string[] | null;
  sectors: string[] | null;
  eligibility: string[] | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  application_form_url: string | null;
}

/**
 * Query the grants table with optional region/sector filtering.
 * Returns up to `limit` active grants, filtered by region overlap and ordered
 * by sector overlap count (most matching sectors first), then by funder name.
 */
export async function searchGrants(
  orgSectors: string[],
  orgRegions: string[],
  limit = 9999,
): Promise<GrantRow[]> {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) return [];
  try {
    const db = getPool();
    const { rows } = await db.query<GrantRow>(
      `SELECT
         g.id, g.name,
         COALESCE(g.funder_name, c.name) AS funder_name,
         c.funder_type,
         g.type, g.description,
         COALESCE(g.application_form_url, g.url) AS url,
         g.source_url,
         g.regions, g.sectors, g.eligibility,
         g.amount_min, g.amount_max, g.deadline,
         g.application_form_url
       FROM grants g
       JOIN charities c ON c.id = g.funder_id
       WHERE g.is_active
         AND (
           g.deadline IS NULL
           OR g.deadline = ''
           OR g.deadline !~ '^\d{4}-\d{2}-\d{2}'   -- non-date deadlines (e.g. "rolling")
           OR g.deadline::date >= CURRENT_DATE       -- future or today
         )
         AND (
           $1::text[] = '{}'        -- empty = nationwide org: no region filter
           OR g.regions IS NULL
           OR g.regions = '{}'
           OR g.regions && $1::text[]
         )
         AND (
           $2::text[] = '{}'        -- empty = no sector filter
           OR g.sectors IS NULL
           OR g.sectors = '{}'
           OR g.sectors && $2::text[]
         )
       ORDER BY
         cardinality(ARRAY(
           SELECT unnest(COALESCE(g.sectors, '{}')) INTERSECT SELECT unnest($2::text[])
         )) DESC,
         COALESCE(g.funder_name, c.name) ASC
       LIMIT $3`,
      [orgRegions, orgSectors.length ? orgSectors : ([] as string[]), limit],
    );
    console.log(`[GrantSearch] DB grants query: ${rows.length} grants returned`);
    return rows;
  } catch (err) {
    console.warn('[GrantSearch] searchGrants failed:', err);
    return [];
  }
}

// ─── Deep Search Write-back ──────────────────────────────────────────────────

/**
 * Writes fields discovered by deep search back to the grants table.
 * Uses COALESCE so only NULL fields in the DB are updated — existing data is never overwritten.
 * Silently no-ops if nothing useful was found or the DB is unavailable.
 */
export async function writeDeepSearchUpdates(
  grantId: string,
  updates: {
    applicationFormUrl?: string;
    amountMin?: number;
    amountMax?: number;
    deadline?: string;
  },
): Promise<void> {
  const { applicationFormUrl, amountMin, amountMax, deadline } = updates;
  if (!applicationFormUrl && amountMin == null && amountMax == null && !deadline) return;
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) return;

  try {
    const db = getPool();
    await db.query(
      `UPDATE grants SET
         application_form_url = COALESCE(application_form_url, $1),
         amount_min           = COALESCE(amount_min, $2),
         amount_max           = COALESCE(amount_max, $3),
         deadline             = COALESCE(deadline, $4),
         updated_at           = NOW()
       WHERE id = $5`,
      [
        applicationFormUrl ?? null,
        amountMin ?? null,
        amountMax ?? null,
        deadline ?? null,
        grantId,
      ],
    );
    console.log(`[DeepSearch] Wrote back to DB for grant ${grantId}`);
  } catch (err) {
    console.warn(`[DeepSearch] DB write-back failed for ${grantId}:`, err);
  }
}

// ─── Deterministic Grant IDs ─────────────────────────────────────────────────

export function generateGrantId(funder: string, name: string, url: string): string {
  const input = `${funder.trim().toLowerCase()}|${name.trim().toLowerCase()}|${url.trim().toLowerCase()}`;
  return 'g_' + createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ─── Storage Tables ──────────────────────────────────────────────────────────

let storageTablesReady = false;

export async function ensureStorageTables(): Promise<void> {
  if (storageTablesReady) return;
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) return;
  try {
    const db = getPool();
    await db.query(`
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
        name TEXT NOT NULL,
        org_id TEXT NOT NULL REFERENCES organisations(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

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

      CREATE TABLE IF NOT EXISTS saved_searches (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organisations(id),
        name TEXT NOT NULL,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        grant_count INTEGER NOT NULL DEFAULT 0,
        org_summary TEXT NOT NULL DEFAULT '',
        market TEXT NOT NULL,
        result_json JSONB NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_saved_searches_org ON saved_searches(org_id);

      CREATE TABLE IF NOT EXISTS shortlisted_grants (
        org_id TEXT NOT NULL REFERENCES organisations(id),
        grant_id TEXT NOT NULL,
        grant_json JSONB NOT NULL,
        search_title TEXT NOT NULL DEFAULT '',
        shortlisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, grant_id)
      );

      CREATE TABLE IF NOT EXISTS deep_searches (
        org_id TEXT NOT NULL REFERENCES organisations(id),
        grant_id TEXT NOT NULL,
        result_json JSONB NOT NULL,
        searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, grant_id)
      );

      CREATE TABLE IF NOT EXISTS grant_applications (
        org_id TEXT NOT NULL REFERENCES organisations(id),
        grant_id TEXT NOT NULL,
        id TEXT NOT NULL,
        grant_json JSONB NOT NULL,
        search_title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'preparing',
        status_history JSONB NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        started_at TIMESTAMPTZ NOT NULL,
        submitted_at TIMESTAMPTZ,
        decided_at TIMESTAMPTZ,
        amount_requested NUMERIC,
        amount_awarded NUMERIC,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (org_id, grant_id)
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organisations(id),
        filename TEXT NOT NULL,
        blob_url TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        notes TEXT NOT NULL DEFAULT '',
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id);

      CREATE TABLE IF NOT EXISTS application_checklist_items (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organisations(id),
        grant_id TEXT NOT NULL,
        item_index INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        required BOOLEAN NOT NULL DEFAULT false,
        checked BOOLEAN NOT NULL DEFAULT false,
        checked_at TIMESTAMPTZ,
        UNIQUE(org_id, grant_id, item_index)
      );

      CREATE INDEX IF NOT EXISTS idx_checklist_grant
        ON application_checklist_items(grant_id);
      CREATE INDEX IF NOT EXISTS idx_checklist_org
        ON application_checklist_items(org_id);

      CREATE TABLE IF NOT EXISTS checklist_documents (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organisations(id),
        checklist_item_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        attached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(checklist_item_id, document_id)
      );

      CREATE INDEX IF NOT EXISTS idx_cd_checklist
        ON checklist_documents(checklist_item_id);
      CREATE INDEX IF NOT EXISTS idx_cd_document
        ON checklist_documents(document_id);
    `);
    storageTablesReady = true;
  } catch (err) {
    console.warn('[Storage] Failed to create storage tables:', err);
  }
}

