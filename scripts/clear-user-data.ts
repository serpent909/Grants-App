import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tables = [
    'saved_searches',
    'deep_searches',
    'shortlisted_grants',
    'grant_applications',
  ];

  for (const table of tables) {
    const { rowCount } = await pool.query(`DELETE FROM ${table}`);
    console.log(`${table}: deleted ${rowCount} rows`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
