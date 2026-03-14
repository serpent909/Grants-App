import { MarketConfig } from './types';
import { CURATED_GRANT_PAGES } from '../nz-grant-sources';

export const NZ_MARKET: MarketConfig = {
  id: 'nz',
  displayName: 'New Zealand',
  country: 'New Zealand',
  currency: 'NZD',
  currencySymbol: '$',
  locale: 'en-NZ',

  funderTypeHints: [
    'Gaming / pub charity trusts',
    'Regional community foundations and trusts',
    'Government lottery and DIA-administered funds',
    'Other central government grant programs',
    'Territorial authority / district council community grants (list every council individually)',
    'Health and medical research foundations',
    'Private and family philanthropic foundations',
    'Corporate and bank community foundations',
    'Arts, sport, environment, and sector-specific funds',
  ],

  grantDirectories: [
    'https://www.fundinginformation.org.nz',
    'https://www.communitymatters.govt.nz/our-funding',
    'https://generositynz.org.nz/apply',
  ],

  seedQueryTemplates: [
    '{country} grants apply "{purpose}" non-profit {year}',
    '{country} community charitable trust grants {year} apply',
    '{country} local council community grants apply {year}',
    'site:communitymatters.govt.nz lottery grants apply',
    '{country} corporate foundation community grants apply {year}',
    '{country} government grants not-for-profit {year}',
  ],

  excludedDomains: [
    'nzherald.co.nz', 'stuff.co.nz', 'rnz.co.nz', 'scoop.co.nz',
    'newshub.co.nz', 'tvnz.co.nz', 'beehive.govt.nz',
    'wikipedia.org', 'wikimedia.org', 'linkedin.com', 'facebook.com',
    'twitter.com', 'instagram.com', 'youtube.com', 'reddit.com',
  ],

  // All 173 pre-researched NZ grant pages — guaranteed coverage of known funders
  curatedPages: CURATED_GRANT_PAGES,
};
