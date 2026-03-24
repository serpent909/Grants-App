// ─── Predefined Categories ─────────────────────────────────────────────────

export interface CategoryDef {
  id: string;
  label: string;
  group: string;
}

export const DOCUMENT_CATEGORIES: CategoryDef[] = [
  // Financial
  { id: 'project-budget',        label: 'Project Budget',              group: 'Financial' },
  { id: 'financial-statements',  label: 'Financial Statements',        group: 'Financial' },
  { id: 'bank-verification',     label: 'Bank Verification',           group: 'Financial' },
  { id: 'quotes-estimates',      label: 'Quotes & Estimates',          group: 'Financial' },
  // Governance
  { id: 'constitution',          label: 'Constitution / Trust Deed',   group: 'Governance' },
  { id: 'registration',          label: 'Registration / Legal Status', group: 'Governance' },
  { id: 'governance-docs',       label: 'Governance Documents',        group: 'Governance' },
  // Project
  { id: 'project-plan',          label: 'Project Plan / Proposal',     group: 'Project' },
  { id: 'timeline',              label: 'Timeline / Work Plan',        group: 'Project' },
  { id: 'outcomes',              label: 'Outcomes / Evaluation',       group: 'Project' },
  // Supporting
  { id: 'letters-of-support',    label: 'Letters of Support',          group: 'Supporting' },
  { id: 'references',            label: 'References',                  group: 'Supporting' },
  { id: 'annual-report',         label: 'Annual Report',               group: 'Supporting' },
  { id: 'org-profile',           label: 'Organisation Profile',        group: 'Supporting' },
  // Other
  { id: 'photos-media',          label: 'Photos & Media',              group: 'Other' },
  { id: 'other',                 label: 'Other',                       group: 'Other' },
];

// Type is string to support dynamic categories from unmatched checklist items
export type DocumentCategory = string;

// Ordered group names for UI rendering
export const CATEGORY_GROUP_ORDER = ['Financial', 'Governance', 'Project', 'Supporting', 'Other'] as const;

export interface CategoryGroup {
  group: string;
  categories: CategoryDef[];
}

export const CATEGORY_GROUPS: CategoryGroup[] = CATEGORY_GROUP_ORDER.map(group => ({
  group,
  categories: DOCUMENT_CATEGORIES.filter(c => c.group === group),
}));

// Fast lookup set for predefined category IDs
const PREDEFINED_IDS = new Set(DOCUMENT_CATEGORIES.map(c => c.id));

export function isPredefinedCategory(id: string): boolean {
  return PREDEFINED_IDS.has(id);
}

// ─── Legacy Migration Map ──────────────────────────────────────────────────

const LEGACY_CATEGORY_MAP: Record<string, string> = {
  financial:    'financial-statements',
  governance:   'constitution',
  // 'references' stays the same
  // 'registration' stays the same
  project:      'project-plan',
  reports:      'annual-report',
  identity:     'photos-media',
  // 'other' stays the same
};

/** Resolve a category ID, mapping legacy IDs to new ones */
export function resolveCategory(id: string): string {
  return LEGACY_CATEGORY_MAP[id] ?? id;
}

// ─── Category Label Helpers ────────────────────────────────────────────────

/** Get display label for any category ID (predefined or dynamic) */
export function getCategoryLabel(id: string): string {
  const resolved = resolveCategory(id);
  const found = DOCUMENT_CATEGORIES.find(c => c.id === resolved);
  if (found) return found.label;
  // Dynamic category: convert slug to title case
  return resolved
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Get group name for a category ID */
export function getCategoryGroup(id: string): string {
  const resolved = resolveCategory(id);
  const found = DOCUMENT_CATEGORIES.find(c => c.id === resolved);
  return found?.group ?? 'Custom';
}

// ─── Checklist-to-Category Mapping ─────────────────────────────────────────

/**
 * Explicit map from normalized checklist item names to predefined category IDs.
 * Covers common variations used by NZ grant funders.
 */
const CHECKLIST_NAME_MAP: Record<string, string> = {
  // Project Budget
  'project budget':                     'project-budget',
  'detailed budget':                    'project-budget',
  'budget breakdown':                   'project-budget',
  'budget':                             'project-budget',
  'line-item budget':                   'project-budget',
  'cost breakdown':                     'project-budget',
  'funding budget':                     'project-budget',
  'itemised budget':                    'project-budget',
  'itemized budget':                    'project-budget',
  'expenditure budget':                 'project-budget',

  // Financial Statements
  'financial accounts':                 'financial-statements',
  'financial statements':               'financial-statements',
  'audited accounts':                   'financial-statements',
  'audited financial statements':       'financial-statements',
  'annual accounts':                    'financial-statements',
  'profit and loss':                    'financial-statements',
  'profit and loss statement':          'financial-statements',
  'balance sheet':                      'financial-statements',
  'statement of financial performance': 'financial-statements',
  'statement of financial position':    'financial-statements',
  'income and expenditure':             'financial-statements',
  'financial report':                   'financial-statements',
  'financial summary':                  'financial-statements',

  // Bank Verification
  'bank deposit slip':                  'bank-verification',
  'bank statement':                     'bank-verification',
  'bank account details':               'bank-verification',
  'bank account verification':          'bank-verification',
  'bank account':                       'bank-verification',
  'proof of bank account':              'bank-verification',
  'bank confirmation':                  'bank-verification',

  // Quotes & Estimates
  'quotes':                             'quotes-estimates',
  'quotations':                         'quotes-estimates',
  'cost estimates':                     'quotes-estimates',
  'tenders':                            'quotes-estimates',
  'supplier quotes':                    'quotes-estimates',

  // Constitution / Trust Deed
  'constitution':                       'constitution',
  'trust deed':                         'constitution',
  'constitution or trust deed':         'constitution',
  'rules of incorporation':             'constitution',
  'governing document':                 'constitution',
  'articles of association':            'constitution',
  'deed of trust':                      'constitution',
  'bylaws':                             'constitution',
  'charter':                            'constitution',
  'rules':                              'constitution',
  'society rules':                      'constitution',
  'incorporated society rules':         'constitution',

  // Registration / Legal Status
  'certificate of incorporation':       'registration',
  'charity registration':               'registration',
  'charities services registration':    'registration',
  'ird letter':                         'registration',
  'tax exempt status':                  'registration',
  'proof of legal status':              'registration',
  'registration certificate':           'registration',
  'certificate of registration':        'registration',
  'tax exemption certificate':          'registration',
  'donee status':                       'registration',
  'ird donee status':                   'registration',
  'legal status':                       'registration',

  // Governance Documents
  'board minutes':                      'governance-docs',
  'governance documents':               'governance-docs',
  'governance policies':                'governance-docs',
  'conflict of interest policy':        'governance-docs',
  'strategic plan':                     'governance-docs',
  'list of board members':              'governance-docs',
  'board member details':               'governance-docs',
  'trustee details':                    'governance-docs',
  'committee members':                  'governance-docs',
  'governance structure':               'governance-docs',

  // Project Plan / Proposal
  'project plan':                       'project-plan',
  'project outline':                    'project-plan',
  'project description':                'project-plan',
  'project proposal':                   'project-plan',
  'proposal':                           'project-plan',
  'project overview':                   'project-plan',
  'methodology':                        'project-plan',
  'project summary':                    'project-plan',
  'programme outline':                  'project-plan',
  'programme description':              'project-plan',
  'project details':                    'project-plan',

  // Timeline / Work Plan
  'timeline':                           'timeline',
  'project timeline':                   'timeline',
  'milestones':                         'timeline',
  'work plan':                          'timeline',
  'gantt chart':                        'timeline',
  'implementation plan':                'timeline',
  'implementation timeline':            'timeline',
  'project schedule':                   'timeline',

  // Outcomes / Evaluation
  'outcomes framework':                 'outcomes',
  'logic model':                        'outcomes',
  'theory of change':                   'outcomes',
  'evaluation plan':                    'outcomes',
  'monitoring and evaluation':          'outcomes',
  'outcomes':                           'outcomes',
  'impact measurement':                 'outcomes',
  'kpis':                               'outcomes',
  'key performance indicators':         'outcomes',
  'outcome measures':                   'outcomes',

  // Letters of Support
  'letters of support':                 'letters-of-support',
  'letter of support':                  'letters-of-support',
  'support letters':                    'letters-of-support',
  'community support letters':          'letters-of-support',
  'partner letters':                    'letters-of-support',
  'endorsement letter':                 'letters-of-support',
  'endorsement letters':                'letters-of-support',
  'endorsement':                        'letters-of-support',
  'collaboration letter':               'letters-of-support',

  // References
  'character references':               'references',
  'references':                         'references',
  'referee details':                    'references',
  'testimonials':                       'references',
  'recommendations':                    'references',
  'recommendation letter':              'references',
  'reference letters':                  'references',

  // Annual Report
  'annual report':                      'annual-report',
  'impact report':                      'annual-report',
  'accountability report':              'annual-report',
  'progress report':                    'annual-report',
  'year in review':                     'annual-report',
  'annual review':                      'annual-report',

  // Organisation Profile
  'organisation profile':               'org-profile',
  'organization profile':               'org-profile',
  'organisation overview':              'org-profile',
  'organization overview':              'org-profile',
  'about us':                           'org-profile',
  'mission statement':                  'org-profile',
  'org background':                     'org-profile',
  'organisation description':           'org-profile',
  'organisation summary':               'org-profile',

  // Photos & Media
  'photos':                             'photos-media',
  'logo':                               'photos-media',
  'images':                             'photos-media',
  'media':                              'photos-media',
  'branding':                           'photos-media',
  'photographs':                        'photos-media',
  'project photos':                     'photos-media',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Map a checklist item name to a category.
 * 1. Exact match in CHECKLIST_NAME_MAP
 * 2. Partial match (longest key that the input contains, or longest key that contains the input)
 * 3. Fallback: slugify the item name as a dynamic category
 */
export function mapChecklistToCategory(checklistItemName: string): string {
  const normalized = checklistItemName.toLowerCase().trim();
  if (!normalized) return 'other';

  // 1. Exact match
  if (CHECKLIST_NAME_MAP[normalized]) {
    return CHECKLIST_NAME_MAP[normalized];
  }

  // 2. Partial match — find the longest matching key
  let bestMatch = '';
  let bestCategory = '';
  for (const [key, cat] of Object.entries(CHECKLIST_NAME_MAP)) {
    if (key.length > bestMatch.length) {
      if (normalized.includes(key) || key.includes(normalized)) {
        bestMatch = key;
        bestCategory = cat;
      }
    }
  }
  if (bestCategory) return bestCategory;

  // 3. No match — create dynamic category from item name
  return slugify(checklistItemName);
}
