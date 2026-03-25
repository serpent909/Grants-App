import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows: [sl] } = await pool.query(
    `SELECT count(*) as total, count(*) filter (where grant_id IN (SELECT id FROM grants)) as matched FROM shortlisted_grants`
  );
  console.log(`shortlisted_grants: ${sl.total} total | ${sl.matched} match | ${Number(sl.total) - Number(sl.matched)} orphaned`);

  const { rows: [ds] } = await pool.query(
    `SELECT count(*) as total, count(*) filter (where grant_id IN (SELECT id FROM grants)) as matched FROM deep_searches`
  );
  console.log(`deep_searches: ${ds.total} total | ${ds.matched} match | ${Number(ds.total) - Number(ds.matched)} orphaned`);

  const { rows: [ga] } = await pool.query(
    `SELECT count(*) as total, count(*) filter (where grant_id IN (SELECT id FROM grants)) as matched FROM grant_applications`
  );
  console.log(`grant_applications: ${ga.total} total | ${ga.matched} match | ${Number(ga.total) - Number(ga.matched)} orphaned`);

  // Saved searches — grant IDs embedded in JSONB
  const { rows: searches } = await pool.query('SELECT id, name, result_json FROM saved_searches');
  const { rows: allIds } = await pool.query('SELECT id FROM grants');
  const idSet = new Set(allIds.map(r => r.id));

  let totalG = 0, orphG = 0;
  for (const s of searches) {
    const grants = s.result_json?.grants || [];
    let searchOrphans = 0;
    for (const g of grants) {
      totalG++;
      if (!idSet.has(g.id)) { orphG++; searchOrphans++; }
    }
    if (searchOrphans > 0) {
      console.log(`  saved_search "${s.name}": ${grants.length} grants, ${searchOrphans} orphaned`);
    }
  }
  console.log(`saved_searches: ${searches.length} searches | ${totalG} grant refs | ${orphG} orphaned`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
