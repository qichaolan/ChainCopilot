"use client";

/**
 * TornadoChartView Component
 * Displays OI distribution as a horizontal bar chart (tornado/butterfly chart)
 */

import { useMemo } from "react";
import { cn, formatCompactNumber } from "@/lib/utils";
import type { DisplayOption, TornadoStrikeWindow, TornadoFilter, TornadoDisplayRow } from "../types";

interface TornadoChartViewProps {
  calls: DisplayOption[];
  puts: DisplayOption[];
  underlyingPrice: number;
  strikeWindow: TornadoStrikeWindow;
  filter: TornadoFilter;
  isDesktop: boolean;
  hoveredStrike: number | null;
  selectedStrike: number | null;
  onHoverStrike: (strike: number | null) => void;
  onSelectStrike: (strike: number | null) => void;
}

// Chart configuration
const CHART_HEIGHT = 560;
const MAX_ROWS_DESKTOP = 50;
const MAX_ROWS_MOBILE = 30;
const MIN_ROW_HEIGHT = 16;
const MAX_ROW_HEIGHT = 28;

export function TornadoChartView({
  calls,
  puts,
  underlyingPrice,
  strikeWindow,
  filter,
  isDesktop,
  hoveredStrike,
  selectedStrike,
  onHoverStrike,
  onSelectStrike,
}: TornadoChartViewProps) {
  const maxRows = isDesktop ? MAX_ROWS_DESKTOP : MAX_ROWS_MOBILE;

  // Filter flags
  const showCalls = filter === "both" || filter === "calls";
  const showPuts = filter === "both" || filter === "puts";

  // Build OI by strike from full calls/puts data
  const { displayStrikes, atmStrike, maxOI } = useMemo(() => {
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
      return { displayStrikes: [], atmStrike: null, maxOI: 0 };
    }

    // Find ATM index in all strikes
    const atmIndex = allStrikes.findIndex((s) => s >= underlyingPrice);
    const atmIdx = atmIndex === -1 ? Math.floor(allStrikes.length / 2) : atmIndex;
    const atmStrikeValue = allStrikes[atmIdx];

    // Apply tornado strike window filter
    let filteredStrikes: number[];
    if (strikeWindow === "all") {
      filteredStrikes = allStrikes;
    } else {
      const windowSize = strikeWindow;
      const startIdx = Math.max(0, atmIdx - windowSize);
      const endIdx = Math.min(allStrikes.length, atmIdx + windowSize + 1);
      filteredStrikes = allStrikes.slice(startIdx, endIdx);
    }

    // Aggregate if too many strikes
    let displayStrikes: TornadoDisplayRow[] = [];

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
      displayStrikes = filteredStrikes.map((strike) => ({
        strike,
        ...oiByStrike.get(strike)!,
      }));
    }

    // Find max OI for scaling
    let maxOI = 0;
    for (const data of displayStrikes) {
      if (showCalls) maxOI = Math.max(maxOI, data.callOI);
      if (showPuts) maxOI = Math.max(maxOI, data.putOI);
    }

    return { displayStrikes, atmStrike: atmStrikeValue, maxOI };
  }, [calls, puts, underlyingPrice, strikeWindow, maxRows, showCalls, showPuts]);

  if (displayStrikes.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No data available for tornado chart.
      </div>
    );
  }

  // Calculate adaptive row height
  const visibleRows = displayStrikes.length;
  const rowHeight = Math.min(
    MAX_ROW_HEIGHT,
    Math.max(MIN_ROW_HEIGHT, Math.floor(CHART_HEIGHT / visibleRows))
  );

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 px-1">
        {showCalls && <div className="flex-1 text-right pr-2">Calls OI</div>}
        <div className="w-20 text-center">Strike</div>
        {showPuts && <div className="flex-1 text-left pl-2">Puts OI</div>}
      </div>

      {/* Scrollable bars container with fixed height */}
      <div className="overflow-y-auto space-y-0.5" style={{ height: `${CHART_HEIGHT}px` }}>
        {displayStrikes.map((row) => {
          const callWidth = maxOI > 0 ? (row.callOI / maxOI) * 100 : 0;
          const putWidth = maxOI > 0 ? (row.putOI / maxOI) * 100 : 0;
          const isATMStrike = atmStrike !== null && row.strike === atmStrike;
          const isITMCall = row.strike < underlyingPrice;
          const isITMPut = row.strike > underlyingPrice;
          const isSelected = selectedStrike === row.strike;
          const isHovered = hoveredStrike === row.strike;

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
              onMouseEnter={() => onHoverStrike(row.strike)}
              onMouseLeave={() => onHoverStrike(null)}
              onClick={() => onSelectStrike(isSelected ? null : row.strike)}
            >
              {/* Call bar (right-aligned, grows left) */}
              {showCalls && (
                <div className="flex-1 flex justify-end pr-1">
                  <div
                    className={cn(
                      "rounded-l transition-all",
                      isITMCall ? "bg-green-500 dark:bg-green-600" : "bg-green-300 dark:bg-green-700"
                    )}
                    style={{
                      width: `${callWidth}%`,
                      minWidth: callWidth > 0 ? "2px" : "0",
                      height: `${Math.max(rowHeight - 8, 8)}px`,
                    }}
                    title={`Call OI: ${formatCompactNumber(row.callOI)}${
                      row.isAggregated ? ` (${row.rangeLabel})` : ""
                    }`}
                  />
                </div>
              )}

              {/* Strike label */}
              <div
                className={cn(
                  "w-20 text-center font-medium px-1 flex-shrink-0",
                  isATMStrike
                    ? "text-yellow-700 dark:text-yellow-400 font-bold"
                    : "text-gray-700 dark:text-gray-300",
                  rowHeight <= 20 ? "text-[10px]" : "text-xs"
                )}
              >
                {row.isAggregated ? row.rangeLabel : `$${row.strike}`}
              </div>

              {/* Put bar (left-aligned, grows right) */}
              {showPuts && (
                <div className="flex-1 flex justify-start pl-1">
                  <div
                    className={cn(
                      "rounded-r transition-all",
                      isITMPut ? "bg-red-500 dark:bg-red-600" : "bg-red-300 dark:bg-red-700"
                    )}
                    style={{
                      width: `${putWidth}%`,
                      minWidth: putWidth > 0 ? "2px" : "0",
                      height: `${Math.max(rowHeight - 8, 8)}px`,
                    }}
                    title={`Put OI: ${formatCompactNumber(row.putOI)}${
                      row.isAggregated ? ` (${row.rangeLabel})` : ""
                    }`}
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
        {displayStrikes.some((s) => s.isAggregated) && (
          <div className="flex items-center gap-1 text-gray-400">
            <span>• Strikes aggregated</span>
          </div>
        )}
      </div>
    </div>
  );
}
