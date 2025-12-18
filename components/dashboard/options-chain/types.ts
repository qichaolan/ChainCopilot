/**
 * Options Chain Types
 * Centralized type definitions for the options chain dashboard
 */

// Cache types
export interface ChainCacheEntry {
  calls: DisplayOption[];
  puts: DisplayOption[];
  underlyingPrice: number | null;
  timestamp: number;
}

export interface HeatmapCacheEntry {
  contracts: import("@/lib/heatmap/oi-heatmap").OptionContract[];
  timestamp: number;
}

// Expiration type categories
export type ExpirationType = "all" | "weekly" | "monthly" | "quarterly" | "leaps";

// Types for API responses
export interface OptionsContract {
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
  volume: number | null;
  open_interest: number | null;
  implied_volatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

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

// Insights computed from options data
export interface ChainInsights {
  totalCallOI: number;
  totalPutOI: number;
  totalOI: number;
  callValue: number;
  putValue: number;
  totalValue: number;
  callValuePercent: number;
  pcRatio: number;
  avgIV: number;
  heaviestStrike: number;
  heaviestStrikeOI: number;
  callPercent: number;
  bias: "call-heavy" | "put-heavy" | "neutral";
}

// Strike window for filtering around ATM
export interface StrikeWindow {
  atmIndex: number;
  filteredCalls: DisplayOption[];
  filteredPuts: DisplayOption[];
  hiddenAbove: number;
  hiddenBelow: number;
  startIdx?: number;
  endIdx?: number;
}

// View modes
export type ViewMode = "chain" | "heatmap" | "tornado";
export type StrikeWindowSize = 5 | 10 | 20 | "all";
export type TornadoStrikeWindow = 10 | 20 | 40 | "all";
export type TornadoFilter = "both" | "calls" | "puts";
export type MobileView = "calls" | "puts";

// Heatmap viewport state
export interface HeatmapViewportState {
  strikeMin: number;
  strikeMax: number;
  expirationsShown: string[];
  viewType: string;
  strikeRange: string;
  expGroup: string;
}

// Heatmap cell focus state
export interface HeatmapCellFocus {
  expiration: string;
  strike: number;
  callOI: number;
  putOI: number;
  netOI: number;
}

// Selected contract for AI context
export interface SelectedContract {
  type: "call" | "put";
  contract: DisplayOption;
}

// Tornado data for AI context
export interface TornadoAggregates {
  totalCallOI: number;
  totalPutOI: number;
  pcRatio: number;
  maxCallOIStrike: { strike: number; oi: number };
  maxPutOIStrike: { strike: number; oi: number };
  netOiBias: "put" | "call" | "neutral";
  strikeMin: number;
  strikeMax: number;
  strikeCount: number;
}

export interface TornadoDistributionRow {
  strike: number;
  callOI: number;
  putOI: number;
}

export interface TornadoData {
  aggregates: TornadoAggregates;
  distribution: TornadoDistributionRow[];
}

// Tornado display row (with optional aggregation info)
export interface TornadoDisplayRow {
  strike: number;
  callOI: number;
  putOI: number;
  isAggregated?: boolean;
  rangeLabel?: string;
}
