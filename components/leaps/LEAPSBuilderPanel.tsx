'use client';

/**
 * LEAPSBuilderPanel - Sidecar panel for LEAPS options building
 *
 * This is a persistent side panel that appears when the agent enters
 * LEAPS Builder mode. It's not a chat message but a tool panel.
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  Filter,
  Medal,
  LineChart,
  Shield,
  ChevronRight,
  Check,
  AlertTriangle,
  X,
  Minus,
  Play,
  Clock,
  Target,
  Loader2,
  TrendingUp,
  RefreshCw,
  MessageCircle,
  Send,
  Sparkles,
} from 'lucide-react';
import { useLEAPSBuilder } from './LEAPSBuilderContext';

// ============================================================================
// Popular LEAPS Tickers
// ============================================================================

const POPULAR_LEAPS_TICKERS = [
  { symbol: 'SPY', name: 'S&P 500 ETF', category: 'ETF' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', category: 'ETF' },
  { symbol: 'IWM', name: 'Russell 2000 ETF', category: 'ETF' },
  { symbol: 'AAPL', name: 'Apple', category: 'Tech' },
  { symbol: 'MSFT', name: 'Microsoft', category: 'Tech' },
  { symbol: 'NVDA', name: 'NVIDIA', category: 'Tech' },
  { symbol: 'GOOGL', name: 'Alphabet', category: 'Tech' },
  { symbol: 'AVGO', name: 'Broadcom', category: 'Tech' },
  { symbol: 'META', name: 'Meta Platforms', category: 'Tech' },
];

// ============================================================================
// Popular Tickers Quick Switch
// ============================================================================

function PopularTickersBar({ currentSymbol, onSelect }: { currentSymbol: string; onSelect: (symbol: string) => void }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300">
      <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">Quick:</span>
      {POPULAR_LEAPS_TICKERS.map((ticker) => (
        <button
          key={ticker.symbol}
          onClick={() => onSelect(ticker.symbol)}
          disabled={ticker.symbol === currentSymbol}
          className={`px-2 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
            ticker.symbol === currentSymbol
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30'
          }`}
          title={ticker.name}
        >
          {ticker.symbol}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Step Indicator
// ============================================================================

function StepIndicator({ currentStep, isLoading }: { currentStep: number; isLoading: boolean }) {
  const steps = [
    { name: 'Filter', icon: Filter },
    { name: 'Rank', icon: Medal },
    { name: 'Simulate', icon: LineChart },
    { name: 'Risk Scan', icon: Shield },
  ];

  return (
    <div className="flex items-center justify-between px-2 py-3">
      {steps.map((step, idx) => {
        const Icon = step.icon;
        const isComplete = idx < currentStep;
        const isCurrent = idx === currentStep;
        const isActive = isComplete || isCurrent;

        return (
          <React.Fragment key={idx}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  isComplete
                    ? 'bg-green-500 text-white'
                    : isCurrent
                    ? isLoading
                      ? 'bg-blue-500 text-white animate-pulse'
                      : 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-slate-600 text-gray-400'
                }`}
              >
                {isComplete ? (
                  <Check className="w-5 h-5" />
                ) : isCurrent && isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
              </div>
              <span
                className={`text-xs font-medium ${
                  isActive ? 'text-gray-900 dark:text-white' : 'text-gray-400'
                }`}
              >
                {step.name}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 ${
                  idx < currentStep ? 'bg-green-500' : 'bg-gray-200 dark:bg-slate-600'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ============================================================================
// Filter Results Section
// ============================================================================

function FilterSection({ showAction = false }: { showAction?: boolean }) {
  const { state, confirmFilter } = useLEAPSBuilder();
  const { filterResults, candidates, currentStep, isLoading } = state;

  if (!filterResults && candidates.length === 0) return null;

  const isFilterStep = currentStep === 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-blue-500" />
          <span className="font-semibold">Filter Results</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-green-600 dark:text-green-400 font-bold">
            {filterResults?.passedCount || candidates.length} passed
          </span>
          <span className="text-gray-400">|</span>
          <span className="text-gray-500">{filterResults?.excludedCount || 0} excluded</span>
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {candidates.slice(0, 5).map((c, idx) => {
            const data = c.contract || (c as unknown as { contractSymbol?: string; dte?: number; strike?: number; delta?: number; mark?: number; iv?: number });
            return (
              <div
                key={idx}
                className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-100 dark:border-slate-600"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm font-semibold">
                    {data?.contractSymbol?.slice(-15) || 'N/A'}
                  </span>
                  <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full">
                    {data?.dte || 0} DTE
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="text-center p-1 bg-white dark:bg-slate-800 rounded">
                    <div className="text-gray-500">Strike</div>
                    <div className="font-bold">${data?.strike || 0}</div>
                  </div>
                  <div className="text-center p-1 bg-white dark:bg-slate-800 rounded">
                    <div className="text-gray-500">Delta</div>
                    <div className="font-bold">{data?.delta?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div className="text-center p-1 bg-white dark:bg-slate-800 rounded">
                    <div className="text-gray-500">Mark</div>
                    <div className="font-bold">${data?.mark?.toFixed(2) || 'N/A'}</div>
                  </div>
                  <div className="text-center p-1 bg-white dark:bg-slate-800 rounded">
                    <div className="text-gray-500">IV</div>
                    <div className="font-bold">{((data?.iv || 0) * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* HITL Action Button */}
      {showAction && isFilterStep && !isLoading && (
        <div className="pt-3 border-t border-gray-200 dark:border-slate-700">
          <button
            onClick={confirmFilter}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <ChevronRight className="w-4 h-4" />
            Proceed to Ranking
          </button>
          <p className="text-xs text-center text-gray-500 mt-2">
            Review the filtered candidates above, then proceed to score and rank them
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Ranked Candidates Section
// ============================================================================

function RankSection({ showAction = false }: { showAction?: boolean }) {
  const { state, selectCandidates, selectedForSimulation, toggleCandidateSelection } = useLEAPSBuilder();
  const { rankedCandidates, currentStep, isLoading } = state;

  if (rankedCandidates.length === 0) return null;

  const isRankStep = currentStep === 2;

  const handleRunSimulation = () => {
    if (selectedForSimulation.length > 0) {
      selectCandidates(selectedForSimulation);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
        <div className="flex items-center gap-2">
          <Medal className="w-5 h-5 text-yellow-500" />
          <span className="font-semibold">Ranked Candidates</span>
        </div>
        {showAction && isRankStep && (
          <span className="text-xs bg-yellow-200 dark:bg-yellow-800 px-2 py-1 rounded-full">
            Select 1-3 to simulate
          </span>
        )}
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {rankedCandidates.slice(0, 5).map((c, idx) => {
          const data = c.contract || (c as unknown as { contractSymbol?: string; strike?: number; optionType?: string; dte?: number });
          const contractSymbol = data?.contractSymbol || `contract-${idx}`;
          const isSelected = selectedForSimulation.includes(contractSymbol);

          return (
            <div
              key={idx}
              onClick={() => showAction && isRankStep && !isLoading && toggleCandidateSelection(contractSymbol)}
              className={`p-3 rounded-lg border-2 transition-all ${
                isSelected
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 ring-2 ring-indigo-200'
                  : idx === 0
                  ? 'bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border-yellow-300'
                  : 'bg-gray-50 dark:bg-slate-700/50 border-gray-200 dark:border-slate-600'
              } ${showAction && isRankStep ? 'cursor-pointer hover:border-indigo-300' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {/* Selection checkbox for HITL */}
                  {showAction && isRankStep && (
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-indigo-500 border-indigo-500'
                          : 'border-gray-300 dark:border-slate-500'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  )}
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                      idx === 0
                        ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-white'
                        : 'bg-gray-200 dark:bg-slate-600 text-gray-600'
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div>
                    <span className="font-semibold">${data?.strike || 0} {data?.optionType || 'Call'}</span>
                    <span className="text-xs text-gray-500 ml-2">{data?.dte || 0} DTE</span>
                  </div>
                </div>
                <div className="text-lg font-bold text-blue-600">
                  {c.overallScore?.toFixed(1) || 'N/A'} <span className="text-xs">pts</span>
                </div>
              </div>

              {c.scores && (
                <div className="grid grid-cols-4 gap-1 text-xs mb-2">
                  <div className="text-center p-1 bg-white dark:bg-slate-800 rounded">
                    <div className="text-gray-500">Theta</div>
                    <div className="font-bold">{c.scores.thetaEfficiency?.toFixed(0)}</div>
                  </div>
                  <div className="text-center p-1 bg-white dark:bg-slate-800 rounded">
                    <div className="text-gray-500">Delta</div>
                    <div className="font-bold">{c.scores.deltaProbability?.toFixed(0)}</div>
                  </div>
                  <div className="text-center p-1 bg-white dark:bg-slate-800 rounded">
                    <div className="text-gray-500">Liquid</div>
                    <div className="font-bold">{c.scores.liquidity?.toFixed(0)}</div>
                  </div>
                  <div className="text-center p-1 bg-white dark:bg-slate-800 rounded">
                    <div className="text-gray-500">R/R</div>
                    <div className="font-bold">{c.scores.riskReward?.toFixed(0)}</div>
                  </div>
                </div>
              )}

              {c.why && c.why[0] && (
                <div className="text-xs text-green-600 flex items-center gap-1 p-1.5 bg-green-50 dark:bg-green-900/20 rounded">
                  <Check className="w-3 h-3" />
                  <span>{c.why[0]}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* HITL Action Button */}
      {showAction && isRankStep && !isLoading && (
        <div className="pt-3 border-t border-gray-200 dark:border-slate-700">
          <button
            onClick={handleRunSimulation}
            disabled={selectedForSimulation.length === 0}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-colors font-medium ${
              selectedForSimulation.length > 0
                ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                : 'bg-gray-200 dark:bg-slate-700 text-gray-400 cursor-not-allowed'
            }`}
          >
            <LineChart className="w-4 h-4" />
            Run Simulation ({selectedForSimulation.length} selected)
          </button>
          <p className="text-xs text-center text-gray-500 mt-2">
            Click on candidates to select them for payoff simulation
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Simulation Section
// ============================================================================

function SimulationSection({ showAction = false }: { showAction?: boolean }) {
  const { state, runRiskScan } = useLEAPSBuilder();
  const { simulations, currentStep, isLoading, riskScan } = state;

  if (simulations.length === 0) return null;

  const isSimStep = currentStep === 3;
  const hasRiskScan = !!riskScan;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
        <LineChart className="w-5 h-5 text-purple-500" />
        <span className="font-semibold">Payoff Simulations</span>
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {simulations.slice(0, 3).map((sim, idx) => (
          <div
            key={idx}
            className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg border border-gray-200 dark:border-slate-600"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs font-bold">
                  #{sim.rank}
                </span>
                <span className="font-semibold">${sim.contract?.strike} {sim.contract?.optionType}</span>
              </div>
              <span className="text-sm font-bold">${sim.payoff?.costBasis?.toFixed(0)} cost</span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="p-2 bg-white dark:bg-slate-800 rounded text-center">
                <div className="text-xs text-gray-500">Breakeven</div>
                <div className="font-bold">${sim.payoff?.breakeven?.toFixed(2)}</div>
              </div>
              <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-center">
                <div className="text-xs text-red-500">Max Loss</div>
                <div className="font-bold text-red-600">${Math.abs(sim.payoff?.maxLoss || 0).toFixed(0)}</div>
              </div>
              <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded text-center">
                <div className="text-xs text-green-500">Expected Profit</div>
                <div className="font-bold text-green-600">
                  {(sim.expectedProfit?.expectedProfitUsd ?? (sim as any).candidate?.expectedProfit?.expectedProfitUsd) != null
                    ? `$${(sim.expectedProfit?.expectedProfitUsd ?? (sim as any).candidate?.expectedProfit?.expectedProfitUsd)?.toFixed(0)}`
                    : sim.payoff?.maxProfit === 'unlimited' ? '∞' : `$${sim.payoff?.maxProfit}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-500 p-2 bg-gray-100 dark:bg-slate-800 rounded mb-2">
              <Clock className="w-3 h-3" />
              <span>Theta: ${Math.abs(sim.thetaDecay?.daily || 0).toFixed(2)}/day</span>
              <span>|</span>
              <span>${Math.abs(sim.thetaDecay?.monthly || 0).toFixed(0)}/month</span>
            </div>

            {sim.scenarios && (
              <div>
                <div className="text-[10px] text-gray-400 mb-1">P/L at Expiry</div>
                <div className="flex flex-wrap gap-1">
                  {sim.scenarios.slice(0, 5).map((s, sIdx) => (
                    <span
                      key={sIdx}
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        s.pnl >= 0
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {s.move}: {s.roi >= 0 ? '+' : ''}{s.roi?.toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* HITL Action Button - Optional Risk Scan */}
      {showAction && isSimStep && !isLoading && !hasRiskScan && (
        <div className="pt-3 border-t border-gray-200 dark:border-slate-700">
          <button
            onClick={runRiskScan}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors font-medium"
          >
            <Shield className="w-4 h-4" />
            Run Risk Scan (Optional)
          </button>
          <p className="text-xs text-center text-gray-500 mt-2">
            Analyze IV rank and identify potential risks for these positions
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Risk Section
// ============================================================================

function RiskSection() {
  const { state } = useLEAPSBuilder();
  const { riskScan, symbol } = state;

  if (!riskScan) return null;

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'low': return 'bg-green-100 text-green-700 border-green-300';
      case 'moderate': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'high': return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'critical': return 'bg-red-100 text-red-700 border-red-300';
      default: return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-700 rounded-lg">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          <span className="font-semibold">{symbol} Risk Assessment</span>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold uppercase border ${getRiskColor(
            riskScan.overallRisk
          )}`}
        >
          {riskScan.overallRisk}
        </span>
      </div>

      {/* IV Rank */}
      <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">IV Rank</span>
          <span className="font-bold text-lg">{riskScan.ivRank}%</span>
        </div>
        <div className="w-full h-3 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all rounded-full ${
              riskScan.ivRank < 30
                ? 'bg-green-500'
                : riskScan.ivRank < 70
                ? 'bg-yellow-500'
                : 'bg-red-500'
            }`}
            style={{ width: `${riskScan.ivRank}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>Low IV</span>
          <span>High IV</span>
        </div>
      </div>

      {/* Warnings */}
      {riskScan.warnings && riskScan.warnings.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500 uppercase">Warnings</span>
          {riskScan.warnings.map((w, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-sm text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {riskScan.recommendations && riskScan.recommendations.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500 uppercase">Recommendations</span>
          {riskScan.recommendations.map((r, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-sm text-blue-700 dark:text-blue-400"
            >
              <Target className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Follow-Up Chat Section
// ============================================================================

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

function FollowUpChat() {
  const { state } = useLEAPSBuilder();
  const [input, setInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(true); // Start expanded
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  // Generate context-aware suggested questions based on analysis state
  const getSuggestedQuestions = () => {
    const { symbol, direction, rankedCandidates, simulations, riskScan } = state;
    const topCandidate = rankedCandidates[0]?.contract;
    const questions: string[] = [];

    if (rankedCandidates.length > 0) {
      questions.push(`Why is the $${topCandidate?.strike} strike ranked #1?`);
      questions.push(`Compare the top 3 LEAPS candidates for ${symbol}`);
    }

    if (simulations.length > 0) {
      questions.push(`What happens to my ${symbol} LEAPS if stock drops 20%?`);
      questions.push(`How much theta am I losing per week on this position?`);
    }

    if (riskScan) {
      if (riskScan.ivRank > 50) {
        questions.push(`Is IV too high to buy ${symbol} LEAPS right now?`);
      } else {
        questions.push(`Is this a good IV environment for ${symbol} LEAPS?`);
      }
      questions.push(`What events should I watch out for with ${symbol}?`);
    }

    // Default questions if analysis not complete
    if (questions.length === 0) {
      questions.push(`What delta should I target for ${direction} LEAPS?`);
      questions.push(`How much capital should I allocate to LEAPS?`);
      questions.push(`Should I buy ITM or OTM LEAPS?`);
    }

    return questions.slice(0, 4);
  };

  const handleSend = async (message: string) => {
    if (!message.trim() || isLoading) return;

    const messageId = `leaps-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Add user message to local state first
    setLocalMessages(prev => [
      ...prev,
      {
        id: messageId + '-user',
        role: 'user',
        content: message,
        timestamp: new Date(),
      }
    ]);
    setInput('');
    setIsLoading(true);

    // Build context from current analysis state
    const analysisContext = buildAnalysisContext();

    try {
      // Call dedicated LEAPS chat API
      const response = await fetch('/api/leaps/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: message,
          context: analysisContext,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // Add assistant response
      setLocalMessages(prev => [
        ...prev,
        {
          id: messageId + '-assistant',
          role: 'assistant',
          content: data.answer || 'No response received.',
          timestamp: new Date(),
        }
      ]);
    } catch (error) {
      console.error('[LEAPS FollowUp] Error:', error);
      setLocalMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, there was an error processing your question. Please try again.',
          timestamp: new Date(),
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const buildAnalysisContext = () => {
    const { symbol, direction, rankedCandidates, simulations, riskScan, filterResults } = state;
    const parts: string[] = [];

    // Basic info
    parts.push(`=== LEAPS Analysis for ${symbol} ===`);
    parts.push(`Direction: ${direction}`);
    if (filterResults) {
      parts.push(`Filter: ${filterResults.passedCount} candidates passed from ${filterResults.totalContracts} total`);
      if (filterResults.spotPrice) {
        parts.push(`Current Stock Price: $${filterResults.spotPrice.toFixed(2)}`);
      }
    }

    // Ranked candidates with full scoring details
    if (rankedCandidates.length > 0) {
      parts.push(`\n=== Top ${Math.min(5, rankedCandidates.length)} Ranked Candidates ===`);
      rankedCandidates.slice(0, 5).forEach((r, idx) => {
        const c = r.contract;
        parts.push(`\n#${idx + 1}: $${c?.strike} ${c?.optionType?.toUpperCase()} (${c?.expiration}, ${c?.dte} DTE)`);
        parts.push(`   Premium: $${c?.mark?.toFixed(2)} | Delta: ${c?.delta?.toFixed(2)} | IV: ${(c?.iv * 100)?.toFixed(0)}%`);
        parts.push(`   Overall Score: ${r.overallScore?.toFixed(1)}/100`);
        if (r.scores) {
          parts.push(`   Scores: P(win)=${r.scores.pWin}%, ProfitRate=${r.scores.profitRate}%, DeltaFit=${r.scores.deltaFit}%, ThetaEff=${r.scores.thetaEfficiency}%, Liquidity=${r.scores.liquidity}%`);
        }
        if (r.why && r.why.length > 0) {
          parts.push(`   Why: ${r.why.join('; ')}`);
        }
        if (r.riskFlags && r.riskFlags.length > 0) {
          parts.push(`   Risks: ${r.riskFlags.join('; ')}`);
        }
      });
    }

    // Simulation details
    if (simulations.length > 0) {
      parts.push(`\n=== Payoff Simulations ===`);
      simulations.slice(0, 3).forEach((sim) => {
        parts.push(`\n$${sim.contract?.strike} ${sim.contract?.optionType}:`);
        parts.push(`   Cost: $${sim.payoff?.costBasis?.toFixed(0)} | Breakeven: $${sim.payoff?.breakeven?.toFixed(2)} | Max Loss: $${Math.abs(sim.payoff?.maxLoss || 0).toFixed(0)}`);
        parts.push(`   Theta Decay: $${Math.abs(sim.thetaDecay?.daily || 0).toFixed(2)}/day, $${Math.abs(sim.thetaDecay?.monthly || 0).toFixed(0)}/month`);
        if (sim.scenarios && sim.scenarios.length > 0) {
          const scenarioStr = sim.scenarios.map(s => `${s.move}: ${s.roi >= 0 ? '+' : ''}${s.roi?.toFixed(0)}%`).join(', ');
          parts.push(`   Scenarios: ${scenarioStr}`);
        }
      });
    }

    // Risk assessment
    if (riskScan) {
      parts.push(`\n=== Risk Assessment ===`);
      parts.push(`Overall Risk: ${riskScan.overallRisk?.toUpperCase()}`);
      parts.push(`IV Rank: ${riskScan.ivRank}%`);
      if (riskScan.warnings && riskScan.warnings.length > 0) {
        parts.push(`Warnings: ${riskScan.warnings.join('; ')}`);
      }
      if (riskScan.recommendations && riskScan.recommendations.length > 0) {
        parts.push(`Recommendations: ${riskScan.recommendations.join('; ')}`);
      }
    }

    return parts.join('\n');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const suggestedQuestions = getSuggestedQuestions();
  const showSuggestions = localMessages.length === 0;

  return (
    <div className="border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 flex flex-col max-h-[40%]">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors flex-shrink-0"
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-medium">Follow-up Questions</span>
          {localMessages.length > 0 && (
            <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full">
              {localMessages.length}
            </span>
          )}
        </div>
        <ChevronRight
          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="flex flex-col flex-1 min-h-0 px-4 pb-4">
          {/* Messages Area */}
          {localMessages.length > 0 && (
            <div className="flex-1 overflow-y-auto space-y-3 mb-3 min-h-0">
              {localMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                    <span className="text-sm text-gray-500">Thinking...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Suggested Questions (shown only when no messages) */}
          {showSuggestions && (
            <div className="space-y-2 mb-3">
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Sparkles className="w-3 h-3" />
                <span>Suggested questions</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestedQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(q)}
                    disabled={isLoading}
                    className="text-left text-xs px-3 py-2 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom Input */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this LEAPS analysis..."
              disabled={isLoading}
              className="flex-1 px-3 py-2 text-sm bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
            />
            <button
              onClick={() => handleSend(input)}
              disabled={!input.trim() || isLoading}
              className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Loading State
// ============================================================================

function LoadingState() {
  const { state } = useLEAPSBuilder();

  const stepMessages = [
    { title: 'Filtering LEAPS Contracts', detail: 'Checking DTE, delta, liquidity criteria...' },
    { title: 'Ranking Candidates', detail: 'Scoring theta efficiency, delta probability...' },
    { title: 'Simulating Payoffs', detail: 'Calculating P&L scenarios and theta decay...' },
    { title: 'Scanning for Risks', detail: 'Analyzing IV rank and upcoming events...' },
  ];

  const current = stepMessages[state.currentStep] || stepMessages[0];

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 space-y-4">
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <TrendingUp className="w-10 h-10 text-blue-500" />
        </div>
        <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
      </div>
      <div className="text-center space-y-2">
        <h3 className="font-semibold text-lg">{current.title}</h3>
        <p className="text-sm text-gray-500">{current.detail}</p>
        <p className="text-xs text-blue-500 font-mono">{state.symbol}</p>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// ============================================================================
// Main Panel Component
// ============================================================================

export function LEAPSBuilderPanel() {
  const { state, closePanel, minimizePanel, runFilter, runAnalysis, switchTicker, isMinimized } = useLEAPSBuilder();

  // Auto-run filter when panel opens (HITL Step 1)
  useEffect(() => {
    if (state.isOpen && !state.isLoading && state.currentStep === 0 && !state.error) {
      runFilter();
    }
  }, [state.isOpen, state.isLoading, state.currentStep, state.error, runFilter]);

  if (!state.isOpen) return null;

  // Complete when simulation is done (step 3) - risk scan is optional
  const isComplete = state.currentStep >= 3 && !state.isLoading;

  return (
    <div
      className={`fixed right-0 top-0 h-full bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700 shadow-2xl z-50 transition-all duration-300 flex flex-col ${
        isMinimized ? 'w-16' : 'w-1/2'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        {!isMinimized && (
          <>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              <div>
                <h2 className="font-bold">LEAPS Builder</h2>
                <p className="text-xs opacity-80">{state.symbol} • {state.direction}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {state.isLoading && (
                <span className="text-xs bg-white/20 px-2 py-1 rounded-full mr-2">
                  Analyzing...
                </span>
              )}
              {isComplete && (
                <button
                  onClick={runFilter}
                  className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                  title="Re-run analysis"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={minimizePanel}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                title="Minimize"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                onClick={closePanel}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
        {isMinimized && (
          <button
            onClick={minimizePanel}
            className="w-full flex flex-col items-center gap-1 py-2"
          >
            <Target className="w-6 h-6" />
            <span className="text-xs font-bold">{state.symbol}</span>
          </button>
        )}
      </div>

      {!isMinimized && (
        <>
          {/* Step Indicator */}
          <div className="border-b border-gray-200 dark:border-slate-700 px-4 py-2">
            <StepIndicator currentStep={state.currentStep} isLoading={state.isLoading} />
          </div>

          {/* Popular Tickers Quick Switch */}
          <div className="border-b border-gray-200 dark:border-slate-700 px-4 py-2">
            <PopularTickersBar currentSymbol={state.symbol} onSelect={switchTicker} />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Error State */}
            {state.error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400 mb-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-medium">Analysis Error</span>
                </div>
                <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>
                <button
                  onClick={runFilter}
                  className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry Analysis
                </button>
              </div>
            )}

            {/* Loading State */}
            {state.isLoading && <LoadingState />}

            {/* Results - HITL flow with action buttons */}
            {!state.isLoading && !state.error && (
              <>
                <FilterSection showAction={true} />
                <RankSection showAction={true} />
                <SimulationSection showAction={true} />
                <RiskSection />
              </>
            )}
          </div>

          {/* Follow-Up Chat (shown when analysis is complete) */}
          {isComplete && <FollowUpChat />}

          {/* Footer */}
          {isComplete && (
            <div className="border-t border-gray-200 dark:border-slate-700 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  <Check className="w-4 h-4 inline mr-1 text-green-500" />
                  Analysis complete
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runFilter}
                    className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    Start Over
                  </button>
                  <button
                    onClick={closePanel}
                    className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
