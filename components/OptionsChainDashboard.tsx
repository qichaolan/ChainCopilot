"use client";

import { useState, useMemo } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { Search, TrendingUp, TrendingDown, Info } from "lucide-react";
import { cn, formatCurrency, formatPercent, formatCompactNumber } from "@/lib/utils";

// Sample options chain data
const sampleOptionsData = {
  underlying: {
    symbol: "AAPL",
    name: "Apple Inc.",
    price: 195.27,
    change: 2.45,
    changePercent: 1.27,
    volume: 52_340_000,
    marketCap: 3_020_000_000_000,
  },
  expirations: ["2024-01-19", "2024-01-26", "2024-02-02", "2024-02-16", "2024-03-15"],
  calls: [
    { strike: 185, bid: 11.20, ask: 11.35, last: 11.28, volume: 12500, oi: 45000, iv: 0.285, delta: 0.82, gamma: 0.025, theta: -0.08, vega: 0.15 },
    { strike: 190, bid: 7.15, ask: 7.30, last: 7.22, volume: 28000, oi: 62000, iv: 0.265, delta: 0.68, gamma: 0.042, theta: -0.12, vega: 0.22 },
    { strike: 195, bid: 4.10, ask: 4.25, last: 4.18, volume: 45000, oi: 85000, iv: 0.252, delta: 0.52, gamma: 0.055, theta: -0.15, vega: 0.28 },
    { strike: 200, bid: 2.05, ask: 2.15, last: 2.10, volume: 38000, oi: 72000, iv: 0.248, delta: 0.35, gamma: 0.048, theta: -0.13, vega: 0.25 },
    { strike: 205, bid: 0.92, ask: 1.00, last: 0.96, volume: 22000, oi: 58000, iv: 0.255, delta: 0.22, gamma: 0.035, theta: -0.10, vega: 0.18 },
    { strike: 210, bid: 0.38, ask: 0.42, last: 0.40, volume: 15000, oi: 42000, iv: 0.268, delta: 0.12, gamma: 0.022, theta: -0.06, vega: 0.12 },
  ],
  puts: [
    { strike: 185, bid: 0.85, ask: 0.92, last: 0.88, volume: 8500, oi: 32000, iv: 0.295, delta: -0.18, gamma: 0.025, theta: -0.06, vega: 0.15 },
    { strike: 190, bid: 1.95, ask: 2.08, last: 2.02, volume: 18000, oi: 48000, iv: 0.275, delta: -0.32, gamma: 0.042, theta: -0.10, vega: 0.22 },
    { strike: 195, bid: 3.85, ask: 4.00, last: 3.92, volume: 42000, oi: 78000, iv: 0.258, delta: -0.48, gamma: 0.055, theta: -0.14, vega: 0.28 },
    { strike: 200, bid: 6.80, ask: 6.95, last: 6.88, volume: 32000, oi: 65000, iv: 0.252, delta: -0.65, gamma: 0.048, theta: -0.12, vega: 0.25 },
    { strike: 205, bid: 10.65, ask: 10.85, last: 10.75, volume: 15000, oi: 38000, iv: 0.262, delta: -0.78, gamma: 0.035, theta: -0.09, vega: 0.18 },
    { strike: 210, bid: 15.20, ask: 15.45, last: 15.32, volume: 8000, oi: 25000, iv: 0.278, delta: -0.88, gamma: 0.022, theta: -0.05, vega: 0.12 },
  ],
};

export function OptionsChainDashboard() {
  const [symbol, setSymbol] = useState("AAPL");
  const [selectedExpiration, setSelectedExpiration] = useState(sampleOptionsData.expirations[0]);
  const [showCalls, setShowCalls] = useState(true);
  const [showPuts, setShowPuts] = useState(true);

  const { underlying, calls, puts, expirations } = sampleOptionsData;

  // Calculate summary metrics
  const metrics = useMemo(() => {
    const totalCallVolume = calls.reduce((sum, c) => sum + c.volume, 0);
    const totalPutVolume = puts.reduce((sum, p) => sum + p.volume, 0);
    const totalCallOI = calls.reduce((sum, c) => sum + c.oi, 0);
    const totalPutOI = puts.reduce((sum, p) => sum + p.oi, 0);
    const avgCallIV = calls.reduce((sum, c) => sum + c.iv, 0) / calls.length;
    const avgPutIV = puts.reduce((sum, p) => sum + p.iv, 0) / puts.length;
    const putCallRatio = totalPutVolume / totalCallVolume;

    return {
      totalCallVolume,
      totalPutVolume,
      totalCallOI,
      totalPutOI,
      avgCallIV,
      avgPutIV,
      putCallRatio,
    };
  }, [calls, puts]);

  // Expose data to CopilotKit AI
  useCopilotReadable({
    description: "Options chain data including calls, puts, Greeks, and market metrics for AI analysis",
    value: {
      underlying,
      selectedExpiration,
      calls,
      puts,
      metrics: {
        ...metrics,
        avgCallIV: `${(metrics.avgCallIV * 100).toFixed(1)}%`,
        avgPutIV: `${(metrics.avgPutIV * 100).toFixed(1)}%`,
        putCallRatio: metrics.putCallRatio.toFixed(2),
      },
    },
  });

  const isITM = (strike: number, type: "call" | "put") => {
    if (type === "call") return strike < underlying.price;
    return strike > underlying.price;
  };

  const isATM = (strike: number) => {
    return Math.abs(strike - underlying.price) < 2.5;
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stock Info Card */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Symbol Search */}
          <div className="flex-1 max-w-xs">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="Enter symbol..."
                className="w-full pl-9 pr-4 py-2.5 sm:py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Stock Price Info */}
          <div className="flex items-center gap-4 sm:gap-6">
            <div>
              <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(underlying.price)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {underlying.name}
              </div>
            </div>
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium",
                underlying.change >= 0
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              )}
            >
              {underlying.change >= 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span>
                {underlying.change >= 0 ? "+" : ""}
                {underlying.change.toFixed(2)} ({formatPercent(underlying.changePercent)})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          label="Call Volume"
          value={formatCompactNumber(metrics.totalCallVolume)}
          trend="neutral"
        />
        <MetricCard
          label="Put Volume"
          value={formatCompactNumber(metrics.totalPutVolume)}
          trend="neutral"
        />
        <MetricCard
          label="Put/Call Ratio"
          value={metrics.putCallRatio.toFixed(2)}
          trend={metrics.putCallRatio > 1 ? "bearish" : "bullish"}
        />
        <MetricCard
          label="Avg IV"
          value={`${((metrics.avgCallIV + metrics.avgPutIV) / 2 * 100).toFixed(1)}%`}
          trend="neutral"
        />
      </div>

      {/* Expiration Selector */}
      <div className="flex flex-wrap gap-2">
        {expirations.map((exp) => (
          <button
            key={exp}
            onClick={() => setSelectedExpiration(exp)}
            className={cn(
              "px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all",
              selectedExpiration === exp
                ? "bg-blue-500 text-white shadow-sm"
                : "bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600"
            )}
          >
            {new Date(exp).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </button>
        ))}
      </div>

      {/* Options Chain Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
        {/* Table Header with Toggle */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
            Options Chain - {selectedExpiration}
          </h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showCalls}
                onChange={(e) => setShowCalls(e.target.checked)}
                className="rounded border-gray-300 text-green-500 focus:ring-green-500"
              />
              <span className="text-xs sm:text-sm text-green-600 dark:text-green-400 font-medium">
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
              <span className="text-xs sm:text-sm text-red-600 dark:text-red-400 font-medium">
                Puts
              </span>
            </label>
          </div>
        </div>

        {/* Mobile Card View */}
        <div className="sm:hidden divide-y divide-gray-200 dark:divide-slate-700">
          {calls.map((call, idx) => {
            const put = puts[idx];
            return (
              <div key={call.strike} className="p-4 space-y-3">
                <div
                  className={cn(
                    "text-center py-2 rounded-lg font-bold text-lg",
                    isATM(call.strike)
                      ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                      : "bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white"
                  )}
                >
                  ${call.strike}
                  {isATM(call.strike) && (
                    <span className="ml-2 text-xs font-normal">ATM</span>
                  )}
                </div>

                {showCalls && (
                  <div
                    className={cn(
                      "p-3 rounded-lg",
                      isITM(call.strike, "call")
                        ? "bg-green-50 dark:bg-green-900/20"
                        : "bg-gray-50 dark:bg-slate-700/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase">
                        Call {isITM(call.strike, "call") && "(ITM)"}
                      </span>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {formatCurrency(call.last)}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">IV</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {(call.iv * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Delta</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {call.delta.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Vol</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {formatCompactNumber(call.volume)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">OI</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {formatCompactNumber(call.oi)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {showPuts && (
                  <div
                    className={cn(
                      "p-3 rounded-lg",
                      isITM(put.strike, "put")
                        ? "bg-red-50 dark:bg-red-900/20"
                        : "bg-gray-50 dark:bg-slate-700/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase">
                        Put {isITM(put.strike, "put") && "(ITM)"}
                      </span>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {formatCurrency(put.last)}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">IV</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {(put.iv * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Delta</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {put.delta.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Vol</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {formatCompactNumber(put.volume)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">OI</span>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {formatCompactNumber(put.oi)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/50">
                {showCalls && (
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
                  </>
                )}
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-900 dark:text-white uppercase bg-gray-100 dark:bg-slate-600">
                  Strike
                </th>
                {showPuts && (
                  <>
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
              {calls.map((call, idx) => {
                const put = puts[idx];
                const atmClass = isATM(call.strike)
                  ? "bg-yellow-50 dark:bg-yellow-900/20"
                  : "";

                return (
                  <tr key={call.strike} className={cn("hover:bg-gray-50 dark:hover:bg-slate-700/50", atmClass)}>
                    {showCalls && (
                      <>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-gray-600 dark:text-gray-300",
                            isITM(call.strike, "call") && "bg-green-50 dark:bg-green-900/20 font-medium"
                          )}
                        >
                          {formatCompactNumber(call.oi)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-gray-600 dark:text-gray-300",
                            isITM(call.strike, "call") && "bg-green-50 dark:bg-green-900/20 font-medium"
                          )}
                        >
                          {formatCompactNumber(call.volume)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-gray-600 dark:text-gray-300",
                            isITM(call.strike, "call") && "bg-green-50 dark:bg-green-900/20 font-medium"
                          )}
                        >
                          {(call.iv * 100).toFixed(1)}%
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-gray-600 dark:text-gray-300",
                            isITM(call.strike, "call") && "bg-green-50 dark:bg-green-900/20 font-medium"
                          )}
                        >
                          {call.delta.toFixed(2)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 font-medium text-gray-900 dark:text-white",
                            isITM(call.strike, "call") && "bg-green-50 dark:bg-green-900/20"
                          )}
                        >
                          {call.bid.toFixed(2)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 font-medium text-gray-900 dark:text-white",
                            isITM(call.strike, "call") && "bg-green-50 dark:bg-green-900/20"
                          )}
                        >
                          {call.ask.toFixed(2)}
                        </td>
                      </>
                    )}
                    <td
                      className={cn(
                        "px-4 py-2.5 text-center font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-600",
                        isATM(call.strike) && "bg-yellow-100 dark:bg-yellow-900/40"
                      )}
                    >
                      ${call.strike}
                    </td>
                    {showPuts && (
                      <>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white",
                            isITM(put.strike, "put") && "bg-red-50 dark:bg-red-900/20"
                          )}
                        >
                          {put.bid.toFixed(2)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white",
                            isITM(put.strike, "put") && "bg-red-50 dark:bg-red-900/20"
                          )}
                        >
                          {put.ask.toFixed(2)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300",
                            isITM(put.strike, "put") && "bg-red-50 dark:bg-red-900/20 font-medium"
                          )}
                        >
                          {put.delta.toFixed(2)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300",
                            isITM(put.strike, "put") && "bg-red-50 dark:bg-red-900/20 font-medium"
                          )}
                        >
                          {(put.iv * 100).toFixed(1)}%
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300",
                            isITM(put.strike, "put") && "bg-red-50 dark:bg-red-900/20 font-medium"
                          )}
                        >
                          {formatCompactNumber(put.volume)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300",
                            isITM(put.strike, "put") && "bg-red-50 dark:bg-red-900/20 font-medium"
                          )}
                        >
                          {formatCompactNumber(put.oi)}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
    </div>
  );
}

function MetricCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend: "bullish" | "bearish" | "neutral";
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-3 sm:p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div
        className={cn(
          "text-lg sm:text-xl font-bold",
          trend === "bullish" && "text-green-600 dark:text-green-400",
          trend === "bearish" && "text-red-600 dark:text-red-400",
          trend === "neutral" && "text-gray-900 dark:text-white"
        )}
      >
        {value}
      </div>
    </div>
  );
}
