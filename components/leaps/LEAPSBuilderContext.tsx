'use client';

/**
 * LEAPSBuilderContext - State management for the LEAPS Builder sidecar panel
 *
 * This context manages the LEAPS Builder panel state, allowing the chat agent
 * to trigger the panel and pass data to it without rendering inline.
 *
 * Integrates with OptionsChainContext to:
 * - Use viewed chain data for LEAPS filtering
 * - Include user-selected contracts in ranking
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface LEAPSContract {
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
  // Additional fields from viewed chain
  bid?: number;
  ask?: number;
  gamma?: number;
  vega?: number;
  volume?: number;
}

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
    // New intent-based scoring (from Python agent)
    pWin?: number;
    profitRate?: number;
    deltaFit?: number;
    thetaEfficiency: number;
    liquidity: number;
    riskPenalty?: number;
    // Legacy scoring (from local chain analysis)
    deltaProbability?: number;
    riskReward?: number;
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

export interface LEAPSBuilderState {
  isOpen: boolean;
  isLoading: boolean;
  currentStep: number; // 0=filter, 1=rank, 2=simulate, 3=risk
  symbol: string;
  direction: string;
  capitalBudget: number;

  // Data source
  dataSource: 'api' | 'chain'; // 'chain' = use viewed chain data
  chainContracts: LEAPSContract[]; // Contracts from viewed chain
  userSelectedContracts: LEAPSContract[]; // User-selected contracts to include

  // Step results
  filterResults?: {
    passedCount: number;
    excludedCount: number;
    fromChain: boolean; // Whether data came from viewed chain
    totalContracts?: number;
    spotPrice?: number;
  };
  candidates: LEAPSCandidate[];
  rankedCandidates: LEAPSCandidate[];
  simulations: Simulation[];
  riskScan?: {
    overallRisk: string;
    ivRank: number;
    ivPercentile: number;
    warnings: string[];
    recommendations: string[];
    events: Array<{ date: string; event: string; impact: string }>;
  };

  error?: string;
  message?: string;

  // Expected move for profit calculation (from AI or default)
  expectedMovePct?: number; // e.g., 0.20 = 20% annual
  expectedMoveSector?: string; // e.g., "XLK"
}

interface LEAPSBuilderContextType {
  state: LEAPSBuilderState;
  openPanel: (symbol: string, direction: string, capitalBudget?: number) => void;
  openPanelWithChainData: (
    symbol: string,
    direction: string,
    contracts: LEAPSContract[],
    capitalBudget?: number,
    expectedMovePct?: number,
    expectedMoveSector?: string
  ) => void;
  closePanel: () => void;
  minimizePanel: () => void;
  updateState: (updates: Partial<LEAPSBuilderState>) => void;
  addUserSelection: (contract: LEAPSContract) => void;
  removeUserSelection: (contractSymbol: string) => void;
  clearUserSelections: () => void;
  // HITL step functions
  runFilter: () => Promise<void>;           // Step 1: Filter contracts
  confirmFilter: () => Promise<void>;       // User confirms filter results → run ranking
  selectCandidates: (contractSymbols: string[]) => Promise<void>;  // User selects 1-3 → run simulation
  runRiskScan: () => Promise<void>;         // Optional: run risk analysis
  // Legacy: runs all steps automatically (for testing)
  runAnalysis: () => Promise<void>;
  // Quick ticker switch
  switchTicker: (symbol: string) => void;
  isMinimized: boolean;
  // State for candidate selection UI
  selectedForSimulation: string[];
  toggleCandidateSelection: (contractSymbol: string) => void;
  clearCandidateSelection: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: LEAPSBuilderState = {
  isOpen: false,
  isLoading: false,
  currentStep: 0,
  symbol: '',
  direction: 'bullish',
  capitalBudget: 10000,
  dataSource: 'api',
  chainContracts: [],
  userSelectedContracts: [],
  candidates: [],
  rankedCandidates: [],
  simulations: [],
};

// LEAPS filter criteria
const LEAPS_MIN_DTE = 180;
const LEAPS_DELTA_MIN = 0.60;
const LEAPS_DELTA_MAX = 0.85;
const LEAPS_MIN_OI = 100;

// ============================================================================
// Context
// ============================================================================

const LEAPSBuilderContext = createContext<LEAPSBuilderContextType | undefined>(undefined);

export function LEAPSBuilderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LEAPSBuilderState>(initialState);
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedForSimulation, setSelectedForSimulation] = useState<string[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);

  const openPanel = useCallback((symbol: string, direction: string, capitalBudget = 10000) => {
    setState({
      ...initialState,
      isOpen: true,
      symbol: symbol.toUpperCase(),
      direction,
      capitalBudget,
      dataSource: 'api',
    });
    setIsMinimized(false);
    setThreadId(null); // Reset thread for new session
    setSelectedForSimulation([]); // Reset selections
  }, []);

  // Open panel with data from the viewed chain
  const openPanelWithChainData = useCallback((
    symbol: string,
    direction: string,
    contracts: LEAPSContract[],
    capitalBudget = 10000,
    expectedMovePct?: number,
    expectedMoveSector?: string
  ) => {
    setState({
      ...initialState,
      isOpen: true,
      symbol: symbol.toUpperCase(),
      direction,
      capitalBudget,
      dataSource: 'chain',
      chainContracts: contracts,
      expectedMovePct,
      expectedMoveSector,
    });
    setIsMinimized(false);
    setThreadId(null); // Reset thread for new session
    setSelectedForSimulation([]); // Reset selections
  }, []);

  const closePanel = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const minimizePanel = useCallback(() => {
    setIsMinimized(prev => !prev);
  }, []);

  const updateState = useCallback((updates: Partial<LEAPSBuilderState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // Add a user-selected contract
  const addUserSelection = useCallback((contract: LEAPSContract) => {
    setState(prev => {
      if (prev.userSelectedContracts.some(c => c.contractSymbol === contract.contractSymbol)) {
        return prev;
      }
      return {
        ...prev,
        userSelectedContracts: [...prev.userSelectedContracts, contract],
      };
    });
  }, []);

  // Remove a user-selected contract
  const removeUserSelection = useCallback((contractSymbol: string) => {
    setState(prev => ({
      ...prev,
      userSelectedContracts: prev.userSelectedContracts.filter(
        c => c.contractSymbol !== contractSymbol
      ),
    }));
  }, []);

  // Clear all user selections
  const clearUserSelections = useCallback(() => {
    setState(prev => ({ ...prev, userSelectedContracts: [] }));
  }, []);

  // Toggle candidate selection for simulation
  const toggleCandidateSelection = useCallback((contractSymbol: string) => {
    setSelectedForSimulation(prev => {
      if (prev.includes(contractSymbol)) {
        return prev.filter(s => s !== contractSymbol);
      }
      // Max 3 selections
      if (prev.length >= 3) {
        return prev;
      }
      return [...prev, contractSymbol];
    });
  }, []);

  // Clear candidate selections
  const clearCandidateSelection = useCallback(() => {
    setSelectedForSimulation([]);
  }, []);

  // Switch to a different ticker (quick switch from popular tickers)
  const switchTicker = useCallback((symbol: string) => {
    setState(prev => ({
      ...initialState,
      isOpen: true,
      symbol: symbol.toUpperCase(),
      direction: prev.direction, // Keep same direction
      capitalBudget: prev.capitalBudget, // Keep same budget
      dataSource: 'api', // Switch to API mode for new ticker
    }));
    setIsMinimized(false);
    setThreadId(null);
    setSelectedForSimulation([]);
  }, []);

  // Helper to call the LEAPS API
  const callAgent = useCallback(async (params: Record<string, unknown>) => {
    const response = await fetch('/api/leaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.symbol,
        direction: state.direction,
        capitalBudget: state.capitalBudget,
        thread_id: threadId,
        ...params,
      }),
    });
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    const result = await response.json();
    // Capture thread_id for subsequent calls
    if (result.thread_id) {
      setThreadId(result.thread_id);
    }
    return result;
  }, [state.symbol, state.direction, state.capitalBudget, threadId]);

  // HITL Step 1: Run filter
  const runFilter = useCallback(async () => {
    if (!state.symbol) return;

    // Reset state for new analysis run
    setState(prev => ({
      ...prev,
      isLoading: true,
      error: undefined,
      currentStep: 0,
      candidates: [],
      rankedCandidates: [],
      simulations: [],
      riskScan: undefined,
      filterResults: undefined,
    }));
    setThreadId(null); // Reset thread for fresh API calls
    setSelectedForSimulation([]); // Clear candidate selections

    try {
      // If we have chain data, filter locally
      if (state.dataSource === 'chain' && state.chainContracts.length > 0) {
        const direction = state.direction;
        const optionType = direction === 'bullish' ? 'call' : direction === 'bearish' ? 'put' : 'call';

        // Filter LEAPS from chain data
        let leapsCandidates = state.chainContracts.filter(c => {
          const matchesType = c.optionType.toLowerCase() === optionType;
          const meetsDeadline = c.dte >= LEAPS_MIN_DTE;
          const meetsDelta = Math.abs(c.delta) >= LEAPS_DELTA_MIN && Math.abs(c.delta) <= LEAPS_DELTA_MAX;
          const meetsLiquidity = c.openInterest >= LEAPS_MIN_OI;
          const withinBudget = (c.mark * 100) <= state.capitalBudget;

          return matchesType && meetsDeadline && meetsDelta && meetsLiquidity && withinBudget;
        });

        // Include user-selected contracts
        const userSelections = state.userSelectedContracts.filter(
          uc => !leapsCandidates.some(c => c.contractSymbol === uc.contractSymbol)
        );
        leapsCandidates = [...leapsCandidates, ...userSelections];

        // Create basic candidates (not yet ranked)
        const candidates = leapsCandidates.map(c => ({
          contract: c,
          scores: { thetaEfficiency: 0, liquidity: 0 },
          overallScore: 0,
          why: [],
          riskFlags: [],
        }));

        setState(prev => ({
          ...prev,
          isLoading: false,
          currentStep: 1, // Filter complete, show results
          filterResults: {
            passedCount: leapsCandidates.length,
            excludedCount: state.chainContracts.length - leapsCandidates.length,
            fromChain: true,
          },
          candidates,
          message: `Found ${leapsCandidates.length} LEAPS candidates from viewed chain`,
        }));
        return;
      }

      // Call API for filter step
      console.log('[LEAPS] Step 1: Running filter...');
      const result = await callAgent({ userAction: 'proceed_stale' });
      const agentState = result.state || {};

      if (!agentState.candidates || agentState.candidates.length === 0) {
        throw new Error('No LEAPS candidates found matching your criteria');
      }

      setState(prev => ({
        ...prev,
        isLoading: false,
        currentStep: 1, // Filter complete
        filterResults: {
          passedCount: agentState.filterResults?.passedCount || agentState.candidates?.length || 0,
          excludedCount: agentState.filterResults?.excludedCount || 0,
          fromChain: false,
          totalContracts: agentState.filterResults?.totalContracts,
          spotPrice: agentState.filterResults?.spotPrice || agentState.spotPrice,
        },
        candidates: agentState.candidates || [],
        message: `Found ${agentState.candidates?.length || 0} LEAPS candidates - review and confirm to proceed`,
      }));

    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [state.symbol, state.direction, state.capitalBudget, state.dataSource, state.chainContracts, state.userSelectedContracts, callAgent]);

  // HITL Step 2: User confirms filter → run ranking
  const confirmFilter = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      // If using chain data, do local ranking
      if (state.dataSource === 'chain' && state.candidates.length > 0) {
        const direction = state.direction;

        // Sort by delta (closer to target)
        const sorted = [...state.candidates].sort((a, b) => {
          const targetDelta = direction === 'bullish' ? 0.70 : -0.70;
          return Math.abs(Math.abs(a.contract.delta) - Math.abs(targetDelta)) -
                 Math.abs(Math.abs(b.contract.delta) - Math.abs(targetDelta));
        });

        // Create ranked candidates with scores
        const rankedCandidates = sorted.slice(0, 10).map((c) => {
          const contract = c.contract;
          const thetaEfficiency = Math.round(100 - (Math.abs(contract.theta) / contract.mark) * 1000);
          const deltaProbability = Math.round(Math.abs(contract.delta) * 100);
          const liquidity = Math.min(100, Math.round(contract.openInterest / 50));
          const riskReward = Math.round((1 - contract.mark * 100 / state.capitalBudget) * 100);
          const overallScore = (thetaEfficiency + deltaProbability + liquidity + riskReward) / 4;

          const isUserSelected = state.userSelectedContracts.some(
            uc => uc.contractSymbol === contract.contractSymbol
          );

          return {
            contract,
            scores: { thetaEfficiency, deltaProbability, liquidity, riskReward },
            overallScore,
            why: isUserSelected
              ? ['User selected this contract', 'Included in ranking by your choice']
              : ['Strong theta efficiency relative to premium', 'Good delta exposure for direction'],
            riskFlags: contract.openInterest < 500 ? ['Lower liquidity - wider spreads possible'] : [],
          };
        });

        setState(prev => ({
          ...prev,
          isLoading: false,
          currentStep: 2, // Ranking complete
          rankedCandidates,
          message: `Ranked ${rankedCandidates.length} candidates - select up to 3 for simulation`,
        }));
        return;
      }

      // Call API for ranking
      console.log('[LEAPS] Step 2: Running rank...');
      const result = await callAgent({
        userAction: 'confirm_filter',
        step: 'rank',
      });
      const agentState = result.state || {};

      if (!agentState.rankedCandidates || agentState.rankedCandidates.length === 0) {
        throw new Error('Failed to rank candidates');
      }

      setState(prev => ({
        ...prev,
        isLoading: false,
        currentStep: 2, // Ranking complete
        rankedCandidates: agentState.rankedCandidates || [],
        message: `Ranked ${agentState.rankedCandidates?.length || 0} candidates - select up to 3 for simulation`,
      }));

    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [state.dataSource, state.candidates, state.direction, state.capitalBudget, state.userSelectedContracts, callAgent]);

  // HITL Step 3: User selects candidates → run simulation
  const selectCandidates = useCallback(async (contractSymbols: string[]) => {
    if (contractSymbols.length === 0) {
      setState(prev => ({ ...prev, error: 'Please select at least one candidate' }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      // If using chain data, do local simulation
      if (state.dataSource === 'chain' && state.rankedCandidates.length > 0) {
        const selectedCandidates = state.rankedCandidates.filter(
          r => contractSymbols.includes(r.contract.contractSymbol)
        );

        // Get spot price and expected move for profit calculation
        const spotPrice = state.filterResults?.spotPrice || selectedCandidates[0]?.contract.strike || 100;
        const expectedMovePct = state.expectedMovePct || 0.10; // Use AI-determined or default 10%

        const simulations = selectedCandidates.map((r, i) => {
          const c = r.contract;
          const strike = c.strike;
          const mark = c.mark;
          const dte = c.dte || 540;
          const premiumUsd = mark * 100;

          // Calculate expected profit based on expected move
          const tYears = dte / 365;
          const horizonMove = expectedMovePct * Math.sqrt(tYears);
          const expectedPrice = spotPrice * (1 + horizonMove);
          const intrinsicAtExpiry = Math.max(0, expectedPrice - strike) * 100;
          const expectedProfitUsd = intrinsicAtExpiry - premiumUsd;
          const expectedRoiPct = premiumUsd > 0 ? (expectedProfitUsd / premiumUsd) * 100 : 0;

          return {
            rank: i + 1,
            contract: c,
            payoff: {
              breakeven: strike + mark,
              maxProfit: 'unlimited' as const,
              maxLoss: -premiumUsd,
              costBasis: premiumUsd,
            },
            expectedProfit: {
              expectedPriceAtExpiry: Math.round(expectedPrice * 100) / 100,
              expectedProfitUsd: Math.round(expectedProfitUsd * 100) / 100,
              expectedRoiPct: Math.round(expectedRoiPct * 10) / 10,
              horizonMovePct: Math.round(horizonMove * 1000) / 10,
              annualizedMovePct: Math.round(expectedMovePct * 1000) / 10,
            },
            scenarios: [
              // Scenarios at horizon_move ± 20pp from spot (e.g., if horizon=24%, show 4%, 14%, 24%, 34%, 44%)
              ...[horizonMove - 0.20, horizonMove - 0.10, horizonMove, horizonMove + 0.10, horizonMove + 0.20].map(move => {
                const scenarioPrice = spotPrice * (1 + move);
                const scenarioPnl = Math.max(0, scenarioPrice - strike) * 100 - premiumUsd;
                const scenarioRoi = premiumUsd > 0 ? (scenarioPnl / premiumUsd) * 100 : 0;
                const moveLabel = move === horizonMove ? `+${(move * 100).toFixed(0)}% (expected)` : `${move >= 0 ? '+' : ''}${(move * 100).toFixed(0)}%`;
                return {
                  move: moveLabel,
                  price: Math.round(scenarioPrice * 100) / 100,
                  pnl: Math.round(scenarioPnl * 100) / 100,
                  roi: Math.round(scenarioRoi * 10) / 10,
                };
              }),
            ],
            thetaDecay: {
              daily: c.theta,
              weekly: c.theta * 7,
              monthly: c.theta * 30,
            },
          };
        });

        setState(prev => ({
          ...prev,
          isLoading: false,
          currentStep: 3, // Simulation complete
          simulations,
          message: `Simulated ${simulations.length} position(s) - P/L at expiry scenarios`,
        }));
        return;
      }

      // Call API for simulation
      console.log('[LEAPS] Step 3: Running simulation for:', contractSymbols);
      const result = await callAgent({
        userAction: 'select_candidates',
        selectedContracts: contractSymbols,
        step: 'simulate',
      });
      const agentState = result.state || {};

      setState(prev => ({
        ...prev,
        isLoading: false,
        currentStep: 3, // Simulation complete
        simulations: agentState.simulations || [],
        message: `Simulated ${agentState.simulations?.length || 0} position(s) - review payoff scenarios`,
      }));

    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [state.dataSource, state.rankedCandidates, callAgent]);

  // HITL Step 4: Run risk scan (optional)
  const runRiskScan = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      // If using chain data, create basic risk scan
      if (state.dataSource === 'chain') {
        setState(prev => ({
          ...prev,
          isLoading: false,
          riskScan: {
            overallRisk: 'moderate',
            ivRank: 50,
            ivPercentile: 50,
            warnings: [
              'Analysis based on currently viewed chain data',
              state.userSelectedContracts.length > 0
                ? `${state.userSelectedContracts.length} user-selected contract(s) included`
                : 'Consider reviewing additional expirations',
            ],
            recommendations: [
              'Review individual contract details before trading',
              'Monitor position around earnings announcements',
            ],
            events: [],
          },
          message: 'Risk analysis complete',
        }));
        return;
      }

      // Call API for risk scan
      console.log('[LEAPS] Step 4: Running risk scan...');
      const result = await callAgent({
        userAction: 'proceed_risk_scan',
        step: 'risk_scan',
      });
      const agentState = result.state || {};

      setState(prev => ({
        ...prev,
        isLoading: false,
        riskScan: agentState.riskScan,
        message: 'Risk analysis complete',
      }));

    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [state.dataSource, state.userSelectedContracts, callAgent]);

  // Run analysis - uses chain data if available, otherwise calls API
  const runAnalysis = useCallback(async () => {
    if (!state.symbol) return;

    setState(prev => ({ ...prev, isLoading: true, error: undefined }));

    try {
      // If we have chain data, use it for local filtering
      if (state.dataSource === 'chain' && state.chainContracts.length > 0) {
        const direction = state.direction;
        const optionType = direction === 'bullish' ? 'call' : direction === 'bearish' ? 'put' : 'call';

        // Filter LEAPS from chain data
        let leapsCandidates = state.chainContracts.filter(c => {
          const matchesType = c.optionType.toLowerCase() === optionType;
          const meetsDeadline = c.dte >= LEAPS_MIN_DTE;
          const meetsDelta = Math.abs(c.delta) >= LEAPS_DELTA_MIN && Math.abs(c.delta) <= LEAPS_DELTA_MAX;
          const meetsLiquidity = c.openInterest >= LEAPS_MIN_OI;
          const withinBudget = (c.mark * 100) <= state.capitalBudget;

          return matchesType && meetsDeadline && meetsDelta && meetsLiquidity && withinBudget;
        });

        // Include user-selected contracts (even if they don't meet all criteria)
        const userSelections = state.userSelectedContracts.filter(
          uc => !leapsCandidates.some(c => c.contractSymbol === uc.contractSymbol)
        );
        leapsCandidates = [...leapsCandidates, ...userSelections];

        // Sort by delta (closer to target)
        leapsCandidates.sort((a, b) => {
          const targetDelta = direction === 'bullish' ? 0.70 : -0.70;
          return Math.abs(Math.abs(a.delta) - Math.abs(targetDelta)) -
                 Math.abs(Math.abs(b.delta) - Math.abs(targetDelta));
        });

        // Create candidates with scores
        const rankedCandidates = leapsCandidates.slice(0, 10).map((c, i) => {
          const thetaEfficiency = Math.round(100 - (Math.abs(c.theta) / c.mark) * 1000);
          const deltaProbability = Math.round(Math.abs(c.delta) * 100);
          const liquidity = Math.min(100, Math.round(c.openInterest / 50));
          const riskReward = Math.round((1 - c.mark * 100 / state.capitalBudget) * 100);
          const overallScore = (thetaEfficiency + deltaProbability + liquidity + riskReward) / 4;

          const isUserSelected = state.userSelectedContracts.some(
            uc => uc.contractSymbol === c.contractSymbol
          );

          return {
            contract: c,
            scores: { thetaEfficiency, deltaProbability, liquidity, riskReward },
            overallScore,
            why: isUserSelected
              ? ['User selected this contract', 'Included in ranking by your choice']
              : ['Strong theta efficiency relative to premium', 'Good delta exposure for direction'],
            riskFlags: c.openInterest < 500 ? ['Lower liquidity - wider spreads possible'] : [],
          };
        });

        // Create simulations with expected profit
        const spotPrice = rankedCandidates[0]?.contract.strike || 100; // Use first strike as proxy for spot
        const expectedMovePct = state.expectedMovePct || 0.10; // Use AI-determined or default 10%

        const simulations = rankedCandidates.slice(0, 3).map((r, i) => {
          const c = r.contract;
          const strike = c.strike;
          const mark = c.mark;
          const dte = c.dte || 540;
          const premiumUsd = mark * 100;

          // Calculate expected profit based on expected move
          const tYears = dte / 365;
          const horizonMove = expectedMovePct * Math.sqrt(tYears);
          const expectedPrice = spotPrice * (1 + horizonMove);
          const intrinsicAtExpiry = Math.max(0, expectedPrice - strike) * 100;
          const expectedProfitUsd = intrinsicAtExpiry - premiumUsd;
          const expectedRoiPct = premiumUsd > 0 ? (expectedProfitUsd / premiumUsd) * 100 : 0;

          return {
            rank: i + 1,
            contract: c,
            payoff: {
              breakeven: strike + mark,
              maxProfit: 'unlimited' as const,
              maxLoss: -premiumUsd,
              costBasis: premiumUsd,
            },
            expectedProfit: {
              expectedPriceAtExpiry: Math.round(expectedPrice * 100) / 100,
              expectedProfitUsd: Math.round(expectedProfitUsd * 100) / 100,
              expectedRoiPct: Math.round(expectedRoiPct * 10) / 10,
              horizonMovePct: Math.round(horizonMove * 1000) / 10,
              annualizedMovePct: Math.round(expectedMovePct * 1000) / 10,
            },
            scenarios: [
              // Scenarios at horizon_move ± 20pp from spot (e.g., if horizon=24%, show 4%, 14%, 24%, 34%, 44%)
              ...[horizonMove - 0.20, horizonMove - 0.10, horizonMove, horizonMove + 0.10, horizonMove + 0.20].map(move => {
                const scenarioPrice = spotPrice * (1 + move);
                const scenarioPnl = Math.max(0, scenarioPrice - strike) * 100 - premiumUsd;
                const scenarioRoi = premiumUsd > 0 ? (scenarioPnl / premiumUsd) * 100 : 0;
                const moveLabel = move === horizonMove ? `+${(move * 100).toFixed(0)}% (expected)` : `${move >= 0 ? '+' : ''}${(move * 100).toFixed(0)}%`;
                return {
                  move: moveLabel,
                  price: Math.round(scenarioPrice * 100) / 100,
                  pnl: Math.round(scenarioPnl * 100) / 100,
                  roi: Math.round(scenarioRoi * 10) / 10,
                };
              }),
            ],
            thetaDecay: {
              daily: c.theta,
              weekly: c.theta * 7,
              monthly: c.theta * 30,
            },
          };
        });

        setState(prev => ({
          ...prev,
          isLoading: false,
          currentStep: 3,
          filterResults: {
            passedCount: leapsCandidates.length,
            excludedCount: state.chainContracts.length - leapsCandidates.length,
            fromChain: true,
          },
          candidates: rankedCandidates.map(r => ({ ...r, contract: r.contract })),
          rankedCandidates,
          simulations,
          riskScan: {
            overallRisk: 'moderate',
            ivRank: 50,
            ivPercentile: 50,
            warnings: [
              'Analysis based on currently viewed chain data',
              state.userSelectedContracts.length > 0
                ? `${state.userSelectedContracts.length} user-selected contract(s) included`
                : 'Consider reviewing additional expirations',
            ],
            recommendations: [
              'Review individual contract details before trading',
              'Monitor position around earnings announcements',
            ],
            events: [],
          },
          message: `Found ${leapsCandidates.length} LEAPS from viewed chain`,
        }));

        return;
      }

      // Otherwise, call the API - run through all steps sequentially
      // The Python agent runs ONE step per call (HITL flow)
      // We maintain thread_id across calls to preserve state

      let threadId: string | null = null;

      // Helper to call the agent
      const callAgent = async (params: Record<string, unknown>) => {
        const response = await fetch('/api/leaps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: state.symbol,
            direction: state.direction,
            capitalBudget: state.capitalBudget,
            thread_id: threadId, // Maintain state across calls
            ...params,
          }),
        });
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        const result = await response.json();
        // Capture thread_id for subsequent calls
        if (result.thread_id) {
          threadId = result.thread_id;
        }
        return result;
      };

      // Step 1: Filter (auto-proceed past stale data warning)
      console.log('[LEAPS] Step 1: Running filter...');
      let result = await callAgent({ userAction: 'proceed_stale' });
      let agentState = result.state || {};

      if (!agentState.candidates || agentState.candidates.length === 0) {
        throw new Error('No LEAPS candidates found matching your criteria');
      }

      // Step 2: Rank (auto-confirm filter)
      console.log('[LEAPS] Step 2: Running rank...');
      result = await callAgent({
        userAction: 'confirm_filter',
        step: 'rank',
      });
      agentState = result.state || {};

      if (!agentState.rankedCandidates || agentState.rankedCandidates.length === 0) {
        throw new Error('Failed to rank candidates');
      }

      // Step 3: Simulate (auto-select top 3 candidates)
      const topCandidates = agentState.rankedCandidates
        .slice(0, 3)
        .map((r: { contract: { contractSymbol: string } }) => r.contract.contractSymbol);

      console.log('[LEAPS] Step 3: Running simulation for:', topCandidates);
      result = await callAgent({
        userAction: 'select_candidates',
        selectedContracts: topCandidates,
        step: 'simulate',
      });
      agentState = result.state || {};

      // Step 4: Risk scan (optional, auto-proceed)
      console.log('[LEAPS] Step 4: Running risk scan...');
      result = await callAgent({
        userAction: 'proceed_risk_scan',
        step: 'risk_scan',
      });
      agentState = result.state || {};

      console.log('[LEAPS] Analysis complete');

      setState(prev => ({
        ...prev,
        isLoading: false,
        currentStep: 3,
        filterResults: {
          passedCount: agentState.filterResults?.passedCount || agentState.candidates?.length || 0,
          excludedCount: agentState.filterResults?.excludedCount || 0,
          fromChain: false,
          totalContracts: agentState.filterResults?.totalContracts,
          spotPrice: agentState.filterResults?.spotPrice || agentState.spotPrice,
        },
        candidates: agentState.candidates || [],
        rankedCandidates: agentState.rankedCandidates || [],
        simulations: agentState.simulations || [],
        riskScan: agentState.riskScan,
        message: 'LEAPS analysis complete',
      }));

    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [state.symbol, state.direction, state.capitalBudget, state.dataSource, state.chainContracts, state.userSelectedContracts]);

  return (
    <LEAPSBuilderContext.Provider
      value={{
        state,
        openPanel,
        openPanelWithChainData,
        closePanel,
        minimizePanel,
        updateState,
        addUserSelection,
        removeUserSelection,
        clearUserSelections,
        runFilter,
        confirmFilter,
        selectCandidates,
        runRiskScan,
        runAnalysis,
        switchTicker,
        isMinimized,
        selectedForSimulation,
        toggleCandidateSelection,
        clearCandidateSelection,
      }}
    >
      {children}
    </LEAPSBuilderContext.Provider>
  );
}

export function useLEAPSBuilder() {
  const context = useContext(LEAPSBuilderContext);
  if (context === undefined) {
    throw new Error('useLEAPSBuilder must be used within a LEAPSBuilderProvider');
  }
  return context;
}
