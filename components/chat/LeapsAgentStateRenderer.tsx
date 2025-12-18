'use client';

/**
 * LeapsAgentStateRenderer - Renders real-time CoAgent state
 *
 * Uses CopilotKit's useCoAgentStateRender to display live progress
 * as the LEAPS agent processes through its 4-step workflow.
 */

import { useCoAgentStateRender } from '@copilotkit/react-core';
import {
  Filter,
  Medal,
  LineChart,
  Shield,
  Check,
  Loader2,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';

// ============================================================================
// Shared State Types (must match backend schema)
// ============================================================================

interface LEAPSCandidate {
  contractSymbol: string;
  strike: number;
  expiration: string;
  optionType: string;
  mark: number;
  delta: number;
  theta: number;
  iv: number;
  openInterest: number;
  dte: number;
}

interface RankedCandidate {
  contract: LEAPSCandidate;
  scores: {
    thetaEfficiency: number;
    deltaProbability: number;
    liquidity: number;
    riskReward: number;
  };
  overallScore: number;
  why: string[];
  riskFlags: string[];
}

interface Simulation {
  rank: number;
  contract: LEAPSCandidate;
  candidate?: {
    expectedProfit?: {
      expectedProfitUsd: number;
      expectedRoiPct: number;
      horizonMovePct: number;
    };
  };
  payoff: {
    breakeven: number;
    maxProfit: string | number;
    maxLoss: number;
    costBasis: number;
  };
  expectedProfit?: {
    expectedProfitUsd: number;
    expectedRoiPct: number;
    horizonMovePct: number;
  };
  scenarios: Array<{
    move: string;
    price: number;
    pnl: number;
    roi: number;
  }>;
  thetaDecay: {
    daily: number;
    weekly: number;
    monthly: number;
  };
}

interface RiskScan {
  symbol: string;
  overallRisk: string;
  ivAnalysis: {
    ivRank: number;
    ivPercentile: number;
    assessment: string;
  };
  events: Array<{
    date: string;
    event: string;
    impact: string;
  }>;
  warnings: string[];
  recommendations: string[];
}

interface LeapsAgentState {
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  capitalBudget: number;
  currentStep: 'filter' | 'rank' | 'simulate' | 'risk_scan' | 'complete';
  stepProgress: string;
  isProcessing: boolean;
  currentTool?: string;
  toolProgress?: string;
  filterResults?: {
    passedCount: number;
    excludedCount: number;
    criteria: Record<string, unknown>;
  };
  candidates?: LEAPSCandidate[];
  rankedCandidates?: RankedCandidate[];
  simulations?: Simulation[];
  riskScan?: RiskScan;
}

// ============================================================================
// Step Components
// ============================================================================

const STEPS = ['Filter', 'Rank', 'Simulate', 'Risk Scan'];

function StepIndicator({ currentStep }: { currentStep: string }) {
  const stepIndex = {
    filter: 0,
    rank: 1,
    simulate: 2,
    risk_scan: 3,
    complete: 4,
  }[currentStep] || 0;

  return (
    <div className="flex items-center justify-between mb-4 px-2">
      {STEPS.map((step, idx) => (
        <div key={idx} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
              idx < stepIndex
                ? 'bg-green-500 text-white'
                : idx === stepIndex
                ? 'bg-blue-500 text-white animate-pulse'
                : 'bg-gray-200 dark:bg-slate-600 text-gray-500 dark:text-gray-400'
            }`}
          >
            {idx < stepIndex ? <Check className="w-4 h-4" /> : idx + 1}
          </div>
          <span
            className={`ml-2 text-xs hidden sm:block ${
              idx === stepIndex
                ? 'text-blue-600 dark:text-blue-400 font-medium'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {step}
          </span>
          {idx < STEPS.length - 1 && (
            <ChevronRight className="w-4 h-4 mx-2 text-gray-300 dark:text-gray-600" />
          )}
        </div>
      ))}
    </div>
  );
}

function ToolProgressIndicator({
  currentTool,
  toolProgress,
}: {
  currentTool?: string;
  toolProgress?: string;
}) {
  if (!currentTool) return null;

  const getToolIcon = (tool: string) => {
    if (tool.includes('filter')) return Filter;
    if (tool.includes('rank')) return Medal;
    if (tool.includes('simulate') || tool.includes('payoff')) return LineChart;
    if (tool.includes('risk')) return Shield;
    return Loader2;
  };

  const Icon = getToolIcon(currentTool);

  return (
    <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg animate-pulse">
      <div className="relative">
        <Icon className="w-5 h-5 text-blue-500" />
        <div className="absolute inset-0 animate-ping">
          <Icon className="w-5 h-5 text-blue-500 opacity-50" />
        </div>
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium text-blue-700 dark:text-blue-300">
          {currentTool}
        </div>
        {toolProgress && (
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
            {toolProgress}
          </div>
        )}
      </div>
      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
    </div>
  );
}

function FilterResultsCard({ state }: { state: LeapsAgentState }) {
  if (!state.filterResults) return null;

  return (
    <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-blue-500" />
          <span className="font-medium text-sm">Filter Results</span>
        </div>
        <div className="text-xs">
          <span className="text-green-600 dark:text-green-400 font-medium">
            {state.filterResults.passedCount} passed
          </span>
          <span className="text-gray-400 mx-1">|</span>
          <span className="text-gray-500">{state.filterResults.excludedCount} excluded</span>
        </div>
      </div>
      {state.candidates && state.candidates.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {state.candidates.slice(0, 3).map((c, i) => (
            <div key={i} className="text-xs p-2 bg-white dark:bg-slate-800 rounded">
              <span className="font-mono">{c.contractSymbol?.slice(-15)}</span>
              <span className="text-gray-500 ml-2">
                ${c.strike} | Delta: {c.delta?.toFixed(2)} | {c.dte} DTE
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RankResultsCard({ state }: { state: LeapsAgentState }) {
  if (!state.rankedCandidates || state.rankedCandidates.length === 0) return null;

  return (
    <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Medal className="w-4 h-4 text-yellow-500" />
        <span className="font-medium text-sm">Ranked Candidates</span>
      </div>
      <div className="space-y-2">
        {state.rankedCandidates.slice(0, 3).map((r, i) => (
          <div
            key={i}
            className={`p-2 rounded text-xs ${
              i === 0
                ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
                : 'bg-white dark:bg-slate-800'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="font-medium">
                #{i + 1} ${r.contract?.strike} {r.contract?.optionType}
              </span>
              <span className="text-blue-600 font-bold">{r.overallScore?.toFixed(1)} pts</span>
            </div>
            {r.why?.[0] && (
              <div className="text-green-600 mt-1 flex items-center gap-1">
                <Check className="w-3 h-3" />
                {r.why[0]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SimulationResultsCard({ state }: { state: LeapsAgentState }) {
  if (!state.simulations || state.simulations.length === 0) return null;

  const sim = state.simulations[0];

  return (
    <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <LineChart className="w-4 h-4 text-purple-500" />
        <span className="font-medium text-sm">Payoff Simulation</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
        <div className="p-2 bg-white dark:bg-slate-800 rounded text-center">
          <div className="text-gray-500">Breakeven</div>
          <div className="font-bold">${sim.payoff?.breakeven?.toFixed(2)}</div>
        </div>
        <div className="p-2 bg-white dark:bg-slate-800 rounded text-center">
          <div className="text-gray-500">Max Loss</div>
          <div className="font-bold text-red-600">${sim.payoff?.maxLoss?.toFixed(0)}</div>
        </div>
        <div className="p-2 bg-white dark:bg-slate-800 rounded text-center">
          <div className="text-gray-500">Expected Profit</div>
          <div className="font-bold text-green-600">
            {(sim.expectedProfit?.expectedProfitUsd ?? sim.candidate?.expectedProfit?.expectedProfitUsd) != null
              ? `$${(sim.expectedProfit?.expectedProfitUsd ?? sim.candidate?.expectedProfit?.expectedProfitUsd)?.toFixed(0)}`
              : sim.payoff?.maxProfit === 'unlimited' ? '∞' : `$${sim.payoff?.maxProfit}`}
          </div>
        </div>
      </div>
      {sim.scenarios && (
        <div className="flex gap-1 flex-wrap">
          {sim.scenarios.slice(0, 5).map((s, i) => (
            <span
              key={i}
              className={`px-1.5 py-0.5 rounded text-xs ${
                s.pnl >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {s.move}: {s.roi >= 0 ? '+' : ''}{s.roi?.toFixed(0)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RiskScanCard({ state }: { state: LeapsAgentState }) {
  if (!state.riskScan) return null;

  const riskColorMap: Record<string, string> = {
    low: 'bg-green-100 text-green-700',
    moderate: 'bg-yellow-100 text-yellow-700',
    high: 'bg-orange-100 text-orange-700',
    critical: 'bg-red-100 text-red-700',
  };
  const riskColor = riskColorMap[state.riskScan.overallRisk] || 'bg-gray-100 text-gray-700';

  return (
    <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-500" />
          <span className="font-medium text-sm">Risk Assessment</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium uppercase ${riskColor}`}>
          {state.riskScan.overallRisk}
        </span>
      </div>
      {state.riskScan.ivAnalysis && (
        <div className="text-xs mb-2">
          <span className="text-gray-500">IV Rank: </span>
          <span className="font-medium">{state.riskScan.ivAnalysis.ivRank}%</span>
        </div>
      )}
      {state.riskScan.warnings && state.riskScan.warnings.length > 0 && (
        <div className="space-y-1">
          {state.riskScan.warnings.slice(0, 2).map((w, i) => (
            <div key={i} className="flex items-start gap-1 text-xs text-amber-600">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main State Renderer
// ============================================================================

function LeapsAgentStateContent({ state }: { state: LeapsAgentState }) {
  const stepIndex = {
    filter: 0,
    rank: 1,
    simulate: 2,
    risk_scan: 3,
    complete: 4,
  }[state.currentStep] || 0;

  return (
    <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">LEAPS Builder</span>
          <span className="text-xs opacity-80">
            {state.symbol} • {state.direction}
          </span>
        </div>
        {state.isProcessing && (
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Processing...</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 bg-white dark:bg-slate-800 space-y-3">
        {/* Step Progress */}
        <StepIndicator currentStep={state.currentStep} />

        {/* Current Progress Message */}
        {state.stepProgress && (
          <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
            {state.stepProgress}
          </div>
        )}

        {/* Tool Execution Progress */}
        {state.isProcessing && (
          <ToolProgressIndicator
            currentTool={state.currentTool}
            toolProgress={state.toolProgress}
          />
        )}

        {/* Results Cards */}
        {stepIndex >= 1 && <FilterResultsCard state={state} />}
        {stepIndex >= 2 && <RankResultsCard state={state} />}
        {stepIndex >= 3 && <SimulationResultsCard state={state} />}
        {stepIndex >= 4 && <RiskScanCard state={state} />}
      </div>
    </div>
  );
}

// ============================================================================
// Hook Export
// ============================================================================

/**
 * Register the LEAPS agent state renderer with CopilotKit
 */
export function useLeapsAgentStateRender() {
  useCoAgentStateRender<LeapsAgentState>({
    name: 'leaps_builder',
    render: ({ state }) => {
      if (!state || !state.symbol) return null;
      return <LeapsAgentStateContent state={state} />;
    },
  });
}

export default LeapsAgentStateContent;
