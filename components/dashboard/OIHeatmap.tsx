"use client";

import { useMemo, useState, useCallback, useRef, useLayoutEffect, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import {
  OIViewType,
  StrikeRangeType,
  ExpirationGroupType,
  OptionContract,
  HeatmapCell,
  HeatmapConfig,
  buildHeatmapData,
  getCellValue,
  getCellColor,
  formatOI,
  formatExpiration,
  formatPCRatio,
  cellKey,
} from "@/lib/heatmap/oi-heatmap";

// Viewport info exposed to parent
export interface HeatmapViewport {
  strikeMin: number;
  strikeMax: number;
  expirationsShown: string[];
  viewType: OIViewType;
  strikeRange: StrikeRangeType;
  expGroup: ExpirationGroupType;
}

// Cell info for hover/select
export interface HeatmapCellInfo {
  expiration: string;
  strike: number;
  callOI: number;
  putOI: number;
  netOI: number;
}

interface OIHeatmapProps {
  contracts: OptionContract[];
  underlyingPrice: number;
  onCellClick?: (expiration: string, strike: number) => void;
  onViewportChange?: (viewport: HeatmapViewport) => void;
  onHoverCell?: (cell: HeatmapCellInfo | null) => void;
  onSelectCell?: (cell: HeatmapCellInfo | null) => void;
}

// Tooltip component - isolated to prevent grid rerenders
const Tooltip = memo(function Tooltip({
  cell,
  position,
  onCellClick,
}: {
  cell: HeatmapCell | null;
  position: { x: number; y: number };
  onCellClick?: (expiration: string, strike: number) => void;
}) {
  if (!cell || !cell.hasData) return null;

  return (
    <div
      className="fixed z-50 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 p-3 text-xs pointer-events-none"
      style={{
        left: position.x,
        top: position.y,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="font-semibold text-gray-900 dark:text-white mb-2">
        {cell.expiration} @ ${cell.strike}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="text-gray-500 dark:text-gray-400">Call OI:</div>
        <div className="text-green-600 dark:text-green-400 font-medium text-right">
          {formatOI(cell.callOI)}
        </div>
        <div className="text-gray-500 dark:text-gray-400">Put OI:</div>
        <div className="text-red-600 dark:text-red-400 font-medium text-right">
          {formatOI(cell.putOI)}
        </div>
        <div className="text-gray-500 dark:text-gray-400">Net OI:</div>
        <div className={cn(
          "font-medium text-right",
          cell.netOI > 0 ? "text-green-600 dark:text-green-400" :
          cell.netOI < 0 ? "text-red-600 dark:text-red-400" :
          "text-gray-600 dark:text-gray-300"
        )}>
          {cell.netOI > 0 ? "+" : ""}
          {formatOI(cell.netOI)}
          <span className="ml-1 text-gray-500 dark:text-gray-400 font-normal">
            ({cell.netOI > 0 ? "Call-heavy" : cell.netOI < 0 ? "Put-heavy" : "Neutral"})
          </span>
        </div>
        {cell.putCallRatio !== null && (
          <>
            <div className="text-gray-500 dark:text-gray-400">P/C Ratio:</div>
            <div className="text-gray-900 dark:text-white font-medium text-right">
              {formatPCRatio(cell.putCallRatio)}
            </div>
          </>
        )}
        <div className="text-gray-500 dark:text-gray-400">% of Exp:</div>
        <div className="text-gray-900 dark:text-white font-medium text-right">
          {cell.pctOfExpTotal.toFixed(1)}%
        </div>
      </div>
      {onCellClick && (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-slate-700 text-center text-gray-400">
          Click to view chain
        </div>
      )}
    </div>
  );
});

// Memoized row component for virtualization
const HeatmapRow = memo(function HeatmapRow({
  strike,
  expirations,
  colorsByKey,
  cellsByKey,
  cellDimensions,
  isATM,
  onCellHover,
  onCellClick,
}: {
  strike: number;
  expirations: string[];
  colorsByKey: Map<string, string>;
  cellsByKey: Map<string, HeatmapCell>;
  cellDimensions: { minWidth: number; height: number };
  isATM: boolean;
  onCellHover: (cell: HeatmapCell | null, e?: React.MouseEvent) => void;
  onCellClick: (cell: HeatmapCell) => void;
}) {
  return (
    <div className="flex">
      {/* Strike label */}
      <div
        className={cn(
          "w-12 flex-shrink-0 p-0.5 text-[10px] font-medium text-right pr-1 flex items-center justify-end",
          isATM
            ? "text-yellow-600 dark:text-yellow-400 font-bold"
            : "text-gray-600 dark:text-gray-300"
        )}
        style={{ height: cellDimensions.height + 2 }}
      >
        ${strike}
      </div>
      {/* Cells */}
      {expirations.map((exp) => {
        const key = cellKey(exp, strike);
        const cell = cellsByKey.get(key);
        const color = colorsByKey.get(key) || "#F3F4F6";

        if (!cell) return null;

        return (
          <div
            key={key}
            className={cn(
              "flex-1 m-px rounded-sm cursor-pointer transition-shadow border",
              cell.hasData
                ? "hover:ring-1 hover:ring-blue-400 border-transparent"
                : "border-gray-200 dark:border-slate-700 cursor-default",
              isATM && "ring-1 ring-yellow-400"
            )}
            style={{
              backgroundColor: color,
              minWidth: cellDimensions.minWidth,
              height: cellDimensions.height,
            }}
            onMouseEnter={(e) => onCellHover(cell, e)}
            onMouseLeave={() => onCellHover(null)}
            onClick={() => onCellClick(cell)}
            title={cell.hasData ? undefined : "No OI data"}
          />
        );
      })}
    </div>
  );
});

export function OIHeatmap({ contracts, underlyingPrice, onCellClick, onViewportChange, onHoverCell, onSelectCell }: OIHeatmapProps) {
  // View controls
  const [viewType, setViewType] = useState<OIViewType>("net");
  const [strikeRange, setStrikeRange] = useState<StrikeRangeType>("20");
  const [expGroup, setExpGroup] = useState<ExpirationGroupType>("short");

  // Refs for hover state (prevents grid rerenders)
  const hoveredCellRef = useRef<HeatmapCell | null>(null);
  const tooltipPosRef = useRef({ x: 0, y: 0 });
  const rafIdRef = useRef<number>(0);

  // State for tooltip (only updates tooltip, not grid)
  const [tooltipState, setTooltipState] = useState<{
    cell: HeatmapCell | null;
    position: { x: number; y: number };
  }>({ cell: null, position: { x: 0, y: 0 } });

  // Virtualization container ref
  const parentRef = useRef<HTMLDivElement>(null);

  // Dark mode detection via CSS (check once on mount, use matchMedia for efficiency)
  const [isDarkMode, setIsDarkMode] = useState(false);

  useLayoutEffect(() => {
    // Check dark mode via media query or class
    const checkDarkMode = () => {
      // First check if dark class is on documentElement (Tailwind convention)
      if (document.documentElement.classList.contains("dark")) {
        setIsDarkMode(true);
        return;
      }
      // Fallback to system preference
      setIsDarkMode(window.matchMedia("(prefers-color-scheme: dark)").matches);
    };

    checkDarkMode();

    // Listen for system preference changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => checkDarkMode();
    mediaQuery.addEventListener("change", handleChange);

    // Also watch for class changes (for manual toggle)
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
      observer.disconnect();
    };
  }, []);

  // Build heatmap data
  const heatmapData = useMemo(() => {
    const config: HeatmapConfig = {
      viewType,
      strikeRange,
      expirationGroup: expGroup,
      underlyingPrice,
    };
    return buildHeatmapData(contracts, config);
  }, [contracts, viewType, strikeRange, expGroup, underlyingPrice]);

  // Report viewport changes to parent
  useLayoutEffect(() => {
    if (onViewportChange && heatmapData.strikes.length > 0) {
      onViewportChange({
        strikeMin: heatmapData.strikes[0],
        strikeMax: heatmapData.strikes[heatmapData.strikes.length - 1],
        expirationsShown: heatmapData.expirations,
        viewType,
        strikeRange,
        expGroup,
      });
    }
  }, [onViewportChange, heatmapData.strikes, heatmapData.expirations, viewType, strikeRange, expGroup]);

  // Precompute ATM strike (closest strike to underlying price)
  const atmStrike = useMemo(() => {
    if (heatmapData.strikes.length === 0) return null;
    let closest = heatmapData.strikes[0];
    let minDiff = Math.abs(closest - underlyingPrice);
    for (const strike of heatmapData.strikes) {
      const diff = Math.abs(strike - underlyingPrice);
      if (diff < minDiff) {
        minDiff = diff;
        closest = strike;
      }
    }
    return closest;
  }, [heatmapData.strikes, underlyingPrice]);

  // Precompute all colors in useMemo (B optimization)
  const { colorsByKey, cellsByKey } = useMemo(() => {
    const colors = new Map<string, string>();
    const cells = new Map<string, HeatmapCell>();
    const emptyColor = isDarkMode ? "#374151" : "#F3F4F6";

    for (const strike of heatmapData.strikes) {
      for (const exp of heatmapData.expirations) {
        const key = cellKey(exp, strike);
        const cell = heatmapData.cells.get(key);
        if (cell) {
          cells.set(key, cell);
          if (cell.hasData) {
            const value = getCellValue(cell, viewType);
            colors.set(
              key,
              getCellColor(value, heatmapData.minValue, heatmapData.maxValue, viewType, isDarkMode)
            );
          } else {
            colors.set(key, emptyColor);
          }
        }
      }
    }
    return { colorsByKey: colors, cellsByKey: cells };
  }, [heatmapData, viewType, isDarkMode]);

  // Handle cell hover with RAF throttling (A optimization)
  const handleCellHover = useCallback(
    (cell: HeatmapCell | null, e?: React.MouseEvent) => {
      hoveredCellRef.current = cell;

      if (e && cell) {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        tooltipPosRef.current = {
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
        };
      }

      // Use RAF to batch tooltip updates
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        setTooltipState({
          cell: hoveredCellRef.current,
          position: { ...tooltipPosRef.current },
        });
      });

      // Report hover to parent
      if (onHoverCell) {
        onHoverCell(cell && cell.hasData ? {
          expiration: cell.expiration,
          strike: cell.strike,
          callOI: cell.callOI,
          putOI: cell.putOI,
          netOI: cell.netOI,
        } : null);
      }
    },
    [onHoverCell]
  );

  // Handle cell click
  const handleCellClick = useCallback(
    (cell: HeatmapCell) => {
      if (cell.hasData) {
        // Report selection to parent
        if (onSelectCell) {
          onSelectCell({
            expiration: cell.expiration,
            strike: cell.strike,
            callOI: cell.callOI,
            putOI: cell.putOI,
            netOI: cell.netOI,
          });
        }
        // Also call onCellClick for navigation
        if (onCellClick) {
          onCellClick(cell.expiration, cell.strike);
        }
      }
    },
    [onCellClick, onSelectCell]
  );

  // Calculate dynamic cell size based on data dimensions
  const cellDimensions = useMemo(() => {
    const expCount = heatmapData.expirations.length;
    const strikeCount = heatmapData.strikes.length;

    let minWidth = 36;
    let height = 20;

    if (expCount > 20) {
      minWidth = Math.max(24, Math.floor(600 / expCount));
    }
    if (expCount > 40) {
      minWidth = Math.max(18, Math.floor(720 / expCount));
    }
    if (strikeCount > 30) {
      height = Math.max(14, Math.floor(400 / strikeCount));
    }
    if (strikeCount > 50) {
      height = Math.max(10, Math.floor(500 / strikeCount));
    }

    return { minWidth, height };
  }, [heatmapData.expirations.length, heatmapData.strikes.length]);

  // Row virtualizer (C optimization)
  const rowVirtualizer = useVirtualizer({
    count: heatmapData.strikes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => cellDimensions.height + 2,
    overscan: 5,
  });

  // View type labels
  const viewLabels: Record<OIViewType, string> = {
    calls: "Calls OI",
    puts: "Puts OI",
    net: "Net OI",
  };

  // Strike range labels
  const rangeLabels: Record<StrikeRangeType, string> = {
    "10": "±10%",
    "20": "±20%",
    "30": "±30%",
    all: "All",
  };

  // Expiration group labels
  const expLabels: Record<ExpirationGroupType, string> = {
    short: "Short-term",
    weekly: "Weekly",
    monthly: "OPEX",
    leaps: "LEAPS",
    all: "All",
  };

  // Should virtualize only when we have many rows
  const shouldVirtualize = heatmapData.strikes.length > 30;

  return (
    <div className="space-y-4">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* View Type Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">View:</span>
          <div className="flex rounded-md bg-gray-100 dark:bg-slate-700 p-0.5">
            {(["calls", "puts", "net"] as OIViewType[]).map((type) => (
              <button
                key={type}
                onClick={() => setViewType(type)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded transition-all",
                  viewType === type
                    ? type === "calls"
                      ? "bg-green-500 text-white shadow-sm"
                      : type === "puts"
                      ? "bg-red-500 text-white shadow-sm"
                      : "bg-blue-500 text-white shadow-sm"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600"
                )}
              >
                {viewLabels[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Strike Range Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Range:</span>
          <div className="flex items-center gap-1 text-xs">
            {(["10", "20", "30", "all"] as StrikeRangeType[]).map((range) => (
              <button
                key={range}
                onClick={() => setStrikeRange(range)}
                className={cn(
                  "px-2 py-1 rounded transition-all",
                  strikeRange === range
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                )}
              >
                {rangeLabels[range]}
              </button>
            ))}
          </div>
        </div>

        {/* Expiration Group Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Dates:</span>
          <div className="flex items-center gap-1 text-xs">
            {(["short", "weekly", "monthly", "leaps", "all"] as ExpirationGroupType[]).map((group) => (
              <button
                key={group}
                onClick={() => setExpGroup(group)}
                className={cn(
                  "px-2 py-1 rounded transition-all",
                  expGroup === group
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
                )}
              >
                {expLabels[group]}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {viewType === "net" ? (
            // Diverging legend for Net OI: Put-heavy (red) <- Neutral (gray) -> Call-heavy (green)
            <div className="flex items-center gap-1">
              <span className="text-red-600 dark:text-red-400 font-medium">Put</span>
              <div className="flex items-center">
                <span className="w-3 h-3 rounded-l bg-red-600 dark:bg-red-500" />
                <span className="w-3 h-3 bg-red-300 dark:bg-red-800" />
                <span className="w-3 h-3 bg-gray-200 dark:bg-gray-600" />
                <span className="w-3 h-3 bg-green-300 dark:bg-green-800" />
                <span className="w-3 h-3 rounded-r bg-green-600 dark:bg-green-500" />
              </div>
              <span className="text-green-600 dark:text-green-400 font-medium">Call</span>
              <span className="text-gray-400 dark:text-gray-500 ml-1">(symlog)</span>
            </div>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <span
                  className={cn(
                    "w-3 h-3 rounded",
                    viewType === "calls"
                      ? "bg-emerald-50 dark:bg-emerald-950"
                      : "bg-red-50 dark:bg-red-950"
                  )}
                />
                Low
              </span>
              <span className="flex items-center gap-1">
                <span
                  className={cn(
                    "w-3 h-3 rounded",
                    viewType === "calls"
                      ? "bg-green-600 dark:bg-green-500"
                      : "bg-red-600 dark:bg-red-500"
                  )}
                />
                High
              </span>
            </>
          )}
        </div>
      </div>

      {/* Heatmap Grid */}
      {heatmapData.expirations.length === 0 || heatmapData.strikes.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No data available for the selected filters
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* Header Row (Expirations) - always visible */}
            <div className="flex sticky top-0 bg-white dark:bg-slate-800 z-10">
              <div className="w-12 flex-shrink-0 p-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 text-right pr-1">
                Strike
              </div>
              {heatmapData.expirations.map((exp) => (
                <div
                  key={exp}
                  className="flex-1 p-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300 text-center truncate"
                  style={{ minWidth: cellDimensions.minWidth }}
                  title={exp}
                >
                  {formatExpiration(exp)}
                </div>
              ))}
            </div>

            {/* Data Rows - virtualized when many rows */}
            {shouldVirtualize ? (
              <div
                ref={parentRef}
                className="overflow-auto"
                style={{ maxHeight: 400 }}
              >
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const strike = heatmapData.strikes[virtualRow.index];
                    return (
                      <div
                        key={virtualRow.key}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <HeatmapRow
                          strike={strike}
                          expirations={heatmapData.expirations}
                          colorsByKey={colorsByKey}
                          cellsByKey={cellsByKey}
                          cellDimensions={cellDimensions}
                          isATM={strike === atmStrike}
                          onCellHover={handleCellHover}
                          onCellClick={handleCellClick}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              // Non-virtualized for smaller grids
              heatmapData.strikes.map((strike) => (
                <HeatmapRow
                  key={strike}
                  strike={strike}
                  expirations={heatmapData.expirations}
                  colorsByKey={colorsByKey}
                  cellsByKey={cellsByKey}
                  cellDimensions={cellDimensions}
                  isATM={strike === atmStrike}
                  onCellHover={handleCellHover}
                  onCellClick={handleCellClick}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Tooltip - isolated component */}
      <Tooltip
        cell={tooltipState.cell}
        position={tooltipState.position}
        onCellClick={onCellClick}
      />

      {/* Summary Stats */}
      <div className="flex items-center gap-6 text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-slate-700">
        <span>
          Total OI: <span className="font-medium text-gray-900 dark:text-white">{formatOI(heatmapData.totalOI)}</span>
        </span>
        <span>
          Strikes: <span className="font-medium text-gray-900 dark:text-white">{heatmapData.strikes.length}</span>
        </span>
        <span>
          Expirations: <span className="font-medium text-gray-900 dark:text-white">{heatmapData.expirations.length}</span>
        </span>
      </div>
    </div>
  );
}
