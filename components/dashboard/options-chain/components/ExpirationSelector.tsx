"use client";

/**
 * ExpirationSelector Component
 * Handles expiration type tabs and date dropdown/bottom sheet
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExpirationType } from "../types";
import { formatDropdownDate } from "../utils";

interface ExpirationSelectorProps {
  expirationType: ExpirationType;
  selectedExpiration: string;
  categorizedExpirations: Record<ExpirationType, string[]>;
  currentTypeDates: string[];
  onTypeChange: (type: ExpirationType) => void;
  onExpirationChange: (exp: string) => void;
}

const EXPIRATION_TYPES: ExpirationType[] = ["all", "weekly", "monthly", "quarterly", "leaps"];

export function ExpirationSelector({
  expirationType,
  selectedExpiration,
  categorizedExpirations,
  currentTypeDates,
  onTypeChange,
  onExpirationChange,
}: ExpirationSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);

  const handleTypeClick = (type: ExpirationType) => {
    const count = categorizedExpirations[type].length;
    if (count > 0) {
      onTypeChange(type);
      setDropdownOpen(false);
    }
  };

  const handleDateSelect = (date: string) => {
    onExpirationChange(date);
    setDropdownOpen(false);
    setBottomSheetOpen(false);
  };

  return (
    <>
      {/* Desktop */}
      <div className="hidden sm:block bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex items-center gap-4">
          {/* Segmented Control */}
          <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-1">
            {EXPIRATION_TYPES.map((type) => {
              const count = categorizedExpirations[type].length;
              const isDisabled = count === 0;
              const isSelected = expirationType === type;

              return (
                <button
                  key={type}
                  onClick={() => handleTypeClick(type)}
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
                    <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">({count})</span>
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
              <span>
                {selectedExpiration
                  ? formatDropdownDate(selectedExpiration, expirationType === "leaps")
                  : "Select date"}
              </span>
              <ChevronDown
                className={cn("h-4 w-4 text-gray-400 transition-transform", dropdownOpen && "rotate-180")}
              />
            </button>

            {dropdownOpen && currentTypeDates.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg z-10 max-h-60 overflow-auto">
                {currentTypeDates.map((date) => (
                  <button
                    key={date}
                    onClick={() => handleDateSelect(date)}
                    className={cn(
                      "w-full px-4 py-2 text-left text-sm transition-colors",
                      selectedExpiration === date
                        ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-600"
                    )}
                  >
                    {formatDropdownDate(date, expirationType === "leaps")}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: Trigger for Bottom Sheet */}
      <div className="sm:hidden">
        <button
          onClick={() => setBottomSheetOpen(true)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700"
        >
          <div className="text-left">
            <div className="text-xs text-gray-500 dark:text-gray-400">Expiration</div>
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {selectedExpiration
                ? formatDropdownDate(selectedExpiration, expirationType === "leaps")
                : "Select date"}
              <span className="text-gray-400 dark:text-gray-500 ml-1 capitalize">
                • {expirationType}
              </span>
            </div>
          </div>
          <ChevronDown className="h-5 w-5 text-gray-400" />
        </button>
      </div>

      {/* Mobile Bottom Sheet */}
      {bottomSheetOpen && (
        <div className="sm:hidden fixed inset-0 z-50">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setBottomSheetOpen(false)} />
          {/* Sheet */}
          <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-800 rounded-t-2xl max-h-[80vh] overflow-hidden animate-in slide-in-from-bottom duration-300">
            {/* Handle */}
            <div className="flex justify-center py-3">
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
            </div>

            {/* Header */}
            <div className="px-4 pb-3 border-b border-gray-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Select Expiration
              </h3>
            </div>

            {/* Segmented Control */}
            <div className="p-4 border-b border-gray-200 dark:border-slate-700">
              <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-1">
                {EXPIRATION_TYPES.map((type) => {
                  const count = categorizedExpirations[type].length;
                  const isDisabled = count === 0;
                  const isSelected = expirationType === type;

                  return (
                    <button
                      key={type}
                      onClick={() => handleTypeClick(type)}
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
                      {type !== "all" && count > 0 && (
                        <span className="block text-[10px] text-gray-400">({count})</span>
                      )}
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
                  onClick={() => handleDateSelect(date)}
                  className={cn(
                    "w-full px-4 py-3 text-left rounded-lg transition-colors",
                    selectedExpiration === date
                      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                      : "text-gray-700 dark:text-gray-300 active:bg-gray-100 dark:active:bg-slate-700"
                  )}
                >
                  {formatDropdownDate(date, expirationType === "leaps")}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
