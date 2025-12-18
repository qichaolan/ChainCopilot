/**
 * useOptionsData Hook
 * Handles fetching, caching, and transforming options chain data
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  DisplayOption,
  UnderlyingInfo,
  ChainCacheEntry,
  HeatmapCacheEntry,
  OptionsContract,
} from "../types";
import { OptionContract } from "@/lib/heatmap/oi-heatmap";
import { isCacheValid, transformContracts } from "../utils";

interface UseOptionsDataReturn {
  // Data
  expirations: string[];
  calls: DisplayOption[];
  puts: DisplayOption[];
  underlying: UnderlyingInfo;
  allContracts: OptionContract[];

  // Loading states
  loadingExpirations: boolean;
  loadingChain: boolean;
  loadingHeatmap: boolean;
  isLoading: boolean;

  // Error state
  error: string | null;

  // Actions
  fetchExpirations: (ticker: string) => Promise<void>;
  fetchOptionsChain: (ticker: string, expiration: string) => Promise<void>;
  loadHeatmapData: () => Promise<void>;
  clearHeatmapData: () => void;
}

const INITIAL_UNDERLYING: UnderlyingInfo = {
  symbol: "",
  name: "",
  price: 0,
  prevClose: 0,
  change: 0,
  changePercent: 0,
  priceType: "unknown",
  priceTimestamp: null,
};

export function useOptionsData(symbol: string): UseOptionsDataReturn {
  // Data states
  const [expirations, setExpirations] = useState<string[]>([]);
  const [calls, setCalls] = useState<DisplayOption[]>([]);
  const [puts, setPuts] = useState<DisplayOption[]>([]);
  const [underlying, setUnderlying] = useState<UnderlyingInfo>(INITIAL_UNDERLYING);
  const [allContracts, setAllContracts] = useState<OptionContract[]>([]);

  // Loading states
  const [loadingExpirations, setLoadingExpirations] = useState(false);
  const [loadingChain, setLoadingChain] = useState(false);
  const [loadingHeatmap, setLoadingHeatmap] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Cache refs
  const chainCache = useRef<Map<string, ChainCacheEntry>>(new Map());
  const heatmapCache = useRef<Map<string, HeatmapCacheEntry>>(new Map());

  // Fetch expiration dates for a ticker
  const fetchExpirations = useCallback(async (ticker: string) => {
    if (!ticker) return;

    setLoadingExpirations(true);
    setError(null);

    try {
      const response = await fetch(`/api/market/expirations?ticker=${encodeURIComponent(ticker)}`);
      const data = await response.json();

      if (data.error) {
        setError(data.error);
        setExpirations([]);
        return;
      }

      setExpirations(data.expiration_dates || []);
      setUnderlying({
        symbol: ticker,
        name: ticker,
        price: data.underlying_price || 0,
        prevClose: 0,
        change: 0,
        changePercent: 0,
        priceType: "unknown",
        priceTimestamp: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch expirations");
    } finally {
      setLoadingExpirations(false);
    }
  }, []);

  // Fetch options chain for a specific expiration (with caching)
  const fetchOptionsChain = useCallback(async (ticker: string, expiration: string) => {
    if (!ticker || !expiration) return;

    const cacheKey = `${ticker}:${expiration}`;
    const cached = chainCache.current.get(cacheKey);

    // Use cache if valid
    if (cached && isCacheValid(cached.timestamp)) {
      setCalls(cached.calls);
      setPuts(cached.puts);
      if (cached.underlyingPrice) {
        setUnderlying((prev) => ({ ...prev, price: cached.underlyingPrice! }));
      }
      return;
    }

    setLoadingChain(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/market/chain?ticker=${encodeURIComponent(ticker)}&exp=${encodeURIComponent(expiration)}`
      );
      const data = await response.json();

      if (data.error) {
        setError(data.error);
        setCalls([]);
        setPuts([]);
        return;
      }

      const { calls: callContracts, puts: putContracts } = transformContracts(data.contracts || []);

      // Store in cache
      chainCache.current.set(cacheKey, {
        calls: callContracts,
        puts: putContracts,
        underlyingPrice: data.underlying_price || null,
        timestamp: Date.now(),
      });

      setCalls(callContracts);
      setPuts(putContracts);

      if (data.underlying_price) {
        setUnderlying((prev) => ({
          ...prev,
          price: data.underlying_price,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch options chain");
    } finally {
      setLoadingChain(false);
    }
  }, []);

  // Load heatmap data using batch endpoint
  const loadHeatmapData = useCallback(async () => {
    if (!symbol) return;

    // Check heatmap cache first
    const cachedHeatmap = heatmapCache.current.get(symbol);
    if (cachedHeatmap && isCacheValid(cachedHeatmap.timestamp)) {
      setAllContracts(cachedHeatmap.contracts);
      return;
    }

    setLoadingHeatmap(true);

    try {
      const response = await fetch("/api/market/heatmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: symbol }),
      });
      const data = await response.json();

      if (!data.error && data.contracts) {
        const contracts: OptionContract[] = [];
        for (const c of data.contracts as OptionsContract[]) {
          contracts.push({
            strike: c.strike || 0,
            expiration: c.expiration || "",
            optionType: c.option_type === "call" ? "call" : "put",
            bid: c.bid || 0,
            ask: c.ask || 0,
            oi: c.open_interest || 0,
            volume: c.volume || 0,
            iv: c.implied_volatility || 0,
          });
        }

        // Store in heatmap cache
        heatmapCache.current.set(symbol, {
          contracts,
          timestamp: Date.now(),
        });

        setAllContracts(contracts);
      }
    } catch (err) {
      console.error("Failed to load heatmap data:", err);
    } finally {
      setLoadingHeatmap(false);
    }
  }, [symbol]);

  // Clear heatmap data when symbol changes
  const clearHeatmapData = useCallback(() => {
    setAllContracts([]);
  }, []);

  // Reset heatmap data when symbol changes
  useEffect(() => {
    setAllContracts([]);
  }, [symbol]);

  const isLoading = loadingExpirations || loadingChain;

  return {
    expirations,
    calls,
    puts,
    underlying,
    allContracts,
    loadingExpirations,
    loadingChain,
    loadingHeatmap,
    isLoading,
    error,
    fetchExpirations,
    fetchOptionsChain,
    loadHeatmapData,
    clearHeatmapData,
  };
}
