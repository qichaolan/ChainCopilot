/**
 * Options Chain Utility Functions
 * Pure helper functions for data transformation and formatting
 */

import type { ExpirationType, OptionsContract, DisplayOption } from "./types";

// Cache TTL in milliseconds (5 minutes)
export const CACHE_TTL = 5 * 60 * 1000;

/**
 * Check if a cache entry is still valid
 */
export function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_TTL;
}

/**
 * Categorize expiration dates by type (weekly, monthly, quarterly, LEAPS)
 */
export function categorizeExpirations(dates: string[]): Record<ExpirationType, string[]> {
  const today = new Date();
  const eighteenMonthsFromNow = new Date(today);
  eighteenMonthsFromNow.setMonth(eighteenMonthsFromNow.getMonth() + 18);

  const categories: Record<ExpirationType, string[]> = {
    all: [...dates],
    weekly: [],
    monthly: [],
    quarterly: [],
    leaps: [],
  };

  for (const dateStr of dates) {
    const date = new Date(dateStr + "T00:00:00");
    const month = date.getMonth();
    const dayOfWeek = date.getDay();

    // LEAPS: > 18 months out
    if (date > eighteenMonthsFromNow) {
      categories.leaps.push(dateStr);
      continue;
    }

    // Quarterly: March (2), June (5), September (8), December (11) - third Friday
    const isQuarterlyMonth = [2, 5, 8, 11].includes(month);

    // Find third Friday of the month
    const firstDay = new Date(date.getFullYear(), month, 1);
    const firstFriday = 1 + ((5 - firstDay.getDay() + 7) % 7);
    const thirdFriday = firstFriday + 14;

    const isThirdFriday = date.getDate() === thirdFriday && dayOfWeek === 5;

    if (isQuarterlyMonth && isThirdFriday) {
      categories.quarterly.push(dateStr);
    } else if (isThirdFriday) {
      // Monthly: Third Friday of non-quarterly months
      categories.monthly.push(dateStr);
    } else {
      // Weekly: All other Fridays
      categories.weekly.push(dateStr);
    }
  }

  return categories;
}

/**
 * Transform raw API contracts to display format
 */
export function transformContracts(contracts: OptionsContract[]): {
  calls: DisplayOption[];
  puts: DisplayOption[];
} {
  const callContracts: DisplayOption[] = [];
  const putContracts: DisplayOption[] = [];

  for (const contract of contracts) {
    const displayOption: DisplayOption = {
      strike: contract.strike || 0,
      bid: contract.bid || 0,
      ask: contract.ask || 0,
      last: contract.last_price || 0,
      volume: contract.volume || 0,
      oi: contract.open_interest || 0,
      iv: contract.implied_volatility || 0,
      delta: contract.delta || 0,
      gamma: contract.gamma || 0,
      theta: contract.theta || 0,
      vega: contract.vega || 0,
    };

    if (contract.option_type === "call") {
      callContracts.push(displayOption);
    } else if (contract.option_type === "put") {
      putContracts.push(displayOption);
    }
  }

  // Sort by strike
  callContracts.sort((a, b) => a.strike - b.strike);
  putContracts.sort((a, b) => a.strike - b.strike);

  return { calls: callContracts, puts: putContracts };
}

/**
 * Format date for dropdown display
 */
export function formatDropdownDate(dateStr: string, includeYear: boolean = false): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: includeYear ? "numeric" : undefined,
  });
}

/**
 * Check if a strike is in-the-money
 */
export function isITM(strike: number, type: "call" | "put", underlyingPrice: number): boolean {
  if (type === "call") return strike < underlyingPrice;
  return strike > underlyingPrice;
}

/**
 * Get moneyness label for a contract
 */
export function getMoneyness(
  strike: number,
  type: "call" | "put",
  atmStrike: number | null,
  underlyingPrice: number
): "ITM" | "ATM" | "OTM" {
  if (atmStrike !== null && strike === atmStrike) return "ATM";
  if (type === "call") return strike < underlyingPrice ? "ITM" : "OTM";
  return strike > underlyingPrice ? "ITM" : "OTM";
}

/**
 * Find ATM strike index (closest to underlying price)
 */
export function findATMIndex(strikes: number[], underlyingPrice: number): number {
  if (strikes.length === 0) return 0;

  let atmIndex = 0;
  let minDiff = Infinity;

  strikes.forEach((strike, idx) => {
    const diff = Math.abs(strike - underlyingPrice);
    if (diff < minDiff) {
      minDiff = diff;
      atmIndex = idx;
    }
  });

  return atmIndex;
}

/**
 * Compute strike step from array of strikes
 * Returns the mode of deltas, or "mixed" if irregular
 */
export function computeStrikeStep(strikes: number[]): number | "mixed" {
  if (strikes.length <= 1) return 1;

  const deltas: number[] = [];
  for (let i = 1; i < strikes.length; i++) {
    deltas.push(Math.round((strikes[i] - strikes[i - 1]) * 100) / 100);
  }

  // Find mode of deltas
  const deltaCount = new Map<number, number>();
  for (const d of deltas) {
    deltaCount.set(d, (deltaCount.get(d) || 0) + 1);
  }

  let modeCount = 0;
  let modeValue = deltas[0];
  for (const [d, count] of deltaCount) {
    if (count > modeCount) {
      modeCount = count;
      modeValue = d;
    }
  }

  // If mode covers less than 80% of deltas, mark as mixed
  return modeCount / deltas.length >= 0.8 ? modeValue : "mixed";
}
