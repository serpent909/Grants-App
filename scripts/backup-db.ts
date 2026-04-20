/**
 * Backup charities and grants tables to JSON files.
 * Used when pg_dump version mismatch prevents native backup.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Pool } from '@neondatabase/serverless';
import { writeFileSync, mkdirSync } from 'fs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await pool.query(`SET search_path TO public`);

  const dir = process.argv[2] || 'backups/v3-20260407';
  mkdirSync(dir, { recursive: true });

  // Backup charities
  console.log('Backing up charities...');
  const { rows: charities } = await pool.query(`SELECT * FROM charities`);
  writeFileSync(`${dir}/charities.json`, JSON.stringify(charities, null, 0));
  console.log(`  ${charities.length} charities saved`);

  // Backup grants
  console.log('Backing up grants...');
  const { rows: grants } = await pool.query(`SELECT * FROM grants`);
  writeFileSync(`${dir}/grants.json`, JSON.stringify(grants, null, 0));
  console.log(`  ${grants.length} grants saved`);

  // Backup pipeline_runs
  console.log('Backing up pipeline_runs...');
  const { rows: runs } = await pool.query(`SELECT * FROM pipeline_runs`);
  writeFileSync(`${dir}/pipeline_runs.json`, JSON.stringify(runs, null, 0));
  console.log(`  ${runs.length} runs saved`);

  console.log(`\nBackup complete → ${dir}/`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
