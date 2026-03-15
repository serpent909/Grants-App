export interface MarketConfig {
  /** Unique identifier used as form value and API parameter */
  id: string;

  /** Human-readable name shown in the UI dropdown */
  displayName: string;

  /** Country name as it appears in prompts: "New Zealand", "Australia" */
  country: string;

  /** ISO 4217 currency code */
  currency: string;

  /** Currency symbol for UI display */
  currencySymbol: string;

  /** BCP-47 locale for date/number formatting: 'en-NZ', 'en-AU', 'en-GB' */
  locale: string;

  /**
   * Broad funder category labels for this country.
   * Used to structure GPT's funder enumeration — tells GPT which categories
   * to cover exhaustively. Do NOT list individual funder names here.
   */
  funderTypeHints: string[];

  /**
   * Explicit grouping of funderTypeHints into parallel enumeration calls.
   * Each inner array is sent as its own GPT call, allowing heavy categories
   * (e.g. local councils) to get their own dedicated token budget.
   */
  funderTypeGroups: string[][];

  /**
   * Grant directory / aggregator pages for this country.
   * Used in Step 0: extracted to harvest funder URLs, and searched via site: queries.
   * These are the "fundinginformation.org.nz equivalents".
   */
  grantDirectories: string[];

  /**
   * Curated list of known grant funder pages to extract.
   * These bypass search — guaranteed to be included when relevant.
   * `regions` omitted = national (always included).
   * `regions` present = only included when user selects a matching region.
   * Cost: ~1 Tavily credit per URL ($0.008 each).
   */
  curatedFunderUrls: { url: string; regions?: string[] }[];

  /**
   * Tavily search query templates providing country-specific breadth.
   * Interpolated at runtime with: {country}, {purpose}, {year}, {currency}.
   * Keep to 4–7 templates.
   */
  seedQueryTemplates: string[];

  /**
   * Domains to exclude from grant page extraction.
   * Add national news sites, social platforms, press release portals —
   * anything that appears in search results but never has grant listings.
   */
  excludedDomains: string[];

  /**
   * Selectable geographic regions for this market.
   * Users pick their operating region(s) — the pipeline uses these to target
   * local/regional funders while still including national-level grants.
   */
  regions: { id: string; name: string }[];
}
