"use client";

/**
 * StockInfoCard Component
 * Symbol search and price information display
 */

import { useState, FormEvent } from "react";
import { Search, Loader2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { UnderlyingInfo } from "../types";

interface StockInfoCardProps {
  underlying: UnderlyingInfo;
  isLoading: boolean;
  onSearch: (symbol: string) => void;
}

export function StockInfoCard({ underlying, isLoading, onSearch }: StockInfoCardProps) {
  const [inputSymbol, setInputSymbol] = useState("");

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (inputSymbol.trim()) {
      onSearch(inputSymbol.trim().toUpperCase());
    }
  };

  return (
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
            <span className="font-bold text-gray-900 dark:text-white">
              {formatCurrency(underlying.price)}
            </span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-gray-500 dark:text-gray-400">Prev Close:</span>
            <span className="font-medium">{formatCurrency(underlying.prevClose)}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-gray-500 dark:text-gray-400">Day Change:</span>
            <span
              className={cn(
                "font-medium",
                underlying.change >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {underlying.change >= 0 ? "+" : ""}
              {underlying.change.toFixed(2)} ({underlying.change >= 0 ? "+" : ""}
              {underlying.changePercent.toFixed(2)}%)
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
  );
}
