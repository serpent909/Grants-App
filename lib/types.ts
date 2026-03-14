export interface OrgInfo {
  website: string;
  linkedin: string;
  fundingPurpose: string;
  fundingAmount: number;
  market: string; // market ID: 'nz' | 'au' | ...
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
}
