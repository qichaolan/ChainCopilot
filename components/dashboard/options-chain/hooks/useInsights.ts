/**
 * useInsights Hook
 * Computes key metrics from options chain data
 */

import { useMemo } from "react";
import type { DisplayOption, ChainInsights } from "../types";

interface UseInsightsProps {
  calls: DisplayOption[];
  puts: DisplayOption[];
}

export function useInsights({ calls, puts }: UseInsightsProps): ChainInsights | null {
  return useMemo(() => {
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
}
