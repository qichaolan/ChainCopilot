"use client";

/**
 * OptionsChainDashboard - Refactored
 * Main orchestration component for the options chain analysis dashboard
 *
 * This component coordinates:
 * - Data fetching via useOptionsData
 * - Expiration management via useExpirations
 * - Strike filtering via useStrikeWindow
 * - AI context exposure via dedicated hooks
 * - View switching between chain, heatmap, and tornado
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Info, Loader2, Grid3X3, List, BarChart3 } from "lucide-react";
import { useOptionsChain, ViewedContract } from "./options-chain/context/OptionsChainContext";
import { cn } from "@/lib/utils";
import { OIHeatmap, HeatmapCellInfo, HeatmapViewport } from "./OIHeatmap";

// Import from options-chain module
import {
  // Types
  ViewMode,
  StrikeWindowSize,
  TornadoStrikeWindow,
  TornadoFilter,
  MobileView,
  SelectedContract,
  HeatmapViewportState,
  HeatmapCellFocus,
  // Hooks
  useOptionsData,
  useExpirations,
  useStrikeWindow,
  useInsights,
  useChainAIContext,
  useHeatmapAIContext,
  useTornadoAIContext,
  // Components
  StockInfoCard,
  InsightsBar,
  ExpirationSelector,
  // Views
  ChainTableView,
  TornadoChartView,
} from "./options-chain";

export function OptionsChainDashboard() {
  // === OPTIONS CHAIN CONTEXT (for LEAPS Builder integration) ===
  const { setChainData } = useOptionsChain();

  // === SYMBOL STATE ===
  const [symbol, setSymbol] = useState("");

  // === VIEW MODE STATE ===
  const [viewMode, setViewMode] = useState<ViewMode>("chain");
  const [showCalls, setShowCalls] = useState(true);
  const [showPuts, setShowPuts] = useState(true);
  const [mobileView, setMobileView] = useState<MobileView>("calls");
  const [strikeWindowSize, setStrikeWindowSize] = useState<StrikeWindowSize>(5);
  const [tornadoStrikeWindow, setTornadoStrikeWindow] = useState<TornadoStrikeWindow>(10);
  const [tornadoFilter, setTornadoFilter] = useState<TornadoFilter>("both");

  // === SELECTION STATE ===
  const [selectedContract, setSelectedContract] = useState<SelectedContract | null>(null);

  // === HEATMAP FOCUS STATE ===
  const [heatmapViewport, setHeatmapViewport] = useState<HeatmapViewportState | null>(null);
  const [heatmapHoveredCell, setHeatmapHoveredCell] = useState<HeatmapCellFocus | null>(null);
  const [heatmapSelectedCell, setHeatmapSelectedCell] = useState<HeatmapCellFocus | null>(null);

  // === TORNADO FOCUS STATE ===
  const [tornadoHoveredStrike, setTornadoHoveredStrike] = useState<number | null>(null);
  const [tornadoSelectedStrike, setTornadoSelectedStrike] = useState<number | null>(null);

  // === RESPONSIVE STATE ===
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktop();
    window.addEventListener("resize", checkDesktop);
    return () => window.removeEventListener("resize", checkDesktop);
  }, []);

  // === DATA HOOKS ===
  const {
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
  } = useOptionsData(symbol);

  // === EXPIRATION MANAGEMENT ===
  const {
    expirationType,
    selectedExpiration,
    categorizedExpirations,
    currentTypeDates,
    handleTypeChange,
    setSelectedExpiration,
    selectClosestExpiration,
  } = useExpirations({ expirations });

  // === STRIKE WINDOW ===
  const strikeWindow = useStrikeWindow({
    calls,
    puts,
    underlyingPrice: underlying.price,
    windowSize: strikeWindowSize,
  });

  const displayCalls = strikeWindow.filteredCalls;
  const displayPuts = strikeWindow.filteredPuts;

  // === INSIGHTS ===
  const insights = useInsights({ calls, puts });

  // === ATM STRIKE ===
  const atmStrike = useMemo(() => {
    if (calls.length === 0) return null;
    return calls[strikeWindow.atmIndex]?.strike ?? null;
  }, [calls, strikeWindow.atmIndex]);

  // === EVENT HANDLERS ===
  const handleSearch = useCallback(
    async (ticker: string) => {
      setSymbol(ticker);
      await fetchExpirations(ticker);
    },
    [fetchExpirations]
  );

  // When expirations are loaded, auto-select closest
  useEffect(() => {
    if (expirations.length > 0 && !selectedExpiration) {
      selectClosestExpiration();
    }
  }, [expirations, selectedExpiration, selectClosestExpiration]);

  // Fetch chain when expiration changes
  useEffect(() => {
    if (symbol && selectedExpiration) {
      fetchOptionsChain(symbol, selectedExpiration);
      setStrikeWindowSize(5);
      setSelectedContract(null);
    }
  }, [symbol, selectedExpiration, fetchOptionsChain]);

  // Populate OptionsChainContext when chain data is loaded (for LEAPS Builder)
  useEffect(() => {
    if (symbol && underlying.price > 0 && (calls.length > 0 || puts.length > 0)) {
      // Calculate DTE from selected expiration
      const dte = selectedExpiration
        ? Math.max(0, Math.ceil((new Date(selectedExpiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;

      // Convert DisplayOption to ViewedContract
      const toViewedContract = (opt: typeof calls[0], type: 'call' | 'put'): ViewedContract => ({
        contractSymbol: `${symbol}${selectedExpiration?.replace(/-/g, '')}${type === 'call' ? 'C' : 'P'}${String(opt.strike * 1000).padStart(8, '0')}`,
        strike: opt.strike,
        expiration: selectedExpiration || '',
        optionType: type,
        mark: (opt.bid + opt.ask) / 2,
        bid: opt.bid,
        ask: opt.ask,
        delta: opt.delta,
        theta: opt.theta,
        gamma: opt.gamma,
        vega: opt.vega,
        iv: opt.iv,
        openInterest: opt.oi,
        volume: opt.volume,
        dte,
      });

      const viewedCalls = calls.map(c => toViewedContract(c, 'call'));
      const viewedPuts = puts.map(p => toViewedContract(p, 'put'));

      setChainData(symbol, underlying.price, expirations, viewedCalls, viewedPuts, selectedExpiration);
    }
  }, [symbol, underlying.price, calls, puts, selectedExpiration, expirations, setChainData]);

  // Load heatmap data when switching to heatmap view
  useEffect(() => {
    if (viewMode === "heatmap" && symbol && allContracts.length === 0 && !loadingHeatmap) {
      loadHeatmapData();
    }
  }, [viewMode, symbol, allContracts.length, loadingHeatmap, loadHeatmapData]);

  // Handle heatmap cell click (drill down)
  const handleHeatmapCellClick = useCallback((expiration: string, _strike: number) => {
    setSelectedExpiration(expiration);
    setViewMode("chain");
  }, [setSelectedExpiration]);

  // Handle heatmap viewport change
  const handleHeatmapViewportChange = useCallback((viewport: HeatmapViewport) => {
    setHeatmapViewport({
      strikeMin: viewport.strikeMin,
      strikeMax: viewport.strikeMax,
      expirationsShown: viewport.expirationsShown,
      viewType: viewport.viewType,
      strikeRange: viewport.strikeRange,
      expGroup: viewport.expGroup,
    });
  }, []);

  // Handle heatmap hover
  const handleHeatmapHover = useCallback((cell: HeatmapCellInfo | null) => {
    setHeatmapHoveredCell(cell);
  }, []);

  // Handle heatmap select
  const handleHeatmapSelect = useCallback((cell: HeatmapCellInfo | null) => {
    setHeatmapSelectedCell(cell);
  }, []);

  // === AI CONTEXT HOOKS (side effects only) ===
  useChainAIContext({
    selectedExpiration,
    underlying: {
      symbol: underlying.symbol,
      price: underlying.price,
      changePercent: underlying.changePercent,
    },
    insights,
    strikeWindowSize,
    displayCalls,
    displayPuts,
    selectedContract,
    atmStrike,
  });

  useHeatmapAIContext({
    viewMode,
    allContracts,
    heatmapViewport,
    heatmapHoveredCell,
    heatmapSelectedCell,
    underlying: {
      symbol: underlying.symbol,
      price: underlying.price,
      changePercent: underlying.changePercent,
    },
  });

  useTornadoAIContext({
    viewMode,
    displayCalls,
    displayPuts,
    underlying: {
      symbol: underlying.symbol,
      price: underlying.price,
      changePercent: underlying.changePercent,
    },
    tornadoHoveredStrike,
    tornadoSelectedStrike,
  });

  // === RENDER ===
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stock Info Card */}
      <StockInfoCard underlying={underlying} isLoading={isLoading} onSearch={handleSearch} />

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
            Type a ticker symbol (e.g., AAPL, NVDA, TSLA) and press Enter to view options chain
            data.
          </p>
        </div>
      )}

      {/* Key Insights */}
      {symbol && insights && (
        <InsightsBar insights={insights} selectedExpiration={selectedExpiration} />
      )}

      {/* Expiration Selector */}
      {expirations.length > 0 && (
        <ExpirationSelector
          expirationType={expirationType}
          selectedExpiration={selectedExpiration}
          categorizedExpirations={categorizedExpirations}
          currentTypeDates={currentTypeDates}
          onTypeChange={handleTypeChange}
          onExpirationChange={setSelectedExpiration}
        />
      )}

      {/* Main Content Area */}
      {symbol && (calls.length > 0 || puts.length > 0) && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
          {/* Header with Controls */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
                {viewMode === "chain"
                  ? `Options Chain - ${selectedExpiration}`
                  : viewMode === "heatmap"
                  ? "OI Heatmap"
                  : "OI Tornado"}
              </h2>

              {/* Tornado filter selector */}
              {viewMode === "tornado" && (
                <div className="hidden sm:flex items-center gap-1 text-xs">
                  {(["both", "calls", "puts"] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setTornadoFilter(filter)}
                      className={cn(
                        "px-2 py-1 rounded transition-all capitalize",
                        tornadoFilter === filter
                          ? filter === "calls"
                            ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-medium"
                            : filter === "puts"
                            ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium"
                            : "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                      )}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              )}

              {/* Strike window size selector (chain view) */}
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

              {/* Strike window size selector (tornado view) */}
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
                  <span className="text-sm text-red-600 dark:text-red-400 font-medium">Puts</span>
                </label>
              </div>
            )}

            {/* Mobile: Controls */}
            {viewMode === "chain" && (
              <div className="sm:hidden flex items-center gap-2">
                <div className="flex items-center gap-0.5 text-xs bg-gray-100 dark:bg-slate-700 rounded-md p-0.5">
                  {([5, 10, "all"] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() =>
                        setStrikeWindowSize(size === 5 ? 5 : size === 10 ? 10 : "all")
                      }
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

          {/* Chain View */}
          {viewMode === "chain" && (
            <ChainTableView
              displayCalls={displayCalls}
              displayPuts={displayPuts}
              underlyingPrice={underlying.price}
              atmStrike={atmStrike}
              showCalls={showCalls}
              showPuts={showPuts}
              mobileView={mobileView}
              selectedContract={selectedContract}
              onSelectContract={setSelectedContract}
            />
          )}

          {/* Heatmap View */}
          {viewMode === "heatmap" && (
            <div className="p-4">
              {loadingHeatmap ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  <span className="ml-3 text-gray-500 dark:text-gray-400">
                    Loading heatmap data...
                  </span>
                </div>
              ) : allContracts.length > 0 ? (
                <OIHeatmap
                  contracts={allContracts}
                  underlyingPrice={underlying.price}
                  onCellClick={handleHeatmapCellClick}
                  onViewportChange={handleHeatmapViewportChange}
                  onHoverCell={handleHeatmapHover}
                  onSelectCell={handleHeatmapSelect}
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
              <TornadoChartView
                calls={calls}
                puts={puts}
                underlyingPrice={underlying.price}
                strikeWindow={tornadoStrikeWindow}
                filter={tornadoFilter}
                isDesktop={isDesktop}
                hoveredStrike={tornadoHoveredStrike}
                selectedStrike={tornadoSelectedStrike}
                onHoverStrike={setTornadoHoveredStrike}
                onSelectStrike={setTornadoSelectedStrike}
              />
            </div>
          )}

          {/* Help Text */}
          <div className="px-4 py-3 bg-gray-50 dark:bg-slate-700/50 border-t border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Info className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                Click the chat button to ask the AI about strategies, Greeks analysis, or trade
                recommendations.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
