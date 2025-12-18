"use client";

/**
 * InsightsBar Component
 * Displays key metrics for the current expiration
 */

import { cn, formatCompactNumber } from "@/lib/utils";
import type { ChainInsights } from "../types";

interface InsightsBarProps {
  insights: ChainInsights;
  selectedExpiration: string;
}

export function InsightsBar({ insights, selectedExpiration }: InsightsBarProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
      {/* Desktop: Grouped layout - Context | Positioning | Risk */}
      <div className="hidden sm:flex items-stretch">
        {/* === CONTEXT GROUP === */}
        <div className="flex items-stretch border-r-2 border-gray-200 dark:border-slate-600">
          {/* Expiry */}
          <div className="px-4 py-3 flex flex-col justify-center bg-gray-50 dark:bg-slate-700/50 border-r border-gray-100 dark:border-slate-700">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">
              Expires
            </div>
            <div className="text-base font-bold text-gray-900 dark:text-white whitespace-nowrap">
              {new Date(selectedExpiration + "T00:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </div>
          </div>
          {/* Max OI Strike */}
          <div className="px-4 py-3 flex flex-col justify-center bg-blue-50/50 dark:bg-blue-900/10">
            <div className="text-[10px] uppercase tracking-wide text-blue-500 dark:text-blue-400 font-medium">
              Max OI
            </div>
            <div className="text-base font-bold text-gray-900 dark:text-white">
              ${insights.heaviestStrike}
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500">
              {formatCompactNumber(insights.heaviestStrikeOI)} (C+P)
            </div>
          </div>
        </div>

        {/* === POSITIONING GROUP (dominant) === */}
        <div className="flex-1 flex items-stretch bg-gradient-to-b from-gray-50/50 to-white dark:from-slate-700/30 dark:to-slate-800 border-r-2 border-gray-200 dark:border-slate-600">
          {/* OI Contracts */}
          <div className="flex-1 px-4 py-3 border-r border-gray-100 dark:border-slate-700">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium mb-1">
              Contracts
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-green-600 dark:text-green-400">
                  {formatCompactNumber(insights.totalCallOI)}
                </span>
                <span className="text-[10px] text-gray-400">C</span>
              </div>
              <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden flex min-w-[60px]">
                <div
                  className="bg-green-500 dark:bg-green-400 h-full"
                  style={{ width: `${insights.callPercent}%` }}
                />
                <div
                  className="bg-red-500 dark:bg-red-400 h-full"
                  style={{ width: `${100 - insights.callPercent}%` }}
                />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-red-600 dark:text-red-400">
                  {formatCompactNumber(insights.totalPutOI)}
                </span>
                <span className="text-[10px] text-gray-400">P</span>
              </div>
            </div>
          </div>

          {/* OI Value */}
          <div className="flex-1 px-4 py-3 border-r border-gray-100 dark:border-slate-700">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium mb-1">
              Value
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-green-600 dark:text-green-400">
                ${formatCompactNumber(insights.callValue)}
              </span>
              <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden flex min-w-[60px]">
                <div
                  className="bg-green-500 dark:bg-green-400 h-full"
                  style={{ width: `${insights.callValuePercent}%` }}
                />
                <div
                  className="bg-red-500 dark:bg-red-400 h-full"
                  style={{ width: `${100 - insights.callValuePercent}%` }}
                />
              </div>
              <span className="text-lg font-bold text-red-600 dark:text-red-400">
                ${formatCompactNumber(insights.putValue)}
              </span>
            </div>
          </div>

          {/* P/C Ratio */}
          <div
            className={cn(
              "px-5 py-3 flex flex-col justify-center",
              insights.pcRatio > 1.2
                ? "bg-red-50 dark:bg-red-900/20"
                : insights.pcRatio < 0.8
                ? "bg-green-50 dark:bg-green-900/20"
                : ""
            )}
          >
            <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">
              P/C
            </div>
            <div
              className={cn(
                "text-2xl font-bold",
                insights.pcRatio > 1.2
                  ? "text-red-600 dark:text-red-400"
                  : insights.pcRatio < 0.8
                  ? "text-green-600 dark:text-green-400"
                  : "text-gray-900 dark:text-white"
              )}
            >
              {insights.pcRatio.toFixed(2)}
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500">
              {insights.pcRatio > 1.2
                ? "Put heavy"
                : insights.pcRatio < 0.8
                ? "Call heavy"
                : "Balanced"}
            </div>
          </div>
        </div>

        {/* === RISK GROUP (de-emphasized) === */}
        <div className="px-4 py-3 flex flex-col justify-center bg-gray-50/50 dark:bg-slate-700/20">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">
            Avg IV
          </div>
          <div className="text-base font-medium text-gray-600 dark:text-gray-300">
            {(insights.avgIV * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Mobile: Grouped compact layout */}
      <div className="sm:hidden p-3 space-y-3">
        {/* Context Row */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-100 dark:bg-slate-700 rounded-lg">
            <span className="text-[10px] uppercase text-gray-400 dark:text-gray-500">Exp</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">
              {new Date(selectedExpiration + "T00:00:00").toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <span className="text-[10px] uppercase text-blue-500 dark:text-blue-400">Max OI</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">
              ${insights.heaviestStrike}
            </span>
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
            <span className="text-[10px] uppercase text-gray-500 dark:text-gray-400 font-medium">
              Positioning
            </span>
            <div
              className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded",
                insights.pcRatio > 1.2
                  ? "bg-red-100 dark:bg-red-900/30"
                  : insights.pcRatio < 0.8
                  ? "bg-green-100 dark:bg-green-900/30"
                  : "bg-gray-100 dark:bg-slate-600"
              )}
            >
              <span className="text-[10px] text-gray-500 dark:text-gray-400">P/C</span>
              <span
                className={cn(
                  "text-base font-bold",
                  insights.pcRatio > 1.2
                    ? "text-red-600 dark:text-red-400"
                    : insights.pcRatio < 0.8
                    ? "text-green-600 dark:text-green-400"
                    : "text-gray-900 dark:text-white"
                )}
              >
                {insights.pcRatio.toFixed(2)}
              </span>
            </div>
          </div>
          {/* OI Contracts bar */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-green-600 dark:text-green-400 w-10 text-right">
              {formatCompactNumber(insights.totalCallOI)}
            </span>
            <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden flex">
              <div
                className="bg-green-500 dark:bg-green-400 h-full"
                style={{ width: `${insights.callPercent}%` }}
              />
              <div
                className="bg-red-500 dark:bg-red-400 h-full"
                style={{ width: `${100 - insights.callPercent}%` }}
              />
            </div>
            <span className="text-xs font-bold text-red-600 dark:text-red-400 w-10">
              {formatCompactNumber(insights.totalPutOI)}
            </span>
            <span className="text-[9px] text-gray-400 w-6">OI</span>
          </div>
          {/* OI Value bar */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-green-600 dark:text-green-400 w-10 text-right">
              ${formatCompactNumber(insights.callValue)}
            </span>
            <div className="flex-1 h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden flex">
              <div
                className="bg-green-500 dark:bg-green-400 h-full"
                style={{ width: `${insights.callValuePercent}%` }}
              />
              <div
                className="bg-red-500 dark:bg-red-400 h-full"
                style={{ width: `${100 - insights.callValuePercent}%` }}
              />
            </div>
            <span className="text-xs font-bold text-red-600 dark:text-red-400 w-10">
              ${formatCompactNumber(insights.putValue)}
            </span>
            <span className="text-[9px] text-gray-400 w-6">Val</span>
          </div>
        </div>
      </div>
    </div>
  );
}
