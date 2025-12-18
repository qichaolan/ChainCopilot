/**
 * useHeatmapAIContext Hook
 * Exposes heatmap data to CopilotKit AI
 */

import { useMemo } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { AI_CONTEXT_CONFIG } from "@/lib/config/ai-context";
import { OptionContract } from "@/lib/heatmap/oi-heatmap";
import type { HeatmapViewportState, HeatmapCellFocus, ViewMode } from "../types";
import { computeStrikeStep } from "../utils";

interface HeatmapAggregates {
  totalCallOI: number;
  totalPutOI: number;
  strikeMin: number;
  strikeMax: number;
  strikeStep: number | "mixed";
  strikeCount: number;
  expirations: string[];
  perStrike: Array<{ strike: number; callOi: number; putOi: number }>;
  perExpiration: Array<{
    exp: string;
    totalCallOi: number;
    totalPutOi: number;
    pcRatio: number;
  }>;
  topCells: Array<{ exp: string; strike: number; type: string; oi: number }>;
}

interface UseHeatmapAIContextProps {
  viewMode: ViewMode;
  allContracts: OptionContract[];
  heatmapViewport: HeatmapViewportState | null;
  heatmapHoveredCell: HeatmapCellFocus | null;
  heatmapSelectedCell: HeatmapCellFocus | null;
  underlying: {
    symbol: string;
    price: number;
    changePercent: number;
  };
}

export function useHeatmapAIContext({
  viewMode,
  allContracts,
  heatmapViewport,
  heatmapHoveredCell,
  heatmapSelectedCell,
  underlying,
}: UseHeatmapAIContextProps): void {
  // Filter contracts to only what's visible in the heatmap viewport
  const visibleContracts = useMemo(() => {
    if (!heatmapViewport || allContracts.length === 0) return [];
    const expSet = new Set(heatmapViewport.expirationsShown);
    return allContracts.filter((c) => {
      const strike = c.strike ?? 0;
      const exp = c.expiration ?? "";
      return (
        strike >= heatmapViewport.strikeMin &&
        strike <= heatmapViewport.strikeMax &&
        expSet.has(exp)
      );
    });
  }, [allContracts, heatmapViewport]);

  // Compute heatmap aggregates for AI context (viewport-only data)
  const heatmapAggregates = useMemo((): HeatmapAggregates | null => {
    if (visibleContracts.length === 0) return null;

    let totalCallOI = 0;
    let totalPutOI = 0;
    const strikeSet = new Set<number>();
    const expSet = new Set<string>();

    // Maps for per-strike and per-expiration aggregation
    const strikeMap = new Map<number, { callOi: number; putOi: number }>();
    const expMap = new Map<string, { totalCallOi: number; totalPutOi: number }>();
    // All cells for topCells extraction
    const allCells: Array<{ exp: string; strike: number; type: string; oi: number }> = [];

    for (const contract of visibleContracts) {
      const strike = contract.strike ?? 0;
      const oi = contract.oi ?? 0;
      const exp = contract.expiration ?? "";
      const type = contract.optionType ?? "";
      strikeSet.add(strike);
      if (exp) expSet.add(exp);

      // Per-strike aggregation
      const strikeData = strikeMap.get(strike) || { callOi: 0, putOi: 0 };
      if (type === "call") {
        strikeData.callOi += oi;
        totalCallOI += oi;
      } else if (type === "put") {
        strikeData.putOi += oi;
        totalPutOI += oi;
      }
      strikeMap.set(strike, strikeData);

      // Per-expiration aggregation
      if (exp) {
        const expData = expMap.get(exp) || { totalCallOi: 0, totalPutOi: 0 };
        if (type === "call") {
          expData.totalCallOi += oi;
        } else if (type === "put") {
          expData.totalPutOi += oi;
        }
        expMap.set(exp, expData);
      }

      // Collect all cells for topCells
      if (oi > 0 && exp) {
        allCells.push({ exp, strike, type, oi });
      }
    }

    const strikes = Array.from(strikeSet).sort((a, b) => a - b);
    const expirations = Array.from(expSet).sort();

    // Compute strike step
    const strikeStep = computeStrikeStep(strikes);

    // Build perStrike array
    const perStrike = Array.from(strikeMap.entries())
      .map(([strike, data]) => ({ strike, callOi: data.callOi, putOi: data.putOi }))
      .sort((a, b) => a.strike - b.strike);

    // Build perExpiration array with pcRatio
    const perExpiration = Array.from(expMap.entries())
      .map(([exp, data]) => ({
        exp,
        totalCallOi: data.totalCallOi,
        totalPutOi: data.totalPutOi,
        pcRatio:
          data.totalCallOi > 0
            ? Number((data.totalPutOi / data.totalCallOi).toFixed(2))
            : 0,
      }))
      .sort((a, b) => a.exp.localeCompare(b.exp));

    // Build topCells (top K cells by OI)
    const topCellsCount = AI_CONTEXT_CONFIG.heatmap.topCellsCount;
    const topCells = allCells.sort((a, b) => b.oi - a.oi).slice(0, topCellsCount);

    return {
      totalCallOI,
      totalPutOI,
      strikeMin: strikes[0] ?? 0,
      strikeMax: strikes[strikes.length - 1] ?? 0,
      strikeStep,
      strikeCount: strikes.length,
      expirations,
      perStrike,
      perExpiration,
      topCells,
    };
  }, [visibleContracts]);

  // Expose heatmap context to CopilotKit AI (v4 - viewport-only)
  useCopilotReadable({
    description:
      "OptChain heatmap context (v4). Viewport-only data. perStrike covers ALL visible strikes. topCells has top 12 cells. For specific (strike,exp,type) queries, answer ONLY from focus or topCells; otherwise instruct user to click/hover.",
    value:
      viewMode === "heatmap" && heatmapAggregates
        ? {
            pageId: "chain_analysis",
            tableId: "heatmap",
            contextVersion: 4,
            timestamp: new Date().toISOString(),

            // Underlying stock info
            underlying: {
              symbol: underlying.symbol,
              price: underlying.price,
              changePct: underlying.changePercent,
            },

            // Viewport: exactly what the UI is showing
            viewport: {
              strikesShown: {
                min: heatmapAggregates.strikeMin,
                max: heatmapAggregates.strikeMax,
                step: heatmapAggregates.strikeStep,
                count: heatmapAggregates.strikeCount,
              },
              expirationsShown: heatmapAggregates.expirations,
              viewMode: heatmapViewport?.viewType ?? "net",
              strikeRange: heatmapViewport?.strikeRange ?? "20",
              expGroup: heatmapViewport?.expGroup ?? "short",
              units: { price: "USD", oi: "contracts" },
            },

            // A) Per-strike totals across expirations SHOWN
            perStrike: heatmapAggregates.perStrike,

            // B) Per-expiration totals
            perExpiration: heatmapAggregates.perExpiration,

            // C) Top cells within the CURRENT viewport
            topCells: {
              scope: "viewport_only",
              k: AI_CONTEXT_CONFIG.heatmap.topCellsCount,
              cells: heatmapAggregates.topCells,
            },

            // D) Focus: exact cell if user hovered/clicked
            focus: {
              hoveredCell: heatmapHoveredCell,
              selectedCell: heatmapSelectedCell,
            },

            // E) Guardrails for AI
            availability: {
              isCompleteForViewport: true,
              cellLevelCoverage: "topK_plus_focus",
              exactCellOiRule:
                "Exact OI per (strike,exp,type) is available only if it is the selected/hovered cell OR it appears in topCells. Otherwise say: 'Click or hover that cell to retrieve the exact value.'",
            },
          }
        : null,
  });
}
