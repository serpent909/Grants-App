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
   * Keep to 6-10 short labels.
   */
  funderTypeHints: string[];

  /**
   * Grant directory / aggregator pages for this country.
   * Used in Step 0: extracted to harvest funder URLs, and searched via site: queries.
   * Keep to 3–6 URLs. These are the "fundinginformation.org.nz equivalents".
   */
  grantDirectories: string[];

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
   * Pre-known grant page URLs for this market.
   * NZ: the existing 173-URL curated list (guaranteed coverage of known funders).
   * New markets: start empty — Step 0 dynamic discovery fills this role.
   */
  curatedPages?: string[];
}
