/**
 * useStrikeWindow Hook
 * Handles strike filtering around ATM
 */

import { useMemo } from "react";
import type { DisplayOption, StrikeWindow, StrikeWindowSize } from "../types";

interface UseStrikeWindowProps {
  calls: DisplayOption[];
  puts: DisplayOption[];
  underlyingPrice: number;
  windowSize: StrikeWindowSize;
}

export function useStrikeWindow({
  calls,
  puts,
  underlyingPrice,
  windowSize,
}: UseStrikeWindowProps): StrikeWindow {
  return useMemo(() => {
    if (calls.length === 0) {
      return {
        atmIndex: 0,
        filteredCalls: [],
        filteredPuts: [],
        hiddenAbove: 0,
        hiddenBelow: 0,
      };
    }

    // If underlying price is not available, show all strikes
    if (!underlyingPrice || underlyingPrice <= 0) {
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
      const diff = Math.abs(call.strike - underlyingPrice);
      if (diff < minDiff) {
        minDiff = diff;
        atmIndex = idx;
      }
    });

    // Use the selected window size (or show all)
    if (windowSize === "all") {
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
    const startIdx = Math.max(0, atmIndex - windowSize);
    const endIdx = Math.min(calls.length - 1, atmIndex + windowSize);

    // Count hidden strikes
    const hiddenAbove = startIdx;
    const hiddenBelow = calls.length - 1 - endIdx;

    // Filter arrays
    const filteredCalls = calls.slice(startIdx, endIdx + 1);
    const filteredPuts = puts.slice(startIdx, endIdx + 1);

    return {
      atmIndex,
      filteredCalls,
      filteredPuts,
      hiddenAbove,
      hiddenBelow,
      startIdx,
      endIdx,
    };
  }, [calls, puts, underlyingPrice, windowSize]);
}
