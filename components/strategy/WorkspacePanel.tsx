'use client';

/**
 * WorkspacePanel - Left panel of Strategy Builder
 *
 * Displays:
 * - Summary strip with current state
 * - Options chain table (tornado style)
 * - Candidate cards with strategy details
 * - Simulation results
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Briefcase,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Target,
  AlertTriangle,
  Check,
  ChevronRight,
  BarChart3,
  Clock,
  Table,
  BarChart2,
  Calendar,
  Activity,
  Layers,
  Info,
  Lightbulb,
} from 'lucide-react';
import { useStrategyBuilder } from '@/lib/strategy';
import type { StrategyCandidate, SimulationResult, OptionContract, ExpirationGroup } from '@/lib/strategy/types';

// ============================================================================
// Summary Strip
// ============================================================================

function SummaryStrip() {
  const { state } = useStrategyBuilder();
  const { ticker, spotPrice, selectedExpiration, outlook, selectedStrategy, capitalBudget } = state;

  const getOutlookIcon = () => {
    switch (outlook) {
      case 'bullish':
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'bearish':
        return <TrendingDown className="w-4 h-4 text-red-500" />;
      default:
        return <Minus className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <div className="bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Ticker & Price */}
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm">
            {ticker?.slice(0, 3) || '---'}
          </div>
          <div>
            <div className="font-bold text-lg">{ticker || 'No ticker'}</div>
            {spotPrice && (
              <div className="text-sm text-gray-500">${spotPrice.toFixed(2)}</div>
            )}
          </div>
        </div>

        {/* Outlook */}
        <div className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-slate-700 rounded-lg">
          {getOutlookIcon()}
          <span className="text-sm font-medium capitalize">{outlook}</span>
        </div>

        {/* Strategy */}
        {selectedStrategy && (
          <div className="px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
            <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
              {selectedStrategy.replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* Expiration */}
        {selectedExpiration && (
          <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
            <Clock className="w-4 h-4" />
            <span>{selectedExpiration}</span>
          </div>
        )}

        {/* Budget */}
        <div className="flex items-center gap-1 text-sm">
          <DollarSign className="w-4 h-4 text-slate-500" />
          <span className="font-medium">${capitalBudget.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Options Chain Table (Tornado Style - Calls | Strike | Puts)
// ============================================================================

type ChainFilter = 'both' | 'calls' | 'puts';
type ViewMode = 'table' | 'tornado';
type StrikeWindow = 10 | 20 | 40 | 'all';

interface SelectedOption {
  strike: number;
  type: 'call' | 'put';
  contract: OptionContract;
}

function OptionsChainTable() {
  const { state } = useStrategyBuilder();
  const { chain, spotPrice, selectedExpiration } = state;
  const [filter, setFilter] = useState<ChainFilter>('both');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [strikeWindow, setStrikeWindow] = useState<StrikeWindow>(10);
  const [selectedOptions, setSelectedOptions] = useState<SelectedOption[]>([]);

  // Toggle option selection
  const toggleOption = (strike: number, type: 'call' | 'put', contract: OptionContract) => {
    setSelectedOptions((prev) => {
      const exists = prev.find((o) => o.strike === strike && o.type === type);
      if (exists) {
        return prev.filter((o) => !(o.strike === strike && o.type === type));
      }
      // Max 4 legs for complex strategies
      if (prev.length >= 4) return prev;
      return [...prev, { strike, type, contract }];
    });
  };

  const isSelected = (strike: number, type: 'call' | 'put') => {
    return selectedOptions.some((o) => o.strike === strike && o.type === type);
  };

  const clearSelection = () => setSelectedOptions([]);

  // Process chain data into calls and puts by strike
  const { calls, puts, strikes, atmStrike, atmIndex } = useMemo(() => {
    if (!chain || chain.length === 0) {
      return { calls: new Map(), puts: new Map(), strikes: [], atmStrike: null, atmIndex: 0 };
    }

    const callsMap = new Map<number, OptionContract>();
    const putsMap = new Map<number, OptionContract>();
    const strikesSet = new Set<number>();

    chain.forEach((contract) => {
      strikesSet.add(contract.strike);
      if (contract.optionType === 'call') {
        callsMap.set(contract.strike, contract);
      } else {
        putsMap.set(contract.strike, contract);
      }
    });

    const sortedStrikes = Array.from(strikesSet).sort((a, b) => a - b);

    // Find ATM strike - matching home page implementation
    const spot = spotPrice || 100;
    const atmIdx = sortedStrikes.findIndex((s) => s >= spot);
    const atmIndex = atmIdx === -1 ? Math.floor(sortedStrikes.length / 2) : atmIdx;
    const atm = sortedStrikes[atmIndex] || null;

    return { calls: callsMap, puts: putsMap, strikes: sortedStrikes, atmStrike: atm, atmIndex };
  }, [chain, spotPrice]);

  // Filter strikes based on strike window (for tornado view) or ±15% (for table view)
  const filteredStrikes = useMemo(() => {
    if (strikes.length === 0) return [];

    if (viewMode === 'tornado') {
      // Use strike window for tornado view (matching home page implementation)
      if (strikeWindow === 'all') {
        return strikes;
      }
      const windowSize = strikeWindow;
      const startIdx = Math.max(0, atmIndex - windowSize);
      const endIdx = Math.min(strikes.length, atmIndex + windowSize + 1);
      return strikes.slice(startIdx, endIdx);
    } else {
      // Use ±15% for table view
      const spot = spotPrice || 100;
      const minStrike = spot * 0.85;
      const maxStrike = spot * 1.15;
      return strikes.filter((s) => s >= minStrike && s <= maxStrike);
    }
  }, [strikes, spotPrice, viewMode, strikeWindow, atmIndex]);

  const formatCompact = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return n.toString();
  };

  const isITM = (strike: number, type: 'call' | 'put') => {
    const spot = spotPrice || 100;
    return type === 'call' ? strike < spot : strike > spot;
  };

  // Calculate max OI for tornado chart scaling
  const maxOI = useMemo(() => {
    let max = 0;
    const showCalls = filter === 'both' || filter === 'calls';
    const showPuts = filter === 'both' || filter === 'puts';

    filteredStrikes.forEach((strike) => {
      const call = calls.get(strike);
      const put = puts.get(strike);
      if (showCalls && call) max = Math.max(max, call.openInterest);
      if (showPuts && put) max = Math.max(max, put.openInterest);
    });
    return max;
  }, [filteredStrikes, calls, puts, filter]);

  if (!selectedExpiration || chain.length === 0) {
    return (
      <div className="p-8 text-center">
        <Table className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-sm text-gray-500">
          Select an expiration to view the options chain
        </p>
      </div>
    );
  }

  const showCalls = filter === 'both' || filter === 'calls';
  const showPuts = filter === 'both' || filter === 'puts';

  return (
    <div className="space-y-3">
      {/* Header with view toggle and filter */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {viewMode === 'table' ? (
            <Table className="w-4 h-4 text-blue-500" />
          ) : (
            <BarChart2 className="w-4 h-4 text-blue-500" />
          )}
          <span className="text-sm font-semibold">Options Chain</span>
          <span className="text-xs text-gray-500">({selectedExpiration})</span>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-0.5">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              title="Table View"
            >
              <Table className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('tornado')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'tornado'
                  ? 'bg-white dark:bg-slate-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              title="Tornado View"
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Strike Window (Tornado view only) */}
          {viewMode === 'tornado' && (
            <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-0.5">
              {([10, 20, 40, 'all'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setStrikeWindow(w)}
                  className={`px-2 py-1 text-xs font-medium rounded transition-all ${
                    strikeWindow === w
                      ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {w === 'all' ? 'All' : `±${w}`}
                </button>
              ))}
            </div>
          )}

          {/* Filter */}
          <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-0.5">
            {(['both', 'calls', 'puts'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 text-xs font-medium rounded transition-all capitalize ${
                  filter === f
                    ? f === 'calls'
                      ? 'bg-green-500 text-white'
                      : f === 'puts'
                      ? 'bg-red-500 text-white'
                      : 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Spot price indicator */}
      <div className="text-xs text-gray-500 text-center">
        Spot: ${(spotPrice || 0).toFixed(2)} | {viewMode === 'tornado' ? (strikeWindow === 'all' ? 'All strikes' : `±${strikeWindow} strikes`) : '±15% range'} ({filteredStrikes.length} strikes)
      </div>

      {/* Tornado View */}
      {viewMode === 'tornado' && (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg">
          {/* Tornado Header */}
          <div className="flex items-center text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-2 border-b border-gray-200 dark:border-slate-700">
            {showCalls && <div className="flex-1 text-right pr-2">Calls OI</div>}
            <div className="w-16 text-center font-semibold">Strike</div>
            {showPuts && <div className="flex-1 text-left pl-2">Puts OI</div>}
          </div>

          {/* Tornado Bars - matching home page implementation */}
          <div className="overflow-y-auto" style={{ height: '400px' }}>
            {filteredStrikes.map((strike) => {
              const call = calls.get(strike);
              const put = puts.get(strike);
              const callOI = call?.openInterest || 0;
              const putOI = put?.openInterest || 0;
              const callWidth = maxOI > 0 ? (callOI / maxOI) * 100 : 0;
              const putWidth = maxOI > 0 ? (putOI / maxOI) * 100 : 0;
              const isAtm = strike === atmStrike;
              const isITMCall = strike < (spotPrice || 100);
              const isITMPut = strike > (spotPrice || 100);
              const callSelected = isSelected(strike, 'call');
              const putSelected = isSelected(strike, 'put');

              // Calculate adaptive row height
              const rowHeight = Math.min(24, Math.max(16, Math.floor(400 / filteredStrikes.length)));
              const barHeight = Math.max(rowHeight - 6, 8);

              return (
                <div
                  key={strike}
                  className={`flex items-center transition-colors ${
                    isAtm ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''
                  } ${callSelected || putSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                  style={{ height: `${rowHeight}px` }}
                >
                  {/* Call bar section (right-aligned, grows left) */}
                  {showCalls && (
                    <div
                      className={`flex-1 flex justify-end items-center pr-1 cursor-pointer ${
                        callSelected ? 'ring-1 ring-inset ring-blue-400' : ''
                      }`}
                      onClick={() => call && toggleOption(strike, 'call', call)}
                      title={`Call OI: ${formatCompact(callOI)}`}
                    >
                      {callSelected && <Check className="w-3 h-3 text-blue-500 mr-1 flex-shrink-0" />}
                      <div
                        className={`rounded-l transition-all ${
                          isITMCall ? 'bg-green-500 dark:bg-green-600' : 'bg-green-300 dark:bg-green-700'
                        }`}
                        style={{
                          width: `${callWidth}%`,
                          minWidth: callWidth > 0 ? '2px' : '0',
                          height: `${barHeight}px`,
                        }}
                      />
                    </div>
                  )}

                  {/* Strike label */}
                  <div
                    className={`w-16 text-center font-medium px-1 flex-shrink-0 ${
                      rowHeight <= 18 ? 'text-[10px]' : 'text-xs'
                    } ${
                      isAtm
                        ? 'text-yellow-700 dark:text-yellow-400 font-bold'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    ${strike}
                  </div>

                  {/* Put bar section (left-aligned, grows right) */}
                  {showPuts && (
                    <div
                      className={`flex-1 flex justify-start items-center pl-1 cursor-pointer ${
                        putSelected ? 'ring-1 ring-inset ring-blue-400' : ''
                      }`}
                      onClick={() => put && toggleOption(strike, 'put', put)}
                      title={`Put OI: ${formatCompact(putOI)}`}
                    >
                      <div
                        className={`rounded-r transition-all ${
                          isITMPut ? 'bg-red-500 dark:bg-red-600' : 'bg-red-300 dark:bg-red-700'
                        }`}
                        style={{
                          width: `${putWidth}%`,
                          minWidth: putWidth > 0 ? '2px' : '0',
                          height: `${barHeight}px`,
                        }}
                      />
                      {putSelected && <Check className="w-3 h-3 text-blue-500 ml-1 flex-shrink-0" />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tornado Legend */}
          <div className="flex items-center justify-center gap-4 px-2 py-2 border-t border-gray-200 dark:border-slate-700 text-xs text-gray-500 dark:text-gray-400">
            {showCalls && (
              <>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-green-500 dark:bg-green-600" />
                  <span>ITM Calls</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-green-300 dark:bg-green-700" />
                  <span>OTM Calls</span>
                </div>
              </>
            )}
            {showPuts && (
              <>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-red-500 dark:bg-red-600" />
                  <span>ITM Puts</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-red-300 dark:bg-red-700" />
                  <span>OTM Puts</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 dark:bg-slate-800">
            <tr className="border-b border-gray-200 dark:border-slate-700">
              {(filter === 'both' || filter === 'calls') && (
                <>
                  <th className="px-2 py-2 text-left text-green-600 dark:text-green-400 font-semibold">OI</th>
                  <th className="px-2 py-2 text-left text-green-600 dark:text-green-400 font-semibold">Vol</th>
                  <th className="px-2 py-2 text-left text-green-600 dark:text-green-400 font-semibold">IV</th>
                  <th className="px-2 py-2 text-left text-green-600 dark:text-green-400 font-semibold">Bid</th>
                  <th className="px-2 py-2 text-left text-green-600 dark:text-green-400 font-semibold">Ask</th>
                </>
              )}
              <th className="px-3 py-2 text-center font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-700">
                Strike
              </th>
              {(filter === 'both' || filter === 'puts') && (
                <>
                  <th className="px-2 py-2 text-right text-red-600 dark:text-red-400 font-semibold">Bid</th>
                  <th className="px-2 py-2 text-right text-red-600 dark:text-red-400 font-semibold">Ask</th>
                  <th className="px-2 py-2 text-right text-red-600 dark:text-red-400 font-semibold">IV</th>
                  <th className="px-2 py-2 text-right text-red-600 dark:text-red-400 font-semibold">Vol</th>
                  <th className="px-2 py-2 text-right text-red-600 dark:text-red-400 font-semibold">OI</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {filteredStrikes.map((strike) => {
              const call = calls.get(strike);
              const put = puts.get(strike);
              const isAtm = strike === atmStrike;
              const callItm = call && isITM(strike, 'call');
              const putItm = put && isITM(strike, 'put');
              const callSelected = isSelected(strike, 'call');
              const putSelected = isSelected(strike, 'put');

              return (
                <tr
                  key={strike}
                  className={`hover:bg-gray-50 dark:hover:bg-slate-700/50 ${
                    isAtm ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''
                  }`}
                >
                  {(filter === 'both' || filter === 'calls') && call && (
                    <>
                      <td
                        onClick={() => toggleOption(strike, 'call', call)}
                        className={`px-2 py-1.5 text-left cursor-pointer transition-colors ${
                          callSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-green-50 dark:hover:bg-green-900/20'
                        } ${callItm ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {formatCompact(call.openInterest)}
                      </td>
                      <td
                        onClick={() => toggleOption(strike, 'call', call)}
                        className={`px-2 py-1.5 text-left cursor-pointer transition-colors ${
                          callSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-green-50 dark:hover:bg-green-900/20'
                        } ${callItm ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {formatCompact(call.volume)}
                      </td>
                      <td
                        onClick={() => toggleOption(strike, 'call', call)}
                        className={`px-2 py-1.5 text-left cursor-pointer transition-colors ${
                          callSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-green-50 dark:hover:bg-green-900/20'
                        } ${callItm ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {(call.iv * 100).toFixed(0)}%
                      </td>
                      <td
                        onClick={() => toggleOption(strike, 'call', call)}
                        className={`px-2 py-1.5 text-left cursor-pointer transition-colors font-medium ${
                          callSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-green-50 dark:hover:bg-green-900/20'
                        } ${callItm ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}
                      >
                        {call.bid.toFixed(2)}
                      </td>
                      <td
                        onClick={() => toggleOption(strike, 'call', call)}
                        className={`px-2 py-1.5 text-left cursor-pointer transition-colors font-medium ${
                          callSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-inset ring-blue-400'
                            : 'hover:bg-green-50 dark:hover:bg-green-900/20'
                        } ${callItm ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}
                      >
                        <div className="flex items-center gap-1">
                          {call.ask.toFixed(2)}
                          {callSelected && <Check className="w-3 h-3 text-blue-500" />}
                        </div>
                      </td>
                    </>
                  )}
                  {(filter === 'both' || filter === 'calls') && !call && (
                    <>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                    </>
                  )}
                  <td className={`px-3 py-1.5 text-center font-bold bg-gray-100 dark:bg-slate-700 ${
                    isAtm ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-white'
                  }`}>
                    ${strike}
                    {isAtm && <span className="text-[10px] ml-1 font-normal">ATM</span>}
                  </td>
                  {(filter === 'both' || filter === 'puts') && put && (
                    <>
                      <td
                        onClick={() => toggleOption(strike, 'put', put)}
                        className={`px-2 py-1.5 text-right cursor-pointer transition-colors font-medium ${
                          putSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-inset ring-blue-400'
                            : 'hover:bg-red-50 dark:hover:bg-red-900/20'
                        } ${putItm ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}
                      >
                        <div className="flex items-center justify-end gap-1">
                          {putSelected && <Check className="w-3 h-3 text-blue-500" />}
                          {put.bid.toFixed(2)}
                        </div>
                      </td>
                      <td
                        onClick={() => toggleOption(strike, 'put', put)}
                        className={`px-2 py-1.5 text-right cursor-pointer transition-colors font-medium ${
                          putSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-red-50 dark:hover:bg-red-900/20'
                        } ${putItm ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}
                      >
                        {put.ask.toFixed(2)}
                      </td>
                      <td
                        onClick={() => toggleOption(strike, 'put', put)}
                        className={`px-2 py-1.5 text-right cursor-pointer transition-colors ${
                          putSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-red-50 dark:hover:bg-red-900/20'
                        } ${putItm ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {(put.iv * 100).toFixed(0)}%
                      </td>
                      <td
                        onClick={() => toggleOption(strike, 'put', put)}
                        className={`px-2 py-1.5 text-right cursor-pointer transition-colors ${
                          putSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-red-50 dark:hover:bg-red-900/20'
                        } ${putItm ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {formatCompact(put.volume)}
                      </td>
                      <td
                        onClick={() => toggleOption(strike, 'put', put)}
                        className={`px-2 py-1.5 text-right cursor-pointer transition-colors ${
                          putSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'hover:bg-red-50 dark:hover:bg-red-900/20'
                        } ${putItm ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}
                      >
                        {formatCompact(put.openInterest)}
                      </td>
                    </>
                  )}
                  {(filter === 'both' || filter === 'puts') && !put && (
                    <>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                      <td className="px-2 py-1.5 text-gray-400 text-center">-</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Selected Options Summary */}
      {selectedOptions.length > 0 && (
        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
              Selected ({selectedOptions.length}/4)
            </span>
            <button
              onClick={clearSelection}
              className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedOptions.map((opt) => (
              <div
                key={`${opt.type}-${opt.strike}`}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  opt.type === 'call'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                }`}
              >
                ${opt.strike} {opt.type.toUpperCase()} @ ${opt.contract.ask.toFixed(2)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Candidates Comparison Table
// ============================================================================

interface CandidatesTableProps {
  candidates: StrategyCandidate[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  spotPrice: number;
}

function CandidatesComparisonTable({ candidates, selectedIds, onToggle, spotPrice }: CandidatesTableProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
              <th className="px-2 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400 w-8">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-2 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400 w-8">#</th>
              <th className="px-2 py-2.5 text-left font-semibold text-slate-700 dark:text-slate-200">Strategy</th>
              <th className="px-2 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400">Legs</th>
              <th className="px-2 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">Premium</th>
              <th className="px-2 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">Expected Profit</th>
              <th className="px-2 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">Expected ROC</th>
              <th className="px-2 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">Breakeven</th>
              <th className="px-2 py-2.5 text-right font-medium text-slate-500 dark:text-slate-400">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {candidates.slice(0, 10).map((candidate, idx) => {
              const isSelected = selectedIds.includes(candidate.id);
              const breakeven = Array.isArray(candidate.breakeven) ? candidate.breakeven[0] : candidate.breakeven;
              const bePct = ((breakeven - spotPrice) / spotPrice) * 100;
              const canSelect = isSelected || selectedIds.length < 3;

              return (
                <tr
                  key={candidate.id}
                  onClick={() => canSelect && onToggle(candidate.id)}
                  className={`
                    transition-colors cursor-pointer
                    ${isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : canSelect
                      ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      : 'opacity-50 cursor-not-allowed'
                    }
                  `}
                >
                  {/* Selection checkbox */}
                  <td className="px-2 py-2">
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-blue-500 border-blue-500'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </td>

                  {/* Rank */}
                  <td className="px-2 py-2">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        idx === 0
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : idx === 1
                          ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          : idx === 2
                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                      }`}
                    >
                      {idx + 1}
                    </div>
                  </td>

                  {/* Strategy type */}
                  <td className="px-2 py-2 font-semibold text-slate-800 dark:text-slate-200 capitalize whitespace-nowrap">
                    {candidate.strategyType.replace(/_/g, ' ')}
                  </td>

                  {/* Legs */}
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-0.5">
                      {candidate.legs.map((leg, legIdx) => (
                        <span
                          key={legIdx}
                          className={`px-1 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                            leg.action === 'buy'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}
                        >
                          {leg.action === 'buy' ? 'B' : 'S'} ${leg.contract.strike}{leg.contract.optionType[0].toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Premium */}
                  <td className="px-2 py-2 text-right font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    ${Math.abs(candidate.maxLoss).toFixed(0)}
                  </td>

                  {/* Expected Profit */}
                  <td className="px-2 py-2 text-right font-semibold text-green-600 whitespace-nowrap">
                    {(candidate as any).expectedProfit?.expectedProfitUsd != null
                      ? `$${(candidate as any).expectedProfit.expectedProfitUsd.toFixed(0)}`
                      : 'N/A'}
                  </td>

                  {/* Expected ROC */}
                  <td className="px-2 py-2 text-right font-semibold text-purple-600 whitespace-nowrap">
                    {(() => {
                      const expectedProfit = (candidate as any).expectedProfit?.expectedProfitUsd;
                      const premium = Math.abs(candidate.maxLoss);
                      if (expectedProfit != null && premium > 0) {
                        const roc = (expectedProfit / premium) * 100;
                        return `${roc.toFixed(0)}%`;
                      }
                      return 'N/A';
                    })()}
                  </td>

                  {/* Breakeven */}
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      ${breakeven.toFixed(0)}
                    </span>
                    <span className={`ml-0.5 text-[10px] ${bePct >= 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                      ({bePct >= 0 ? '+' : ''}{bePct.toFixed(1)}% from spot)
                    </span>
                  </td>

                  {/* Score (0-1 scale) */}
                  <td className="px-2 py-2 text-right">
                    <span className={`px-1.5 py-0.5 rounded font-bold ${
                      candidate.overallScore >= 70
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : candidate.overallScore >= 50
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {(candidate.overallScore / 100).toFixed(2)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Greeks Summary Row */}
      <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
        <div className="flex items-center gap-4 text-[10px] text-slate-500 dark:text-slate-400">
          <span className="font-medium">Greeks (selected):</span>
          {selectedIds.length > 0 ? (
            <>
              {(() => {
                const selected = candidates.filter(c => selectedIds.includes(c.id));
                const totalDelta = selected.reduce((sum, c) => sum + c.netDelta, 0);
                const totalTheta = selected.reduce((sum, c) => sum + c.netTheta, 0);
                const totalVega = selected.reduce((sum, c) => sum + c.netVega, 0);
                return (
                  <>
                    <span>Δ: <span className={totalDelta >= 0 ? 'text-emerald-600' : 'text-red-600'}>{totalDelta.toFixed(2)}</span></span>
                    <span>θ: <span className={totalTheta >= 0 ? 'text-emerald-600' : 'text-red-600'}>${totalTheta.toFixed(2)}/d</span></span>
                    <span>ν: <span className="text-slate-600 dark:text-slate-300">${totalVega.toFixed(2)}</span></span>
                  </>
                );
              })()}
            </>
          ) : (
            <span className="italic">Select candidates to see combined Greeks</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Simulation Comparison View
// ============================================================================

interface SimulationCardProps {
  simulation: SimulationResult;
  rank: number;
  spotPrice: number;
  compact?: boolean;
}

// Generate AI insight based on candidate metrics
function generateInsight(candidate: StrategyCandidate, spotPrice: number): string {
  const breakeven = Array.isArray(candidate.breakeven) ? candidate.breakeven[0] : candidate.breakeven;
  const breakevenMove = ((breakeven - spotPrice) / spotPrice) * 100;
  const maxLoss = candidate.maxLoss;
  const maxProfit = candidate.maxProfit === 'unlimited' ? Infinity : candidate.maxProfit;
  const riskRewardRatio = maxProfit === Infinity ? 'unlimited' : (maxProfit / Math.abs(maxLoss)).toFixed(1);

  // Generate insight based on position characteristics
  if (breakevenMove > 0) {
    if (breakevenMove > 10) {
      return `+${breakevenMove.toFixed(1)}% to BE — needs strong upside.`;
    } else if (breakevenMove > 5) {
      return `+${breakevenMove.toFixed(1)}% to BE. R/R: ${riskRewardRatio}:1.`;
    } else {
      return `Low +${breakevenMove.toFixed(1)}% to BE. ${candidate.pop}% POP.`;
    }
  } else {
    if (breakevenMove < -10) {
      return `Profit above ${breakevenMove.toFixed(1)}% drop. Good cushion.`;
    } else if (breakevenMove < -5) {
      return `BE at ${breakevenMove.toFixed(1)}% decline. R/R: ${riskRewardRatio}:1.`;
    } else {
      return `Tight ${breakevenMove.toFixed(1)}% buffer — needs stability.`;
    }
  }
}

// Comparison Summary Table
interface ComparisonTableProps {
  simulations: SimulationResult[];
  spotPrice: number;
}

function ComparisonTable({ simulations, spotPrice }: ComparisonTableProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Quick Comparison</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
              <th className="px-2 sm:px-3 py-2 text-left font-medium text-slate-500 dark:text-slate-400 w-20 sm:w-24 text-[11px] sm:text-xs">Position</th>
              {simulations.map((sim, idx) => {
                const leg = sim.candidate.legs?.[0];
                const contract = leg?.contract;
                const strike = contract?.strike;
                const optionType = contract?.optionType;
                const expiration = contract?.expiration;
                return (
                <th key={sim.candidate.id} className="px-2 sm:px-3 py-2 text-center font-semibold text-slate-700 dark:text-slate-200 min-w-[90px] sm:min-w-[120px]">
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="flex items-center gap-1">
                      <span className="w-4 h-4 sm:w-5 sm:h-5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center text-[9px] sm:text-[10px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="text-[11px] sm:text-sm whitespace-nowrap">${strike} {optionType}</span>
                    </div>
                    <span className="text-[9px] sm:text-[10px] text-slate-400">{expiration}</span>
                  </div>
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            <tr>
              <td className="px-2 sm:px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap text-[11px] sm:text-xs">Max Loss</td>
              {simulations.map((sim) => (
                <td key={sim.candidate.id} className="px-2 sm:px-3 py-1.5 text-center font-semibold text-red-600 text-[11px] sm:text-xs">
                  ${Math.abs(sim.candidate.maxLoss).toFixed(0)}
                </td>
              ))}
            </tr>
            <tr className="bg-slate-50/30 dark:bg-slate-800/30">
              <td className="px-2 sm:px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap text-[11px] sm:text-xs">Expected Profit</td>
              {simulations.map((sim) => (
                <td key={sim.candidate.id} className="px-2 sm:px-3 py-1.5 text-center font-semibold text-green-600 text-[11px] sm:text-xs">
                  {(sim.candidate as any).expectedProfit?.expectedProfitUsd != null
                    ? `$${(sim.candidate as any).expectedProfit.expectedProfitUsd.toFixed(0)}`
                    : 'N/A'}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-2 sm:px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap text-[11px] sm:text-xs">Expected ROC</td>
              {simulations.map((sim) => {
                const expectedProfit = (sim.candidate as any).expectedProfit?.expectedProfitUsd;
                const premium = Math.abs(sim.candidate.maxLoss);
                const roc = expectedProfit != null && premium > 0 ? (expectedProfit / premium) * 100 : null;
                return (
                  <td key={sim.candidate.id} className="px-2 sm:px-3 py-1.5 text-center font-semibold text-purple-600 text-[11px] sm:text-xs">
                    {roc != null ? `${roc.toFixed(0)}%` : 'N/A'}
                  </td>
                );
              })}
            </tr>
            <tr className="bg-slate-50/30 dark:bg-slate-800/30">
              <td className="px-2 sm:px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap text-[11px] sm:text-xs">Expected Underlayer Move</td>
              {simulations.map((sim) => (
                <td key={sim.candidate.id} className="px-2 sm:px-3 py-1.5 text-center font-semibold text-blue-600 text-[11px] sm:text-xs">
                  {(sim.candidate as any).expectedProfit?.horizonMovePct != null
                    ? `+${(sim.candidate as any).expectedProfit.horizonMovePct.toFixed(1)}%`
                    : 'N/A'}
                  {(sim.candidate as any).expectedProfit?.expectedPriceAtExpiry != null && (
                    <span className="text-[10px] sm:text-xs text-blue-400 ml-1">→ ${(sim.candidate as any).expectedProfit.expectedPriceAtExpiry.toFixed(0)}</span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-2 sm:px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap text-[11px] sm:text-xs">Breakeven</td>
              {simulations.map((sim) => {
                const be = Array.isArray(sim.candidate.breakeven) ? sim.candidate.breakeven[0] : sim.candidate.breakeven;
                const bePct = ((be - spotPrice) / spotPrice) * 100;
                return (
                  <td key={sim.candidate.id} className="px-2 sm:px-3 py-1.5 text-center text-[11px] sm:text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">${be.toFixed(0)}</span>
                    <span className={`ml-1 text-[9px] sm:text-[10px] ${bePct >= 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                      ({bePct >= 0 ? '+' : ''}{bePct.toFixed(1)}%)
                    </span>
                  </td>
                );
              })}
            </tr>
            <tr className="bg-slate-50/30 dark:bg-slate-800/30">
              <td className="px-2 sm:px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap text-[11px] sm:text-xs">Daily θ</td>
              {simulations.map((sim) => (
                <td key={sim.candidate.id} className="px-2 sm:px-3 py-1.5 text-center text-slate-600 dark:text-slate-300 text-[11px] sm:text-xs">
                  ${Math.abs(sim.thetaDecay.daily).toFixed(2)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SimulationCard({ simulation, rank, spotPrice, compact = false }: SimulationCardProps) {
  const { candidate, scenarios, thetaDecay, payoffCurve } = simulation;

  // Breakeven calculation
  const breakeven = Array.isArray(candidate.breakeven) ? candidate.breakeven[0] : candidate.breakeven;

  // Generate AI insight
  const insight = generateInsight(candidate, spotPrice);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden h-full flex flex-col">
      {/* Compact Header */}
      <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-semibold text-xs">
              {rank}
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 capitalize">
                {candidate.strategyType.replace(/_/g, ' ')}
              </div>
              <div className="text-[10px] text-slate-500">
                {candidate.legs.map((l) => `$${l.contract.strike}${l.contract.optionType[0].toUpperCase()}`).join(' / ')}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              ${Math.abs(candidate.netPremium).toFixed(0)}
            </div>
            <div className="text-[10px] text-slate-400">
              {candidate.netPremium > 0 ? 'Debit' : 'Credit'}
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-2 flex-1">
        {/* P&L Zone Chart with BE Distance Indicator */}
        {(() => {
          // Calculate BE distance (what matters most)
          const beMovePct = ((breakeven - spotPrice) / spotPrice) * 100;
          const maxLoss = Math.abs(candidate.maxLoss);

          // Get P&L at +50% move for display
          const getPnlAtMove = (movePct: number) => {
            const targetPrice = spotPrice * (1 + movePct);
            const closest = payoffCurve.reduce((prev, curr) =>
              Math.abs(curr.price - targetPrice) < Math.abs(prev.price - targetPrice) ? curr : prev
            );
            return closest.pnl;
          };
          const pnlAt50 = getPnlAtMove(0.50);

          return (
            <div className="space-y-1.5">
              {/* Simplified P/L Zone Bar */}
              <div className="relative h-8 rounded overflow-hidden bg-slate-100 dark:bg-slate-700/50">
                {/* Loss zone (left of BE) */}
                <div
                  className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-red-400 to-red-300 dark:from-red-600 dark:to-red-500"
                  style={{ width: `${Math.min(100, Math.max(0, (beMovePct + 5) / 55 * 100))}%` }}
                />
                {/* Profit zone (right of BE) */}
                <div
                  className="absolute top-0 bottom-0 right-0 bg-gradient-to-r from-emerald-300 to-emerald-500 dark:from-emerald-600 dark:to-emerald-400"
                  style={{ width: `${Math.min(100, Math.max(0, 100 - (beMovePct + 5) / 55 * 100))}%` }}
                />
                {/* BE marker */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-amber-500 z-10"
                  style={{ left: `${Math.min(100, Math.max(0, (beMovePct + 5) / 55 * 100))}%` }}
                />
                {/* Labels on bar */}
                <div className="absolute inset-0 flex items-center justify-between px-2 text-[9px] font-bold z-20">
                  <span className="text-red-800 dark:text-red-200">-${(maxLoss/1000).toFixed(1)}k</span>
                  <span className="text-emerald-800 dark:text-emerald-200">+${(pnlAt50/1000).toFixed(0)}k</span>
                </div>
              </div>

              {/* X-axis with key points */}
              <div className="flex justify-between text-[8px] text-slate-500 dark:text-slate-400">
                <span>-5%</span>
                <span>0%</span>
                <span>+25%</span>
                <span>+50%</span>
              </div>

              {/* Normalized BE Distance Indicator */}
              <div className="flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-700/50 rounded">
                <span className="text-[9px] text-slate-500 dark:text-slate-400 whitespace-nowrap">To BE:</span>
                <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${beMovePct <= 10 ? 'bg-emerald-500' : beMovePct <= 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, Math.max(5, beMovePct * 2))}%` }}
                  />
                </div>
                <span className={`text-[10px] font-bold whitespace-nowrap ${beMovePct <= 10 ? 'text-emerald-600' : beMovePct <= 20 ? 'text-amber-600' : 'text-red-600'}`}>
                  +{beMovePct.toFixed(0)}%
                </span>
              </div>
            </div>
          );
        })()}

        {/* AI Insight - Compact */}
        <div className="flex items-start gap-1.5 p-2 bg-slate-50 dark:bg-slate-700/30 rounded text-[10px] text-slate-600 dark:text-slate-400">
          <Target className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
          <span className="leading-relaxed">{insight}</span>
        </div>

        {/* Theta - Compact */}
        <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700">
          <Clock className="w-2.5 h-2.5" />
          <span>θ: ${Math.abs(thetaDecay.daily).toFixed(2)}/d</span>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <span>${Math.abs(thetaDecay.weekly).toFixed(0)}/wk</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Expiration Preview Panel
// ============================================================================

interface ExpirationPreviewPanelProps {
  hoveredExpiration: ExpirationGroup | null;
  ticker: string | null;
  spotPrice: number | null;
}

function ExpirationPreviewPanel({ hoveredExpiration, ticker, spotPrice }: ExpirationPreviewPanelProps) {
  if (!hoveredExpiration) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <Calendar className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-400 mb-2">
            Select an Expiration
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Hover over an expiration date on the right to preview its details here.
          </p>
          <div className="text-xs text-slate-400 space-y-1">
            <p>• ATM IV and total open interest</p>
            <p>• Number of available strikes</p>
            <p>• Liquidity assessment</p>
          </div>
        </div>
      </div>
    );
  }

  const { expiration, dte, callCount, putCount, totalOI, avgIV } = hoveredExpiration;
  const totalContracts = callCount + putCount;
  const date = new Date(expiration);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  // Determine liquidity level - using blue/slate for non-P&L
  const getLiquidityInfo = () => {
    if (totalOI >= 100000) return { level: 'High', color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-900/30' };
    if (totalOI >= 10000) return { level: 'Moderate', color: 'text-slate-600', bgColor: 'bg-slate-100 dark:bg-slate-700/50' };
    return { level: 'Thin', color: 'text-amber-600', bgColor: 'bg-amber-100 dark:bg-amber-900/30' };
  };

  const liquidity = getLiquidityInfo();
  const is0DTE = dte === 0;
  const isLowDTE = dte <= 2 && dte > 0;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-200 dark:border-slate-700">
        <div className="w-11 h-11 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <Calendar className="w-5 h-5 text-slate-600 dark:text-slate-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">{formattedDate}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm text-slate-500">{ticker}</span>
            <span className="text-sm font-medium text-blue-600">{dte} DTE</span>
            {is0DTE && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                <AlertTriangle className="w-2.5 h-2.5" />
                0 DTE
              </span>
            )}
            {isLowDTE && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                Fast Decay
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Activity className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">ATM IV</span>
          </div>
          <div className="text-xl font-bold text-slate-800 dark:text-slate-200">
            {avgIV > 0 ? `${(avgIV * 100).toFixed(1)}%` : 'N/A'}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {avgIV > 0.5 ? 'High volatility' : avgIV > 0.3 ? 'Moderate' : 'Low volatility'}
          </div>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Total OI</span>
          </div>
          <div className="text-xl font-bold text-slate-800 dark:text-slate-200">
            {totalOI > 1000000 ? `${(totalOI / 1000000).toFixed(1)}M` : totalOI > 1000 ? `${(totalOI / 1000).toFixed(0)}K` : totalOI}
          </div>
          <div className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${liquidity.bgColor} ${liquidity.color}`}>
            {liquidity.level} Liquidity
          </div>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Calls</span>
          </div>
          <div className="text-xl font-bold text-slate-800 dark:text-slate-200">{callCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">contracts</div>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingDown className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Puts</span>
          </div>
          <div className="text-xl font-bold text-slate-800 dark:text-slate-200">{putCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">contracts</div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
          <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
            <p><span className="font-medium">{totalContracts}</span> total contracts across <span className="font-medium">{Math.ceil(totalContracts / 2)}</span> strikes</p>
            {spotPrice && (
              <p>Current spot: <span className="font-medium">${spotPrice.toFixed(2)}</span></p>
            )}
            {is0DTE && (
              <p className="text-amber-600 dark:text-amber-400">
                ⚠️ Same-day expiration — high gamma, fast theta decay
              </p>
            )}
            {dte > 180 && (
              <p className="text-blue-600 dark:text-blue-400">
                📈 LEAPS expiration — good for stock replacement or PMCC strategies
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function WorkspacePanel() {
  const { state, actions } = useStrategyBuilder();
  const { stage, candidates, selectedCandidateIds, simulations, error, spotPrice, ticker } = state;
  const [hoveredExpiration, setHoveredExpiration] = useState<ExpirationGroup | null>(null);

  // Listen for expiration hover events from CopilotPanel
  useEffect(() => {
    const handleExpirationHover = (event: CustomEvent<ExpirationGroup | null>) => {
      setHoveredExpiration(event.detail);
    };

    window.addEventListener('expiration-hover', handleExpirationHover as EventListener);
    return () => {
      window.removeEventListener('expiration-hover', handleExpirationHover as EventListener);
    };
  }, []);

  // Stage-specific content
  const renderContent = () => {
    switch (stage) {
      case 'ticker':
        return (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-8">
              <Briefcase className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
              <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-400 mb-2">
                Enter a Ticker to Start
              </h3>
              <p className="text-sm text-gray-500">
                Use the panel on the right to enter a stock symbol and begin building your strategy.
              </p>
            </div>
          </div>
        );

      case 'expiration':
        return (
          <ExpirationPreviewPanel
            hoveredExpiration={hoveredExpiration}
            ticker={ticker}
            spotPrice={spotPrice}
          />
        );

      case 'strategy':
        return (
          <div className="space-y-4">
            <OptionsChainTable />
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Select a strategy type and outlook in the panel on the right to generate candidates.
              </p>
            </div>
          </div>
        );

      case 'candidates':
        return (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Target className="w-5 h-5 text-blue-500" />
                Strategy Candidates ({candidates.length})
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">
                  Spot: ${(spotPrice || 100).toFixed(2)}
                </span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                  selectedCandidateIds.length === 3
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : selectedCandidateIds.length > 0
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                }`}>
                  {selectedCandidateIds.length}/3 selected
                </span>
              </div>
            </div>

            {/* Instruction */}
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-blue-500" />
              Click rows to select up to 3 candidates for simulation
            </div>

            {/* Comparison Table */}
            <CandidatesComparisonTable
              candidates={candidates}
              selectedIds={selectedCandidateIds}
              onToggle={(id) => actions.toggleCandidateSelection(id)}
              spotPrice={spotPrice || 100}
            />

            {/* Simulate Button */}
            {selectedCandidateIds.length > 0 && (
              <button
                onClick={actions.runSimulations}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
              >
                <ChevronRight className="w-4 h-4" />
                Simulate {selectedCandidateIds.length} Position{selectedCandidateIds.length > 1 ? 's' : ''}
              </button>
            )}
          </div>
        );

      case 'simulation':
        return (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-500" />
                Simulation Results ({simulations.length})
              </h3>
              <span className="text-xs text-slate-500">Spot: ${(spotPrice || 100).toFixed(2)}</span>
            </div>

            {/* Comparison Table - Side by side metrics */}
            <ComparisonTable simulations={simulations} spotPrice={spotPrice || 100} />

            {/* Cards Grid - Side by side */}
            <div className={`grid gap-3 ${
              simulations.length === 1 ? 'grid-cols-1' :
              simulations.length === 2 ? 'grid-cols-2' :
              'grid-cols-2 lg:grid-cols-3'
            }`}>
              {simulations.map((sim, idx) => (
                <SimulationCard
                  key={sim.candidate.id}
                  simulation={sim}
                  rank={idx + 1}
                  spotPrice={spotPrice || 100}
                  compact
                />
              ))}
            </div>

            {/* Complete Banner - Compact */}
            <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <Check className="w-4 h-4" />
                <span className="text-sm font-medium">Analysis Complete</span>
              </div>
              <button
                onClick={actions.reset}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
              >
                Start New Analysis
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-900">
      {/* Summary Strip */}
      <div className="p-4 border-b border-gray-200 dark:border-slate-700">
        <SummaryStrip />
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4">{renderContent()}</div>
    </div>
  );
}
