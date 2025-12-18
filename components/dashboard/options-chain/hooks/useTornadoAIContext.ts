/**
 * useTornadoAIContext Hook
 * Exposes tornado chart data to CopilotKit AI
 */

import { useMemo } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { AI_CONTEXT_CONFIG } from "@/lib/config/ai-context";
import type { DisplayOption, TornadoData, ViewMode } from "../types";

interface UseTornadoAIContextProps {
  viewMode: ViewMode;
  displayCalls: DisplayOption[];
  displayPuts: DisplayOption[];
  underlying: {
    symbol: string;
    price: number;
    changePercent: number;
  };
  tornadoHoveredStrike: number | null;
  tornadoSelectedStrike: number | null;
}

export function useTornadoAIContext({
  viewMode,
  displayCalls,
  displayPuts,
  underlying,
  tornadoHoveredStrike,
  tornadoSelectedStrike,
}: UseTornadoAIContextProps): void {
  // Compute tornado aggregates and distribution for AI context
  const tornadoData = useMemo((): TornadoData | null => {
    if (displayCalls.length === 0 && displayPuts.length === 0) return null;

    const oiByStrike = new Map<number, { callOI: number; putOI: number }>();
    let totalCallOI = 0;
    let totalPutOI = 0;
    let maxCallOIStrike = { strike: 0, oi: 0 };
    let maxPutOIStrike = { strike: 0, oi: 0 };

    for (const call of displayCalls) {
      const existing = oiByStrike.get(call.strike) || { callOI: 0, putOI: 0 };
      existing.callOI += call.oi;
      oiByStrike.set(call.strike, existing);
      totalCallOI += call.oi;
      if (call.oi > maxCallOIStrike.oi) {
        maxCallOIStrike = { strike: call.strike, oi: call.oi };
      }
    }
    for (const put of displayPuts) {
      const existing = oiByStrike.get(put.strike) || { callOI: 0, putOI: 0 };
      existing.putOI += put.oi;
      oiByStrike.set(put.strike, existing);
      totalPutOI += put.oi;
      if (put.oi > maxPutOIStrike.oi) {
        maxPutOIStrike = { strike: put.strike, oi: put.oi };
      }
    }

    const strikes = Array.from(oiByStrike.keys()).sort((a, b) => a - b);
    const pcRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
    const netOiBias: "put" | "call" | "neutral" =
      pcRatio > 1.2 ? "put" : pcRatio < 0.8 ? "call" : "neutral";

    const distribution = strikes.map((strike) => {
      const data = oiByStrike.get(strike)!;
      return { strike, callOI: data.callOI, putOI: data.putOI };
    });

    return {
      aggregates: {
        totalCallOI,
        totalPutOI,
        pcRatio: Number(pcRatio.toFixed(2)),
        maxCallOIStrike,
        maxPutOIStrike,
        netOiBias,
        strikeMin: strikes[0] ?? 0,
        strikeMax: strikes[strikes.length - 1] ?? 0,
        strikeCount: strikes.length,
      },
      distribution,
    };
  }, [displayCalls, displayPuts]);

  // Expose tornado context to CopilotKit AI (v3)
  useCopilotReadable({
    description: "OptChain tornado chart context (v3)",
    value:
      viewMode === "tornado" && tornadoData
        ? {
            pageId: "chain_analysis",
            tableId: "tornado",
            contextVersion: 3,
            timestamp: new Date().toISOString(),
            underlying: {
              symbol: underlying.symbol,
              price: underlying.price,
              changePct: underlying.changePercent,
            },
            viewport: {
              strikeMin: tornadoData.aggregates.strikeMin,
              strikeMax: tornadoData.aggregates.strikeMax,
              strikeCount: tornadoData.aggregates.strikeCount,
            },
            aggregates: {
              totalCallOI: tornadoData.aggregates.totalCallOI,
              totalPutOI: tornadoData.aggregates.totalPutOI,
              pcRatio: tornadoData.aggregates.pcRatio,
              maxCallOIStrike: tornadoData.aggregates.maxCallOIStrike,
              maxPutOIStrike: tornadoData.aggregates.maxPutOIStrike,
              netOiBias: tornadoData.aggregates.netOiBias,
            },
            distribution: (() => {
              const maxStrikes = AI_CONTEXT_CONFIG.tornado.maxStrikes;
              const dist = tornadoData.distribution;
              const truncated = dist.length > maxStrikes;
              // Cap around center (ATM area)
              let strikes = dist;
              if (truncated) {
                const center = Math.floor(dist.length / 2);
                const half = Math.floor(maxStrikes / 2);
                strikes = dist.slice(Math.max(0, center - half), center + half);
              }
              return {
                byStrike: strikes.map((row) => ({
                  strike: row.strike,
                  callOI: row.callOI,
                  putOI: row.putOI,
                })),
                truncated,
                totalStrikesInView: dist.length,
              };
            })(),
            focus: {
              hoveredStrike: tornadoHoveredStrike,
              selectedStrike: tornadoSelectedStrike,
            },
            visualization: {
              type: "mirror_horizontal_bar",
              leftSide: "calls",
              rightSide: "puts",
              zeroLine: true,
            },
            units: { price: "USD", oi: "contracts" },
          }
        : null,
  });
}
