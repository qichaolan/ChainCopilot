'use client';

/**
 * OI Heatmap Component
 *
 * Displays Net Open Interest (Calls - Puts) as a heatmap.
 * - Green = Call-heavy (bullish)
 * - Red = Put-heavy (bearish)
 * - Strike range: ±10% around spot price
 */

import React, { useMemo } from 'react';
import { useStrategyBuilder } from '@/lib/strategy';
import { Activity, Info } from 'lucide-react';

interface HeatmapCellProps {
  strike: number;
  netOI: number;
  callOI: number;
  putOI: number;
  maxAbsOI: number;
  spotPrice: number;
  onClick?: () => void;
}

function HeatmapCell({
  strike,
  netOI,
  callOI,
  putOI,
  maxAbsOI,
  spotPrice,
  onClick,
}: HeatmapCellProps) {
  // Normalize OI to -1 to 1 for color intensity
  const intensity = maxAbsOI > 0 ? netOI / maxAbsOI : 0;

  // Color based on net OI
  const getBgColor = () => {
    if (intensity > 0) {
      // Call-heavy = green
      const alpha = Math.min(0.8, Math.abs(intensity));
      return `rgba(34, 197, 94, ${alpha})`;
    } else if (intensity < 0) {
      // Put-heavy = red
      const alpha = Math.min(0.8, Math.abs(intensity));
      return `rgba(239, 68, 68, ${alpha})`;
    }
    return 'rgba(148, 163, 184, 0.1)';
  };

  const isAtMoney = Math.abs(strike - spotPrice) < spotPrice * 0.02;

  return (
    <div
      onClick={onClick}
      className={`
        relative p-2 rounded cursor-pointer transition-all
        hover:ring-2 hover:ring-blue-400 hover:z-10
        ${isAtMoney ? 'ring-2 ring-yellow-400' : ''}
      `}
      style={{ backgroundColor: getBgColor() }}
      title={`Strike: $${strike}\nCall OI: ${callOI.toLocaleString()}\nPut OI: ${putOI.toLocaleString()}\nNet: ${netOI.toLocaleString()}`}
    >
      <div className="text-center">
        <div className="text-xs font-bold text-gray-800 dark:text-white">
          ${strike}
        </div>
        <div
          className={`text-xs font-medium ${
            netOI > 0
              ? 'text-green-800 dark:text-green-200'
              : netOI < 0
              ? 'text-red-800 dark:text-red-200'
              : 'text-gray-500'
          }`}
        >
          {netOI > 0 ? '+' : ''}
          {(netOI / 1000).toFixed(1)}K
        </div>
      </div>
      {isAtMoney && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full" />
      )}
    </div>
  );
}

export function OIHeatmap() {
  const { state, actions } = useStrategyBuilder();
  const { heatmapData, selectedExpiration, isProcessing } = state;

  // Load heatmap data when expiration changes
  React.useEffect(() => {
    if (selectedExpiration && state.chain.length > 0) {
      actions.loadHeatmapData();
    }
  }, [selectedExpiration, state.chain.length, actions]);

  const maxAbsOI = useMemo(() => {
    if (!heatmapData) return 0;
    return Math.max(Math.abs(heatmapData.maxNetOI), Math.abs(heatmapData.minNetOI));
  }, [heatmapData]);

  if (!selectedExpiration) {
    return (
      <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg text-center">
        <Activity className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-500">Select an expiration to view OI heatmap</p>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
        <div className="flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Loading heatmap...</span>
        </div>
      </div>
    );
  }

  if (!heatmapData || heatmapData.cells.length === 0) {
    return (
      <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg text-center">
        <Info className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-500">No OI data available for this expiration</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold">Net Open Interest</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500" />
            <span className="text-gray-500">Call Heavy</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span className="text-gray-500">Put Heavy</span>
          </div>
        </div>
      </div>

      {/* Spot price indicator */}
      <div className="text-xs text-gray-500 text-center">
        Spot: ${heatmapData.spotPrice.toFixed(2)} | Range: ±10%
      </div>

      {/* Heatmap grid */}
      <div className="grid grid-cols-5 gap-1 sm:grid-cols-7 md:grid-cols-9">
        {heatmapData.cells.map((cell) => (
          <HeatmapCell
            key={cell.strike}
            strike={cell.strike}
            netOI={cell.netOI}
            callOI={cell.callOI}
            putOI={cell.putOI}
            maxAbsOI={maxAbsOI}
            spotPrice={heatmapData.spotPrice}
          />
        ))}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded text-center">
          <div className="text-green-600 dark:text-green-400 font-bold">
            {heatmapData.cells
              .filter((c) => c.netOI > 0)
              .reduce((sum, c) => sum + c.netOI, 0)
              .toLocaleString()}
          </div>
          <div className="text-gray-500">Total Call OI</div>
        </div>
        <div className="p-2 bg-gray-50 dark:bg-slate-700 rounded text-center">
          <div className="font-bold">
            {heatmapData.cells.reduce((sum, c) => sum + c.callOI + c.putOI, 0).toLocaleString()}
          </div>
          <div className="text-gray-500">Total OI</div>
        </div>
        <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-center">
          <div className="text-red-600 dark:text-red-400 font-bold">
            {Math.abs(
              heatmapData.cells.filter((c) => c.netOI < 0).reduce((sum, c) => sum + c.netOI, 0)
            ).toLocaleString()}
          </div>
          <div className="text-gray-500">Total Put OI</div>
        </div>
      </div>
    </div>
  );
}
