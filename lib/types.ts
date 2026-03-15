export interface OrgInfo {
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
    applicationDifficulty: number; // 0-10: higher = harder (more info required)
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
}
