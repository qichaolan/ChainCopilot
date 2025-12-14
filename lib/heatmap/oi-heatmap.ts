/**
 * Open Interest Heatmap Calculations
 *
 * Provides data transformation for OI heatmap visualization:
 * - Calls OI, Puts OI, Net OI (Calls - Puts)
 * - Strike range filtering (±10%, ±20%, ±30%, all)
 * - Expiration grouping (short-term, monthly, all)
 * - Value calculation: OI * mid price
 */

export type OIViewType = "calls" | "puts" | "net";
export type StrikeRangeType = "10" | "20" | "30" | "all";
export type ExpirationGroupType = "short" | "weekly" | "monthly" | "leaps" | "all";

// Maximum P/C ratio before clamping (indicates extreme put-heavy)
export const MAX_PC_RATIO = 99;

export interface OptionContract {
  strike: number;
  expiration: string;
  optionType: "call" | "put";
  bid: number;
  ask: number;
  oi: number;
  volume: number;
  iv: number;
}

export interface HeatmapCell {
  expiration: string;
  strike: number;
  callOI: number;
  putOI: number;
  netOI: number; // calls - puts
  callValue: number; // callOI * mid
  putValue: number;  // putOI * mid
  netValue: number;  // callValue - putValue
  callMid: number;
  putMid: number;
  putCallRatio: number | null;
  pctOfExpTotal: number; // % of total OI for that expiration
  hasData: boolean;
}

export interface HeatmapData {
  expirations: string[]; // x-axis
  strikes: number[];     // y-axis
  cells: Map<string, HeatmapCell>; // key: "expiration|strike"
  minValue: number;
  maxValue: number;
  totalOI: number;
}

export interface HeatmapConfig {
  viewType: OIViewType;
  strikeRange: StrikeRangeType;
  expirationGroup: ExpirationGroupType;
  underlyingPrice: number;
}

/**
 * Generate a unique key for a heatmap cell
 */
export function cellKey(expiration: string, strike: number): string {
  return `${expiration}|${strike}`;
}

/**
 * Parse a cell key back to expiration and strike
 */
export function parseKey(key: string): { expiration: string; strike: number } {
  const [expiration, strikeStr] = key.split("|");
  return { expiration, strike: parseFloat(strikeStr) };
}

/**
 * Filter strikes based on percentage range around underlying price
 */
export function filterStrikes(
  strikes: number[],
  underlyingPrice: number,
  rangeType: StrikeRangeType
): number[] {
  if (rangeType === "all") return strikes;

  const pct = parseInt(rangeType) / 100;
  const minStrike = underlyingPrice * (1 - pct);
  const maxStrike = underlyingPrice * (1 + pct);

  return strikes.filter(s => s >= minStrike && s <= maxStrike);
}

/**
 * Get valid mid price from bid/ask, returning null for invalid quotes
 * Handles: both zero, crossed market (ask < bid), single-side quotes
 */
function getValidMid(bid: number, ask: number): number | null {
  // Invalid: both zero
  if (bid === 0 && ask === 0) return null;
  // Invalid: ask < bid (crossed market)
  if (ask > 0 && bid > 0 && ask < bid) return null;
  // If only one side is valid, use it
  if (bid === 0) return ask;
  if (ask === 0) return bid;
  // Normal mid
  return (bid + ask) / 2;
}

/**
 * Parse a date string (YYYY-MM-DD) to UTC midnight timestamp
 * Avoids timezone/DST issues by using UTC
 */
function parseExpDateUTC(exp: string): Date {
  // Parse as UTC to avoid timezone issues
  return new Date(exp + "T00:00:00Z");
}

/**
 * Get today's date at UTC midnight
 */
function getTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Check if a date is a Friday (using UTC)
 */
function isFriday(date: Date): boolean {
  return date.getUTCDay() === 5;
}

/**
 * Get the 3rd Friday of a given month (OPEX date) in UTC
 */
function getThirdFriday(year: number, month: number): number {
  // Start at the 1st of the month in UTC
  const firstDay = new Date(Date.UTC(year, month, 1));
  // Find the first Friday (day of week where Friday = 5)
  const firstFriday = 1 + ((5 - firstDay.getUTCDay() + 7) % 7);
  // Third Friday is 14 days after the first Friday
  return firstFriday + 14;
}

/**
 * Check if a date is an OPEX date (3rd Friday of the month)
 */
function isOPEX(date: Date): boolean {
  if (!isFriday(date)) return false;
  const thirdFridayDay = getThirdFriday(date.getUTCFullYear(), date.getUTCMonth());
  return date.getUTCDate() === thirdFridayDay;
}

/**
 * Filter expirations based on grouping type
 */
export function filterExpirations(
  expirations: string[],
  groupType: ExpirationGroupType
): string[] {
  const sorted = [...expirations].sort();
  const today = getTodayUTC();

  // Filter to future dates only (using UTC parsing)
  const future = sorted.filter(exp => parseExpDateUTC(exp) >= today);

  switch (groupType) {
    case "short":
      // Next 10 future expiration dates
      return future.slice(0, 10);

    case "weekly": {
      // All future Fridays (weekly expirations)
      const fridays: string[] = [];
      for (const exp of future) {
        const date = parseExpDateUTC(exp);
        if (isFriday(date)) {
          fridays.push(exp);
        }
      }
      return fridays;
    }

    case "monthly": {
      // All future OPEX dates (3rd Friday of each month)
      const opexDates: string[] = [];
      for (const exp of future) {
        const date = parseExpDateUTC(exp);
        if (isOPEX(date)) {
          opexDates.push(exp);
        }
      }
      return opexDates;
    }

    case "leaps": {
      // All expirations > 12 months from today (industry standard LEAPS definition)
      // Use UTC to avoid DST issues
      const leapsCutoff = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth() + 12,
        today.getUTCDate()
      ));

      return future.filter((exp) => {
        const date = parseExpDateUTC(exp);
        return date > leapsCutoff;
      });
    }

    case "all":
      // Return all future expirations
      return future;

    default:
      return future;
  }
}

/**
 * Determine strike bucket size based on underlying price
 * Higher priced stocks get larger buckets
 */
export function getStrikeBucketSize(underlyingPrice: number): number {
  if (underlyingPrice < 50) return 1;
  if (underlyingPrice < 100) return 2.5;
  if (underlyingPrice < 500) return 5;
  if (underlyingPrice < 1000) return 10;
  return 25;
}

/**
 * Bucket strikes to reduce granularity for performance
 */
export function bucketStrikes(
  strikes: number[],
  bucketSize: number
): number[] {
  const bucketed = new Set<number>();

  for (const strike of strikes) {
    const bucket = Math.round(strike / bucketSize) * bucketSize;
    bucketed.add(bucket);
  }

  return Array.from(bucketed).sort((a, b) => a - b);
}

/**
 * Cell accumulator for single-pass aggregation
 * Stores running totals instead of contract arrays
 */
interface CellAccumulator {
  callOI: number;
  putOI: number;
  callMidWeightedSum: number;
  callOiForMid: number;
  putMidWeightedSum: number;
  putOiForMid: number;
}

/**
 * Build heatmap data from raw options contracts
 * Optimized: single-pass accumulation, no intermediate arrays
 */
export function buildHeatmapData(
  contracts: OptionContract[],
  config: HeatmapConfig
): HeatmapData {
  // First pass: collect all unique expirations and strikes
  const allExpirations = new Set<string>();
  const allStrikes = new Set<number>();

  for (const contract of contracts) {
    allExpirations.add(contract.expiration);
    allStrikes.add(contract.strike);
  }

  // Filter expirations and strikes
  const filteredExpirations = filterExpirations(
    Array.from(allExpirations),
    config.expirationGroup
  );
  const filteredExpSet = new Set(filteredExpirations);

  let filteredStrikes = filterStrikes(
    Array.from(allStrikes).sort((a, b) => a - b),
    config.underlyingPrice,
    config.strikeRange
  );

  // Determine if bucketing is needed BEFORE aggregating contracts
  let bucketSize: number | null = null;
  if (filteredStrikes.length > 50) {
    bucketSize = getStrikeBucketSize(config.underlyingPrice);
    filteredStrikes = bucketStrikes(filteredStrikes, bucketSize);
  }
  const filteredStrikeSet = new Set(filteredStrikes);

  // Helper to get the strike key (bucketed if needed)
  const getStrikeKey = (strike: number): number => {
    if (bucketSize === null) return strike;
    return Math.round(strike / bucketSize) * bucketSize;
  };

  // Single-pass aggregation: accumulate OI and weighted mid sums directly
  // Uses nested Map (exp -> strike -> accumulator) to avoid string key construction
  // Also compute totalOIByExp in the same pass
  const accumulatorsByExp = new Map<string, Map<number, CellAccumulator>>();
  const totalOIByExp = new Map<string, number>();

  for (const contract of contracts) {
    // Skip contracts not in filtered expirations
    if (!filteredExpSet.has(contract.expiration)) continue;

    const strikeKey = getStrikeKey(contract.strike);

    // Skip contracts not in filtered strikes (after bucketing)
    if (!filteredStrikeSet.has(strikeKey)) continue;

    // Get or create nested map for this expiration
    let strikeMap = accumulatorsByExp.get(contract.expiration);
    if (!strikeMap) {
      strikeMap = new Map<number, CellAccumulator>();
      accumulatorsByExp.set(contract.expiration, strikeMap);
    }

    // Get or create accumulator for this strike
    let acc = strikeMap.get(strikeKey);
    if (!acc) {
      acc = {
        callOI: 0,
        putOI: 0,
        callMidWeightedSum: 0,
        callOiForMid: 0,
        putMidWeightedSum: 0,
        putOiForMid: 0,
      };
      strikeMap.set(strikeKey, acc);
    }

    // Get valid mid price for this contract
    const mid = getValidMid(contract.bid, contract.ask);

    // Accumulate based on option type
    if (contract.optionType === "call") {
      acc.callOI += contract.oi;
      if (mid !== null && contract.oi > 0) {
        acc.callMidWeightedSum += mid * contract.oi;
        acc.callOiForMid += contract.oi;
      }
    } else {
      acc.putOI += contract.oi;
      if (mid !== null && contract.oi > 0) {
        acc.putMidWeightedSum += mid * contract.oi;
        acc.putOiForMid += contract.oi;
      }
    }

    // Accumulate total OI by expiration (single pass)
    const prevTotal = totalOIByExp.get(contract.expiration) || 0;
    totalOIByExp.set(contract.expiration, prevTotal + contract.oi);
  }

  // Build cells from accumulators (using nested Map lookup)
  const cells = new Map<string, HeatmapCell>();
  let minValue = Infinity;
  let maxValue = -Infinity;
  let totalOI = 0;

  for (const exp of filteredExpirations) {
    const expTotal = totalOIByExp.get(exp) || 1;
    const strikeMap = accumulatorsByExp.get(exp);

    for (const strike of filteredStrikes) {
      const key = cellKey(exp, strike);
      const acc = strikeMap?.get(strike);

      // Extract values from accumulator (or use defaults)
      const callOI = acc?.callOI ?? 0;
      const putOI = acc?.putOI ?? 0;
      const callMid = acc && acc.callOiForMid > 0
        ? acc.callMidWeightedSum / acc.callOiForMid
        : 0;
      const putMid = acc && acc.putOiForMid > 0
        ? acc.putMidWeightedSum / acc.putOiForMid
        : 0;

      const callValue = callOI * callMid;
      const putValue = putOI * putMid;
      const netOI = callOI - putOI;
      const netValue = callValue - putValue;

      // Calculate put/call ratio (clamped at MAX_PC_RATIO to preserve extreme values)
      let putCallRatio: number | null = null;
      if (callOI > 0) {
        putCallRatio = Math.min(putOI / callOI, MAX_PC_RATIO);
      } else if (putOI > 0) {
        // All puts, no calls - use max ratio to indicate extreme
        putCallRatio = MAX_PC_RATIO;
      }
      // null only when both callOI and putOI are 0

      // Calculate percentage of expiration total
      const pctOfExpTotal = ((callOI + putOI) / expTotal) * 100;

      const cell: HeatmapCell = {
        expiration: exp,
        strike,
        callOI,
        putOI,
        netOI,
        callValue,
        putValue,
        netValue,
        callMid,
        putMid,
        putCallRatio,
        pctOfExpTotal,
        hasData: callOI > 0 || putOI > 0,
      };

      cells.set(key, cell);

      // Track min/max for color scaling
      const value = getCellValue(cell, config.viewType);
      if (cell.hasData) {
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }

      totalOI += callOI + putOI;
    }
  }

  // Handle edge case of no data
  if (minValue === Infinity) minValue = 0;
  if (maxValue === -Infinity) maxValue = 0;

  return {
    expirations: filteredExpirations,
    strikes: filteredStrikes,
    cells,
    minValue,
    maxValue,
    totalOI,
  };
}

/**
 * Normalize unsigned OI value using log scale: log10(oi + 1)
 * For calls/puts which are always >= 0
 */
export function normalizeUnsignedOI(oi: number): number {
  return Math.log10(oi + 1);
}

/**
 * Normalize signed OI value using log scale: sign(oi) × log10(|oi| + 1)
 * For net OI which can be positive or negative
 */
export function normalizeSignedOI(oi: number): number {
  if (oi === 0) return 0;
  const sign = oi > 0 ? 1 : -1;
  return sign * Math.log10(Math.abs(oi) + 1);
}

/**
 * Get the normalized display value for a cell based on view type
 * - Calls/Puts: unsigned log (always >= 0)
 * - Net: signed log (preserves direction)
 */
export function getCellValue(cell: HeatmapCell, viewType: OIViewType): number {
  switch (viewType) {
    case "calls":
      return normalizeUnsignedOI(cell.callOI);
    case "puts":
      return normalizeUnsignedOI(cell.putOI);
    case "net":
      return normalizeSignedOI(cell.netOI);
  }
}

/**
 * Get the raw OI value for a cell based on view type (not normalized)
 */
export function getCellOI(cell: HeatmapCell, viewType: OIViewType): number {
  switch (viewType) {
    case "calls":
      return cell.callOI;
    case "puts":
      return cell.putOI;
    case "net":
      return cell.netOI;
  }
}

/**
 * Color palette for heatmap
 */
const COLORS = {
  light: {
    // Net OI: Diverging scale (Green = call-heavy, Gray = neutral, Red = put-heavy)
    net: {
      // Call-heavy (positive net OI): greens
      callMax: "#15803D",   // Dark green - strongly call-heavy
      callHigh: "#22C55E",  // Green
      callMed: "#86EFAC",   // Light green
      callLow: "#DCFCE7",   // Very light green
      // Neutral (zero net OI)
      neutral: "#F3F4F6",   // Gray-100
      // Put-heavy (negative net OI): reds
      putLow: "#FEE2E2",    // Very light red
      putMed: "#FCA5A5",    // Light red
      putHigh: "#EF4444",   // Red
      putMax: "#B91C1C",    // Dark red - strongly put-heavy
    },
    // Calls OI (sequential: low to high)
    calls: {
      low: "#ECFDF5",
      medium: "#BBF7D0",
      high: "#22C55E",
      max: "#15803D",
    },
    // Puts OI (sequential: low to high)
    puts: {
      low: "#FEF2F2",
      medium: "#FECACA",
      high: "#EF4444",
      max: "#B91C1C",
    },
    zero: "#F3F4F6",
  },
  dark: {
    // Net OI: Diverging scale (Green = call-heavy, Gray = neutral, Red = put-heavy)
    net: {
      // Call-heavy (positive net OI): greens
      callMax: "#22C55E",   // Bright green - strongly call-heavy
      callHigh: "#16A34A",  // Green
      callMed: "#14532D",   // Dark green
      callLow: "#052E16",   // Very dark green
      // Neutral (zero net OI)
      neutral: "#374151",   // Gray-700
      // Put-heavy (negative net OI): reds
      putLow: "#450A0A",    // Very dark red
      putMed: "#7F1D1D",    // Dark red
      putHigh: "#DC2626",   // Red
      putMax: "#EF4444",    // Bright red - strongly put-heavy
    },
    // Calls OI (sequential: low to high)
    calls: {
      low: "#064E3B",
      medium: "#14532D",
      high: "#16A34A",
      max: "#22C55E",
    },
    // Puts OI (sequential: low to high)
    puts: {
      low: "#7F1D1D",
      medium: "#991B1B",
      high: "#DC2626",
      max: "#EF4444",
    },
    zero: "#374151",
  },
};

/**
 * Interpolate between colors based on position (0-1)
 */
function interpolateColor(colors: string[], position: number): string {
  const n = colors.length - 1;
  const idx = Math.min(Math.floor(position * n), n - 1);
  const t = (position * n) - idx;

  const c1 = hexToRgb(colors[idx]);
  const c2 = hexToRgb(colors[idx + 1]);

  if (!c1 || !c2) return colors[0];

  const r = Math.round(c1.r + (c2.r - c1.r) * t);
  const g = Math.round(c1.g + (c2.g - c1.g) * t);
  const b = Math.round(c1.b + (c2.b - c1.b) * t);

  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

/**
 * Contrast curve exponents per view type
 * Lower values = gentler curve, more mid-level structure visible
 * Higher values = more aggressive, only top values pop
 */
const CONTRAST_EXPONENTS: Record<OIViewType, number> = {
  net: 2.5,    // Slightly compressed for magnitude-only view
  calls: 2.0,  // Gentler to show mid-level OI structure
  puts: 2.0,   // Gentler to show mid-level OI structure
};

/**
 * Apply power curve to compress values, showing high contrast for top percentile
 * Exponent is configurable per view type
 */
function applyContrastCurve(normalized: number, viewType: OIViewType): number {
  const exponent = CONTRAST_EXPONENTS[viewType];
  // Examples with x^2: 0.7^2 = 0.49, 0.8^2 = 0.64, 0.9^2 = 0.81
  // Examples with x^2.5: 0.7^2.5 ≈ 0.41, 0.8^2.5 ≈ 0.57, 0.9^2.5 ≈ 0.77
  return Math.pow(normalized, exponent);
}

/**
 * Calculate color for a cell value
 * Sequential scale for calls/puts
 * Diverging scale for net OI: Green (call-heavy) -> Gray (neutral) -> Red (put-heavy)
 */
export function getCellColor(
  value: number,
  minValue: number,
  maxValue: number,
  viewType: OIViewType,
  isDarkMode: boolean = false
): string {
  const palette = isDarkMode ? COLORS.dark : COLORS.light;

  // Zero value
  if (value === 0) {
    return palette.zero;
  }

  if (viewType === "net") {
    // Diverging scale: Green (call-heavy/positive) <- Gray (neutral/0) -> Red (put-heavy/negative)
    // Value is already in symlog space: sign(x) * log10(|x| + 1)
    const absMax = Math.max(Math.abs(minValue), Math.abs(maxValue));
    if (absMax === 0) return palette.net.neutral;

    // Normalize to -1 to +1 range (preserving sign)
    const normalized = value / absMax;

    // Apply contrast curve to the absolute value, preserve sign
    const absNormalized = Math.abs(normalized);
    const curved = applyContrastCurve(absNormalized, viewType);

    if (value > 0) {
      // Call-heavy (positive net OI): neutral -> green scale
      // curved goes from 0 (near neutral) to 1 (max call-heavy)
      const colors = [
        palette.net.neutral,
        palette.net.callLow,
        palette.net.callMed,
        palette.net.callHigh,
        palette.net.callMax,
      ];
      return interpolateColor(colors, Math.min(curved, 1));
    } else {
      // Put-heavy (negative net OI): neutral -> red scale
      // curved goes from 0 (near neutral) to 1 (max put-heavy)
      const colors = [
        palette.net.neutral,
        palette.net.putLow,
        palette.net.putMed,
        palette.net.putHigh,
        palette.net.putMax,
      ];
      return interpolateColor(colors, Math.min(curved, 1));
    }
  } else {
    // Sequential scale: low to max with contrast curve
    if (maxValue === minValue) return palette.zero;

    const normalized = (value - minValue) / (maxValue - minValue);
    const curved = applyContrastCurve(normalized, viewType);

    if (viewType === "calls") {
      const colors = [
        palette.calls.low,
        palette.calls.medium,
        palette.calls.high,
        palette.calls.max,
      ];
      return interpolateColor(colors, Math.min(curved, 1));
    } else {
      const colors = [
        palette.puts.low,
        palette.puts.medium,
        palette.puts.high,
        palette.puts.max,
      ];
      return interpolateColor(colors, Math.min(curved, 1));
    }
  }
}

/**
 * Format large numbers compactly
 */
export function formatOI(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return (value / 1000000).toFixed(1) + "M";
  }
  if (Math.abs(value) >= 1000) {
    return (value / 1000).toFixed(1) + "K";
  }
  return value.toFixed(0);
}

/**
 * Format currency value compactly
 */
export function formatValue(value: number): string {
  if (Math.abs(value) >= 1000000000) {
    return "$" + (value / 1000000000).toFixed(1) + "B";
  }
  if (Math.abs(value) >= 1000000) {
    return "$" + (value / 1000000).toFixed(1) + "M";
  }
  if (Math.abs(value) >= 1000) {
    return "$" + (value / 1000).toFixed(1) + "K";
  }
  return "$" + value.toFixed(0);
}

/**
 * Format expiration date for display (short form)
 * Uses UTC to avoid timezone issues
 */
export function formatExpiration(exp: string): string {
  const date = parseExpDateUTC(exp);
  // Format using UTC values to avoid timezone shift
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Format put/call ratio for display
 * Shows "99+" when at max (indicates extreme put-heavy or no calls)
 */
export function formatPCRatio(ratio: number | null): string {
  if (ratio === null) return "-";
  if (ratio >= MAX_PC_RATIO) return `${MAX_PC_RATIO}+`;
  return ratio.toFixed(2);
}
