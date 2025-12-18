/**
 * useChainAIContext Hook
 * Exposes chain table data to CopilotKit AI
 */

import { useCopilotReadable } from "@copilotkit/react-core";
import { AI_CONTEXT_CONFIG } from "@/lib/config/ai-context";
import type { DisplayOption, ChainInsights, SelectedContract, StrikeWindowSize } from "../types";
import { getMoneyness } from "../utils";

interface UseChainAIContextProps {
  selectedExpiration: string;
  underlying: {
    symbol: string;
    price: number;
    changePercent: number;
  };
  insights: ChainInsights | null;
  strikeWindowSize: StrikeWindowSize;
  displayCalls: DisplayOption[];
  displayPuts: DisplayOption[];
  selectedContract: SelectedContract | null;
  atmStrike: number | null;
}

export function useChainAIContext({
  selectedExpiration,
  underlying,
  insights,
  strikeWindowSize,
  displayCalls,
  displayPuts,
  selectedContract,
  atmStrike,
}: UseChainAIContextProps): void {
  // Build selectedchain object from selected contracts
  const buildSelectedChain = (): Record<number, object> | null => {
    if (!selectedContract) return null;
    return {
      0: {
        type: selectedContract.type,
        Strike: selectedContract.contract.strike,
        Bid: selectedContract.contract.bid,
        Ask: selectedContract.contract.ask,
        Last: selectedContract.contract.last,
        Vol: selectedContract.contract.volume,
        OI: selectedContract.contract.oi,
        IV: selectedContract.contract.iv
          ? (selectedContract.contract.iv * 100).toFixed(1)
          : null,
        Delta: selectedContract.contract.delta?.toFixed(3),
        Gamma: selectedContract.contract.gamma?.toFixed(4),
        Theta: selectedContract.contract.theta?.toFixed(3),
        Vega: selectedContract.contract.vega?.toFixed(3),
        moneyness: getMoneyness(
          selectedContract.contract.strike,
          selectedContract.type,
          atmStrike,
          underlying.price
        ),
      },
    };
  };

  useCopilotReadable({
    description: "OptChain context (v3)",
    value: {
      pageId: "chain_analysis",
      tableId: "chain",
      contextVersion: 3,
      timestamp: new Date().toISOString(),
      selectedExpiration,
      underlying: {
        symbol: underlying.symbol,
        price: underlying.price,
        changePct: underlying.changePercent,
      },
      insights: insights
        ? {
            totalCallOI: insights.totalCallOI,
            totalPutOI: insights.totalPutOI,
            totalCallOIValue: insights.callValue,
            totalPutOIValue: insights.putValue,
            pcRatio: Number(insights.pcRatio.toFixed(2)),
            avgIVPct: Number((insights.avgIV * 100).toFixed(1)),
            heaviestStrike: insights.heaviestStrike,
          }
        : null,
      // User's current view: strikes visible on screen (capped for AI context)
      strikeWindow: strikeWindowSize === "all" ? "all" : `±${strikeWindowSize}`,
      visibleStrikes: (() => {
        const maxStrikes = AI_CONTEXT_CONFIG.chain.maxStrikes;
        const strikes = displayCalls.map((call, idx) => ({
          strike: call.strike,
          callOI: call.oi,
          putOI: displayPuts[idx]?.oi ?? 0,
          callIV: call.iv ? Number((call.iv * 100).toFixed(1)) : null,
          putIV: displayPuts[idx]?.iv
            ? Number((displayPuts[idx].iv * 100).toFixed(1))
            : null,
        }));
        if (strikes.length <= maxStrikes) return strikes;
        // Cap around ATM (center of array)
        const center = Math.floor(strikes.length / 2);
        const half = Math.floor(maxStrikes / 2);
        return strikes.slice(Math.max(0, center - half), center + half);
      })(),
      visibleStrikesTruncated: displayCalls.length > AI_CONTEXT_CONFIG.chain.maxStrikes,
      numOfSelectedChain: selectedContract ? 1 : 0,
      selectedchain: buildSelectedChain(),
      units: { price: "USD", iv: "percent", oi: "contracts" },
    },
  });
}
