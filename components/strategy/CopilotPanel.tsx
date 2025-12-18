'use client';

/**
 * CopilotPanel - Right panel of Strategy Builder
 *
 * Displays:
 * - Stage header with progress
 * - Stage-specific controls (HITL)
 * - Activity feed
 * - Chat interface via CopilotKit
 */

import React, { useState } from 'react';
import {
  Search,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Check,
  Clock,
  DollarSign,
  Loader2,
  MessageCircle,
  Bot,
  User,
  AlertTriangle,
  Lightbulb,
  ArrowUpDown,
  Zap,
} from 'lucide-react';
import { useStrategyBuilder } from '@/lib/strategy';
import type { StrategyStage, StrategyType, MarketOutlook, TraderProfileType } from '@/lib/strategy/types';
import { TRADER_PROFILES } from '@/lib/strategy/types';

// ============================================================================
// Back Navigation Button
// ============================================================================

interface StageHeaderProps {
  title: string;
  subtitle?: string;
  previousStage?: StrategyStage;
  showContext?: React.ReactNode;
}

function StageHeader({ title, subtitle, previousStage, showContext }: StageHeaderProps) {
  const { actions, state } = useStrategyBuilder();

  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {previousStage && (
          <button
            onClick={() => actions.goToStage(previousStage)}
            disabled={state.isProcessing}
            className="p-1 -ml-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
            title={`Back to ${previousStage}`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div>
          <h3 className="font-semibold text-base">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {showContext}
    </div>
  );
}

// ============================================================================
// Stage Progress
// ============================================================================

const STAGES: { id: StrategyStage; label: string; icon: React.ElementType }[] = [
  { id: 'ticker', label: 'Ticker', icon: Search },
  { id: 'strategy', label: 'Strategy', icon: Sparkles },
  { id: 'expiration', label: 'Expiration', icon: Calendar },
  { id: 'candidates', label: 'Candidates', icon: TrendingUp },
  { id: 'simulation', label: 'Simulation', icon: Check },
];

function StageProgress() {
  const { state, actions } = useStrategyBuilder();
  const currentIdx = STAGES.findIndex((s) => s.id === state.stage);

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
      {STAGES.map((stage, idx) => {
        const Icon = stage.icon;
        const isComplete = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isActive = isComplete || isCurrent;
        const canNavigate = isComplete && !state.isProcessing;

        return (
          <React.Fragment key={stage.id}>
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => canNavigate && actions.goToStage(stage.id)}
                disabled={!canNavigate}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  isComplete
                    ? 'bg-emerald-500 dark:bg-emerald-600 text-white hover:bg-emerald-600 dark:hover:bg-emerald-500 cursor-pointer'
                    : isCurrent
                    ? state.isProcessing
                      ? 'bg-blue-500 text-white animate-pulse'
                      : 'bg-blue-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                } ${canNavigate ? 'hover:scale-105' : ''}`}
              >
                {isComplete ? (
                  <Check className="w-4 h-4" />
                ) : isCurrent && state.isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </button>
              <span
                className={`text-[11px] font-medium ${
                  isComplete
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : isActive
                    ? 'text-slate-700 dark:text-slate-200'
                    : 'text-slate-400'
                }`}
              >
                {stage.label}
              </span>
            </div>
            {idx < STAGES.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 ${
                  idx < currentIdx ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
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
// Stage: Ticker Input
// ============================================================================

function TickerStage() {
  const { state, actions } = useStrategyBuilder();
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      actions.setTicker(input.trim());
    }
  };

  return (
    <div className="space-y-4">
      <StageHeader
        title="Enter Stock Ticker"
        subtitle="Enter a symbol to load its options chain"
      />

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="AAPL, TSLA, SPY..."
            disabled={state.isProcessing}
            className="w-full pl-10 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-lg uppercase"
            autoFocus
          />
        </div>

        <button
          type="submit"
          disabled={!input.trim() || state.isProcessing}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {state.isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <ChevronRight className="w-4 h-4" />
              Load Options Chain
            </>
          )}
        </button>
      </form>

      {/* Quick picks */}
      <div className="pt-4 border-t border-gray-200 dark:border-slate-700">
        <div className="text-xs text-gray-500 mb-2">Popular tickers</div>
        <div className="flex flex-wrap gap-2">
          {['AAPL', 'TSLA', 'SPY', 'NVDA', 'AMZN', 'QQQ'].map((ticker) => (
            <button
              key={ticker}
              onClick={() => {
                setInput(ticker);
                actions.setTicker(ticker);
              }}
              disabled={state.isProcessing}
              className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
            >
              {ticker}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Stage: Expiration Selection (matches Options Chain format)
// ============================================================================

type ExpirationType = 'all' | 'weekly' | 'monthly' | 'quarterly' | 'leaps';
type SortOption = 'dte' | 'liquidity' | 'oi';

// AI guidance content for each expiration type
const EXPIRATION_GUIDANCE: Record<ExpirationType, { title: string; description: string }> = {
  all: {
    title: 'Choosing the Right Expiration',
    description: 'Short-term (0–7 DTE): High theta decay, directional risk. Monthly: Balanced liquidity & decay. LEAPS: Capital-efficient long exposure.',
  },
  weekly: {
    title: 'Weekly Expirations',
    description: 'High theta decay accelerates near expiry. Best for short-term directional plays or premium selling. Watch gamma risk as expiration approaches.',
  },
  monthly: {
    title: 'Monthly Expirations',
    description: 'Standard monthly cycles offer the best liquidity. Good balance of time value and premium cost. Preferred for most spread strategies.',
  },
  quarterly: {
    title: 'Quarterly Expirations',
    description: 'Tied to major index rebalancing dates. Often show elevated OI and volume. Consider for longer-dated defined-risk positions.',
  },
  leaps: {
    title: 'LEAPS (Long-Term)',
    description: 'Used for stock replacement, PMCC, or long-term directional exposure. Lower theta burn but higher capital requirement. Delta acts more like stock.',
  },
};

// Get liquidity level based on OI - using blue/slate for non-P&L
function getLiquidityLevel(totalOI: number): { level: 'high' | 'moderate' | 'thin'; label: string; color: string } {
  if (totalOI >= 100000) {
    return { level: 'high', label: 'High Liquidity', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
  } else if (totalOI >= 10000) {
    return { level: 'moderate', label: 'Moderate', color: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-400' };
  } else {
    return { level: 'thin', label: 'Thin', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
  }
}

function ExpirationStage() {
  const { state, actions } = useStrategyBuilder();
  const { expirations, selectedStrategy } = state;

  // If LEAPS strategy selected, force LEAPS expirations only
  const isLeapsStrategy = selectedStrategy === 'leaps';
  const defaultExpType: ExpirationType = isLeapsStrategy ? 'leaps' : 'all';

  const [expirationType, setExpirationType] = useState<ExpirationType>(defaultExpType);
  const [sortBy, setSortBy] = useState<SortOption>('dte');
  const [hoveredExpiration, setHoveredExpiration] = useState<string | null>(null);

  // Auto-switch to LEAPS tab when LEAPS strategy is selected
  React.useEffect(() => {
    if (isLeapsStrategy && expirationType !== 'leaps') {
      setExpirationType('leaps');
    }
  }, [isLeapsStrategy, expirationType]);

  // LEAPS = 540+ DTE (18 months minimum)
  const MIN_LEAPS_DTE = 540;

  // Categorize expirations like Options Chain does
  const categorizedExpirations: Record<ExpirationType, typeof expirations> = {
    all: isLeapsStrategy ? expirations.filter((e) => e.dte >= MIN_LEAPS_DTE) : expirations,
    weekly: expirations.filter((e) => e.dte <= 7),
    monthly: expirations.filter((e) => {
      // Monthly = 3rd Friday pattern or 8-45 DTE non-quarterly
      const isQuarterly = [3, 6, 9, 12].includes(new Date(e.expiration).getMonth() + 1);
      return e.dte > 7 && e.dte <= 45 && !isQuarterly;
    }),
    quarterly: expirations.filter((e) => {
      const month = new Date(e.expiration).getMonth() + 1;
      return [3, 6, 9, 12].includes(month) && e.dte > 7 && e.dte <= 120;
    }),
    leaps: expirations.filter((e) => e.dte >= MIN_LEAPS_DTE),
  };

  // Sort expirations
  const sortedExpirations = [...categorizedExpirations[expirationType]].sort((a, b) => {
    switch (sortBy) {
      case 'liquidity':
        return b.totalOI - a.totalOI;
      case 'oi':
        return b.totalOI - a.totalOI;
      case 'dte':
      default:
        return a.dte - b.dte;
    }
  });

  // Format date for display
  const formatDate = (dateStr: string, isLeaps: boolean) => {
    const date = new Date(dateStr);
    if (isLeaps) {
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get hovered expiration data for preview
  const hoveredData = hoveredExpiration
    ? expirations.find((e) => e.expiration === hoveredExpiration)
    : null;

  // Emit hover event for left panel preview
  React.useEffect(() => {
    if (hoveredData) {
      // Store in a way WorkspacePanel can access (via context or state)
      window.dispatchEvent(new CustomEvent('expiration-hover', { detail: hoveredData }));
    } else {
      window.dispatchEvent(new CustomEvent('expiration-hover', { detail: null }));
    }
  }, [hoveredData]);

  const guidance = EXPIRATION_GUIDANCE[expirationType];

  return (
    <div className="space-y-3">
      <StageHeader
        title="Select Expiration"
        subtitle="Choose an expiration date"
        previousStage="strategy"
        showContext={
          <span className="text-xs text-slate-500 font-medium">{state.ticker}</span>
        }
      />

      {/* AI Guidance Box */}
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
        <div className="flex items-start gap-2">
          <Lightbulb className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-0.5">
              {guidance.title}
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
              {guidance.description}
            </p>
          </div>
        </div>
      </div>

      {/* Segmented Control - matches ExpirationSelector */}
      {isLeapsStrategy ? (
        // For LEAPS strategy, show only LEAPS expirations with info message
        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
            <Calendar className="w-4 h-4" />
            <span>LEAPS strategy requires 540+ DTE expirations ({categorizedExpirations.leaps.length} available)</span>
          </div>
        </div>
      ) : (
        <div className="flex rounded-lg bg-gray-100 dark:bg-slate-700 p-1">
          {(['all', 'weekly', 'monthly', 'quarterly', 'leaps'] as const).map((type) => {
            const count = categorizedExpirations[type].length;
            const isDisabled = count === 0;
            const isSelected = expirationType === type;

            return (
              <button
                key={type}
                onClick={() => !isDisabled && setExpirationType(type)}
                disabled={isDisabled}
                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${
                  isSelected
                    ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm'
                    : isDisabled
                    ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {type === 'leaps' ? 'LEAPS' : type === 'all' ? 'All' : type}
                {count > 0 && type !== 'all' && (
                  <span className="ml-1 text-[10px] text-gray-400">({count})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Sort Options */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{sortedExpirations.length} expirations</span>
        <div className="flex items-center gap-1">
          <ArrowUpDown className="w-3 h-3 text-gray-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="text-xs bg-transparent border-none text-gray-600 dark:text-gray-400 cursor-pointer focus:outline-none"
          >
            <option value="dte">Sort by DTE</option>
            <option value="liquidity">Sort by Liquidity</option>
            <option value="oi">Sort by OI</option>
          </select>
        </div>
      </div>

      {/* Expiration List */}
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {sortedExpirations.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            No expirations in this category
          </div>
        ) : (
          sortedExpirations.map((exp) => {
            const is0DTE = exp.dte === 0;
            const isLowDTE = exp.dte <= 2 && exp.dte > 0;
            const liquidity = getLiquidityLevel(exp.totalOI);

            return (
              <button
                key={exp.expiration}
                onClick={() => actions.selectExpiration(exp.expiration)}
                onMouseEnter={() => setHoveredExpiration(exp.expiration)}
                onMouseLeave={() => setHoveredExpiration(null)}
                className={`w-full p-2.5 bg-white dark:bg-slate-800 border rounded-lg hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all text-left ${
                  is0DTE
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-900/10'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {/* Top row: Date + Badges */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {formatDate(exp.expiration, exp.dte >= MIN_LEAPS_DTE)}
                    </span>
                    {exp.dte >= MIN_LEAPS_DTE && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                        {Math.floor(exp.dte / 365)}y {Math.round((exp.dte % 365) / 30)}m
                      </span>
                    )}
                    {is0DTE && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        0 DTE
                      </span>
                    )}
                    {isLowDTE && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                        <Zap className="w-2.5 h-2.5" />
                        {exp.dte}d
                      </span>
                    )}
                  </div>
                  {/* Liquidity Badge */}
                  {exp.callCount + exp.putCount > 0 && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${liquidity.color}`}>
                      {liquidity.label}
                    </span>
                  )}
                </div>

                {/* Bottom row: Stats */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 dark:text-slate-400">
                    {exp.dte} DTE
                    {is0DTE && <span className="ml-1.5 text-amber-600 dark:text-amber-400">• High gamma</span>}
                  </span>
                  {exp.callCount + exp.putCount > 0 && (
                    <span className="text-slate-400 dark:text-slate-500">
                      {exp.callCount + exp.putCount} contracts • OI: {exp.totalOI > 1000000 ? `${(exp.totalOI / 1000000).toFixed(1)}M` : exp.totalOI > 1000 ? `${(exp.totalOI / 1000).toFixed(0)}K` : exp.totalOI}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Stage: Strategy Selection
// ============================================================================

const STRATEGY_OPTIONS: { id: StrategyType; label: string; shortDesc: string }[] = [
  { id: 'long_call', label: 'Long Call', shortDesc: 'Unlimited upside' },
  { id: 'long_put', label: 'Long Put', shortDesc: 'Downside protection' },
  { id: 'credit_spread', label: 'Credit Spread', shortDesc: 'Collect premium' },
  { id: 'iron_condor', label: 'Iron Condor', shortDesc: 'Range-bound' },
  { id: 'leaps', label: 'LEAPS', shortDesc: 'Stock replacement' },
  { id: 'covered_call', label: 'Covered Call', shortDesc: 'Income on shares' },
  { id: 'cash_secured_put', label: 'Cash-Secured Put', shortDesc: 'Get paid to buy' },
];

// Context-aware AI suggestions based on state
function getAISuggestions(outlook: MarketOutlook, strategy: StrategyType | null, ticker: string | null): string[] {
  const suggestions: string[] = [];

  if (!strategy) {
    suggestions.push(`Which strategy is best for ${outlook} on ${ticker || 'this stock'}?`);
    suggestions.push('What\'s the risk/reward for each option?');
  } else {
    const strategyName = strategy.replace(/_/g, ' ');
    suggestions.push(`Why ${strategyName} for ${outlook} outlook?`);
    suggestions.push(`What's the ideal strike for ${strategyName}?`);
    suggestions.push('How much capital should I allocate?');
  }

  return suggestions;
}

// Generate context-aware AI response
function generateAIResponse(question: string, outlook: MarketOutlook, strategy: StrategyType | null): string {
  const strategyName = strategy?.replace(/_/g, ' ') || '';

  if (question.includes('best for') || question.includes('Which strategy')) {
    if (outlook === 'bullish') {
      return 'For bullish plays: Long Calls offer unlimited upside with defined risk. Credit Spreads (bull put) collect premium if stock stays above short strike. LEAPS work well for longer-term conviction.';
    } else if (outlook === 'bearish') {
      return 'For bearish plays: Long Puts have limited risk with high reward on drops. Credit Spreads (bear call) profit if stock stays below short strike. LEAPS puts for extended timeframes.';
    }
    return 'For neutral outlook: Iron Condors profit from range-bound action. You collect premium from both sides while defining max risk with wings.';
  }

  if (question.includes('risk/reward')) {
    return 'Long options: Risk = premium paid, Reward = unlimited (calls) or substantial (puts). Spreads: Both risk and reward are capped. Iron Condors: Max profit = premium collected, Max loss = width - premium.';
  }

  if (question.includes('ideal strike')) {
    if (strategy === 'long_call' || strategy === 'long_put') {
      return `For ${strategyName}s, ATM strikes offer balanced delta (~0.50). OTM is cheaper but needs bigger move. ITM costs more but higher probability.`;
    }
    return `For ${strategyName}, short strikes typically 1 standard deviation OTM (30 delta). Wider spreads = more risk but more premium.`;
  }

  if (question.includes('capital') || question.includes('allocate')) {
    return 'Rule of thumb: Risk 1-5% of portfolio per trade. For defined-risk strategies, max loss = position size. Leave room for adjustments.';
  }

  if (question.includes('Why')) {
    return `${strategyName} aligns with ${outlook} outlook. It offers a favorable risk/reward profile for this market view with manageable capital requirements.`;
  }

  return 'Select a strategy type above and I can provide more specific guidance based on your selection.';
}

function StrategyStage() {
  const { state, actions } = useStrategyBuilder();
  const { outlook, selectedStrategy, capitalBudget, traderProfile, expectedMovePct, expectedMoveSector, expectedMoveSource, ticker } = state;
  const [budget, setBudget] = useState(capitalBudget.toString());
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);
  const [isTyping, setIsTyping] = useState(false);

  // Filter strategies based on trader profile's typical strategies
  const currentProfile = TRADER_PROFILES[traderProfile];
  const profileStrategies = currentProfile?.typicalStrategies || [];
  const filteredStrategies = STRATEGY_OPTIONS.filter((s) => profileStrategies.includes(s.id));
  const defaultStrategy = currentProfile?.defaultStrategy;
  const suggestions = getAISuggestions(outlook, selectedStrategy, ticker);

  // Auto-select default strategy when profile changes
  React.useEffect(() => {
    if (defaultStrategy && selectedStrategy !== defaultStrategy) {
      actions.selectStrategy(defaultStrategy);
    }
  }, [traderProfile, defaultStrategy, actions]);

  // Get readable strategy name for the hint message
  const getStrategyLabel = (id: StrategyType) => {
    const option = STRATEGY_OPTIONS.find((s) => s.id === id);
    return option?.label || id.replace(/_/g, ' ');
  };

  const handleSuggestionClick = (question: string) => {
    setChatMessages((prev) => [...prev, { role: 'user', text: question }]);
    setIsTyping(true);

    // Simulate AI response delay
    setTimeout(() => {
      const response = generateAIResponse(question, outlook, selectedStrategy);
      setChatMessages((prev) => [...prev, { role: 'ai', text: response }]);
      setIsTyping(false);
    }, 500);
  };

  const handleContinueToExpiration = () => {
    const budgetNum = parseInt(budget, 10) || 10000;
    actions.setCapitalBudget(budgetNum);
    actions.goToStage('expiration');
  };

  return (
    <div className="space-y-3">
      <StageHeader
        title="Build Strategy"
        previousStage="ticker"
        showContext={
          <span className="text-xs text-slate-500">{ticker} • ${state.spotPrice?.toFixed(2)}</span>
        }
      />

      {/* Market Outlook - Segmented Control */}
      <div className="flex rounded-lg bg-slate-100 dark:bg-slate-700 p-0.5">
        {(['bullish', 'bearish', 'neutral'] as const).map((o) => {
          const Icon = o === 'bullish' ? TrendingUp : o === 'bearish' ? TrendingDown : Minus;
          const isSelected = outlook === o;
          const selectedColors = {
            bullish: 'bg-emerald-500 text-white',
            bearish: 'bg-red-500 text-white',
            neutral: 'bg-slate-500 text-white',
          };
          return (
            <button
              key={o}
              onClick={() => actions.setOutlook(o)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                isSelected
                  ? selectedColors[o]
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="capitalize">{o}</span>
            </button>
          );
        })}
      </div>

      {/* Row 1: Trader Profile + Strategy */}
      <div className="grid grid-cols-2 gap-2">
        {/* Trader Profile */}
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Profile</div>
          <select
            value={traderProfile}
            onChange={(e) => actions.setTraderProfile(e.target.value as TraderProfileType)}
            className="w-full px-2 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
          >
            {Object.values(TRADER_PROFILES).map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>

        {/* Strategy Type */}
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Strategy</div>
          <select
            value={selectedStrategy || ''}
            onChange={(e) => actions.selectStrategy(e.target.value as StrategyType)}
            className="w-full px-2 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
          >
            <option value="" disabled>Select...</option>
            {filteredStrategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {/* Default strategy hint */}
      <div className="text-[10px] text-blue-500 dark:text-blue-400 -mt-1">
        {currentProfile?.label}: {getStrategyLabel(defaultStrategy || 'long_call')} recommended
      </div>

      {/* Row 2: Expected Annualized Price Move + Max Loss */}
      <div className="grid grid-cols-2 gap-2">
        {/* Expected Annualized Price Move */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Expected Annualized Price Move</div>
            <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              {(expectedMovePct * 100).toFixed(0)}%
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="50"
            step="5"
            value={expectedMovePct * 100}
            onChange={(e) => actions.setExpectedMovePct(parseInt(e.target.value, 10) / 100)}
            className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="text-[10px] text-slate-400">
            {expectedMoveSector && expectedMoveSource !== 'default'
              ? `Initial estimate based on ${expectedMoveSector}'s 10-year historical return. You can adjust this.`
              : 'Your expected annualized price move'}
          </div>
        </div>

        {/* Max Loss Allowed */}
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Max Loss Allowed</div>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5">
            <div className="relative flex-1">
              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full pl-6 pr-2 py-1.5 text-xs bg-white dark:bg-slate-800 border-0 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-1">
            {[5000, 10000, 25000].map((amt) => (
              <button
                key={amt}
                onClick={() => setBudget(amt.toString())}
                className={`flex-1 px-1 py-1 text-[10px] font-medium rounded transition-colors ${
                  budget === amt.toString()
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                ${amt / 1000}K
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Chat Section */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Bot className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">AI Assistant</span>
        </div>

        {/* Chat Messages */}
        {chatMessages.length > 0 && (
          <div className="space-y-2 mb-2 max-h-[120px] overflow-y-auto">
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`text-[11px] p-2 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ml-4'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 mr-4'
                }`}
              >
                {msg.text}
              </div>
            ))}
            {isTyping && (
              <div className="text-[11px] p-2 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-400 mr-4">
                <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                Thinking...
              </div>
            )}
          </div>
        )}

        {/* Suggested Questions */}
        <div className="flex flex-wrap gap-1">
          {suggestions.slice(0, 3).map((q, idx) => (
            <button
              key={idx}
              onClick={() => handleSuggestionClick(q)}
              disabled={isTyping}
              className="px-2 py-1 text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 truncate max-w-[160px]"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Continue to Expiration Button */}
      <button
        onClick={handleContinueToExpiration}
        disabled={!selectedStrategy || state.isProcessing}
        className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {state.isProcessing ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading...
          </>
        ) : (
          <>
            <ChevronRight className="w-4 h-4" />
            Select Expiration
          </>
        )}
      </button>
    </div>
  );
}

// ============================================================================
// Stage: Candidates (HITL selection happens in WorkspacePanel)
// ============================================================================

function CandidatesStage() {
  const { state, actions } = useStrategyBuilder();
  const { candidates, selectedCandidateIds, ticker, selectedStrategy } = state;

  return (
    <div className="space-y-4">
      <StageHeader
        title="Review Candidates"
        subtitle="Select up to 3 to simulate"
        previousStage="expiration"
        showContext={
          <span className="text-xs text-slate-500">
            {ticker} • {selectedStrategy?.replace(/_/g, ' ')}
          </span>
        }
      />

      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <div className="text-2xl font-bold text-blue-600 mb-1">
          {candidates.length}
        </div>
        <div className="text-sm text-blue-700 dark:text-blue-300">
          Candidates generated
        </div>
      </div>

      <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Selected for simulation</span>
          <span className="text-sm text-gray-500">{selectedCandidateIds.length}/3</span>
        </div>
        <div className="w-full h-2 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${(selectedCandidateIds.length / 3) * 100}%` }}
          />
        </div>
      </div>

      {selectedCandidateIds.length > 0 && (
        <button
          onClick={actions.runSimulations}
          disabled={state.isProcessing}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {state.isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Simulating...
            </>
          ) : (
            <>
              <ChevronRight className="w-4 h-4" />
              Run Simulations
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Stage: Simulation Complete
// ============================================================================

function SimulationStage() {
  const { state, actions } = useStrategyBuilder();
  const { simulations, ticker } = state;

  return (
    <div className="space-y-4">
      <StageHeader
        title="Analysis Complete"
        subtitle="Review simulation results"
        previousStage="candidates"
        showContext={
          <span className="text-xs text-slate-500">{ticker}</span>
        }
      />

      <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 mb-2">
          <Check className="w-5 h-5" />
          <span className="font-medium">Simulations Complete</span>
        </div>
        <div className="text-3xl font-bold text-emerald-600 mb-1">
          {simulations.length}
        </div>
        <div className="text-sm text-emerald-600 dark:text-emerald-400">
          Position(s) analyzed
        </div>
      </div>

      <button
        onClick={actions.reset}
        className="w-full py-3 border border-gray-300 dark:border-slate-600 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
      >
        Start New Analysis
      </button>
    </div>
  );
}

// ============================================================================
// Activity Feed
// ============================================================================

function ActivityFeed() {
  const { state } = useStrategyBuilder();
  const { activityLog } = state;

  if (activityLog.length === 0) return null;

  return (
    <div className="border-t border-gray-200 dark:border-slate-700 pt-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Activity</span>
      </div>
      <div className="space-y-2 max-h-[150px] overflow-y-auto">
        {activityLog.slice(-5).reverse().map((entry) => {
          const Icon = entry.type === 'ai_message' ? Bot : entry.type === 'error' ? Clock : User;
          const color =
            entry.type === 'error'
              ? 'text-red-500'
              : entry.type === 'ai_message'
              ? 'text-blue-500'
              : 'text-gray-400';

          return (
            <div key={entry.id} className="flex items-start gap-2 text-xs">
              <Icon className={`w-3 h-3 mt-0.5 ${color}`} />
              <div className="flex-1">
                <p className="text-gray-600 dark:text-gray-400">{entry.message}</p>
                <p className="text-gray-400 text-[10px]">
                  {entry.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CopilotPanel() {
  const { state } = useStrategyBuilder();

  const renderStageContent = () => {
    switch (state.stage) {
      case 'ticker':
        return <TickerStage />;
      case 'expiration':
        return <ExpirationStage />;
      case 'strategy':
        return <StrategyStage />;
      case 'candidates':
        return <CandidatesStage />;
      case 'simulation':
        return <SimulationStage />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700">
      {/* Header - Softened gradient */}
      <div className="px-4 py-3 bg-gradient-to-r from-slate-700 to-slate-800 dark:from-slate-800 dark:to-slate-900 text-white border-b border-slate-600">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-400" />
          <h2 className="font-semibold">AI Strategy Builder</h2>
        </div>
      </div>

      {/* Stage Progress */}
      <StageProgress />

      {/* Stage Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {renderStageContent()}
        <ActivityFeed />
      </div>
    </div>
  );
}
