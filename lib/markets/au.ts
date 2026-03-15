import { MarketConfig } from './types';

export const AU_MARKET: MarketConfig = {
  id: 'au',
  displayName: 'Australia',
  country: 'Australia',
  currency: 'AUD',
  currencySymbol: '$',
  locale: 'en-AU',

  funderTypeHints: [
    'Local and city councils, district and regional authorities — list EVERY individual council by its full official name',
    'National government ministries, departments, and statutory grant-making agencies',
    'Government-funded agencies and Crown entities with community grant programmes',
    'International government and multilateral bodies (UN agencies, EU funds, World Bank NGO windows, USAID, bilateral foreign aid)',
    'National lottery distributors and gaming/TAB-related community trust grant programmes',
    'Community foundations and regional endowment funds (pooled local philanthropy)',
    'Private and family philanthropic foundations',
    'Corporate foundations (philanthropic arms of major companies)',
    'Charitable trusts with specific mandated purposes (health, education, environment, sport, arts, housing, etc.)',
    'Corporate CSR and community investment programmes (non-foundation, direct company giving)',
    'Industry associations and trade bodies with community or social good grant funds',
    'Faith-based, church, and religious denominational charitable funds and community trusts',
    'Federated and workplace giving programmes that distribute pooled donations as grants (e.g. United Way)',
    'Ethnic, cultural, and diaspora community associations with grant programmes',
    'Neighbourhood, community development, and resident association small grants',
    'Large international NGOs and development organisations that sub-grant to local nonprofits (e.g. Oxfam, CARE, Save the Children)',
    'Global thematic funds with NGO grant windows (Global Fund, Green Climate Fund, food security, global health funds)',
    'University and research institution community partnership grants (where nonprofits can be lead or co-applicant)',
    'Social enterprise support programmes, accelerators, and incubators with non-returnable grant components',
  ],

  funderTypeGroups: [
    // Group 1: Local Councils — own call; Australia has ~550 local councils
    [
      'Local and city councils, district and regional authorities — list EVERY individual council by its full official name',
    ],
    // Group 2: Government & Lottery
    [
      'National government ministries, departments, and statutory grant-making agencies',
      'Government-funded agencies and Crown entities with community grant programmes',
      'National lottery distributors and gaming/TAB-related community trust grant programmes',
    ],
    // Group 3: Foundations & Trusts
    [
      'Community foundations and regional endowment funds (pooled local philanthropy)',
      'Private and family philanthropic foundations',
      'Corporate foundations (philanthropic arms of major companies)',
      'Charitable trusts with specific mandated purposes (health, education, environment, sport, arts, housing, etc.)',
    ],
    // Group 4: Corporate & Industry
    [
      'Corporate CSR and community investment programmes (non-foundation, direct company giving)',
      'Industry associations and trade bodies with community or social good grant funds',
      'Faith-based, church, and religious denominational charitable funds and community trusts',
    ],
    // Group 5: Community & Cultural
    [
      'Federated and workplace giving programmes that distribute pooled donations as grants (e.g. United Way)',
      'Ethnic, cultural, and diaspora community associations with grant programmes',
      'Neighbourhood, community development, and resident association small grants',
    ],
    // Group 6: International
    [
      'International government and multilateral bodies (UN agencies, EU funds, World Bank NGO windows, USAID, bilateral foreign aid)',
      'Large international NGOs and development organisations that sub-grant to local nonprofits (e.g. Oxfam, CARE, Save the Children)',
      'Global thematic funds with NGO grant windows (Global Fund, Green Climate Fund, food security, global health funds)',
    ],
    // Group 7: Research & Social Enterprise
    [
      'University and research institution community partnership grants (where nonprofits can be lead or co-applicant)',
      'Social enterprise support programmes, accelerators, and incubators with non-returnable grant components',
    ],
  ],

  grantDirectories: [
    'https://www.grants.gov.au',
    'https://www.philanthropy.org.au/grants',
    'https://www.australiancf.org.au/grants',
    'https://www.ourcommunity.com.au/grants',
  ],

  curatedFunderUrls: [],  // TODO: populate with AU grant funder URLs

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

  regions: [
    { id: 'nsw', name: 'New South Wales' },
    { id: 'vic', name: 'Victoria' },
    { id: 'qld', name: 'Queensland' },
    { id: 'wa', name: 'Western Australia' },
    { id: 'sa', name: 'South Australia' },
    { id: 'tas', name: 'Tasmania' },
    { id: 'act', name: 'Australian Capital Territory' },
    { id: 'nt', name: 'Northern Territory' },
  ],
};
