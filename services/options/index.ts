/**
 * Options Data Services
 *
 * Backend services for options data management.
 * Connects to OpenBB and other data providers.
 */

import { fetchOptionsChain, OptionsChain, OptionsContract } from '@/lib/openbb';

/**
 * Options Service - handles data fetching and caching
 */
export class OptionsService {
  private cache: Map<string, { data: OptionsChain; timestamp: number }> = new Map();
  private cacheTTL: number;

  constructor(cacheTTL: number = 60000) { // Default 60 second cache
    this.cacheTTL = cacheTTL;
  }

  /**
   * Get options chain with caching
   */
  async getOptionsChain(symbol: string): Promise<OptionsChain | null> {
    const cacheKey = symbol.toUpperCase();
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const data = await fetchOptionsChain(symbol);

    if (data) {
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
    }

    return data;
  }

  /**
   * Filter contracts by expiration
   */
  filterByExpiration(chain: OptionsChain, expiration: string): OptionsContract[] {
    return chain.contracts.filter(c => c.expiration === expiration);
  }

  /**
   * Get unique expirations from chain
   */
  getExpirations(chain: OptionsChain): string[] {
    return [...new Set(chain.contracts.map(c => c.expiration))].sort();
  }

  /**
   * Calculate put/call ratio
   */
  getPutCallRatio(chain: OptionsChain): number {
    const calls = chain.contracts.filter(c => c.type === 'call');
    const puts = chain.contracts.filter(c => c.type === 'put');

    const callVolume = calls.reduce((sum, c) => sum + c.volume, 0);
    const putVolume = puts.reduce((sum, c) => sum + c.volume, 0);

    return callVolume > 0 ? putVolume / callVolume : 0;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const optionsService = new OptionsService();

// Re-export types
export type { OptionsChain, OptionsContract } from '@/lib/openbb';
