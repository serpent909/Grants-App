/**
 * Comprehensive DB quality fixes for GrantSearch NZ.
 *
 * Fixes:
 *  1. Merge errors (Fillmor House → OCT, Aoraki co.nz, Waikato Sick Babies)
 *  2. Homepage URLs → specific grants pages
 *  3. Add curated_grant_url to register entries (Central Lakes, Aoraki, Momentum Waikato)
 *  4. Deduplicate funders (NZCT, Four Winds, Community Trust South, Geyser CF, Todd Foundation, Lion Foundation)
 *  5. Deactivate contamination grants (grants-received listed as grants-given)
 *  6. Reset enriched_at for re-enrichment
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/db-quality-fixes.ts
 */

import { Pool } from '@neondatabase/serverless';

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }
  const pool = new Pool({ connectionString: dbUrl });

  console.log('Running DB quality fixes...\n');

  // ── 1. MERGE ERRORS ──────────────────────────────────────────────────────────

  console.log('1. Fixing merge errors...');

  // Fillmor House Limited was incorrectly merged with OCT's URL
  await pool.query(`UPDATE charities SET
    name = 'Otago Community Trust',
    curated_grant_url = 'https://www.oct.org.nz/funding/apply-for-funding',
    website_url = 'https://www.oct.org.nz',
    enriched_at = NULL
    WHERE id = 541`);
  await pool.query(`UPDATE grants SET funder_name = 'Otago Community Trust', updated_at = NOW() WHERE funder_id = 541`);
  console.log('  ✓ Fillmor House → Otago Community Trust');

  // Waikato Sick Babies Trust was incorrectly assigned Momentum Waikato's grant URL
  await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = 2678`);
  await pool.query(`UPDATE charities SET
    curated_grant_url = 'https://momentumwaikato.nz/how-we-fund',
    enriched_at = NULL
    WHERE id = 48`);
  console.log('  ✓ Momentum Waikato Community Foundation (id=48) — curated URL assigned');

  // Aoraki MRI Charitable Trust (aorakifoundation.co.nz) is NOT the Aoraki Foundation community foundation
  await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = 2070`);
  // Aoraki Foundation (aorakifoundation.org.nz) is the real community foundation
  await pool.query(`UPDATE charities SET
    curated_grant_url = 'https://www.aorakifoundation.org.nz/apply-for-a-grant',
    enriched_at = NULL
    WHERE id = 274`);
  console.log('  ✓ Aoraki Foundation — fixed to .org.nz domain');

  // ── 2. HOMEPAGE URL FIXES ─────────────────────────────────────────────────────

  console.log('\n2. Fixing homepage URLs → specific grants pages...');

  const homepageFixes: Array<[number, string, string]> = [
    [541,   'https://www.oct.org.nz/funding/apply-for-funding', 'Otago Community Trust (already done)'],
    [13393, 'https://www.baytrust.org.nz/apply-for-funding',   'BayTrust'],
    [287,   'https://www.jrmckenzie.org.nz/what',              'J R McKenzie Trust'],
    [15082, 'https://mainlandfoundation.co.nz/grant-funding/', 'Mainland Foundation'],
    [15106, 'https://www.nikaufoundation.nz/funding-hub',      'Nikau Foundation'],
    [15099, 'https://toifoundation.org.nz/how-we-fund/',       'Toi Foundation'],
    [15096, 'https://wct.org.nz/funding/',                     'Wellington Community Trust'],
  ];

  for (const [id, url, label] of homepageFixes) {
    if (id === 541) { console.log(`  ✓ ${label}`); continue; } // already done above
    await pool.query(`UPDATE charities SET curated_grant_url = $1, enriched_at = NULL WHERE id = $2`, [url, id]);
    console.log(`  ✓ ${label}`);
  }

  // Fix WCT name while we're at it
  await pool.query(`UPDATE charities SET name = 'Wellington Community Trust' WHERE id = 15096`);
  // Fix CureKids name
  await pool.query(`UPDATE charities SET name = 'CureKids', enriched_at = NULL WHERE id = 15143`);
  console.log('  ✓ Wellington Community Trust — name fixed');
  console.log('  ✓ CureKids — name fixed');

  // ── 3. ADD CURATED URLs TO REGISTER ENTRIES ───────────────────────────────────

  console.log('\n3. Adding curated URLs to register entries...');

  await pool.query(`UPDATE charities SET
    curated_grant_url = 'https://www.clt.net.nz/funding',
    enriched_at = NULL
    WHERE id = 365`);
  console.log('  ✓ Central Lakes Trust (id=365)');

  // Already done above: Aoraki Foundation (id=274) and Momentum Waikato (id=48)

  // ── 4. DEDUPLICATE FUNDERS ────────────────────────────────────────────────────

  console.log('\n4. Deduplicating funders...');

  // NZCT: keep curated id=15073 (2 grants), clear register id=590 (1 grant)
  await pool.query(`UPDATE grants SET funder_id = 15073, updated_at = NOW() WHERE funder_id = 590`);
  await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = 590`);
  console.log('  ✓ NZCT — merged register into curated (id=15073)');

  // Four Winds: keep id=15076 (trailing slash), remove id=15276 (no trailing slash)
  await pool.query(`UPDATE grants SET funder_id = 15076, updated_at = NOW() WHERE funder_id = 15276`);
  await pool.query(`DELETE FROM charities WHERE id = 15276`);
  console.log('  ✓ Four Winds Foundation — removed duplicate (id=15276)');

  // Community Trust South: keep curated id=15086 (11 grants), deactivate register id=15286
  await pool.query(`UPDATE grants SET is_active = false, updated_at = NOW() WHERE funder_id = 15286`);
  await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = 15286`);
  console.log('  ✓ Community Trust South — deactivated duplicate grants (id=15286)');

  // Geyser Community Foundation: keep curated id=15113, deactivate register id=332
  await pool.query(`UPDATE grants SET is_active = false, updated_at = NOW() WHERE funder_id = 332`);
  await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = 332`);
  console.log('  ✓ Geyser Community Foundation — deactivated duplicate grants (id=332)');

  // Todd Foundation: keep curated id=15121 (15 grants), deactivate register id=156 (1 grant)
  await pool.query(`UPDATE grants SET is_active = false, updated_at = NOW() WHERE funder_id = 156`);
  await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = 156`);
  console.log('  ✓ Todd Foundation — deactivated duplicate grants (id=156)');

  // JR McKenzie: delete empty duplicate curated entry (id=15123, 0 grants)
  await pool.query(`DELETE FROM charities WHERE id = 15123`);
  console.log('  ✓ J R McKenzie Trust — deleted empty duplicate (id=15123)');

  // Eastern Bay CF: keep curated id=15111 and register id=465 - check which has more grants
  // Both scraped the same URL - deactivate register duplicate
  const { rows: ebcfRows } = await pool.query(`SELECT id, (SELECT COUNT(*) FROM grants WHERE funder_id = c.id AND is_active) AS cnt FROM charities c WHERE id IN (465, 15111)`);
  const ebcfCurated = ebcfRows.find((r: {id: number}) => r.id === 15111);
  const ebcfRegister = ebcfRows.find((r: {id: number}) => r.id === 465);
  if (ebcfCurated && ebcfRegister) {
    await pool.query(`UPDATE grants SET is_active = false, updated_at = NOW() WHERE funder_id = 465`);
    await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = 465`);
    console.log(`  ✓ Eastern Bay Community Foundation — deactivated register duplicate (curated has ${ebcfCurated.cnt}, register had ${ebcfRegister.cnt})`);
  }

  // Top of South CF: keep curated id=15115 and register id=57 - deactivate register
  await pool.query(`UPDATE grants SET is_active = false, updated_at = NOW() WHERE funder_id = 57`);
  await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = 57`);
  console.log('  ✓ Top of South Community Foundation — deactivated register duplicate (id=57)');

  // Hawkes Bay Foundation: check for duplicates
  const { rows: hbfRows } = await pool.query(`SELECT id, name, curated_grant_url, (SELECT COUNT(*) FROM grants WHERE funder_id = c.id AND is_active) AS cnt FROM charities c WHERE name ILIKE '%hawke%bay%foundation%' AND curated_grant_url IS NOT NULL`);
  if (hbfRows.length > 1) {
    hbfRows.sort((a: {cnt: string}, b: {cnt: string}) => Number(b.cnt) - Number(a.cnt));
    const keepId = hbfRows[0].id;
    for (const row of hbfRows.slice(1)) {
      await pool.query(`UPDATE grants SET funder_id = $1, updated_at = NOW() WHERE funder_id = $2`, [keepId, row.id]);
      await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = $1`, [row.id]);
      console.log(`  ✓ Hawkes Bay Foundation — merged id=${row.id} into id=${keepId}`);
    }
  }

  // Northland CF: check duplicates
  const { rows: ncfRows } = await pool.query(`SELECT id, name, curated_grant_url, (SELECT COUNT(*) FROM grants WHERE funder_id = c.id AND is_active) AS cnt FROM charities c WHERE name ILIKE '%northland community foundation%' AND curated_grant_url IS NOT NULL`);
  if (ncfRows.length > 1) {
    ncfRows.sort((a: {cnt: string}, b: {cnt: string}) => Number(b.cnt) - Number(a.cnt));
    const keepId = ncfRows[0].id;
    for (const row of ncfRows.slice(1)) {
      await pool.query(`UPDATE grants SET funder_id = $1, updated_at = NOW() WHERE funder_id = $2`, [keepId, row.id]);
      await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = $1`, [row.id]);
      console.log(`  ✓ Northland Community Foundation — merged id=${row.id} into id=${keepId}`);
    }
  }

  // Lion Foundation: fix name and merge duplicate
  await pool.query(`UPDATE grants SET funder_id = 15074, updated_at = NOW() WHERE funder_id = 15274`);
  await pool.query(`DELETE FROM charities WHERE id = 15274`);
  await pool.query(`UPDATE charities SET name = 'Lion Foundation', enriched_at = NULL WHERE id = 15074`);
  console.log('  ✓ Lion Foundation — name fixed, duplicate removed, queued for re-enrichment');

  // Skycity Hamilton: deduplicate
  const { rows: skyRows } = await pool.query(`SELECT id, curated_grant_url, (SELECT COUNT(*) FROM grants WHERE funder_id = c.id AND is_active) AS cnt FROM charities c WHERE name ILIKE '%skycity hamilton%' AND curated_grant_url IS NOT NULL`);
  if (skyRows.length > 1) {
    skyRows.sort((a: {cnt: string}, b: {cnt: string}) => Number(b.cnt) - Number(a.cnt));
    const keepId = skyRows[0].id;
    for (const row of skyRows.slice(1)) {
      await pool.query(`UPDATE grants SET funder_id = $1, updated_at = NOW() WHERE funder_id = $2`, [keepId, row.id]);
      await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = $1`, [row.id]);
      console.log(`  ✓ SkyCity Hamilton — merged id=${row.id} into id=${keepId}`);
    }
  }

  // The Tindall Foundation: deduplicate
  const { rows: tindallRows } = await pool.query(`SELECT id, curated_grant_url, (SELECT COUNT(*) FROM grants WHERE funder_id = c.id AND is_active) AS cnt FROM charities c WHERE name ILIKE '%tindall foundation%' AND curated_grant_url IS NOT NULL`);
  if (tindallRows.length > 1) {
    tindallRows.sort((a: {cnt: string}, b: {cnt: string}) => Number(b.cnt) - Number(a.cnt));
    const keepId = tindallRows[0].id;
    for (const row of tindallRows.slice(1)) {
      await pool.query(`UPDATE grants SET funder_id = $1, updated_at = NOW() WHERE funder_id = $2`, [keepId, row.id]);
      await pool.query(`UPDATE charities SET curated_grant_url = NULL WHERE id = $1`, [row.id]);
      console.log(`  ✓ The Tindall Foundation — merged id=${row.id} into id=${keepId}`);
    }
  }

  // ── 5. DEACTIVATE CONTAMINATION GRANTS ────────────────────────────────────────

  console.log('\n5. Deactivating contamination grants (grants-received listed as grants-given)...');

  const contaminated = [
    'g_c868f3e0d5559429', // Tindall Foundation Grants under Top of South Community Foundation
    'g_a1b7261468d90f34', // Tindall Foundation Funding under Hawke\'s Bay Foundation
    'g_2fb59b3eb64c27a5', // Tindall Funding under Eastern Bay of Plenty Community Foundation
    'g_81950d1ad566bdb3', // Tindall Foundation September Grant Round under Top of South CF Limited
    'g_6320e48c5396fb8c', // Tindall Foundation funding under The Sunrise Foundation
    'g_65983c77b5833c5e', // NZCT Active Communities Fund under Sport Manawatu Charitable Trust
    'g_bacdcc52258250f5', // National Lottery Grant under Sustainable South Canterbury Trust
    'g_c806cda938835a2c', // The Tindall Foundation under Northland Community Foundation
    'g_fc0366b9a0a5b701', // Lottery National Community under Foundation For Peace Studies
    'g_fc3df702138e90d5', // Arts Lottery Aotearoa under The Cachet Foundation
    'g_0c5dc3e1e0f3d9c1', // Lottery Grants under Te Puna Ariki Charitable Trust
    'g_ac3540346ce98a6e', // The Tindall Foundation under Te Puna Ariki Charitable Trust
    'g_f75af0e1e6cbdb86', // Tindall Foundation funding Northland under Northland Community Foundation
    'g_4f4825cf9b4b68bf', // The Tindall Foundation under Hawkes Bay Foundation (curated)
    'g_0f9693e5dd9b79f2', // The Tindall Foundation Grants under Topsouthfoundation
    'g_faa71c93f7908661', // Tindall Funding under Eastern Bay Community Foundation
    'g_8d56074d3f91dbf0', // Tindall Foundation Grants under Top of South CF Limited
  ];

  const { rowCount } = await pool.query(
    `UPDATE grants SET is_active = false, updated_at = NOW() WHERE id = ANY($1) AND is_active = true`,
    [contaminated]
  );
  console.log(`  ✓ Deactivated ${rowCount} contamination grants`);

  // ── 6. RESET enriched_at FOR UNDERPERFORMING FUNDERS ─────────────────────────

  console.log('\n6. Resetting enriched_at for underperforming funders...');

  const toReEnrich = [
    15077, // Pub Charity (1 grant)
    15081, // Grassroots Trust (1 grant)
    15080, // Aotearoa Gaming Trust (1 grant)
    15084, // Dragon Community Trust (1 grant)
    15076, // Four Winds Foundation (1 grant)
    450,   // Trust Horizon (1 grant)
    15073, // NZCT (2 grants)
    15092, // Trust Waikato (2 grants)
    15100, // WEL Energy Trust (2 grants)
    15074, // Lion Foundation (0 grants — just re-enriched above)
  ];

  await pool.query(`UPDATE charities SET enriched_at = NULL WHERE id = ANY($1)`, [toReEnrich]);
  console.log(`  ✓ Reset enriched_at for ${toReEnrich.length} underperforming funders`);

  // ── SUMMARY ───────────────────────────────────────────────────────────────────

  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_active) AS active_grants,
      COUNT(*) FILTER (WHERE is_active = false) AS inactive_grants,
      COUNT(DISTINCT funder_name) FILTER (WHERE is_active) AS unique_funders
    FROM grants
  `);
  const { rows: pendingEnrich } = await pool.query(`
    SELECT COUNT(*) AS pending FROM charities WHERE enriched_at IS NULL AND curated_grant_url IS NOT NULL
  `);

  console.log('\n── Final stats ──────────────────────────────────────────────');
  console.log(`  Active grants:    ${stats[0].active_grants}`);
  console.log(`  Inactive grants:  ${stats[0].inactive_grants}`);
  console.log(`  Unique funders:   ${stats[0].unique_funders}`);
  console.log(`  Pending re-enrich: ${pendingEnrich[0].pending}`);
  console.log('\nDone! Run enrich-with-tavily.ts (without --force) to process pending entries.');

  await pool.end();
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
