import { z } from 'zod';

// ─── Reusable primitives ────────────────────────────────────────────────────

const grantId = z.string().min(1).max(100);
const entityId = z.string().min(1).max(100);
const shortText = z.string().max(500);
const mediumText = z.string().max(5000);
const longText = z.string().max(50000);
const url = z.string().url().max(2000);
const optionalUrl = z.string().max(2000).optional();
const isoDate = z.string().max(100).optional();
const score = z.number().min(0).max(10);

const scoresSchema = z.object({
  alignment: score,
  ease: score,
  attainability: score,
  overall: score,
});

// ─── Grant object (stored as JSONB in shortlist / applications) ─────────────

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
}).passthrough(); // allow extra fields from AI scoring without breaking

// ─── Applications ───────────────────────────────────────────────────────────

const applicationStatus = z.enum([
  'preparing', 'submitted', 'under-review', 'approved', 'declined', 'withdrawn',
]);

const statusEntry = z.object({
  status: applicationStatus,
  note: z.string().max(5000),
  updatedAt: z.string().max(100),
});

export const createApplicationSchema = z.object({
  id: entityId,
  grantId: grantId,
  grant: grantObjectSchema,
  searchTitle: z.string().max(500).optional().default(''),
  status: applicationStatus,
  statusHistory: z.array(statusEntry).max(200),
  notes: z.string().max(20000).optional().default(''),
  startedAt: z.string().max(100),
});

export const updateApplicationSchema = z.object({
  grantId: grantId,
  status: applicationStatus.optional(),
  statusHistory: z.array(statusEntry).max(200).optional(),
  notes: z.string().max(20000).optional(),
  submittedAt: isoDate,
  decidedAt: isoDate,
  amountRequested: z.number().optional(),
  amountAwarded: z.number().optional(),
});

// ─── Saved searches ─────────────────────────────────────────────────────────

export const createSavedSearchSchema = z.object({
  id: entityId,
  name: shortText,
  savedAt: z.string().max(100),
  grantCount: z.number().int().min(0).max(10000),
  orgSummary: mediumText.optional().default(''),
  market: z.string().max(20),
  result: z.record(z.string(), z.unknown()), // SearchResult JSONB — validated loosely
});

export const updateSavedSearchSchema = z.object({
  id: entityId,
  grantCount: z.number().int().min(0).max(10000),
  orgSummary: mediumText.optional().default(''),
  result: z.record(z.string(), z.unknown()),
});

// ─── Shortlist ──────────────────────────────────────────────────────────────

export const createShortlistSchema = z.object({
  grant: grantObjectSchema,
  searchTitle: z.string().max(500).optional().default(''),
});

// ─── Documents ──────────────────────────────────────────────────────────────

export const createDocumentSchema = z.object({
  id: entityId,
  filename: shortText,
  blobUrl: z.string().max(2000),
  contentType: z.string().max(200),
  sizeBytes: z.number().int().min(0).max(50_000_000),
  category: z.string().max(100).optional().default('other'),
  notes: z.string().max(5000).optional().default(''),
});

export const updateDocumentSchema = z.object({
  id: entityId,
  filename: shortText.optional(),
  category: z.string().max(100).optional(),
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

// ─── Search (main grant search) ─────────────────────────────────────────────

export const searchSchema = z.object({
  searchTitle: z.string().max(500).optional(),
  website: z.string().max(2000),
  linkedin: z.string().max(2000).optional().default(''),
  fundingPurpose: z.string().min(1).max(5000),
  fundingAmount: z.number().positive().max(100_000_000),
  market: z.string().max(20).optional().default('nz'),
  regions: z.array(z.string().max(100)).max(50).optional().default([]),
  sectors: z.array(z.string().max(100)).max(50).optional().default([]),
  orgType: z.string().max(100).optional().default(''),
  previousFunders: z.string().max(5000).optional().default(''),
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
  orgContext: searchSchema,
  market: z.string().max(20).optional().default('nz'),
});

// ─── Deep search results (stored JSONB) ─────────────────────────────────────

export const deepSearchResultSchema = z.object({
  grantId: grantId,
  grantName: shortText,
  funder: shortText,
  grantUrl: z.string().max(2000),
  searchedAt: z.string().max(100),
}).passthrough(); // allow the many optional fields without enumerating all

// ─── Auth ───────────────────────────────────────────────────────────────────

export const signupSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  name: z.string().max(200).optional().default(''),
  orgName: z.string().min(1).max(200),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  name: z.string().max(200).optional().default(''),
  password: z.string().min(8).max(200),
});

// ─── Organisation ───────────────────────────────────────────────────────────

export const inviteEmailSchema = z.object({
  email: z.string().email().max(320),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

export function parseOrError<T>(schema: z.ZodSchema<T>, data: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { error: result.error.issues.map(i => i.message).join(', ') };
  }
  return { data: result.data };
}
