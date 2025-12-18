'use client';

/**
 * LEAPS Builder Actions - AG-UI compliant actions for LEAPS options building
 *
 * The buildLEAPS action triggers the LEAPS Builder sidecar panel instead of
 * rendering inline in the chat. The panel provides a better UX for the
 * 4-step HITL workflow.
 */

import React from 'react';
import { useCopilotAction } from '@copilotkit/react-core';
import { useLEAPSBuilder, LEAPSContract } from '@/components/leaps/LEAPSBuilderContext';
import { useOptionsChain } from '@/components/dashboard/options-chain/context/OptionsChainContext';
import {
  Filter,
  Medal,
  LineChart,
  Shield,
  Check,
  AlertTriangle,
  Clock,
  Target,
  Loader2,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface LEAPSCandidate {
  contract: {
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
  };
  scores?: {
    thetaEfficiency: number;
    deltaProbability: number;
    liquidity: number;
    riskReward: number;
  };
  overallScore?: number;
  why?: string[];
  riskFlags?: string[];
}

interface PayoffScenario {
  move: string;
  price: number;
  pnl: number;
  roi: number;
}

interface Simulation {
  rank: number;
  contract: LEAPSCandidate['contract'];
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
  scenarios: PayoffScenario[];
  thetaDecay: {
    daily: number;
    weekly: number;
    monthly: number;
  };
}

// ============================================================================
// UI Components (used by individual display actions)
// ============================================================================

function FilterResults({
  symbol,
  passedCount,
  excludedCount,
  candidates,
}: {
  symbol: string;
  passedCount: number;
  excludedCount: number;
  candidates: LEAPSCandidate[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center">
            <Filter className="w-5 h-5 text-blue-600 dark:text-blue-300" />
          </div>
          <div>
            <span className="font-semibold text-blue-900 dark:text-blue-100 text-lg">{symbol} LEAPS Filter</span>
            <p className="text-xs text-blue-600 dark:text-blue-400">DTE 540-900 • Delta 0.60-0.85</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{passedCount}</div>
            <div className="text-xs text-gray-500">passed</div>
          </div>
          <div className="w-px h-8 bg-gray-300 dark:bg-gray-600" />
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-400">{excludedCount}</div>
            <div className="text-xs text-gray-500">excluded</div>
          </div>
        </div>
      </div>
      {candidates.length > 0 && (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {candidates.slice(0, 5).map((c, idx) => {
            const data = c.contract || c;
            return (
              <div key={idx} className="p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-100 dark:border-slate-600">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-base font-semibold">{(data as any)?.contractSymbol?.slice(-15) || 'N/A'}</span>
                  <span className="text-sm font-medium text-white bg-blue-500 px-3 py-1 rounded-full">{(data as any)?.dte || 0} DTE</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Strike</div>
                    <div className="text-base font-bold">${(data as any)?.strike || 0}</div>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Delta</div>
                    <div className="text-base font-bold">{(data as any)?.delta?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Mark</div>
                    <div className="text-base font-bold">${(data as any)?.mark?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">IV</div>
                    <div className="text-base font-bold">{((data as any)?.iv * 100)?.toFixed(0) || 'N/A'}%</div>
                  </div>
                </div>
              </div>
            );
          })}
          {candidates.length > 5 && (
            <p className="text-sm text-gray-500 text-center py-3 bg-gray-50 dark:bg-slate-700/30 rounded-lg">+ {candidates.length - 5} more candidates</p>
          )}
        </div>
      )}
    </div>
  );
}

function RankedCandidates({ candidates }: { candidates: LEAPSCandidate[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
        <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-800 flex items-center justify-center">
          <Medal className="w-5 h-5 text-yellow-600 dark:text-yellow-300" />
        </div>
        <div>
          <span className="font-semibold text-lg">Ranked Candidates</span>
          <p className="text-xs text-gray-500 dark:text-gray-400">Scored by theta, delta, liquidity & risk/reward</p>
        </div>
      </div>
      <div className="space-y-3">
        {candidates.slice(0, 5).map((c, idx) => {
          const data = c.contract || c;
          return (
            <div
              key={idx}
              className={`p-4 rounded-xl border-2 ${
                idx === 0
                  ? 'bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border-yellow-300 dark:border-yellow-700'
                  : 'bg-gray-50 dark:bg-slate-700/50 border-gray-200 dark:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      idx === 0 ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-white shadow-lg' : 'bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div>
                    <span className="font-semibold text-base">${(data as any)?.strike || 0} {(data as any)?.optionType || 'Call'}</span>
                    <p className="text-xs text-gray-500">{(data as any)?.dte || 0} DTE • Mark ${(data as any)?.mark?.toFixed(2) || 'N/A'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                    {c.overallScore?.toFixed(1) || 'N/A'}
                  </div>
                  <div className="text-xs text-gray-500">points</div>
                </div>
              </div>
              {c.scores && (
                <div className="grid grid-cols-4 gap-2 mb-3">
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Theta Eff.</div>
                    <div className="text-base font-bold">{c.scores.thetaEfficiency?.toFixed(0) || 'N/A'}</div>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Delta Prob.</div>
                    <div className="text-base font-bold">{c.scores.deltaProbability?.toFixed(0) || 'N/A'}</div>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Liquidity</div>
                    <div className="text-base font-bold">{c.scores.liquidity?.toFixed(0) || 'N/A'}</div>
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-800 rounded-lg text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Risk/Reward</div>
                    <div className="text-base font-bold">{c.scores.riskReward?.toFixed(0) || 'N/A'}</div>
                  </div>
                </div>
              )}
              {c.why && c.why.length > 0 && (
                <div className="text-sm text-green-600 dark:text-green-400 flex items-start gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{c.why[0]}</span>
                </div>
              )}
              {c.riskFlags && c.riskFlags.length > 0 && (
                <div className="text-sm text-amber-600 dark:text-amber-400 flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg mt-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{c.riskFlags[0]}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PayoffSimulation({ simulations }: { simulations: Simulation[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
        <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-800 flex items-center justify-center">
          <LineChart className="w-5 h-5 text-purple-600 dark:text-purple-300" />
        </div>
        <div>
          <span className="font-semibold text-lg">Payoff Simulations</span>
          <p className="text-xs text-gray-500 dark:text-gray-400">P&L scenarios across price movements</p>
        </div>
      </div>
      {simulations.slice(0, 3).map((sim, idx) => (
        <div key={idx} className="p-4 bg-gray-50 dark:bg-slate-700/50 rounded-xl border border-gray-200 dark:border-slate-600">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-bold">
                #{sim.rank}
              </span>
              <div>
                <span className="font-semibold text-base">${sim.contract?.strike} {sim.contract?.optionType}</span>
                <p className="text-xs text-gray-500">{sim.contract?.dte || 0} DTE</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">${sim.payoff?.costBasis?.toFixed(0)}</div>
              <div className="text-xs text-gray-500">cost basis</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-white dark:bg-slate-800 rounded-lg text-center border border-gray-100 dark:border-slate-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Breakeven</div>
              <div className="text-lg font-bold">${sim.payoff?.breakeven?.toFixed(2)}</div>
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-center border border-red-100 dark:border-red-900">
              <div className="text-xs text-red-500 dark:text-red-400 mb-1">Max Loss</div>
              <div className="text-lg font-bold text-red-600 dark:text-red-400">${Math.abs(sim.payoff?.maxLoss || 0).toFixed(0)}</div>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center border border-green-100 dark:border-green-900">
              <div className="text-xs text-green-500 dark:text-green-400 mb-1">Expected Profit</div>
              <div className="text-lg font-bold text-green-600 dark:text-green-400">
                {(sim.expectedProfit?.expectedProfitUsd ?? (sim as any).candidate?.expectedProfit?.expectedProfitUsd) != null
                  ? `$${(sim.expectedProfit?.expectedProfitUsd ?? (sim as any).candidate?.expectedProfit?.expectedProfitUsd)?.toFixed(0)}`
                  : sim.payoff?.maxProfit === 'unlimited' ? '∞' : `$${sim.payoff?.maxProfit}`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-gray-100 dark:bg-slate-800 rounded-lg mb-4">
            <Clock className="w-4 h-4 text-gray-500" />
            <div className="flex-1 grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Daily:</span>{' '}
                <span className="font-medium">${Math.abs(sim.thetaDecay?.daily || 0).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-gray-500">Weekly:</span>{' '}
                <span className="font-medium">${Math.abs(sim.thetaDecay?.weekly || 0).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-gray-500">Monthly:</span>{' '}
                <span className="font-medium">${Math.abs(sim.thetaDecay?.monthly || 0).toFixed(0)}</span>
              </div>
            </div>
          </div>

          {sim.scenarios && sim.scenarios.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2 font-medium">Price Scenarios</div>
              <div className="flex flex-wrap gap-2">
                {sim.scenarios.map((s, sIdx) => (
                  <div
                    key={sIdx}
                    className={`px-3 py-2 rounded-lg text-sm font-medium ${
                      s.pnl >= 0
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                    }`}
                  >
                    <div className="text-xs opacity-75">{s.move}</div>
                    <div className="font-bold">{s.roi >= 0 ? '+' : ''}{s.roi?.toFixed(0)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RiskReport({
  symbol,
  riskLevel,
  ivRank,
  warnings,
  recommendations,
}: {
  symbol: string;
  riskLevel: string;
  ivRank?: number;
  warnings: string[];
  recommendations: string[];
}) {
  const getRiskColor = (level: string) => {
    switch (level) {
      case 'low': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'moderate': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'high': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
      case 'critical': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-700 rounded-lg">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          <span className="font-medium">{symbol} Risk Assessment</span>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium uppercase ${getRiskColor(riskLevel)}`}>
          {riskLevel}
        </span>
      </div>

      {ivRank !== undefined && (
        <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">IV Rank</span>
            <span className="font-bold">{ivRank}%</span>
          </div>
          <div className="w-full h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                ivRank < 30 ? 'bg-green-500' : ivRank < 70 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${ivRank}%` }}
            />
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Warnings</span>
          {warnings.map((w, idx) => (
            <div key={idx} className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Recommendations</span>
          {recommendations.map((r, idx) => (
            <div key={idx} className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700 dark:text-blue-400">
              <Target className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Panel Trigger Component
// ============================================================================

function LEAPSBuilderTrigger({
  symbol,
  direction,
  capitalBudget,
  status,
  includeSelectedContracts,
  expectedMovePct,
}: {
  symbol: string;
  direction: string;
  capitalBudget?: number;
  status: string;
  includeSelectedContracts?: boolean;
  expectedMovePct?: number;
}) {
  const { state, openPanel, openPanelWithChainData, addUserSelection } = useLEAPSBuilder();
  const { chainSummary, viewedCalls, viewedPuts, selectedContracts, getLeapsContracts } = useOptionsChain();
  // Track if we've opened for this specific request
  const hasOpenedThisRequest = React.useRef(false);
  const prevIsOpen = React.useRef(state.isOpen);

  // Reset the flag when panel is closed (allows reopening on next request)
  React.useEffect(() => {
    if (prevIsOpen.current && !state.isOpen) {
      // Panel was just closed - reset for next request
      hasOpenedThisRequest.current = false;
    }
    prevIsOpen.current = state.isOpen;
  }, [state.isOpen]);

  // Open panel when component mounts (action is triggered)
  React.useEffect(() => {
    const upperSymbol = symbol?.toUpperCase();

    // Only open if:
    // 1. We have a symbol
    // 2. We haven't already opened for this request
    // 3. Panel is not already open (prevents duplicate opens)
    if (symbol && !hasOpenedThisRequest.current && !state.isOpen) {
      hasOpenedThisRequest.current = true;

      // Check if we have chain data for this symbol
      if (chainSummary?.symbol === upperSymbol && (viewedCalls.length > 0 || viewedPuts.length > 0)) {
        // Use viewed chain data - convert to LEAPSContract format
        const { calls: leapsCalls, puts: leapsPuts } = getLeapsContracts();
        const chainContracts: LEAPSContract[] = [
          ...leapsCalls.map(c => ({
            contractSymbol: c.contractSymbol,
            strike: c.strike,
            expiration: c.expiration,
            optionType: c.optionType,
            mark: c.mark,
            delta: c.delta,
            theta: c.theta,
            iv: c.iv,
            openInterest: c.openInterest,
            dte: c.dte,
            bid: c.bid,
            ask: c.ask,
            gamma: c.gamma,
            vega: c.vega,
            volume: c.volume,
          })),
          ...leapsPuts.map(p => ({
            contractSymbol: p.contractSymbol,
            strike: p.strike,
            expiration: p.expiration,
            optionType: p.optionType,
            mark: p.mark,
            delta: p.delta,
            theta: p.theta,
            iv: p.iv,
            openInterest: p.openInterest,
            dte: p.dte,
            bid: p.bid,
            ask: p.ask,
            gamma: p.gamma,
            vega: p.vega,
            volume: p.volume,
          })),
        ];

        if (chainContracts.length > 0) {
          openPanelWithChainData(upperSymbol, direction, chainContracts, capitalBudget || 10000, expectedMovePct);

          // Add user-selected contracts from chain if requested
          if (includeSelectedContracts && selectedContracts.length > 0) {
            selectedContracts.forEach(sc => {
              // Only add LEAPS-qualified contracts (DTE >= 180)
              if (sc.dte >= 180) {
                addUserSelection({
                  contractSymbol: sc.contractSymbol,
                  strike: sc.strike,
                  expiration: sc.expiration,
                  optionType: sc.optionType,
                  mark: sc.mark,
                  delta: sc.delta,
                  theta: sc.theta,
                  iv: sc.iv,
                  openInterest: sc.openInterest,
                  dte: sc.dte,
                  bid: sc.bid,
                  ask: sc.ask,
                  gamma: sc.gamma,
                  vega: sc.vega,
                  volume: sc.volume,
                });
              }
            });
          }
        } else {
          // No LEAPS in viewed chain, use API
          openPanel(upperSymbol, direction, capitalBudget || 10000);
        }
      } else {
        // No matching chain data, use API
        openPanel(upperSymbol, direction, capitalBudget || 10000);
      }
    }
  }, [symbol, direction, capitalBudget, openPanel, openPanelWithChainData, chainSummary, viewedCalls, viewedPuts, selectedContracts, getLeapsContracts, includeSelectedContracts, addUserSelection, state.isOpen]);

  // Show a minimal inline notification
  return (
    <div className="my-2 p-3 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 flex items-center justify-center">
          <Target className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-indigo-900 dark:text-indigo-100">LEAPS Builder</span>
            {status === 'executing' ? (
              <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Running
              </span>
            ) : (
              <span className="text-xs bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Check className="w-3 h-3" />
                Complete
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {symbol.toUpperCase()} • {direction} • See panel on right →
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Hook: Register LEAPS Actions
// ============================================================================

export function useLeapsActions() {
  console.log('[useLeapsActions] Registering LEAPS actions...');

  // Action: Build LEAPS position (opens the sidecar panel)
  useCopilotAction({
    name: 'buildLEAPS',
    description: `Build a LEAPS (Long-Term Equity AnticiPation Securities) options position step-by-step.
    Use this when user wants to:
    - Find long-term options (6+ months out)
    - Build a stock replacement strategy
    - Get LEAPS recommendations for a symbol
    - Compare LEAPS candidates

    IMPORTANT - Context awareness:
    - Check if user is viewing a LEAPS-qualified expiration (DTE >= 180 days) in the options chain
    - If isViewingLeaps is true in their chain view, acknowledge it: "I see you're looking at the [expiration] expiration which qualifies as LEAPS. Would you like me to build a LEAPS position for that expiration?"
    - If user has selected specific contracts (selectedContractsCount > 0), include them in the analysis by setting includeSelectedContracts to true
    - When user selects a contract and asks about LEAPS, always include their selection in the comparison

    This opens the LEAPS Builder panel on the right side of the screen.`,
    parameters: [
      { name: 'symbol', type: 'string', description: 'Stock ticker symbol (e.g., AAPL, SPY)', required: true },
      { name: 'direction', type: 'string', description: 'Market outlook: bullish, bearish, or neutral', required: true },
      { name: 'capitalBudget', type: 'number', description: 'Maximum premium to spend in dollars', required: false },
      { name: 'includeSelectedContracts', type: 'boolean', description: 'Include user-selected contracts from the chain view in the analysis', required: false },
      { name: 'expectedMovePct', type: 'number', description: 'Expected annual price move (e.g., 0.20 for 20%)', required: false },
    ],
    render: ({ args, status }) => {
      // Render the trigger component which opens the panel
      return (
        <LEAPSBuilderTrigger
          symbol={(args.symbol as string) || ''}
          direction={(args.direction as string) || 'bullish'}
          capitalBudget={args.capitalBudget as number}
          status={status}
          includeSelectedContracts={args.includeSelectedContracts as boolean}
          expectedMovePct={args.expectedMovePct as number}
        />
      );
    },
    handler: async ({ symbol, direction, capitalBudget, includeSelectedContracts }) => {
      // The actual analysis is triggered by the panel via context
      // This handler just returns success to indicate the panel was opened
      return {
        success: true,
        message: `LEAPS Builder panel opened for ${symbol?.toUpperCase()}`,
        symbol: symbol?.toUpperCase(),
        direction: direction || 'bullish',
        capitalBudget: capitalBudget || 10000,
        includeSelectedContracts: includeSelectedContracts || false,
      };
    },
  });

  // Action: Display LEAPS filter results
  useCopilotAction({
    name: 'displayLeapsFilter',
    description: 'Display LEAPS chain filter results. Use after filtering options chain for LEAPS candidates.',
    parameters: [
      { name: 'symbol', type: 'string', description: 'Stock symbol', required: true },
      { name: 'passedCount', type: 'number', description: 'Number of contracts that passed filters', required: true },
      { name: 'excludedCount', type: 'number', description: 'Number of contracts excluded', required: true },
      { name: 'candidatesJson', type: 'string', description: 'JSON array of top candidates', required: false },
    ],
    render: ({ args, status }) => {
      if (status === 'executing' || status === 'complete') {
        let candidates: LEAPSCandidate[] = [];
        try {
          candidates = JSON.parse(args.candidatesJson as string || '[]');
        } catch {
          candidates = [];
        }
        return (
          <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
            <div className="px-3 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white flex items-center gap-2">
              <Filter className="w-4 h-4" />
              <span className="font-semibold text-sm">LEAPS Filter Results</span>
            </div>
            <div className="p-3 bg-white dark:bg-slate-800">
              <FilterResults
                symbol={args.symbol as string}
                passedCount={args.passedCount as number}
                excludedCount={args.excludedCount as number}
                candidates={candidates}
              />
            </div>
          </div>
        );
      }
      return <></>;
    },
    handler: async ({ symbol, passedCount, excludedCount }) => {
      return { success: true, symbol, passedCount, excludedCount };
    },
  });

  // Action: Display LEAPS ranked candidates
  useCopilotAction({
    name: 'displayLeapsRanking',
    description: 'Display ranked LEAPS candidates with scores. Use after ranking filtered candidates.',
    parameters: [
      { name: 'candidatesJson', type: 'string', description: 'JSON array of ranked candidates with scores', required: true },
    ],
    render: ({ args, status }) => {
      if (status === 'executing' || status === 'complete') {
        let candidates: LEAPSCandidate[] = [];
        try {
          candidates = JSON.parse(args.candidatesJson as string || '[]');
        } catch {
          candidates = [];
        }
        return (
          <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
            <div className="px-3 py-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-white flex items-center gap-2">
              <Medal className="w-4 h-4" />
              <span className="font-semibold text-sm">LEAPS Ranking</span>
            </div>
            <div className="p-3 bg-white dark:bg-slate-800">
              <RankedCandidates candidates={candidates} />
            </div>
          </div>
        );
      }
      return <></>;
    },
    handler: async ({ candidatesJson }) => {
      let candidates: LEAPSCandidate[] = [];
      try {
        candidates = JSON.parse(candidatesJson as string || '[]');
      } catch {
        candidates = [];
      }
      return { success: true, count: candidates.length };
    },
  });

  // Action: Display LEAPS payoff simulation
  useCopilotAction({
    name: 'displayLeapsPayoff',
    description: 'Display payoff simulation for LEAPS positions. Use after simulating P&L scenarios.',
    parameters: [
      { name: 'simulationsJson', type: 'string', description: 'JSON array of simulation results', required: true },
    ],
    render: ({ args, status }) => {
      if (status === 'executing' || status === 'complete') {
        let simulations: Simulation[] = [];
        try {
          simulations = JSON.parse(args.simulationsJson as string || '[]');
        } catch {
          simulations = [];
        }
        return (
          <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
            <div className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white flex items-center gap-2">
              <LineChart className="w-4 h-4" />
              <span className="font-semibold text-sm">Payoff Simulation</span>
            </div>
            <div className="p-3 bg-white dark:bg-slate-800">
              <PayoffSimulation simulations={simulations} />
            </div>
          </div>
        );
      }
      return <></>;
    },
    handler: async ({ simulationsJson }) => {
      let simulations: Simulation[] = [];
      try {
        simulations = JSON.parse(simulationsJson as string || '[]');
      } catch {
        simulations = [];
      }
      return { success: true, count: simulations.length };
    },
  });

  // Action: Display LEAPS risk report
  useCopilotAction({
    name: 'displayLeapsRisk',
    description: 'Display risk assessment for LEAPS position. Use after running risk scan.',
    parameters: [
      { name: 'symbol', type: 'string', description: 'Stock symbol', required: true },
      { name: 'riskLevel', type: 'string', description: 'Overall risk level: low, moderate, high, critical', required: true },
      { name: 'ivRank', type: 'number', description: 'IV rank percentile (0-100)', required: false },
      { name: 'warningsJson', type: 'string', description: 'JSON array of warning strings', required: false },
      { name: 'recommendationsJson', type: 'string', description: 'JSON array of recommendation strings', required: false },
    ],
    render: ({ args, status }) => {
      if (status === 'executing' || status === 'complete') {
        let warnings: string[] = [];
        let recommendations: string[] = [];
        try {
          warnings = JSON.parse(args.warningsJson as string || '[]');
          recommendations = JSON.parse(args.recommendationsJson as string || '[]');
        } catch {
          warnings = [];
          recommendations = [];
        }
        return (
          <div className="my-2 rounded-xl border border-gray-200 dark:border-slate-600 overflow-hidden">
            <div className="px-3 py-2 bg-gradient-to-r from-slate-500 to-slate-700 text-white flex items-center gap-2">
              <Shield className="w-4 h-4" />
              <span className="font-semibold text-sm">Risk Assessment</span>
            </div>
            <div className="p-3 bg-white dark:bg-slate-800">
              <RiskReport
                symbol={args.symbol as string}
                riskLevel={args.riskLevel as string}
                ivRank={args.ivRank as number}
                warnings={warnings}
                recommendations={recommendations}
              />
            </div>
          </div>
        );
      }
      return <></>;
    },
    handler: async ({ symbol, riskLevel }) => {
      return { success: true, symbol, riskLevel };
    },
  });
}
