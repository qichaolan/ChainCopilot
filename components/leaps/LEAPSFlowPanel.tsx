'use client';

/**
 * LEAPSFlowPanel - Main panel combining all LEAPS flow components
 *
 * Integrates:
 * - Step chips (Filter → Rank → Simulate → Risk Scan → Decide)
 * - Status strip
 * - Activity feed
 * - HITL checkpoint UI
 */

import React from 'react';
import { X, AlertTriangle, RefreshCw } from 'lucide-react';
import { useLEAPSFlow } from './LEAPSFlowContext';
import { LEAPSStepChips } from './LEAPSStepChips';
import { LEAPSStatusStrip } from './LEAPSStatusStrip';
import { LEAPSActivityFeed } from './LEAPSActivityFeed';

// ============================================================================
// HITL Checkpoint Component
// ============================================================================

function HITLCheckpointCard() {
  const { state, resolveCheckpoint } = useLEAPSFlow();
  const { pendingCheckpoint } = state;

  if (!pendingCheckpoint || pendingCheckpoint.resolved) return null;

  const typeConfig = {
    missing_scope: {
      icon: AlertTriangle,
      color: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20',
      iconColor: 'text-amber-500',
    },
    stale_data: {
      icon: RefreshCw,
      color: 'border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20',
      iconColor: 'text-yellow-500',
    },
    confirmation_required: {
      icon: AlertTriangle,
      color: 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20',
      iconColor: 'text-blue-500',
    },
    tool_failure: {
      icon: X,
      color: 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20',
      iconColor: 'text-red-500',
    },
  };

  const config = typeConfig[pendingCheckpoint.type];
  const Icon = config.icon;

  const buttonVariants = {
    primary: 'bg-blue-500 hover:bg-blue-600 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 dark:bg-slate-600 dark:hover:bg-slate-500 text-gray-700 dark:text-gray-200',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
  };

  return (
    <div className={`p-4 rounded-lg border-2 ${config.color} my-3`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 ${config.iconColor}`} />
        <div className="flex-1">
          <div className="font-medium text-sm mb-1">
            {pendingCheckpoint.type.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {pendingCheckpoint.message}
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingCheckpoint.options.map((option, idx) => (
              <button
                key={idx}
                onClick={() => resolveCheckpoint(option.action)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${buttonVariants[option.variant]}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Error Display
// ============================================================================

function ErrorDisplay() {
  const { state, clearError } = useLEAPSFlow();
  const { error } = state;

  if (!error) return null;

  return (
    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 my-3">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <X className="w-4 h-4 text-red-500 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-red-700 dark:text-red-400">
              Error in {error.step} step
            </div>
            <div className="text-xs text-red-600 dark:text-red-500 mt-0.5">
              {error.message}
            </div>
          </div>
        </div>
        {error.recoverable && (
          <button
            onClick={clearError}
            className="text-xs text-red-600 hover:text-red-700 underline"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Panel
// ============================================================================

interface LEAPSFlowPanelProps {
  className?: string;
  compact?: boolean;
}

export function LEAPSFlowPanel({ className = '', compact = false }: LEAPSFlowPanelProps) {
  const { state } = useLEAPSFlow();
  const { viewContext } = state;

  // Don't show if no symbol is set
  if (!viewContext.symbol) {
    return null;
  }

  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden ${className}`}>
      {/* Header with Step Chips */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            LEAPS Builder
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {viewContext.symbol}
          </span>
        </div>
        <LEAPSStepChips />
      </div>

      {/* Status Strip */}
      <div className="px-4 py-2 border-b border-gray-100 dark:border-slate-700">
        <LEAPSStatusStrip />
      </div>

      {/* Error Display */}
      <div className="px-4">
        <ErrorDisplay />
      </div>

      {/* HITL Checkpoint */}
      <div className="px-4">
        <HITLCheckpointCard />
      </div>

      {/* Activity Feed */}
      {!compact && (
        <div className="px-4 py-3 max-h-48 overflow-y-auto">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
            Activity
          </div>
          <LEAPSActivityFeed />
        </div>
      )}
    </div>
  );
}

export default LEAPSFlowPanel;
