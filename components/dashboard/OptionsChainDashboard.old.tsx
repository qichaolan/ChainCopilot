"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { Search, Info, Loader2, ChevronDown, Grid3X3, List, BarChart3 } from "lucide-react";
import { cn, formatCurrency, formatCompactNumber } from "@/lib/utils";
import { OIHeatmap } from "./OIHeatmap";
import { OptionContract } from "@/lib/heatmap/oi-heatmap";
import { AI_CONTEXT_CONFIG } from "@/lib/config/ai-context";

// Cache types
interface ChainCacheEntry {
  calls: DisplayOption[];
  puts: DisplayOption[];
  underlyingPrice: number | null;
  timestamp: number;
}

interface HeatmapCacheEntry {
  contracts: OptionContract[];
  timestamp: number;
}

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

// Expiration type categories
type ExpirationType = "all" | "weekly" | "monthly" | "quarterly" | "leaps";

// Helper to categorize expiration dates
function categorizeExpirations(dates: string[]): Record<ExpirationType, string[]> {
  const today = new Date();
  const eighteenMonthsFromNow = new Date(today);
  eighteenMonthsFromNow.setMonth(eighteenMonthsFromNow.getMonth() + 18);

  const categories: Record<ExpirationType, string[]> = {
    all: [...dates], // All dates
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

// Types for API responses
interface OptionsContract {
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

interface DisplayOption {
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

interface UnderlyingInfo {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePercent: number;
  priceType: "current" | "prev_close" | "unknown";
  priceTimestamp: string | null;
}

export function OptionsChainDashboard() {
  const [symbol, setSymbol] = useState("");
  const [inputSymbol, setInputSymbol] = useState("");
  const [selectedExpiration, setSelectedExpiration] = useState<string>("");
  const [expirationType, setExpirationType] = useState<ExpirationType>("all");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [showCalls, setShowCalls] = useState(true);
  const [showPuts, setShowPuts] = useState(true);
  // Mobile: toggle between calls/puts (default to calls)
  const [mobileView, setMobileView] = useState<"calls" | "puts">("calls");

  // Strike window size: number of strikes above/below ATM, or "all"
  const [strikeWindowSize, setStrikeWindowSize] = useState<5 | 10 | 20 | "all">(5);

  // Tornado strike window size: separate from chain view (default ±10)
  const [tornadoStrikeWindow, setTornadoStrikeWindow] = useState<10 | 20 | 40 | "all">(10);

  // View mode: chain table, heatmap, or tornado
  const [viewMode, setViewMode] = useState<"chain" | "heatmap" | "tornado">("chain");

  // Tornado filter: both, calls, or puts
  const [tornadoFilter, setTornadoFilter] = useState<"both" | "calls" | "puts">("both");

  // Selected contract for AI context (when user clicks a row)
  const [selectedContract, setSelectedContract] = useState<{
    type: "call" | "put";
    contract: DisplayOption;
  } | null>(null);

  // All contracts for heatmap (accumulated across expirations)
  const [allContracts, setAllContracts] = useState<OptionContract[]>([]);
  const [loadingHeatmap, setLoadingHeatmap] = useState(false);

  // Heatmap viewport state (what's actually visible in the heatmap)
  const [heatmapViewport, setHeatmapViewport] = useState<{
    strikeMin: number;
    strikeMax: number;
    expirationsShown: string[];
    viewType: string;
    strikeRange: string;
    expGroup: string;
  } | null>(null);

  // Heatmap focus state for AI context
  const [heatmapHoveredCell, setHeatmapHoveredCell] = useState<{
    expiration: string;
    strike: number;
    callOI: number;
    putOI: number;
    netOI: number;
  } | null>(null);
  const [heatmapSelectedCell, setHeatmapSelectedCell] = useState<{
    expiration: string;
    strike: number;
    callOI: number;
    putOI: number;
    netOI: number;
  } | null>(null);

  // Tornado focus state for AI context
  const [tornadoHoveredStrike, setTornadoHoveredStrike] = useState<number | null>(null);
  const [tornadoSelectedStrike, setTornadoSelectedStrike] = useState<number | null>(null);

  // Data states
  const [expirations, setExpirations] = useState<string[]>([]);
  const [calls, setCalls] = useState<DisplayOption[]>([]);
  const [puts, setPuts] = useState<DisplayOption[]>([]);
  const [underlying, setUnderlying] = useState<UnderlyingInfo>({
    symbol: "",
    name: "",
    price: 0,
    prevClose: 0,
    change: 0,
    changePercent: 0,
    priceType: "unknown",
    priceTimestamp: null,
  });

  // Loading and error states
  const [loadingExpirations, setLoadingExpirations] = useState(false);
  const [loadingChain, setLoadingChain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track desktop breakpoint for responsive rendering (avoids hydration mismatch)
  const [isDesktop, setIsDesktop] = useState(true); // Default to desktop for SSR

  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktop(); // Initial check
    window.addEventListener("resize", checkDesktop);
    return () => window.removeEventListener("resize", checkDesktop);
  }, []);

  // Cache refs for performance
  const chainCache = useRef<Map<string, ChainCacheEntry>>(new Map());
  const heatmapCache = useRef<Map<string, HeatmapCacheEntry>>(new Map());

  // Helper to check if cache entry is valid
  const isCacheValid = (timestamp: number) => Date.now() - timestamp < CACHE_TTL;

  // Helper to transform raw contracts to display format
  const transformContracts = useCallback((contracts: OptionsContract[]) => {
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
  }, []);

  // Fetch expiration dates for a ticker
  const fetchExpirations = useCallback(async (ticker: string) => {
    if (!ticker) return;

    setLoadingExpirations(true);
    setError(null);

    try {
      // Step 1: Fetch expirations only (fast, no contracts)
      const response = await fetch(`/api/market/expirations?ticker=${encodeURIComponent(ticker)}`);
      const data = await response.json();

      if (data.error) {
        setError(data.error);
        setExpirations([]);
        return;
      }

      setExpirations(data.expiration_dates || []);
      setSymbol(ticker);
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

      // Auto-select closest expiration to today
      if (data.expiration_dates && data.expiration_dates.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        // Find closest expiration >= today
        const closestExpiration = data.expiration_dates.find((d: string) => d >= today) || data.expiration_dates[0];
        setExpirationType("all");
        setSelectedExpiration(closestExpiration);

        // Step 2: Fetch chain for closest expiration (lazy load)
        // This will be triggered by the useEffect that watches selectedExpiration
      }
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
      // Lazy load chain for specific expiration
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

      // Transform contracts using shared helper
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

      // Update underlying price if available
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
  }, [transformContracts]);

  // Fetch options chain when expiration changes
  useEffect(() => {
    if (symbol && selectedExpiration) {
      fetchOptionsChain(symbol, selectedExpiration);
      // Reset strike window to default when loading new data
      setStrikeWindowSize(5);
      // Clear selected contract when switching expirations
      setSelectedContract(null);
    }
  }, [symbol, selectedExpiration, fetchOptionsChain]);

  // Load heatmap data using batch endpoint (single API call)
  const loadHeatmapData = useCallback(async () => {
    if (!symbol) return;

    // Check heatmap cache first
    const heatmapCacheKey = symbol;
    const cachedHeatmap = heatmapCache.current.get(heatmapCacheKey);
    if (cachedHeatmap && isCacheValid(cachedHeatmap.timestamp)) {
      setAllContracts(cachedHeatmap.contracts);
      return;
    }

    setLoadingHeatmap(true);

    try {
      // Bulk fetch for heatmap via POST endpoint
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
        heatmapCache.current.set(heatmapCacheKey, {
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

  // Load heatmap data when switching to heatmap view
  useEffect(() => {
    if (viewMode === "heatmap" && symbol && allContracts.length === 0 && !loadingHeatmap) {
      loadHeatmapData();
    }
  }, [viewMode, symbol, allContracts.length, loadingHeatmap, loadHeatmapData]);

  // Reset heatmap data when symbol changes (clear both state and cache for that symbol)
  useEffect(() => {
    setAllContracts([]);
    // Note: We keep the cache entries; they'll be refreshed based on TTL
  }, [symbol]);

  // Handle heatmap cell click (drill down)
  const handleHeatmapCellClick = useCallback((expiration: string, strike: number) => {
    setSelectedExpiration(expiration);
    setViewMode("chain");
    // Could also scroll to strike - would need a ref
  }, []);

  // Handle symbol search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputSymbol.trim()) {
      fetchExpirations(inputSymbol.trim().toUpperCase());
    }
  };

  const isLoading = loadingExpirations || loadingChain;

  // Calculate key insights for current expiration
  const insights = useMemo(() => {
    if (calls.length === 0 || puts.length === 0) {
      return null;
    }

    const totalCallOI = calls.reduce((sum, c) => sum + c.oi, 0);
    const totalPutOI = puts.reduce((sum, p) => sum + p.oi, 0);
    const totalOI = totalCallOI + totalPutOI;
    const avgCallIV = calls.reduce((sum, c) => sum + c.iv, 0) / calls.length;
    const avgPutIV = puts.reduce((sum, p) => sum + p.iv, 0) / puts.length;
    const avgIV = (avgCallIV + avgPutIV) / 2;

    // OI Value = OI * mid price (notional value of open interest)
    const callValue = calls.reduce((sum, c) => {
      const mid = (c.bid + c.ask) / 2;
      return sum + c.oi * mid * 100; // multiply by 100 for contract size
    }, 0);
    const putValue = puts.reduce((sum, p) => {
      const mid = (p.bid + p.ask) / 2;
      return sum + p.oi * mid * 100;
    }, 0);
    const totalValue = callValue + putValue;
    const callValuePercent = totalValue > 0 ? (callValue / totalValue) * 100 : 50;

    // P/C Ratio based on OI (more meaningful than volume)
    const pcRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

    // Find heaviest strike (highest combined OI) using strike map
    // Build map by strike to handle misaligned calls/puts arrays
    const oiByStrike = new Map<number, number>();
    for (const c of calls) {
      oiByStrike.set(c.strike, (oiByStrike.get(c.strike) || 0) + (c.oi || 0));
    }
    for (const p of puts) {
      oiByStrike.set(p.strike, (oiByStrike.get(p.strike) || 0) + (p.oi || 0));
    }
    let heaviestStrike = calls[0]?.strike || 0;
    let maxOI = 0;
    for (const [strike, combinedOI] of oiByStrike) {
      if (combinedOI > maxOI) {
        maxOI = combinedOI;
        heaviestStrike = strike;
      }
    }

    // Positioning bias
    const callPercent = totalOI > 0 ? (totalCallOI / totalOI) * 100 : 50;
    const bias: "call-heavy" | "put-heavy" | "neutral" =
      callPercent > 55 ? "call-heavy" : callPercent < 45 ? "put-heavy" : "neutral";

    return {
      totalCallOI,
      totalPutOI,
      totalOI,
      callValue,
      putValue,
      totalValue,
      callValuePercent,
      pcRatio,
      avgIV,
      heaviestStrike,
      heaviestStrikeOI: maxOI,
      callPercent,
      bias,
    };
  }, [calls, puts]);

  // Categorize expirations by type
  const categorizedExpirations = useMemo(() => {
    return categorizeExpirations(expirations);
  }, [expirations]);

  // Strike window filtering - find ATM and filter around it
  const strikeWindow = useMemo(() => {
    if (calls.length === 0) {
      return { atmIndex: 0, filteredCalls: [], filteredPuts: [], hiddenAbove: 0, hiddenBelow: 0 };
    }

    // If underlying price is not available, show all strikes
    if (!underlying.price || underlying.price <= 0) {
      return {
        atmIndex: Math.floor(calls.length / 2),
        filteredCalls: calls,
        filteredPuts: puts,
        hiddenAbove: 0,
        hiddenBelow: 0,
        startIdx: 0,
        endIdx: calls.length - 1,
      };
    }

    // Find ATM strike index (closest to underlying price)
    let atmIndex = 0;
    let minDiff = Infinity;
    calls.forEach((call, idx) => {
      const diff = Math.abs(call.strike - underlying.price);
      if (diff < minDiff) {
        minDiff = diff;
        atmIndex = idx;
      }
    });

    // Use the selected window size (or show all)
    if (strikeWindowSize === "all") {
      return {
        atmIndex,
        filteredCalls: calls,
        filteredPuts: puts,
        hiddenAbove: 0,
        hiddenBelow: 0,
        startIdx: 0,
        endIdx: calls.length - 1,
      };
    }

    // Calculate start and end indices based on selected window size
    const startIdx = Math.max(0, atmIndex - strikeWindowSize);
    const endIdx = Math.min(calls.length - 1, atmIndex + strikeWindowSize);

    // Count hidden strikes
    const hiddenAbove = startIdx; // ITM calls / OTM puts above the window
    const hiddenBelow = calls.length - 1 - endIdx; // OTM calls / ITM puts below the window

    // Filter arrays
    const filteredCalls = calls.slice(startIdx, endIdx + 1);
    const filteredPuts = puts.slice(startIdx, endIdx + 1);

    return { atmIndex, filteredCalls, filteredPuts, hiddenAbove, hiddenBelow, startIdx, endIdx };
  }, [calls, puts, underlying.price, strikeWindowSize]);

  // Get the display arrays (already filtered by strikeWindow based on strikeWindowSize)
  const displayCalls = strikeWindow.filteredCalls;
  const displayPuts = strikeWindow.filteredPuts;

  // Get dates for current expiration type
  const currentTypeDates = categorizedExpirations[expirationType];

  // Handle expiration type change
  const handleTypeChange = (type: ExpirationType) => {
    setExpirationType(type);
    setDropdownOpen(false);
    // Auto-select first date in new category if available
    const dates = categorizedExpirations[type];
    if (dates.length > 0 && !dates.includes(selectedExpiration)) {
      setSelectedExpiration(dates[0]);
    }
  };

  // Format date for dropdown display
  const formatDropdownDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: expirationType === "leaps" ? "numeric" : undefined,
    });
  };

  // Get moneyness (ITM/ATM/OTM) for a contract
  const getMoneyness = (strike: number, type: "call" | "put"): "ITM" | "ATM" | "OTM" => {
    if (atmStrike !== null && strike === atmStrike) return "ATM";
    if (type === "call") return strike < underlying.price ? "ITM" : "OTM";
    return strike > underlying.price ? "ITM" : "OTM";
  };

  // Build selectedchain object from selected contracts
  const buildSelectedChain = (): Record<number, object> | null => {
    if (!selectedContract) return null;
    return {
      0: {
        type: selectedContract.type,
        Strike: selectedContract.contract.strike,
        Bid: selectedContract.contract.bid,
        Ask: selectedContract.contract.ask,
        Last: selectedContract.contract.last,
        Vol: selectedContract.contract.volume,
        OI: selectedContract.contract.oi,
        IV: selectedContract.contract.iv ? (selectedContract.contract.iv * 100).toFixed(1) : null,
        Delta: selectedContract.contract.delta?.toFixed(3),
        Gamma: selectedContract.contract.gamma?.toFixed(4),
        Theta: selectedContract.contract.theta?.toFixed(3),
        Vega: selectedContract.contract.vega?.toFixed(3),
        moneyness: getMoneyness(selectedContract.contract.strike, selectedContract.type),
      },
    };
  };

  // Expose data to CopilotKit AI - structured context (v3)
  useCopilotReadable({
    description: "OptChain context (v3)",
    value: {
      pageId: "chain_analysis",
      tableId: "chain",
      contextVersion: 3,
      timestamp: new Date().toISOString(),
      selectedExpiration,
      underlying: {
        symbol: underlying.symbol,
        price: underlying.price,
        changePct: underlying.changePercent,
      },
      insights: insights ? {
        totalCallOI: insights.totalCallOI,
        totalPutOI: insights.totalPutOI,
        totalCallOIValue: insights.callValue,
        totalPutOIValue: insights.putValue,
        pcRatio: Number(insights.pcRatio.toFixed(2)),
        avgIVPct: Number((insights.avgIV * 100).toFixed(1)),
        heaviestStrike: insights.heaviestStrike,
      } : null,
      // User's current view: strikes visible on screen (capped to 40 for AI context)
      strikeWindow: strikeWindowSize === "all" ? "all" : `±${strikeWindowSize}`,
      visibleStrikes: (() => {
        const maxStrikes = AI_CONTEXT_CONFIG.chain.maxStrikes;
        const strikes = displayCalls.map((call, idx) => ({
          strike: call.strike,
          callOI: call.oi,
          putOI: displayPuts[idx]?.oi ?? 0,
          callIV: call.iv ? Number((call.iv * 100).toFixed(1)) : null,
          putIV: displayPuts[idx]?.iv ? Number((displayPuts[idx].iv * 100).toFixed(1)) : null,
        }));
        if (strikes.length <= maxStrikes) return strikes;
        // Cap around ATM (center of array)
        const center = Math.floor(strikes.length / 2);
        const half = Math.floor(maxStrikes / 2);
        return strikes.slice(Math.max(0, center - half), center + half);
      })(),
      visibleStrikesTruncated: displayCalls.length > AI_CONTEXT_CONFIG.chain.maxStrikes,
      numOfSelectedChain: selectedContract ? 1 : 0,
      selectedchain: buildSelectedChain(),
      units: { price: "USD", iv: "percent", oi: "contracts" },
    },
  });

  // Filter contracts to only what's visible in the heatmap viewport
  const visibleContracts = useMemo(() => {
    if (!heatmapViewport || allContracts.length === 0) return [];
    const expSet = new Set(heatmapViewport.expirationsShown);
    return allContracts.filter(c => {
      const strike = c.strike ?? 0;
      const exp = c.expiration ?? "";
      return (
        strike >= heatmapViewport.strikeMin &&
        strike <= heatmapViewport.strikeMax &&
        expSet.has(exp)
      );
    });
  }, [allContracts, heatmapViewport]);

  // Compute heatmap aggregates for AI context (viewport-only data)
  const heatmapAggregates = useMemo(() => {
    if (visibleContracts.length === 0) return null;

    let totalCallOI = 0;
    let totalPutOI = 0;
    const strikeSet = new Set<number>();
    const expSet = new Set<string>();

    // Maps for per-strike and per-expiration aggregation
    const strikeMap = new Map<number, { callOi: number; putOi: number }>();
    const expMap = new Map<string, { totalCallOi: number; totalPutOi: number }>();
    // All cells for topCells extraction
    const allCells: Array<{ exp: string; strike: number; type: string; oi: number }> = [];

    for (const contract of visibleContracts) {
      const strike = contract.strike ?? 0;
      const oi = contract.oi ?? 0;
      const exp = contract.expiration ?? "";
      const type = contract.optionType ?? "";
      strikeSet.add(strike);
      if (exp) expSet.add(exp);

      // Per-strike aggregation
      const strikeData = strikeMap.get(strike) || { callOi: 0, putOi: 0 };
      if (type === "call") {
        strikeData.callOi += oi;
        totalCallOI += oi;
      } else if (type === "put") {
        strikeData.putOi += oi;
        totalPutOI += oi;
      }
      strikeMap.set(strike, strikeData);

      // Per-expiration aggregation
      if (exp) {
        const expData = expMap.get(exp) || { totalCallOi: 0, totalPutOi: 0 };
        if (type === "call") {
          expData.totalCallOi += oi;
        } else if (type === "put") {
          expData.totalPutOi += oi;
        }
        expMap.set(exp, expData);
      }

      // Collect all cells for topCells
      if (oi > 0 && exp) {
        allCells.push({ exp, strike, type, oi });
      }
    }

    const strikes = Array.from(strikeSet).sort((a, b) => a - b);
    const expirations = Array.from(expSet).sort();

    // Compute strike step: use mode of deltas for irregular strikes
    let strikeStep: number | "mixed" = 1;
    if (strikes.length > 1) {
      const deltas: number[] = [];
      for (let i = 1; i < strikes.length; i++) {
        deltas.push(Math.round((strikes[i] - strikes[i - 1]) * 100) / 100); // Round to avoid floating point issues
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
      strikeStep = modeCount / deltas.length >= 0.8 ? modeValue : "mixed";
    }

    // Build perStrike array (ALL strikes in viewport, sorted by strike)
    const perStrike = Array.from(strikeMap.entries())
      .map(([strike, data]) => ({ strike, callOi: data.callOi, putOi: data.putOi }))
      .sort((a, b) => a.strike - b.strike);

    // Build perExpiration array with pcRatio
    const perExpiration = Array.from(expMap.entries())
      .map(([exp, data]) => ({
        exp,
        totalCallOi: data.totalCallOi,
        totalPutOi: data.totalPutOi,
        pcRatio: data.totalCallOi > 0 ? Number((data.totalPutOi / data.totalCallOi).toFixed(2)) : 0,
      }))
      .sort((a, b) => a.exp.localeCompare(b.exp));

    // Build topCells (top K cells by OI across entire viewport)
    const topCellsCount = AI_CONTEXT_CONFIG.heatmap.topCellsCount;
    const topCells = allCells
      .sort((a, b) => b.oi - a.oi)
      .slice(0, topCellsCount);

    return {
      totalCallOI,
      totalPutOI,
      strikeMin: strikes[0] ?? 0,
      strikeMax: strikes[strikes.length - 1] ?? 0,
      strikeStep,
      strikeCount: strikes.length,
      expirations,
      perStrike,
      perExpiration,
      topCells,
    };
  }, [visibleContracts]);

  // Expose heatmap context to CopilotKit AI (v4 - viewport-only)
  // Only send when we have real data; otherwise null to avoid AI misinterpreting empty arrays as "no OI"
  useCopilotReadable({
    description: "OptChain heatmap context (v4). Viewport-only data. perStrike covers ALL visible strikes. topCells has top 12 cells. For specific (strike,exp,type) queries, answer ONLY from focus or topCells; otherwise instruct user to click/hover.",
    value: viewMode === "heatmap" && heatmapAggregates ? {
      pageId: "chain_analysis",
      tableId: "heatmap",
      contextVersion: 4,
      timestamp: new Date().toISOString(),

      // Underlying stock info
      underlying: {
        symbol: underlying.symbol,
        price: underlying.price,
        changePct: underlying.changePercent,
      },

      // Viewport: exactly what the UI is showing
      viewport: {
        strikesShown: {
          min: heatmapAggregates.strikeMin,
          max: heatmapAggregates.strikeMax,
          step: heatmapAggregates.strikeStep,
          count: heatmapAggregates.strikeCount,
        },
        expirationsShown: heatmapAggregates.expirations,
        viewMode: heatmapViewport?.viewType ?? "net",
        strikeRange: heatmapViewport?.strikeRange ?? "20",
        expGroup: heatmapViewport?.expGroup ?? "short",
        units: { price: "USD", oi: "contracts" },
      },

      // A) Per-strike totals across expirations SHOWN (answers "OI at $600")
      perStrike: heatmapAggregates.perStrike,

      // B) Per-expiration totals (answers "which expiry is heavy?")
      perExpiration: heatmapAggregates.perExpiration,

      // C) Top cells within the CURRENT viewport (answers "what's the biggest cell I see?")
      topCells: {
        scope: "viewport_only",
        k: AI_CONTEXT_CONFIG.heatmap.topCellsCount,
        cells: heatmapAggregates.topCells,
      },

      // D) Focus: exact cell if user hovered/clicked
      focus: {
        hoveredCell: heatmapHoveredCell,
        selectedCell: heatmapSelectedCell,
      },

      // E) Guardrails for AI
      availability: {
        isCompleteForViewport: true,
        cellLevelCoverage: "topK_plus_focus",
        exactCellOiRule: "Exact OI per (strike,exp,type) is available only if it is the selected/hovered cell OR it appears in topCells. Otherwise say: 'Click or hover that cell to retrieve the exact value.'",
      },
    } : null,
  });

  // Compute tornado aggregates and distribution for AI context
  const tornadoData = useMemo(() => {
    if (displayCalls.length === 0 && displayPuts.length === 0) return null;

    const oiByStrike = new Map<number, { callOI: number; putOI: number }>();
    let totalCallOI = 0;
    let totalPutOI = 0;
    let maxCallOIStrike = { strike: 0, oi: 0 };
    let maxPutOIStrike = { strike: 0, oi: 0 };

    for (const call of displayCalls) {
      const existing = oiByStrike.get(call.strike) || { callOI: 0, putOI: 0 };
      existing.callOI += call.oi;
      oiByStrike.set(call.strike, existing);
      totalCallOI += call.oi;
      if (call.oi > maxCallOIStrike.oi) {
        maxCallOIStrike = { strike: call.strike, oi: call.oi };
      }
    }
    for (const put of displayPuts) {
      const existing = oiByStrike.get(put.strike) || { callOI: 0, putOI: 0 };
      existing.putOI += put.oi;
      oiByStrike.set(put.strike, existing);
      totalPutOI += put.oi;
      if (put.oi > maxPutOIStrike.oi) {
        maxPutOIStrike = { strike: put.strike, oi: put.oi };
      }
    }

    const strikes = Array.from(oiByStrike.keys()).sort((a, b) => a - b);
    const pcRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
    const netOiBias = pcRatio > 1.2 ? "put" : pcRatio < 0.8 ? "call" : "neutral";

    const distribution = strikes.map((strike) => {
      const data = oiByStrike.get(strike)!;
      return { strike, callOI: data.callOI, putOI: data.putOI };
    });

    return {
      aggregates: {
        totalCallOI,
        totalPutOI,
        pcRatio: Number(pcRatio.toFixed(2)),
        maxCallOIStrike,
        maxPutOIStrike,
        netOiBias,
        strikeMin: strikes[0] ?? 0,
        strikeMax: strikes[strikes.length - 1] ?? 0,
        strikeCount: strikes.length,
      },
      distribution,
    };
  }, [displayCalls, displayPuts]);

  // Expose tornado context to CopilotKit AI (v3)
  // Only send when we have real data; otherwise null to avoid AI misinterpreting
  useCopilotReadable({
    description: "OptChain tornado chart context (v3)",
    value: viewMode === "tornado" && tornadoData ? {
      pageId: "chain_analysis",
      tableId: "tornado",
      contextVersion: 3,
      timestamp: new Date().toISOString(),
      underlying: {
        symbol: underlying.symbol,
        price: underlying.price,
        changePct: underlying.changePercent,
      },
      viewport: {
        strikeMin: tornadoData.aggregates.strikeMin,
        strikeMax: tornadoData.aggregates.strikeMax,
        strikeCount: tornadoData.aggregates.strikeCount,
      },
      aggregates: {
        totalCallOI: tornadoData.aggregates.totalCallOI,
        totalPutOI: tornadoData.aggregates.totalPutOI,
        pcRatio: tornadoData.aggregates.pcRatio,
        maxCallOIStrike: tornadoData.aggregates.maxCallOIStrike,
        maxPutOIStrike: tornadoData.aggregates.maxPutOIStrike,
        netOiBias: tornadoData.aggregates.netOiBias,
      },
      distribution: (() => {
        const maxStrikes = AI_CONTEXT_CONFIG.tornado.maxStrikes;
        const dist = tornadoData.distribution;
        const truncated = dist.length > maxStrikes;
        // Cap around center (ATM area)
        let strikes = dist;
        if (truncated) {
          const center = Math.floor(dist.length / 2);
          const half = Math.floor(maxStrikes / 2);
          strikes = dist.slice(Math.max(0, center - half), center + half);
        }
        return {
          byStrike: strikes.map(row => ({
            strike: row.strike,
            callOI: row.callOI,
            putOI: row.putOI,
          })),
          truncated,
          totalStrikesInView: dist.length,
        };
      })(),
      focus: {
        hoveredStrike: tornadoHoveredStrike,
        selectedStrike: tornadoSelectedStrike,
      },
      visualization: {
        type: "mirror_horizontal_bar",
        leftSide: "calls",
        rightSide: "puts",
        zeroLine: true,
      },
      units: { price: "USD", oi: "contracts" },
    } : null,
  });

  const isITM = (strike: number, type: "call" | "put") => {
    if (type === "call") return strike < underlying.price;
    return strike > underlying.price;
  };

  // Find the single ATM strike (closest to underlying price)
  const atmStrike = useMemo(() => {
    if (calls.length === 0) return null;
    return calls[strikeWindow.atmIndex]?.strike ?? null;
  }, [calls, strikeWindow.atmIndex]);

  const isATM = (strike: number) => {
    return atmStrike !== null && strike === atmStrike;
  };


  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stock Info Card */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Symbol Search */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xs lg:max-w-[300px]">
            <div className="relative">
              {isLoading ? (
                <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
              ) : (
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              )}
              <input
                type="text"
                value={inputSymbol}
                onChange={(e) => setInputSymbol(e.target.value.toUpperCase())}
                placeholder="Search (e.g. QQQ, SPY), Press Enter"
                className="w-full pl-9 pr-4 py-2.5 sm:py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          </form>

          {/* Price Info - Right aligned, single line, no wrap */}
          {underlying.symbol && (
            <div className="flex items-center gap-x-2 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap ml-auto">
              <span className="font-bold text-blue-600 dark:text-blue-400">{underlying.symbol}</span>
              <span className="font-bold text-gray-900 dark:text-white">{formatCurrency(underlying.price)}</span>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-gray-500 dark:text-gray-400">Prev Close:</span>
              <span className="font-medium">{formatCurrency(underlying.prevClose)}</span>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-gray-500 dark:text-gray-400">Day Change:</span>
              <span className={cn(
                "font-medium",
                underlying.change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
              )}>
                {underlying.change >= 0 ? "+" : ""}{underlying.change.toFixed(2)} ({underlying.change >= 0 ? "+" : ""}{underlying.changePercent.toFixed(2)}%)
              </span>
              {underlying.priceTimestamp && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-gray-500 dark:text-gray-400">As of:</span>
                  <span className="font-medium">
                    {new Date(underlying.priceTimestamp).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!symbol && !isLoading && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-8 text-center">
          <Search className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Enter a Stock Symbol
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Type a ticker symbol (e.g., AAPL, NVDA, TSLA) and press Enter to view options chain data.
          </p>
        </div>
      )}

      {/* Key Insights for Current Expiration */}
      {symbol && insights && (
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
        {/* Desktop: Grouped layout - Context | Positioning | Risk */}
        <div className="hidden sm:flex items-stretch">
          {/* === CONTEXT GROUP === */}
          <div className="flex items-stretch border-r-2 border-gray-200 dark:border-slate-600">
            {/* Expiry */}
            <div className="px-4 py-3 flex flex-col justify-center bg-gray-50 dark:bg-slate-700/50 border-r border-gray-100 dark:border-slate-700">
              <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Expires</div>
              <div className="text-base font-bold text-gray-900 dark:text-white whitespace-nowrap">
                {new Date(selectedExpiration + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            </div>
            {/* Max OI Strike */}
            <div className="px-4 py-3 flex flex-col justify-center bg-blue-50/50 dark:bg-blue-900/10">
              <div className="text-[10px] uppercase tracking-wide text-blue-500 dark:text-blue-400 font-medium">Max OI</div>
              <div className="text-base font-bold text-gray-900 dark:text-white">${insights.heaviestStrike}</div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500">{formatCompactNumber(insights.heaviestStrikeOI)} (C+P)</div>
            </div>
          </div>

          {/* === POSITIONING GROUP (dominant) === */}
          <div className="flex-1 flex items-stretch bg-gradient-to-b from-gray-50/50 to-white dark:from-slate-700/30 dark:to-slate-800 border-r-2 border-gray-200 dark:border-slate-600">
            {/* OI Contracts */}
            <div className="flex-1 px-4 py-3 border-r border-gray-100 dark:border-slate-700">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium mb-1">Contracts</div>
              <div className="flex items-center gap-3">
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-green-600 dark:text-green-400">{formatCompactNumber(insights.totalCallOI)}</span>
                  <span className="text-[10px] text-gray-400">C</span>
                </div>
                <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden flex min-w-[60px]">
                  <div className="bg-green-500 dark:bg-green-400 h-full" style={{ width: `${insights.callPercent}%` }} />
                  <div className="bg-red-500 dark:bg-red-400 h-full" style={{ width: `${100 - insights.callPercent}%` }} />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-red-600 dark:text-red-400">{formatCompactNumber(insights.totalPutOI)}</span>
                  <span className="text-[10px] text-gray-400">P</span>
                </div>
              </div>
            </div>

            {/* OI Value */}
            <div className="flex-1 px-4 py-3 border-r border-gray-100 dark:border-slate-700">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium mb-1">Value</div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-green-600 dark:text-green-400">${formatCompactNumber(insights.callValue)}</span>
                <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden flex min-w-[60px]">
                  <div className="bg-green-500 dark:bg-green-400 h-full" style={{ width: `${insights.callValuePercent}%` }} />
                  <div className="bg-red-500 dark:bg-red-400 h-full" style={{ width: `${100 - insights.callValuePercent}%` }} />
                </div>
                <span className="text-lg font-bold text-red-600 dark:text-red-400">${formatCompactNumber(insights.putValue)}</span>
              </div>
            </div>

            {/* P/C Ratio */}
            <div className={cn(
              "px-5 py-3 flex flex-col justify-center",
              insights.pcRatio > 1.2 ? "bg-red-50 dark:bg-red-900/20" :
              insights.pcRatio < 0.8 ? "bg-green-50 dark:bg-green-900/20" : ""
            )}>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">P/C</div>
              <div className={cn(
                "text-2xl font-bold",
                insights.pcRatio > 1.2 ? "text-red-600 dark:text-red-400" :
                insights.pcRatio < 0.8 ? "text-green-600 dark:text-green-400" :
                "text-gray-900 dark:text-white"
              )}>
                {insights.pcRatio.toFixed(2)}
              </div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500">
                {insights.pcRatio > 1.2 ? "Put heavy" : insights.pcRatio < 0.8 ? "Call heavy" : "Balanced"}
              </div>
            </div>
          </div>

          {/* === RISK GROUP (de-emphasized) === */}
          <div className="px-4 py-3 flex flex-col justify-center bg-gray-50/50 dark:bg-slate-700/20">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Avg IV</div>
            <div className="text-base font-medium text-gray-600 dark:text-gray-300">{(insights.avgIV * 100).toFixed(1)}%</div>
          </div>
        </div>

        {/* Mobile: Grouped compact layout */}
        <div className="sm:hidden p-3 space-y-3">
          {/* Context Row */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-100 dark:bg-slate-700 rounded-lg">
              <span className="text-[10px] uppercase text-gray-400 dark:text-gray-500">Exp</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">
                {new Date(selectedExpiration + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <span className="text-[10px] uppercase text-blue-500 dark:text-blue-400">Max OI</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">${insights.heaviestStrike}</span>
            </div>
            <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-gray-500 dark:text-gray-400">
              <span className="text-[10px] uppercase">IV</span>
              <span className="text-sm font-medium">{(insights.avgIV * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* Positioning Section (dominant) */}
          <div className="bg-gray-50 dark:bg-slate-700/30 rounded-lg p-2.5 space-y-2">
            {/* P/C Ratio - prominent */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-gray-500 dark:text-gray-400 font-medium">Positioning</span>
              <div className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded",
                insights.pcRatio > 1.2 ? "bg-red-100 dark:bg-red-900/30" :
                insights.pcRatio < 0.8 ? "bg-green-100 dark:bg-green-900/30" :
                "bg-gray-100 dark:bg-slate-600"
              )}>
                <span className="text-[10px] text-gray-500 dark:text-gray-400">P/C</span>
                <span className={cn(
                  "text-base font-bold",
                  insights.pcRatio > 1.2 ? "text-red-600 dark:text-red-400" :
                  insights.pcRatio < 0.8 ? "text-green-600 dark:text-green-400" :
                  "text-gray-900 dark:text-white"
                )}>
                  {insights.pcRatio.toFixed(2)}
                </span>
              </div>
            </div>
            {/* OI Contracts bar */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-green-600 dark:text-green-400 w-10 text-right">{formatCompactNumber(insights.totalCallOI)}</span>
              <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden flex">
                <div className="bg-green-500 dark:bg-green-400 h-full" style={{ width: `${insights.callPercent}%` }} />
                <div className="bg-red-500 dark:bg-red-400 h-full" style={{ width: `${100 - insights.callPercent}%` }} />
              </div>
              <span className="text-xs font-bold text-red-600 dark:text-red-400 w-10">{formatCompactNumber(insights.totalPutOI)}</span>
              <span className="text-[9px] text-gray-400 w-6">OI</span>
            </div>
            {/* OI Value bar */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-green-600 dark:text-green-400 w-10 text-right">${formatCompactNumber(insights.callValue)}</span>
              <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden flex">
                <div className="bg-green-500 dark:bg-green-400 h-full" style={{ width: `${insights.callValuePercent}%` }} />
                <div className="bg-red-500 dark:bg-red-400 h-full" style={{ width: `${100 - insights.callValuePercent}%` }} />
              </div>
              <span className="text-xs font-bold text-red-600 dark:text-red-400 w-10">${formatCompactNumber(insights.putValue)}</span>
              <span className="text-[9px] text-gray-400 w-6">Val</span>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Expiration Selector - Desktop */}
      {expirations.length > 0 && (
      <>
        <div className="hidden sm:block bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-4">
            {/* Segmented Control */}
            <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-1">
              {(["all", "weekly", "monthly", "quarterly", "leaps"] as ExpirationType[]).map((type) => {
                const count = categorizedExpirations[type].length;
                const isDisabled = count === 0;
                const isSelected = expirationType === type;

                return (
                  <button
                    key={type}
                    onClick={() => !isDisabled && handleTypeChange(type)}
                    disabled={isDisabled}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded-md transition-all capitalize",
                      isSelected
                        ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                        : isDisabled
                        ? "text-gray-400 dark:text-gray-500 cursor-not-allowed"
                        : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                    )}
                  >
                    {type === "leaps" ? "LEAPS" : type === "all" ? "All" : type}
                    {type !== "all" && count > 0 && (
                      <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
                        ({count})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Date Dropdown */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg text-sm font-medium text-gray-900 dark:text-white hover:border-blue-400 dark:hover:border-blue-500 transition-all min-w-[140px]"
              >
                <span>{selectedExpiration ? formatDropdownDate(selectedExpiration) : "Select date"}</span>
                <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform", dropdownOpen && "rotate-180")} />
              </button>

              {dropdownOpen && currentTypeDates.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg z-10 max-h-60 overflow-auto">
                  {currentTypeDates.map((date) => (
                    <button
                      key={date}
                      onClick={() => {
                        setSelectedExpiration(date);
                        setDropdownOpen(false);
                      }}
                      className={cn(
                        "w-full px-4 py-2 text-left text-sm transition-colors",
                        selectedExpiration === date
                          ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-600"
                      )}
                    >
                      {formatDropdownDate(date)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Expiration Selector - Mobile (Trigger for Bottom Sheet) */}
        <div className="sm:hidden">
          <button
            onClick={() => setBottomSheetOpen(true)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700"
          >
            <div className="text-left">
              <div className="text-xs text-gray-500 dark:text-gray-400">Expiration</div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {selectedExpiration ? formatDropdownDate(selectedExpiration) : "Select date"}
                <span className="text-gray-400 dark:text-gray-500 ml-1 capitalize">• {expirationType}</span>
              </div>
            </div>
            <ChevronDown className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        {/* Mobile Bottom Sheet */}
        {bottomSheetOpen && (
          <div className="sm:hidden fixed inset-0 z-50">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setBottomSheetOpen(false)}
            />
            {/* Sheet */}
            <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-800 rounded-t-2xl max-h-[80vh] overflow-hidden animate-in slide-in-from-bottom duration-300">
              {/* Handle */}
              <div className="flex justify-center py-3">
                <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
              </div>

              {/* Header */}
              <div className="px-4 pb-3 border-b border-gray-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Select Expiration</h3>
              </div>

              {/* Segmented Control */}
              <div className="p-4 border-b border-gray-200 dark:border-slate-700">
                <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-1">
                  {(["all", "weekly", "monthly", "quarterly", "leaps"] as ExpirationType[]).map((type) => {
                    const count = categorizedExpirations[type].length;
                    const isDisabled = count === 0;
                    const isSelected = expirationType === type;

                    return (
                      <button
                        key={type}
                        onClick={() => !isDisabled && handleTypeChange(type)}
                        disabled={isDisabled}
                        className={cn(
                          "flex-1 px-2 py-2 text-xs font-medium rounded-md transition-all capitalize",
                          isSelected
                            ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                            : isDisabled
                            ? "text-gray-400 dark:text-gray-500 cursor-not-allowed"
                            : "text-gray-600 dark:text-gray-300"
                        )}
                      >
                        {type === "leaps" ? "LEAPS" : type === "all" ? "All" : type}
                        {type !== "all" && count > 0 && <span className="block text-[10px] text-gray-400">({count})</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Date List */}
              <div className="overflow-auto max-h-[50vh] p-2">
                {currentTypeDates.map((date) => (
                  <button
                    key={date}
                    onClick={() => {
                      setSelectedExpiration(date);
                      setBottomSheetOpen(false);
                    }}
                    className={cn(
                      "w-full px-4 py-3 text-left rounded-lg transition-colors",
                      selectedExpiration === date
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                        : "text-gray-700 dark:text-gray-300 active:bg-gray-100 dark:active:bg-slate-700"
                    )}
                  >
                    {formatDropdownDate(date)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </>
      )}

      {/* Options Chain Table / Heatmap */}
      {symbol && (calls.length > 0 || puts.length > 0) && (
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
        {/* Table Header with Toggle */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
              {viewMode === "chain" ? `Options Chain - ${selectedExpiration}` : viewMode === "heatmap" ? "OI Heatmap" : "OI Tornado"}
            </h2>
            {/* Tornado filter selector (tornado view only) */}
            {viewMode === "tornado" && (
              <div className="hidden sm:flex items-center gap-1 text-xs">
                {(["both", "calls", "puts"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setTornadoFilter(filter)}
                    className={cn(
                      "px-2 py-1 rounded transition-all capitalize",
                      tornadoFilter === filter
                        ? filter === "calls" ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-medium"
                        : filter === "puts" ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium"
                        : "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                    )}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            )}
            {/* Strike window size selector (chain view only) */}
            {viewMode === "chain" && (
              <div className="hidden sm:flex items-center gap-1 text-xs">
                {([5, 10, 20, "all"] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setStrikeWindowSize(size)}
                    className={cn(
                      "px-2 py-1 rounded transition-all",
                      strikeWindowSize === size
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                    )}
                  >
                    {size === "all" ? "All" : `±${size}`}
                  </button>
                ))}
              </div>
            )}
            {/* Strike window size selector (tornado view - larger ranges) */}
            {viewMode === "tornado" && (
              <div className="hidden sm:flex items-center gap-1 text-xs">
                {([10, 20, 40, "all"] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setTornadoStrikeWindow(size)}
                    className={cn(
                      "px-2 py-1 rounded transition-all",
                      tornadoStrikeWindow === size
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                    )}
                  >
                    {size === "all" ? "All" : `±${size}`}
                  </button>
                ))}
              </div>
            )}
            {/* View mode toggle */}
            <div className="hidden sm:flex items-center gap-1 ml-2 border-l border-gray-200 dark:border-slate-700 pl-3">
              <button
                onClick={() => setViewMode("chain")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-xs rounded transition-all",
                  viewMode === "chain"
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                )}
              >
                <List className="h-3.5 w-3.5" />
                Chain
              </button>
              <button
                onClick={() => setViewMode("heatmap")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-xs rounded transition-all",
                  viewMode === "heatmap"
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                )}
              >
                <Grid3X3 className="h-3.5 w-3.5" />
                Heatmap
              </button>
              <button
                onClick={() => setViewMode("tornado")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-xs rounded transition-all",
                  viewMode === "tornado"
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Tornado
              </button>
            </div>
          </div>

          {/* Desktop: Checkboxes (chain view only) */}
          {viewMode === "chain" && (
            <div className="hidden sm:flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCalls}
                  onChange={(e) => setShowCalls(e.target.checked)}
                  className="rounded border-gray-300 text-green-500 focus:ring-green-500"
                />
                <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                  Calls
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPuts}
                  onChange={(e) => setShowPuts(e.target.checked)}
                  className="rounded border-gray-300 text-red-500 focus:ring-red-500"
                />
                <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                  Puts
                </span>
              </label>
            </div>
          )}

          {/* Mobile: Segmented Control + Window Size (chain view only) */}
          {viewMode === "chain" && (
            <div className="sm:hidden flex items-center gap-2">
              {/* Window size selector for mobile */}
              <div className="flex items-center gap-0.5 text-xs bg-gray-100 dark:bg-slate-700 rounded-md p-0.5">
                {([5, 10, "all"] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setStrikeWindowSize(size === 5 ? 5 : size === 10 ? 10 : "all")}
                    className={cn(
                      "px-1.5 py-1 rounded transition-all",
                      strikeWindowSize === size
                        ? "bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 font-medium shadow-sm"
                        : "text-gray-500 dark:text-gray-400"
                    )}
                  >
                    {size === "all" ? "All" : `±${size}`}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-0.5">
                <button
                  onClick={() => setMobileView("calls")}
                  className={cn(
                    "px-4 py-1.5 text-xs font-medium rounded-md transition-all",
                    mobileView === "calls"
                      ? "bg-green-500 text-white shadow-sm"
                      : "text-gray-600 dark:text-gray-300"
                  )}
                >
                  Calls
                </button>
                <button
                  onClick={() => setMobileView("puts")}
                  className={cn(
                    "px-4 py-1.5 text-xs font-medium rounded-md transition-all",
                    mobileView === "puts"
                      ? "bg-red-500 text-white shadow-sm"
                      : "text-gray-600 dark:text-gray-300"
                  )}
                >
                  Puts
                </button>
              </div>
            </div>
          )}
          {/* Mobile: View toggle for heatmap */}
          {viewMode === "heatmap" && (
            <div className="sm:hidden flex items-center gap-1 text-xs bg-gray-100 dark:bg-slate-700 rounded-md p-0.5">
              <button
                onClick={() => setViewMode("chain")}
                className="flex items-center gap-1 px-2 py-1 rounded text-gray-500 dark:text-gray-400"
              >
                <List className="h-3 w-3" />
                Chain
              </button>
              <button
                onClick={() => setViewMode("heatmap")}
                className="flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 font-medium shadow-sm"
              >
                <Grid3X3 className="h-3 w-3" />
                Heatmap
              </button>
            </div>
          )}
        </div>

        {/* Mobile Card View - Single type only (chain view) */}
        {viewMode === "chain" && (
          <div className="sm:hidden divide-y divide-gray-200 dark:divide-slate-700">
            {(mobileView === "calls" ? displayCalls : displayPuts).map((option) => {
              const optionType = mobileView === "calls" ? "call" : "put";
              const colorClass = mobileView === "calls"
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400";
              const bgClass = mobileView === "calls"
                ? isITM(option.strike, "call") ? "bg-green-50 dark:bg-green-900/20" : "bg-gray-50 dark:bg-slate-700/50"
                : isITM(option.strike, "put") ? "bg-red-50 dark:bg-red-900/20" : "bg-gray-50 dark:bg-slate-700/50";

              return (
                <div key={option.strike} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={cn(
                        "px-3 py-1 rounded-lg font-bold",
                        isATM(option.strike)
                          ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                          : "bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white"
                      )}
                    >
                      ${option.strike}
                      {isATM(option.strike) && <span className="ml-1 text-xs font-normal">ATM</span>}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900 dark:text-white">
                        {formatCurrency(option.last)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {option.bid.toFixed(2)} / {option.ask.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className={cn("p-3 rounded-lg", bgClass)}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={cn("text-xs font-semibold uppercase", colorClass)}>
                        {optionType} {isITM(option.strike, optionType) && "(ITM)"}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">IV</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {(option.iv * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Delta</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {option.delta.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Vol</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {formatCompactNumber(option.volume)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">OI</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {formatCompactNumber(option.oi)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Desktop Table View (chain view) */}
        {viewMode === "chain" && (
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50">
                {/* Single-side view: Strike first, then full option data */}
                {showCalls && !showPuts && (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-900 dark:text-white uppercase bg-gray-100 dark:bg-slate-600">
                      Strike
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Bid
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Ask
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Last
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Vol
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      OI
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      IV
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Delta
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Gamma
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Theta
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Vega
                    </th>
                  </>
                )}
                {!showCalls && showPuts && (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-900 dark:text-white uppercase bg-gray-100 dark:bg-slate-600">
                      Strike
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Bid
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Ask
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Last
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Vol
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      OI
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      IV
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Delta
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Gamma
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Theta
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Vega
                    </th>
                  </>
                )}
                {/* Both sides view: Calls | Strike | Puts */}
                {showCalls && showPuts && (
                  <>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      OI
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Vol
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      IV
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Delta
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Bid
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                      Ask
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-900 dark:text-white uppercase bg-gray-100 dark:bg-slate-600">
                      Strike
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Bid
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Ask
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Delta
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      IV
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      Vol
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                      OI
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {displayCalls.map((call, idx) => {
                const put = displayPuts[idx];
                const atmClass = isATM(call.strike)
                  ? "bg-yellow-50 dark:bg-yellow-900/20"
                  : "";
                // ITM highlighting: text color only (no background) for a calmer look
                const callItmClass = isITM(call.strike, "call") ? "text-green-600 dark:text-green-400" : "";
                const putItmClass = isITM(put.strike, "put") ? "text-red-600 dark:text-red-400" : "";

                // Check if this row's contract is selected
                const isCallSelected = selectedContract?.type === "call" && selectedContract?.contract.strike === call.strike;
                const isPutSelected = selectedContract?.type === "put" && selectedContract?.contract.strike === put.strike;

                return (
                  <tr key={call.strike} className={cn("hover:bg-gray-50 dark:hover:bg-slate-700/50", atmClass)}>
                    {/* Calls Only View: Strike first, then full option data with all Greeks */}
                    {showCalls && !showPuts && (
                      <>
                        <td className="px-4 py-2.5 text-left font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-600">
                          ${call.strike}
                        </td>
                        <td className={cn("px-3 py-2.5 font-medium text-gray-900 dark:text-white", callItmClass)}>{call.bid.toFixed(2)}</td>
                        <td className={cn("px-3 py-2.5 font-medium text-gray-900 dark:text-white", callItmClass)}>{call.ask.toFixed(2)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>{call.last.toFixed(2)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>{formatCompactNumber(call.volume)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>{formatCompactNumber(call.oi)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>{(call.iv * 100).toFixed(1)}%</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>{call.delta.toFixed(3)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>{call.gamma.toFixed(4)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>{call.theta.toFixed(3)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>{call.vega.toFixed(3)}</td>
                      </>
                    )}
                    {/* Puts Only View: Strike first, then full option data with all Greeks */}
                    {!showCalls && showPuts && (
                      <>
                        <td className="px-4 py-2.5 text-left font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-600">
                          ${put.strike}
                        </td>
                        <td className={cn("px-3 py-2.5 font-medium text-gray-900 dark:text-white", putItmClass)}>{put.bid.toFixed(2)}</td>
                        <td className={cn("px-3 py-2.5 font-medium text-gray-900 dark:text-white", putItmClass)}>{put.ask.toFixed(2)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>{put.last.toFixed(2)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>{formatCompactNumber(put.volume)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>{formatCompactNumber(put.oi)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>{(put.iv * 100).toFixed(1)}%</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>{put.delta.toFixed(3)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>{put.gamma.toFixed(4)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>{put.theta.toFixed(3)}</td>
                        <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>{put.vega.toFixed(3)}</td>
                      </>
                    )}
                    {/* Both Sides View: Calls | Strike | Puts (original layout) */}
                    {showCalls && showPuts && (
                      <>
                        {/* Call side - clickable for AI context */}
                        <td
                          className={cn(
                            "px-3 py-2.5 text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                            callItmClass,
                            isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isCallSelected ? null : { type: "call", contract: call })}
                        >{formatCompactNumber(call.oi)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                            callItmClass,
                            isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isCallSelected ? null : { type: "call", contract: call })}
                        >{formatCompactNumber(call.volume)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                            callItmClass,
                            isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isCallSelected ? null : { type: "call", contract: call })}
                        >{(call.iv * 100).toFixed(1)}%</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                            callItmClass,
                            isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isCallSelected ? null : { type: "call", contract: call })}
                        >{call.delta.toFixed(2)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 font-medium text-gray-900 dark:text-white cursor-pointer transition-colors",
                            callItmClass,
                            isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isCallSelected ? null : { type: "call", contract: call })}
                        >{call.bid.toFixed(2)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 font-medium text-gray-900 dark:text-white cursor-pointer transition-colors",
                            callItmClass,
                            isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isCallSelected ? null : { type: "call", contract: call })}
                        >{call.ask.toFixed(2)}</td>

                        {/* Strike column - center divider */}
                        <td className="px-4 py-2.5 text-center font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-600">
                          ${call.strike}
                        </td>

                        {/* Put side - clickable for AI context */}
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white cursor-pointer transition-colors",
                            putItmClass,
                            isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isPutSelected ? null : { type: "put", contract: put })}
                        >{put.bid.toFixed(2)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white cursor-pointer transition-colors",
                            putItmClass,
                            isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isPutSelected ? null : { type: "put", contract: put })}
                        >{put.ask.toFixed(2)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                            putItmClass,
                            isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isPutSelected ? null : { type: "put", contract: put })}
                        >{put.delta.toFixed(2)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                            putItmClass,
                            isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isPutSelected ? null : { type: "put", contract: put })}
                        >{(put.iv * 100).toFixed(1)}%</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                            putItmClass,
                            isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isPutSelected ? null : { type: "put", contract: put })}
                        >{formatCompactNumber(put.volume)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                            putItmClass,
                            isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                          )}
                          onClick={() => setSelectedContract(isPutSelected ? null : { type: "put", contract: put })}
                        >{formatCompactNumber(put.oi)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>
        )}

        {/* Heatmap View */}
        {viewMode === "heatmap" && (
          <div className="p-4">
            {loadingHeatmap ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <span className="ml-3 text-gray-500 dark:text-gray-400">Loading heatmap data...</span>
              </div>
            ) : allContracts.length > 0 ? (
              <OIHeatmap
                contracts={allContracts}
                underlyingPrice={underlying.price}
                onCellClick={handleHeatmapCellClick}
                onViewportChange={setHeatmapViewport}
                onHoverCell={setHeatmapHoveredCell}
                onSelectCell={setHeatmapSelectedCell}
              />
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                No heatmap data available. Try switching to a different symbol.
              </div>
            )}
          </div>
        )}

        {/* Tornado View */}
        {viewMode === "tornado" && (
          <div className="p-4">
            {(() => {
              // Tornado chart configuration
              const CHART_HEIGHT = 560; // Fixed height in px
              const MAX_ROWS_DESKTOP = 50;
              const MAX_ROWS_MOBILE = 30;
              const MIN_ROW_HEIGHT = 16; // px
              const MAX_ROW_HEIGHT = 28; // px
              const maxRows = isDesktop ? MAX_ROWS_DESKTOP : MAX_ROWS_MOBILE;

              // Filter flags
              const showCalls = tornadoFilter === "both" || tornadoFilter === "calls";
              const showPuts = tornadoFilter === "both" || tornadoFilter === "puts";

              // Build OI by strike from full calls/puts data
              const oiByStrike = new Map<number, { callOI: number; putOI: number }>();
              for (const call of calls) {
                const existing = oiByStrike.get(call.strike) || { callOI: 0, putOI: 0 };
                existing.callOI += call.oi;
                oiByStrike.set(call.strike, existing);
              }
              for (const put of puts) {
                const existing = oiByStrike.get(put.strike) || { callOI: 0, putOI: 0 };
                existing.putOI += put.oi;
                oiByStrike.set(put.strike, existing);
              }

              // Get all strikes sorted
              let allStrikes = Array.from(oiByStrike.keys()).sort((a, b) => a - b);

              if (allStrikes.length === 0) {
                return (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No data available for tornado chart.
                  </div>
                );
              }

              // Find ATM index in all strikes
              const atmIndex = allStrikes.findIndex(s => s >= underlying.price);
              const atmIdx = atmIndex === -1 ? Math.floor(allStrikes.length / 2) : atmIndex;

              // Apply tornado strike window filter
              let filteredStrikes: number[];
              if (tornadoStrikeWindow === "all") {
                filteredStrikes = allStrikes;
              } else {
                const windowSize = tornadoStrikeWindow;
                const startIdx = Math.max(0, atmIdx - windowSize);
                const endIdx = Math.min(allStrikes.length, atmIdx + windowSize + 1);
                filteredStrikes = allStrikes.slice(startIdx, endIdx);
              }

              // Aggregate if too many strikes
              let displayStrikes: Array<{ strike: number; callOI: number; putOI: number; isAggregated?: boolean; rangeLabel?: string }> = [];

              if (filteredStrikes.length > maxRows) {
                // Aggregate strikes into buckets
                const bucketSize = Math.ceil(filteredStrikes.length / maxRows);
                for (let i = 0; i < filteredStrikes.length; i += bucketSize) {
                  const bucket = filteredStrikes.slice(i, Math.min(i + bucketSize, filteredStrikes.length));
                  let totalCallOI = 0;
                  let totalPutOI = 0;
                  for (const s of bucket) {
                    const data = oiByStrike.get(s)!;
                    totalCallOI += data.callOI;
                    totalPutOI += data.putOI;
                  }
                  const midStrike = bucket[Math.floor(bucket.length / 2)];
                  displayStrikes.push({
                    strike: midStrike,
                    callOI: totalCallOI,
                    putOI: totalPutOI,
                    isAggregated: bucket.length > 1,
                    rangeLabel: bucket.length > 1 ? `${bucket[0]}-${bucket[bucket.length - 1]}` : undefined,
                  });
                }
              } else {
                displayStrikes = filteredStrikes.map(strike => ({
                  strike,
                  ...oiByStrike.get(strike)!,
                }));
              }

              // Calculate adaptive row height
              const visibleRows = displayStrikes.length;
              const rowHeight = Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, Math.floor(CHART_HEIGHT / visibleRows)));

              // Find max OI for scaling
              let maxOI = 0;
              for (const data of displayStrikes) {
                if (showCalls) maxOI = Math.max(maxOI, data.callOI);
                if (showPuts) maxOI = Math.max(maxOI, data.putOI);
              }

              return (
                <div className="flex flex-col">
                  {/* Header */}
                  <div className="flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 px-1">
                    {showCalls && <div className="flex-1 text-right pr-2">Calls OI</div>}
                    <div className="w-20 text-center">Strike</div>
                    {showPuts && <div className="flex-1 text-left pl-2">Puts OI</div>}
                  </div>
                  {/* Scrollable bars container with fixed height */}
                  <div
                    className="overflow-y-auto space-y-0.5"
                    style={{ height: `${CHART_HEIGHT}px` }}
                  >
                    {displayStrikes.map((row) => {
                      const callWidth = maxOI > 0 ? (row.callOI / maxOI) * 100 : 0;
                      const putWidth = maxOI > 0 ? (row.putOI / maxOI) * 100 : 0;
                      const isATMStrike = atmStrike !== null && row.strike === atmStrike;
                      const isITMCall = row.strike < underlying.price;
                      const isITMPut = row.strike > underlying.price;
                      const isSelected = tornadoSelectedStrike === row.strike;
                      const isHovered = tornadoHoveredStrike === row.strike;

                      return (
                        <div
                          key={row.strike}
                          className={cn(
                            "flex items-center rounded cursor-pointer transition-colors",
                            isATMStrike && "bg-yellow-50 dark:bg-yellow-900/20",
                            isSelected && "bg-blue-100 dark:bg-blue-900/30 ring-1 ring-blue-400",
                            !isSelected && isHovered && "bg-gray-100 dark:bg-slate-700/50"
                          )}
                          style={{ height: `${rowHeight}px` }}
                          onMouseEnter={() => setTornadoHoveredStrike(row.strike)}
                          onMouseLeave={() => setTornadoHoveredStrike(null)}
                          onClick={() => setTornadoSelectedStrike(isSelected ? null : row.strike)}
                        >
                          {/* Call bar (right-aligned, grows left) */}
                          {showCalls && (
                            <div className="flex-1 flex justify-end pr-1">
                              <div
                                className={cn(
                                  "rounded-l transition-all",
                                  isITMCall
                                    ? "bg-green-500 dark:bg-green-600"
                                    : "bg-green-300 dark:bg-green-700"
                                )}
                                style={{
                                  width: `${callWidth}%`,
                                  minWidth: callWidth > 0 ? '2px' : '0',
                                  height: `${Math.max(rowHeight - 8, 8)}px`
                                }}
                                title={`Call OI: ${formatCompactNumber(row.callOI)}${row.isAggregated ? ` (${row.rangeLabel})` : ''}`}
                              />
                            </div>
                          )}
                          {/* Strike label */}
                          <div className={cn(
                            "w-20 text-center font-medium px-1 flex-shrink-0",
                            isATMStrike
                              ? "text-yellow-700 dark:text-yellow-400 font-bold"
                              : "text-gray-700 dark:text-gray-300",
                            rowHeight <= 20 ? "text-[10px]" : "text-xs"
                          )}>
                            {row.isAggregated ? row.rangeLabel : `$${row.strike}`}
                          </div>
                          {/* Put bar (left-aligned, grows right) */}
                          {showPuts && (
                            <div className="flex-1 flex justify-start pl-1">
                              <div
                                className={cn(
                                  "rounded-r transition-all",
                                  isITMPut
                                    ? "bg-red-500 dark:bg-red-600"
                                    : "bg-red-300 dark:bg-red-700"
                                )}
                                style={{
                                  width: `${putWidth}%`,
                                  minWidth: putWidth > 0 ? '2px' : '0',
                                  height: `${Math.max(rowHeight - 8, 8)}px`
                                }}
                                title={`Put OI: ${formatCompactNumber(row.putOI)}${row.isAggregated ? ` (${row.rangeLabel})` : ''}`}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Legend */}
                  <div className="flex items-center justify-center gap-4 mt-3 pt-2 border-t border-gray-200 dark:border-slate-700 text-xs text-gray-500 dark:text-gray-400">
                    {showCalls && (
                      <>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded bg-green-500 dark:bg-green-600" />
                          <span>ITM Calls</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded bg-green-300 dark:bg-green-700" />
                          <span>OTM Calls</span>
                        </div>
                      </>
                    )}
                    {showPuts && (
                      <>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded bg-red-500 dark:bg-red-600" />
                          <span>ITM Puts</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded bg-red-300 dark:bg-red-700" />
                          <span>OTM Puts</span>
                        </div>
                      </>
                    )}
                    {displayStrikes.some(s => s.isAggregated) && (
                      <div className="flex items-center gap-1 text-gray-400">
                        <span>• Strikes aggregated</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Help Text */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-slate-700/50 border-t border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Info className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              Click the chat button to ask the AI about strategies, Greeks analysis, or trade recommendations.
            </span>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
