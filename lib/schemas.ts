import { z } from 'zod';
import { SECTORS, ORG_TYPES } from './constants';
import { getMarket, listMarkets } from './markets';

// ─── Reusable primitives ────────────────────────────────────────────────────

const grantId = z.string().min(1).max(100);
const entityId = z.string().min(1).max(100);
const shortText = z.string().max(500);
const mediumText = z.string().max(5000);
const score = z.number().min(0).max(10);
const money = z.number().finite().min(0).max(1_000_000_000_000);
const password = z.string().min(8).max(200);

/** http(s) URL, max 2000 chars. */
const webUrl = z.string().max(2000).refine(value => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}, 'Must be a valid http(s) URL');

const scoresSchema = z.object({
  alignment: score,
  ease: score,
  attainability: score,
  overall: score,
});

const MARKET_IDS = new Set(listMarkets().map(m => m.id));
const SECTOR_IDS = new Set(SECTORS.map(s => s.id));
const ORG_TYPE_IDS = new Set(ORG_TYPES.map(t => t.id));

// ─── Grant object (stored as JSONB in shortlist / applications) ─────────────

/** Unknown keys are stripped so stored JSONB only ever contains these fields. */
export const grantObjectSchema = z.object({
  id: grantId,
  name: shortText,
  funder: shortText,
  type: z.string().max(100),
  description: mediumText.optional().default(''),
  amountMin: z.number().nullish(),
  amountMax: z.number().nullish(),
  deadline: z.string().max(100).nullish(),
  isRecurring: z.boolean().optional(),
  roundFrequency: z.string().max(200).optional(),
  url: z.string().max(2000),
  scores: scoresSchema,
  alignmentReason: mediumText.optional().default(''),
  applicationNotes: mediumText.optional().default(''),
  attainabilityNotes: mediumText.optional().default(''),
});

// ─── Search (main grant search) ─────────────────────────────────────────────

/**
 * Strict schema for a new search. Region and sector IDs feed straight into the
 * grants query, so anything not in the known lists is dropped here.
 */
export const searchSchema = z.object({
  searchTitle: z.string().max(500).optional(),
  website: webUrl,
  linkedin: z.string().max(2000).optional().default(''),
  fundingPurpose: z.string().min(1).max(5000),
  fundingAmount: z.number().positive().max(100_000_000),
  market: z.string().max(20).optional().default('nz')
    .transform(id => (MARKET_IDS.has(id) ? id : 'nz')),
  regions: z.array(z.string().max(100)).max(50).optional().default([]),
  sectors: z.array(z.string().max(100)).max(50).optional().default([])
    .transform(ids => ids.filter(id => SECTOR_IDS.has(id))),
  orgType: z.string().max(100).optional().default('')
    .transform(id => (ORG_TYPE_IDS.has(id) ? id : '')),
  previousFunders: z.string().max(5000).optional().default(''),
}).transform(input => {
  const regionIds = new Set(getMarket(input.market).regions.map(r => r.id));
  return { ...input, regions: input.regions.filter(id => regionIds.has(id)) };
});

/**
 * Lenient version of the search inputs. Used where saved inputs are replayed
 * (deep search context, saved-search snapshots) so older saved searches keep
 * working. Values are only ever used as prompt text, never in queries.
 */
export const orgContextSchema = z.object({
  searchTitle: z.string().max(500).optional(),
  website: z.string().max(2000),
  linkedin: z.string().max(2000).optional().default(''),
  fundingPurpose: z.string().max(5000),
  fundingAmount: z.number().min(0).max(100_000_000),
  market: z.string().max(20).optional().default('nz'),
  regions: z.array(z.string().max(100)).max(50).optional().default([]),
  sectors: z.array(z.string().max(100)).max(50).optional().default([]),
  orgType: z.string().max(100).optional().default(''),
  previousFunders: z.string().max(5000).optional().default(''),
});

// ─── Applications ───────────────────────────────────────────────────────────

export const applicationStatusSchema = z.enum([
  'preparing', 'submitted', 'under-review', 'approved', 'declined', 'withdrawn',
]);

/** IDs, status, history and timestamps are all assigned server-side. */
export const createApplicationSchema = z.object({
  grant: grantObjectSchema,
  searchTitle: z.string().max(500).optional().default(''),
});

/**
 * Partial update. A `status` change appends one history entry (with the
 * optional `note`) server-side; the client never sends the history array.
 * Amounts accept `null` to clear the value.
 */
export const updateApplicationSchema = z.object({
  grantId: grantId,
  status: applicationStatusSchema.optional(),
  note: z.string().max(5000).optional().default(''),
  notes: z.string().max(20000).optional(),
  amountRequested: money.nullable().optional(),
  amountAwarded: money.nullable().optional(),
});

// ─── Saved searches ─────────────────────────────────────────────────────────

/** SearchResult snapshot stored as JSONB in saved_searches.result_json. */
const searchResultSchema = z.object({
  grants: z.array(grantObjectSchema).max(5000),
  orgSummary: mediumText.optional().default(''),
  searchedAt: z.string().max(100),
  market: z.string().max(20),
  inputs: orgContextSchema.optional(),
});

export const createSavedSearchSchema = z.object({
  name: shortText,
  result: searchResultSchema,
});

export const updateSavedSearchSchema = z.object({
  id: entityId,
  result: searchResultSchema,
});

// ─── Shortlist ──────────────────────────────────────────────────────────────

export const createShortlistSchema = z.object({
  grant: grantObjectSchema,
  searchTitle: z.string().max(500).optional().default(''),
});

// ─── Documents ──────────────────────────────────────────────────────────────

/** Category slug: predefined ID or a slugified checklist item name. */
export const documentCategorySchema = z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/);

export const updateDocumentSchema = z.object({
  id: entityId,
  filename: z.string().trim().min(1).max(255).optional(),
  category: documentCategorySchema.optional(),
  notes: z.string().max(5000).optional(),
});

// ─── Checklist ──────────────────────────────────────────────────────────────

export const initChecklistSchema = z.object({
  grantId: grantId,
});

export const toggleChecklistSchema = z.object({
  id: entityId,
  checked: z.boolean(),
});

export const attachDocumentSchema = z.object({
  checklistItemId: entityId,
  documentId: entityId,
});

// ─── Deep search ────────────────────────────────────────────────────────────

export const deepSearchRequestSchema = z.object({
  grant: z.object({
    id: grantId,
    name: shortText,
    funder: shortText,
    url: z.string().max(2000),
    description: mediumText.optional().default(''),
    scores: scoresSchema,
    alignmentReason: mediumText.optional().default(''),
    applicationNotes: mediumText.optional().default(''),
    attainabilityNotes: mediumText.optional().default(''),
    amountMin: z.number().nullish(),
    amountMax: z.number().nullish(),
    deadline: z.string().max(100).nullish(),
  }),
  orgContext: orgContextSchema,
  market: z.string().max(20).optional().default('nz'),
});

// ─── Deep search results (model output → stored JSONB) ──────────────────────

/** Coerce a model-provided value to a trimmed, length-capped string (or undefined). */
const modelText = (max: number) =>
  z.unknown().transform(v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined));

/** Coerce a model-provided value to a sane non-negative amount (or undefined). */
const modelAmount = z.unknown().transform(v =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000_000_000 ? v : undefined,
);

/** Coerce a model-provided score to a number clamped to 0–10. */
const modelScore = z.unknown().transform(v =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 0,
);

/** Only keep http(s) links from model output — never javascript:, data:, etc. */
const modelUrl = z.unknown().transform(v => {
  if (typeof v !== 'string') return undefined;
  try {
    const { protocol } = new URL(v);
    return protocol === 'https:' || protocol === 'http:' ? v.slice(0, 2000) : undefined;
  } catch {
    return undefined;
  }
});

const modelScoreChange = z.object({
  old: modelScore,
  new: modelScore,
  reason: z.unknown().transform(v => (typeof v === 'string' ? v.slice(0, 2000) : '')),
});

/**
 * Sanitises the raw JSON returned by the deep-search model. Every field is
 * coerced or dropped rather than rejected, so one malformed field never loses
 * the whole (expensive) result.
 */
export const deepSearchModelOutputSchema = z.object({
  amountMin: modelAmount.optional(),
  amountMax: modelAmount.optional(),
  amountNotes: modelText(2000).optional(),

  applicationOpenDate: modelText(100).optional(),
  applicationCloseDate: modelText(100).optional(),
  dateNotes: modelText(2000).optional(),

  checklist: z.unknown().transform(v => {
    if (!Array.isArray(v)) return [];
    return v
      .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && typeof (i as Record<string, unknown>).item === 'string')
      .slice(0, 60)
      .map(i => ({
        item: (i.item as string).slice(0, 300),
        description: typeof i.description === 'string' ? i.description.slice(0, 2000) : '',
        required: i.required === true,
      }));
  }).optional().default([]),

  applicationFormUrl: modelUrl.optional(),
  applicationFormType: z.unknown().transform(v =>
    v === 'online' || v === 'pdf' || v === 'word' ? v : ('unknown' as const),
  ).optional(),
  applicationFormNotes: modelText(2000).optional(),

  eligibilityCriteria: z.unknown().transform(v =>
    Array.isArray(v)
      ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()).slice(0, 60).map(s => s.slice(0, 1000))
      : [],
  ).optional().default([]),

  scores: z.object({
    alignment: modelScore,
    ease: modelScore,
    attainability: modelScore,
  }).optional(),
  scoreChanges: z.object({
    alignment: modelScoreChange,
    ease: modelScoreChange,
    attainability: modelScoreChange,
  }).optional(),

  additionalInfo: modelText(5000).optional(),
  keyContacts: modelText(1000).optional(),
  pastRecipientNotes: modelText(5000).optional(),

  sourcesUsed: z.unknown().transform(v => {
    if (!Array.isArray(v)) return [];
    const sources: { url: string; title: string }[] = [];
    for (const s of v.slice(0, 30)) {
      if (!s || typeof s !== 'object') continue;
      const url = modelUrl.parse((s as Record<string, unknown>).url);
      if (!url) continue;
      const title = (s as Record<string, unknown>).title;
      sources.push({ url, title: typeof title === 'string' ? title.slice(0, 300) : '' });
    }
    return sources;
  }).optional().default([]),
});

// ─── Auth ───────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export const signupSchema = z.object({
  email: z.string().email().max(320),
  password,
  name: z.string().max(200).optional().default(''),
  orgName: z.string().trim().min(1).max(200),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  name: z.string().max(200).optional().default(''),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

// ─── Organisation ───────────────────────────────────────────────────────────

export const inviteEmailSchema = z.object({
  email: z.string().email().max(320),
});

export const updateOrgSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

export function parseOrError<T>(schema: z.ZodSchema<T>, data: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { error: result.error.issues.map(i => i.message).join(', ') };
  }
  return { data: result.data };
}
