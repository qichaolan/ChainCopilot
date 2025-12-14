/**
 * Shared Options Types
 *
 * Centralized type definitions for options data used across the application.
 * This eliminates duplicate type definitions and ensures consistency.
 */

// =============================================================================
// Core Options Contract Types
// =============================================================================

/**
 * Raw options contract data from API/Python backend
 */
export interface RawOptionsContract {
  contract_symbol: string;
  underlying_symbol: string;
  underlying_price: number | null;
  expiration: string;
  dte: number | null;
  strike: number | null;
  option_type: string;
  bid: number | null;
  ask: number | null;
  last_price: number | null;
  theoretical_price: number | null;
  mark: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  change: number | null;
  change_percent: number | null;
  volume: number | null;
  open_interest: number | null;
  implied_volatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
}

/**
 * Display-friendly options data (transformed from raw)
 */
export interface DisplayOption {
  strike: number;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  oi: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/**
 * Options chain result from API
 */
export interface OptionsChainResult {
  ticker: string;
  provider: string;
  timestamp: string;
  expiration_date: string | null;
  underlying_price: number | null;
  contracts: RawOptionsContract[];
  total_contracts: number;
  error: string | null;
}

/**
 * Expiration dates result from API
 */
export interface ExpirationDatesResult {
  ticker: string;
  provider: string;
  timestamp: string;
  underlying_price: number | null;
  prev_close?: number | null;
  change?: number | null;
  change_percent?: number | null;
  price_type?: string;
  price_timestamp?: string | null;
  expiration_dates: string[];
  total_dates: number;
  error: string | null;
}

// =============================================================================
// Underlying Asset Types
// =============================================================================

/**
 * Information about the underlying asset
 */
export interface UnderlyingInfo {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePercent: number;
  priceType: "current" | "prev_close" | "unknown";
  priceTimestamp: string | null;
}

// =============================================================================
// Heatmap Types (re-export from oi-heatmap for convenience)
// =============================================================================

export type { OptionContract, HeatmapCell, HeatmapData, HeatmapConfig } from "@/lib/heatmap/oi-heatmap";

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Valid ticker symbol pattern: 1-5 uppercase letters
 * Covers standard US equity tickers
 */
export const TICKER_PATTERN = /^[A-Z]{1,5}$/;

/**
 * Valid date pattern: YYYY-MM-DD
 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Maximum ticker length
 */
export const MAX_TICKER_LENGTH = 5;

/**
 * Validate a ticker symbol
 * @param ticker - The ticker string to validate
 * @returns True if valid, false otherwise
 */
export function isValidTicker(ticker: string): boolean {
  if (!ticker || typeof ticker !== "string") return false;
  const normalized = ticker.trim().toUpperCase();
  return TICKER_PATTERN.test(normalized) && normalized.length <= MAX_TICKER_LENGTH;
}

/**
 * Validate an expiration date string
 * @param date - Date string in YYYY-MM-DD format
 * @returns True if valid format and real date, false otherwise
 */
export function isValidExpirationDate(date: string): boolean {
  if (!date || typeof date !== "string") return false;
  if (!DATE_PATTERN.test(date)) return false;

  // Parse components and verify it's a real date
  const [yearStr, monthStr, dayStr] = date.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Create date in UTC and verify it matches input
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(parsed.getTime())) return false;

  // Verify the date wasn't auto-corrected (e.g., Feb 30 -> Mar 2)
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Sanitize ticker symbol
 * @param ticker - Raw ticker input
 * @returns Sanitized uppercase ticker or null if invalid
 */
export function sanitizeTicker(ticker: string): string | null {
  if (!ticker || typeof ticker !== "string") return null;
  const normalized = ticker.trim().toUpperCase();
  return isValidTicker(normalized) ? normalized : null;
}

// =============================================================================
// Transform Utilities
// =============================================================================

/**
 * Transform raw API contract to display format
 */
export function toDisplayOption(contract: RawOptionsContract): DisplayOption {
  return {
    strike: contract.strike ?? 0,
    bid: contract.bid ?? 0,
    ask: contract.ask ?? 0,
    last: contract.last_price ?? 0,
    volume: contract.volume ?? 0,
    oi: contract.open_interest ?? 0,
    iv: contract.implied_volatility ?? 0,
    delta: contract.delta ?? 0,
    gamma: contract.gamma ?? 0,
    theta: contract.theta ?? 0,
    vega: contract.vega ?? 0,
  };
}
