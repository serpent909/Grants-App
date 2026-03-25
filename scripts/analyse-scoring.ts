/**
 * Analyse scoring quality: pull a saved search from the DB,
 * cross-reference scored grants with raw DB data, and identify
 * grants that appear to be scored inappropriately high.
 *
 * Usage: npx tsx scripts/analyse-scoring.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: url });

interface ScoredGrant {
  id: string;
  name: string;
  funder: string;
  type: string;
  description: string;
  amountMin?: number;
  amountMax?: number;
  url: string;
  scores: { alignment: number; ease: number; attainability: number; overall: number };
  alignmentReason: string;
  attainabilityNotes: string;
}

interface SearchResult {
  grants: ScoredGrant[];
  orgSummary: string;
  inputs?: {
    sectors: string[];
    regions: string[];
    fundingPurpose: string;
    fundingAmount: number;
    orgType: string;
    website: string;
  };
}

async function main() {
  // 1. Get most recent saved search
  const { rows: searches } = await pool.query(`
    SELECT id, name, saved_at, grant_count, org_summary, result_json
    FROM saved_searches
    ORDER BY saved_at DESC
    LIMIT 1
  `);

  if (!searches.length) {
    console.log('No saved searches found.');
    return;
  }

  const search = searches[0];
  const result: SearchResult = search.result_json;
  const grants = result.grants;

  console.log('='.repeat(80));
  console.log(`SEARCH: "${search.name}" (${search.saved_at})`);
  console.log(`ORG SUMMARY: ${result.orgSummary}`);
  if (result.inputs) {
    console.log(`SECTORS: ${result.inputs.sectors?.join(', ') || 'none'}`);
    console.log(`REGIONS: ${result.inputs.regions?.join(', ') || 'none'}`);
    console.log(`PURPOSE: ${result.inputs.fundingPurpose}`);
    console.log(`AMOUNT: ${result.inputs.fundingAmount}`);
    console.log(`ORG TYPE: ${result.inputs.orgType}`);
  }
  console.log(`TOTAL GRANTS SCORED ≥5.0: ${grants.length}`);
  console.log('='.repeat(80));

  // 2. For each scored grant, look up raw DB data
  const grantIds = grants.map(g => g.id);
  const { rows: dbGrants } = await pool.query(`
    SELECT g.id, g.name, g.type, g.description, g.regions, g.sectors,
           g.eligibility, g.amount_min, g.amount_max, g.url,
           g.application_form_url, c.name as funder_name
    FROM grants g
    JOIN charities c ON c.id = g.funder_id
    WHERE g.id = ANY($1)
  `, [grantIds]);

  const dbMap = new Map(dbGrants.map(r => [r.id, r]));

  // 3. Sort by alignment score descending for analysis
  const sorted = [...grants].sort((a, b) => b.scores.alignment - a.scores.alignment);

  // 4. Categorize potential issues
  const issues: { grant: ScoredGrant; dbData: any; problems: string[] }[] = [];

  const orgSectors = result.inputs?.sectors || [];
  const orgRegions = result.inputs?.regions || [];

  // Sector label mapping
  const sectorLabelMap: Record<string, string> = {
    'health': 'Health & Wellbeing', 'mental-health': 'Mental Health',
    'education': 'Education & Training', 'youth': 'Youth',
    'children-families': 'Children & Families', 'elderly': 'Elderly & Aged Care',
    'disability': 'Disability', 'arts-culture': 'Arts & Culture',
    'sport': 'Sport & Recreation', 'environment': 'Environment & Conservation',
    'housing': 'Housing & Homelessness', 'community': 'Community Development',
    'social-services': 'Social Services', 'indigenous': 'Indigenous Development',
    'rural': 'Rural Communities', 'economic-development': 'Economic Development',
    'animal-welfare': 'Animal Welfare',
  };

  const orgSectorLabels = orgSectors.map(s => sectorLabelMap[s] || s);

  for (const grant of sorted) {
    const db = dbMap.get(grant.id);
    const problems: string[] = [];

    if (db) {
      const grantSectors = db.sectors || [];

      // Check sector overlap
      const hasOverlap = grantSectors.length === 0 || orgSectorLabels.some((s: string) =>
        grantSectors.some((gs: string) => gs.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(gs.toLowerCase()))
      );
      if (grantSectors.length > 0 && !hasOverlap) {
        problems.push(`SECTOR MISMATCH: Grant sectors [${grantSectors.join(', ')}] vs org sectors [${orgSectorLabels.join(', ')}]`);
      }

      // Check for in-kind / non-cash grants
      const desc = (db.description || '').toLowerCase();
      const grantName = (db.name || '').toLowerCase();
      const inKindSignals = ['in-kind', 'equipment', 'software', 'product', 'discount', 'pro bono',
        'donated', 'secondment', 'capacity building', 'training programme', 'mentoring'];
      const matchedInKind = inKindSignals.filter(s => desc.includes(s) || grantName.includes(s));
      if (matchedInKind.length > 0) {
        problems.push(`POSSIBLE IN-KIND: signals found: [${matchedInKind.join(', ')}]`);
      }

      // Check for very generic/broad grants scored high
      if (grant.scores.alignment >= 8 && grantSectors.length === 0 && !db.description) {
        problems.push(`HIGH SCORE + NO DATA: alignment=${grant.scores.alignment} but grant has no sectors and no description`);
      }

      // Check amount mismatch
      const orgAmount = result.inputs?.fundingAmount || 0;
      if (db.amount_max && orgAmount > 0 && db.amount_max < orgAmount * 0.1) {
        problems.push(`AMOUNT MISMATCH: Grant max $${db.amount_max} vs org seeking $${orgAmount}`);
      }
      if (db.amount_min && orgAmount > 0 && db.amount_min > orgAmount * 5) {
        problems.push(`AMOUNT MISMATCH (too large): Grant min $${db.amount_min} vs org seeking $${orgAmount}`);
      }
    } else {
      problems.push('NOT FOUND IN DB (may have been web-discovered or deleted)');
    }

    issues.push({ grant, dbData: db, problems });
  }

  // 5. Output analysis
  console.log('\n' + '='.repeat(80));
  console.log('FLAGGED GRANTS (potential scoring issues)');
  console.log('='.repeat(80));

  const flagged = issues.filter(i => i.problems.length > 0);
  console.log(`\n${flagged.length} of ${grants.length} grants flagged with potential issues\n`);

  for (const { grant, dbData, problems } of flagged) {
    console.log('-'.repeat(80));
    console.log(`GRANT: ${grant.name}`);
    console.log(`FUNDER: ${grant.funder}`);
    console.log(`SCORES: alignment=${grant.scores.alignment} ease=${grant.scores.ease} attainability=${grant.scores.attainability} overall=${grant.scores.overall}`);
    console.log(`ALIGNMENT REASON: ${grant.alignmentReason}`);
    if (dbData) {
      console.log(`DB SECTORS: ${(dbData.sectors || []).join(', ') || '(none)'}`);
      console.log(`DB REGIONS: ${(dbData.regions || []).join(', ') || '(none)'}`);
      console.log(`DB DESCRIPTION: ${(dbData.description || '').slice(0, 200)}`);
      if (dbData.eligibility?.length) console.log(`DB ELIGIBILITY: ${dbData.eligibility.join('; ')}`);
      if (dbData.amount_min || dbData.amount_max) {
        console.log(`DB AMOUNT: $${dbData.amount_min || '?'} - $${dbData.amount_max || '?'}`);
      }
    }
    console.log(`PROBLEMS:`);
    problems.forEach(p => console.log(`  ⚠ ${p}`));
    console.log();
  }

  // 6. Score distribution
  console.log('\n' + '='.repeat(80));
  console.log('SCORE DISTRIBUTION');
  console.log('='.repeat(80));
  const brackets = [
    { label: '9-10 (excellent)', min: 9, max: 10 },
    { label: '8-9 (very good)', min: 8, max: 9 },
    { label: '7-8 (good)', min: 7, max: 8 },
    { label: '6-7 (moderate)', min: 6, max: 7 },
    { label: '5-6 (threshold)', min: 5, max: 6 },
  ];
  for (const b of brackets) {
    const count = grants.filter(g => g.scores.alignment >= b.min && g.scores.alignment < b.max).length;
    const bar = '█'.repeat(count);
    console.log(`  ${b.label.padEnd(22)} ${String(count).padStart(3)} ${bar}`);
  }
  // Include 10.0 exactly
  const tens = grants.filter(g => g.scores.alignment === 10).length;
  if (tens) console.log(`  10.0 exactly        ${String(tens).padStart(3)}`);

  // 7. Full grant list (all grants, sorted by alignment)
  console.log('\n' + '='.repeat(80));
  console.log('ALL GRANTS (sorted by alignment score)');
  console.log('='.repeat(80));
  for (const { grant, dbData, problems } of issues) {
    const flag = problems.length > 0 ? ' ⚠' : '';
    const dbSectors = dbData ? (dbData.sectors || []).join(', ') : '?';
    console.log(`  [${grant.scores.alignment.toFixed(1).padStart(4)}] ${grant.funder.padEnd(35).slice(0, 35)} | ${grant.name.slice(0, 50).padEnd(50)} | sectors: ${dbSectors}${flag}`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
