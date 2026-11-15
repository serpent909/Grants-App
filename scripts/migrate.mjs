/**
 * Apply one SQL migration file to the database in DATABASE_URL.
 *
 *   npm run migrate -- migrations/008_email_flows.sql
 *
 * The file is sent as-is, so it should carry its own BEGIN/COMMIT (the files in
 * migrations/ do). If it fails, the transaction is rolled back and nothing is
 * applied. The connection string is never printed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from '@neondatabase/serverless';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run migrate -- migrations/<file>.sql');
  process.exit(1);
}

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL is not set (expected in .env.local)');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const pool = new Pool({ connectionString: url });
const client = await pool.connect();

try {
  await client.query(sql);
  console.log(`Applied ${path.basename(file)}`);
} catch (err) {
  try { await client.query('ROLLBACK'); } catch { /* no open transaction */ }
  console.error(`FAILED ${path.basename(file)}: ${err instanceof Error ? err.message : err}`);
  console.error('Nothing was applied.');
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
