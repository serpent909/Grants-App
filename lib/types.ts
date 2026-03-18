export interface OrgInfo {
  searchTitle?: string; // user-given name for this search, e.g. "Operational funding"
  website: string;
  linkedin: string;
  fundingPurpose: string;
  fundingAmount: number;
  market: string; // market ID: 'nz' | 'au' | ...
  regions: string[]; // region IDs the org operates in
  sectors: string[]; // e.g. ['health', 'youth']
  orgType: string; // e.g. 'registered-charity'
  previousFunders: string; // free text, optional
}

export interface GrantOpportunity {
  id: string;
  name: string;
  funder: string;
  type: 'Government' | 'Foundation' | 'Corporate' | 'Community' | 'International' | 'Other';
  description: string;
  amountMin?: number;
  amountMax?: number;
  deadline?: string;
  url: string;
  scores: {
    alignment: number;             // 0-10: how well grant matches org mission + request
    ease: number;                  // 0-10: higher = easier to apply
    attainability: number;         // 0-10: higher = more attainable (lower competition)
    overall: number;               // 0-10: weighted average
  };
  alignmentReason: string;
  applicationNotes: string;
  attainabilityNotes: string;
}

export interface SearchResult {
  grants: GrantOpportunity[];
  orgSummary: string;
  searchedAt: string;
  market: string; // echoed from request so results page can format currency/dates
  inputs?: OrgInfo; // original form inputs, saved for diagnostics and re-use
  diagnostics?: Record<string, {
    rawUrls: number;
    uniqueUrls: number;
    extractedUrls: number;
    grantsFound: number;
    grantsKept: number;
    avgScore: number | null;
  }>;
}

// ─── Deep Search ─────────────────────────────────────────────────────────────

export interface DeepSearchChecklistItem {
  item: string;        // e.g. "Project budget"
  description: string; // e.g. "A detailed line-item budget showing all project costs"
  required: boolean;   // true if explicitly stated as mandatory
}

export interface DeepSearchScoreChange {
  old: number;
  new: number;
  reason: string;
}

export interface DeepSearchResult {
  grantId: string;
  grantName: string;
  funder: string;
  grantUrl: string;
  searchedAt: string;

  // Financial
  amountMin?: number;
  amountMax?: number;
  amountNotes?: string;

  // Dates
  applicationOpenDate?: string;
  applicationCloseDate?: string;
  dateNotes?: string;

  // Application requirements
  checklist: DeepSearchChecklistItem[];
  applicationFormUrl?: string;
  applicationFormType?: 'online' | 'pdf' | 'word' | 'unknown';
  applicationFormNotes?: string;

  // Eligibility
  eligibilityCriteria: string[];

  // Recalibrated scores
  scores: {
    alignment: number;
    ease: number;
    attainability: number;
    overall: number;
  };
  scoreChanges: {
    alignment: DeepSearchScoreChange;
    ease: DeepSearchScoreChange;
    attainability: DeepSearchScoreChange;
  };

  // Additional discoveries
  additionalInfo?: string;
  keyContacts?: string;
  pastRecipientNotes?: string;
  sourcesUsed: { url: string; title: string }[];
}
