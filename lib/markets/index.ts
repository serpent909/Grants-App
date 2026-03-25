import { MarketConfig } from './types';
import { NZ_MARKET } from './nz';

export type { MarketConfig } from './types';

const MARKETS: Record<string, MarketConfig> = {
  nz: NZ_MARKET,
};

export function getMarket(id: string): MarketConfig {
  const market = MARKETS[id];
  if (!market) {
    console.warn(`[GrantSearch] Unknown market "${id}", falling back to NZ`);
    return NZ_MARKET;
  }
  return market;
}

export function listMarkets(): MarketConfig[] {
  return Object.values(MARKETS);
}

export { NZ_MARKET };
