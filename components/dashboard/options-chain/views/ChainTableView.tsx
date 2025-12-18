"use client";

/**
 * ChainTableView Component
 * Displays the options chain as a table (desktop) or cards (mobile)
 */

import { cn, formatCurrency, formatCompactNumber } from "@/lib/utils";
import type { DisplayOption, SelectedContract, MobileView } from "../types";
import { isITM } from "../utils";

interface ChainTableViewProps {
  displayCalls: DisplayOption[];
  displayPuts: DisplayOption[];
  underlyingPrice: number;
  atmStrike: number | null;
  showCalls: boolean;
  showPuts: boolean;
  mobileView: MobileView;
  selectedContract: SelectedContract | null;
  onSelectContract: (contract: SelectedContract | null) => void;
}

export function ChainTableView({
  displayCalls,
  displayPuts,
  underlyingPrice,
  atmStrike,
  showCalls,
  showPuts,
  mobileView,
  selectedContract,
  onSelectContract,
}: ChainTableViewProps) {
  const isATM = (strike: number) => atmStrike !== null && strike === atmStrike;

  return (
    <>
      {/* Mobile Card View - Single type only */}
      <div className="sm:hidden divide-y divide-gray-200 dark:divide-slate-700">
        {(mobileView === "calls" ? displayCalls : displayPuts).map((option) => {
          const optionType = mobileView === "calls" ? "call" : "put";
          const colorClass =
            mobileView === "calls"
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400";
          const bgClass =
            mobileView === "calls"
              ? isITM(option.strike, "call", underlyingPrice)
                ? "bg-green-50 dark:bg-green-900/20"
                : "bg-gray-50 dark:bg-slate-700/50"
              : isITM(option.strike, "put", underlyingPrice)
              ? "bg-red-50 dark:bg-red-900/20"
              : "bg-gray-50 dark:bg-slate-700/50";

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
                    {optionType} {isITM(option.strike, optionType, underlyingPrice) && "(ITM)"}
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

      {/* Desktop Table View */}
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
              const atmClass = isATM(call.strike) ? "bg-yellow-50 dark:bg-yellow-900/20" : "";
              const callItmClass = isITM(call.strike, "call", underlyingPrice)
                ? "text-green-600 dark:text-green-400"
                : "";
              const putItmClass = isITM(put?.strike, "put", underlyingPrice)
                ? "text-red-600 dark:text-red-400"
                : "";

              const isCallSelected =
                selectedContract?.type === "call" &&
                selectedContract?.contract.strike === call.strike;
              const isPutSelected =
                selectedContract?.type === "put" &&
                selectedContract?.contract.strike === put?.strike;

              const handleCallClick = () =>
                onSelectContract(isCallSelected ? null : { type: "call", contract: call });
              const handlePutClick = () =>
                put &&
                onSelectContract(isPutSelected ? null : { type: "put", contract: put });

              return (
                <tr
                  key={call.strike}
                  className={cn("hover:bg-gray-50 dark:hover:bg-slate-700/50", atmClass)}
                >
                  {/* Calls Only View */}
                  {showCalls && !showPuts && (
                    <>
                      <td className="px-4 py-2.5 text-left font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-600">
                        ${call.strike}
                      </td>
                      <td className={cn("px-3 py-2.5 font-medium text-gray-900 dark:text-white", callItmClass)}>
                        {call.bid.toFixed(2)}
                      </td>
                      <td className={cn("px-3 py-2.5 font-medium text-gray-900 dark:text-white", callItmClass)}>
                        {call.ask.toFixed(2)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>
                        {call.last.toFixed(2)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>
                        {formatCompactNumber(call.volume)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>
                        {formatCompactNumber(call.oi)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>
                        {(call.iv * 100).toFixed(1)}%
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>
                        {call.delta.toFixed(3)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>
                        {call.gamma.toFixed(4)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>
                        {call.theta.toFixed(3)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", callItmClass)}>
                        {call.vega.toFixed(3)}
                      </td>
                    </>
                  )}
                  {/* Puts Only View */}
                  {!showCalls && showPuts && put && (
                    <>
                      <td className="px-4 py-2.5 text-left font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-600">
                        ${put.strike}
                      </td>
                      <td className={cn("px-3 py-2.5 font-medium text-gray-900 dark:text-white", putItmClass)}>
                        {put.bid.toFixed(2)}
                      </td>
                      <td className={cn("px-3 py-2.5 font-medium text-gray-900 dark:text-white", putItmClass)}>
                        {put.ask.toFixed(2)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>
                        {put.last.toFixed(2)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>
                        {formatCompactNumber(put.volume)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>
                        {formatCompactNumber(put.oi)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>
                        {(put.iv * 100).toFixed(1)}%
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>
                        {put.delta.toFixed(3)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>
                        {put.gamma.toFixed(4)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>
                        {put.theta.toFixed(3)}
                      </td>
                      <td className={cn("px-3 py-2.5 text-gray-600 dark:text-gray-300", putItmClass)}>
                        {put.vega.toFixed(3)}
                      </td>
                    </>
                  )}
                  {/* Both Sides View */}
                  {showCalls && showPuts && put && (
                    <>
                      {/* Call side - clickable for AI context */}
                      <td
                        className={cn(
                          "px-3 py-2.5 text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                          callItmClass,
                          isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handleCallClick}
                      >
                        {formatCompactNumber(call.oi)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                          callItmClass,
                          isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handleCallClick}
                      >
                        {formatCompactNumber(call.volume)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                          callItmClass,
                          isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handleCallClick}
                      >
                        {(call.iv * 100).toFixed(1)}%
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                          callItmClass,
                          isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handleCallClick}
                      >
                        {call.delta.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 font-medium text-gray-900 dark:text-white cursor-pointer transition-colors",
                          callItmClass,
                          isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handleCallClick}
                      >
                        {call.bid.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 font-medium text-gray-900 dark:text-white cursor-pointer transition-colors",
                          callItmClass,
                          isCallSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handleCallClick}
                      >
                        {call.ask.toFixed(2)}
                      </td>

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
                        onClick={handlePutClick}
                      >
                        {put.bid.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-medium text-gray-900 dark:text-white cursor-pointer transition-colors",
                          putItmClass,
                          isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handlePutClick}
                      >
                        {put.ask.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                          putItmClass,
                          isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handlePutClick}
                      >
                        {put.delta.toFixed(2)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                          putItmClass,
                          isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handlePutClick}
                      >
                        {(put.iv * 100).toFixed(1)}%
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                          putItmClass,
                          isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handlePutClick}
                      >
                        {formatCompactNumber(put.volume)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right text-gray-600 dark:text-gray-300 cursor-pointer transition-colors",
                          putItmClass,
                          isPutSelected && "bg-blue-100 dark:bg-blue-900/30"
                        )}
                        onClick={handlePutClick}
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
    </>
  );
}
