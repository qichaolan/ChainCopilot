'use client';

/**
 * LEAPSStatusStrip - Compact status bar showing current workflow state
 *
 * Displays: symbol, direction, budget, current step, and processing indicator
 */

import React from 'react';
import { TrendingUp, TrendingDown, MinusCircle, DollarSign, Loader2 } from 'lucide-react';
import { useLEAPSFlow } from './LEAPSFlowContext';

const directionConfig = {
  bullish: { icon: TrendingUp, color: 'text-green-500', label: 'Bullish' },
  bearish: { icon: TrendingDown, color: 'text-red-500', label: 'Bearish' },
  neutral: { icon: MinusCircle, color: 'text-gray-500', label: 'Neutral' },
};

export function LEAPSStatusStrip() {
  const { state } = useLEAPSFlow();
  const { viewContext, currentStep, isProcessing } = state;
  const { symbol, direction, capitalBudget } = viewContext;

  const dirConfig = directionConfig[direction];
  const DirIcon = dirConfig.icon;

  if (!symbol) {
    return (
      <div className="flex items-center justify-center py-2 text-gray-400 dark:text-gray-500 text-xs">
        Enter a symbol to begin LEAPS analysis
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg text-xs">
      {/* Left: Symbol & Direction */}
      <div className="flex items-center gap-3">
        <span className="font-bold text-sm">{symbol}</span>
        <div className={`flex items-center gap-1 ${dirConfig.color}`}>
          <DirIcon className="w-3.5 h-3.5" />
          <span>{dirConfig.label}</span>
        </div>
      </div>

      {/* Center: Budget */}
      <div className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
        <DollarSign className="w-3.5 h-3.5" />
        <span>{capitalBudget.toLocaleString()}</span>
      </div>

      {/* Right: Current Step & Status */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 dark:text-gray-400 capitalize">
          {currentStep.replace('_', ' ')}
        </span>
        {isProcessing && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
        )}
      </div>
    </div>
  );
}

export default LEAPSStatusStrip;
