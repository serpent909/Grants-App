import { MarketConfig } from './types';

export const AU_MARKET: MarketConfig = {
  id: 'au',
  displayName: 'Australia',
  country: 'Australia',
  currency: 'AUD',
  currencySymbol: '$',
  locale: 'en-AU',

  funderTypeHints: [
    'Federal government grant programs',
    'State and territory government grants',
    'Local municipal / shire council community grants (list every council individually)',
    'Community foundations and philanthropic trusts',
    'Corporate and bank community foundations',
    'Health and medical research funds',
    'Arts, sport, environment, and sector-specific funds',
  ],

  grantDirectories: [
    'https://www.grants.gov.au',
    'https://www.philanthropy.org.au/grants',
    'https://www.australiancf.org.au/grants',
    'https://www.ourcommunity.com.au/grants',
  ],

  seedQueryTemplates: [
    '{country} community grants apply "{purpose}" non-profit {year}',
    '{country} government grants not-for-profit community {year}',
    '{country} philanthropic foundation grants apply {year}',
    'site:grants.gov.au community grants open {year}',
    '{country} local council community grants apply {year}',
    '{country} corporate foundation community grants {year}',
  ],

  excludedDomains: [
    'smh.com.au', 'theage.com.au', 'abc.net.au', 'news.com.au',
    'guardian.com', 'afr.com', 'crikey.com.au',
    'wikipedia.org', 'wikimedia.org', 'linkedin.com', 'facebook.com',
    'twitter.com', 'instagram.com', 'youtube.com', 'reddit.com',
  ],

  // No pre-curated pages — Step 0 dynamic discovery handles this for AU
  curatedPages: [],
};
