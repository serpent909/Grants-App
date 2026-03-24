/**
 * Multi-tenancy migration script.
 *
 * Usage:
 *   SEED_ORG_NAME="My Charity" SEED_USER_EMAIL="admin@example.com" SEED_USER_PASSWORD="changeme123" \
 *     npx tsx scripts/migrate-to-multi-tenant.ts
 *
 * This script:
 *   1. Creates organisations, users, invitations tables
 *   2. Creates a seed organisation and user
 *   3. Adds org_id to all tenant-scoped tables
 *   4. Backfills existing data with the seed org's ID
 *   5. Adds NOT NULL constraints, FKs, and indexes
 *   6. Updates primary keys to composite (org_id, grant_id) where needed
 */

import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const SEED_ORG_NAME = process.env.SEED_ORG_NAME!;
const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL!;
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD!;

if (!SEED_ORG_NAME || !SEED_USER_EMAIL || !SEED_USER_PASSWORD) {
  console.error('Required env vars: SEED_ORG_NAME, SEED_USER_EMAIL, SEED_USER_PASSWORD');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function migrate() {
  console.log('Starting multi-tenancy migration...\n');

  // ─── Step 1: Create new tables ─────────────────────────────────────────

  console.log('Step 1: Creating organisations, users, invitations tables...');

  await sql`
    CREATE TABLE IF NOT EXISTS organisations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified TIMESTAMPTZ,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      org_id TEXT NOT NULL REFERENCES organisations(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;

  await sql`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organisations(id),
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id)`;

  console.log('  Done.\n');

  // ─── Step 2: Create seed organisation and user ─────────────────────────

  console.log('Step 2: Creating seed organisation and user...');

  const orgId = `org_${Date.now()}`;
  const orgSlug = slugify(SEED_ORG_NAME);

  await sql`
    INSERT INTO organisations (id, name, slug)
    VALUES (${orgId}, ${SEED_ORG_NAME}, ${orgSlug})
    ON CONFLICT (slug) DO NOTHING
  `;

  const userId = `usr_${Date.now()}`;
  const passwordHash = await bcrypt.hash(SEED_USER_PASSWORD, 12);

  await sql`
    INSERT INTO users (id, email, password_hash, name, org_id)
    VALUES (${userId}, ${SEED_USER_EMAIL.toLowerCase().trim()}, ${passwordHash}, ${'Admin'}, ${orgId})
    ON CONFLICT (email) DO NOTHING
  `;

  console.log(`  Org: "${SEED_ORG_NAME}" (${orgId})`);
  console.log(`  User: ${SEED_USER_EMAIL} (${userId})\n`);

  // ─── Step 3: Add org_id to tenant tables ───────────────────────────────

  const tenantTables = [
    'saved_searches',
    'shortlisted_grants',
    'deep_searches',
    'grant_applications',
    'documents',
    'application_checklist_items',
    'checklist_documents',
  ];

  console.log('Step 3: Adding org_id column to tenant tables...');

  for (const table of tenantTables) {
    // Check if column already exists
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = 'org_id'
    `;
    if (cols.length > 0) {
      console.log(`  ${table}: org_id already exists, skipping.`);
      continue;
    }

    await sql`${sql.unsafe(`ALTER TABLE ${table} ADD COLUMN org_id TEXT`)}`;
    console.log(`  ${table}: added org_id.`);
  }
  console.log('');

  // ─── Step 4: Backfill org_id ───────────────────────────────────────────

  console.log('Step 4: Backfilling org_id with seed org...');

  for (const table of tenantTables) {
    const result = await sql`${sql.unsafe(`UPDATE ${table} SET org_id = '${orgId}' WHERE org_id IS NULL`)}` as unknown as { count: number };
    console.log(`  ${table}: updated ${result.count ?? 0} rows.`);
  }
  console.log('');

  // ─── Step 5: Add NOT NULL, FK, and indexes ─────────────────────────────

  console.log('Step 5: Adding NOT NULL constraints, FKs, and indexes...');

  for (const table of tenantTables) {
    // Set NOT NULL
    await sql`${sql.unsafe(`ALTER TABLE ${table} ALTER COLUMN org_id SET NOT NULL`)}`;

    // Add FK (ignore if already exists)
    const fkName = `fk_${table}_org`;
    try {
      await sql`${sql.unsafe(`ALTER TABLE ${table} ADD CONSTRAINT ${fkName} FOREIGN KEY (org_id) REFERENCES organisations(id)`)}`;
    } catch {
      // Constraint may already exist
    }

    // Add index
    const idxName = `idx_${table}_org_id`;
    await sql`${sql.unsafe(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${table}(org_id)`)}`;

    console.log(`  ${table}: NOT NULL + FK + index.`);
  }
  console.log('');

  // ─── Step 6: Update primary keys to composite ─────────────────────────

  console.log('Step 6: Updating primary keys to composite (org_id, grant_id)...');

  const compositePkTables = ['shortlisted_grants', 'deep_searches', 'grant_applications'];

  for (const table of compositePkTables) {
    try {
      await sql`${sql.unsafe(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_pkey`)}`;
      await sql`${sql.unsafe(`ALTER TABLE ${table} ADD PRIMARY KEY (org_id, grant_id)`)}`;
      console.log(`  ${table}: PK now (org_id, grant_id).`);
    } catch (err) {
      console.log(`  ${table}: PK change skipped (may already be composite). ${(err as Error).message}`);
    }
  }

  // Update unique constraint on application_checklist_items
  try {
    await sql`${sql.unsafe(`ALTER TABLE application_checklist_items DROP CONSTRAINT IF EXISTS application_checklist_items_grant_id_item_index_key`)}`;
    await sql`${sql.unsafe(`ALTER TABLE application_checklist_items ADD CONSTRAINT application_checklist_items_org_grant_idx UNIQUE (org_id, grant_id, item_index)`)}`;
    console.log('  application_checklist_items: UNIQUE now (org_id, grant_id, item_index).');
  } catch (err) {
    console.log(`  application_checklist_items: constraint change skipped. ${(err as Error).message}`);
  }

  console.log('\nMigration complete!');
  console.log(`\nYou can now log in with:\n  Email: ${SEED_USER_EMAIL}\n  Password: ${SEED_USER_PASSWORD}`);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
