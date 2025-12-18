'use client';

/**
 * Strategy Builder Context
 *
 * State machine context for the AI Strategy Builder.
 * Calls the Python Strategy Builder agent via /api/strategy.
 *
 * Flow:
 * ticker → expiration → strategy → candidates → simulation
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { useCopilotReadable } from '@copilotkit/react-core';
import type {
  StrategyBuilderState,
  StrategyBuilderActions,
  StrategyBuilderContextType,
  StrategyStage,
  MarketOutlook,
  StrategyType,
  TraderProfileType,
  HeatmapData,
  ActivityLogEntry,
} from './types';

// ============================================================================
// Initial State
// ============================================================================

const initialState: StrategyBuilderState = {
  stage: 'ticker',
  isProcessing: false,
  error: null,
  ticker: null,
  spotPrice: null,
  expirations: [],
  selectedExpiration: null,
  outlook: 'bullish',
  selectedStrategy: null,
  capitalBudget: 10000,
  traderProfile: 'stock_replacement',
  expectedMovePct: 0.10, // Default 10% expected move
  expectedMoveSector: null,
  expectedMoveSource: null,
  chain: [],
  heatmapData: null,
  candidates: [],
  selectedCandidateIds: [],
  simulations: [],
  activityLog: [],
};

// ============================================================================
// Context
// ============================================================================

const StrategyBuilderContext = createContext<StrategyBuilderContextType | undefined>(
  undefined
);

// ============================================================================
// Provider
// ============================================================================

export function StrategyBuilderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StrategyBuilderState>(initialState);
  const threadIdRef = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // Helper: Add log entry
  // -------------------------------------------------------------------------
  const addLogEntry = useCallback(
    (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => {
      const newEntry: ActivityLogEntry = {
        ...entry,
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date(),
      };
      setState((prev) => ({
        ...prev,
        activityLog: [...prev.activityLog, newEntry],
      }));
    },
    []
  );

  // -------------------------------------------------------------------------
  // Helper: Call Strategy Agent API
  // -------------------------------------------------------------------------
  const callAgent = useCallback(
    async (action: string, params: Record<string, unknown> = {}) => {
      const response = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          action,
          thread_id: threadIdRef.current,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `API error: ${response.status}`);
      }

      const result = await response.json();

      // Store thread_id for subsequent calls
      if (result.thread_id) {
        threadIdRef.current = result.thread_id;
      }

      return result;
    },
    []
  );

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  const goToStage = useCallback(
    (stage: StrategyStage) => {
      setState((prev) => ({ ...prev, stage, error: null }));
      addLogEntry({ type: 'stage_change', message: `Moved to ${stage} stage` });
    },
    [addLogEntry]
  );

  const reset = useCallback(() => {
    setState(initialState);
    threadIdRef.current = null;
    addLogEntry({ type: 'action', message: 'Reset strategy builder' });
  }, [addLogEntry]);

  // -------------------------------------------------------------------------
  // Step 0: Ticker
  // -------------------------------------------------------------------------
  const setTicker = useCallback(
    async (ticker: string) => {
      const normalizedTicker = ticker.toUpperCase().trim();
      if (!normalizedTicker) return;

      setState((prev) => ({
        ...prev,
        isProcessing: true,
        error: null,
        ticker: normalizedTicker,
      }));
      addLogEntry({
        type: 'user_action',
        message: `Entered ticker: ${normalizedTicker}`,
      });

      // Reset thread for new ticker
      threadIdRef.current = null;

      try {
        const result = await callAgent('set_ticker', { ticker: normalizedTicker });

        if (!result.success) {
          throw new Error(result.error || result.data?.error || 'Failed to fetch options');
        }

        const { expirations, spotPrice, contractCount } = result.data;
        // Get AI-determined expectedMovePct from data or state
        const aiExpectedMove = result.data.expectedMovePct ?? result.state?.expectedMovePct;
        const expectedMoveSource = result.data.expectedMoveSource ?? (aiExpectedMove ? 'ai' : 'default');
        const sector = result.data.sector;

        console.log('[setTicker] AI expected move:', {
          dataExpectedMove: result.data.expectedMovePct,
          stateExpectedMove: result.state?.expectedMovePct,
          resolved: aiExpectedMove,
          source: expectedMoveSource,
          sector
        });

        setState((prev) => ({
          ...prev,
          isProcessing: false,
          expirations: expirations || [],
          spotPrice: spotPrice || null,
          expectedMovePct: aiExpectedMove ?? prev.expectedMovePct,  // AI-determined default
          expectedMoveSector: sector || null,
          expectedMoveSource: expectedMoveSource as 'ai' | 'ai_sector' | 'fallback' | 'default' | null,
          stage: 'strategy',
          error: null,
        }));

        const moveInfo = expectedMoveSource === 'ai' && sector
          ? ` (${sector}: ${((aiExpectedMove || 0.1) * 100).toFixed(0)}% expected)`
          : '';
        addLogEntry({
          type: 'ai_message',
          message: `Loaded ${contractCount} contracts across ${expirations?.length || 0} expirations for ${normalizedTicker}${moveInfo}`,
          data: { spotPrice, expectedMovePct: aiExpectedMove, sector },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          error: message,
        }));
        addLogEntry({ type: 'error', message });
      }
    },
    [addLogEntry, callAgent]
  );

  // -------------------------------------------------------------------------
  // Step 2: Expiration (now comes after Strategy in new flow)
  // -------------------------------------------------------------------------
  const selectExpiration = useCallback(
    async (expiration: string) => {
      setState((prev) => ({
        ...prev,
        isProcessing: true,
        selectedExpiration: expiration,
        error: null,
      }));
      addLogEntry({
        type: 'user_action',
        message: `Selected expiration: ${expiration}`,
      });

      try {
        const result = await callAgent('select_expiration', { expiration });

        if (!result.success) {
          throw new Error(result.error || result.data?.error || 'Failed to load expiration');
        }

        // Store chain data for heatmap
        const chain = result.state?.chain || [];
        setState((prev) => ({
          ...prev,
          spotPrice: result.data.spotPrice || result.state?.spotPrice || prev.spotPrice,
          chain, // Store chain for heatmap
        }));

        addLogEntry({
          type: 'ai_message',
          message: `Loaded ${result.data.contractCount || chain.length} contracts for ${expiration}`,
        });

        // Now generate candidates with the selected expiration
        // We need to get current state values for the API call
        const currentState = await new Promise<StrategyBuilderState>((resolve) => {
          setState((prev) => {
            resolve(prev);
            return prev;
          });
        });

        addLogEntry({
          type: 'action',
          message: `Generating ${currentState.selectedStrategy} candidates...`,
        });

        const candidateResult = await callAgent('generate_candidates', {
          strategy: currentState.selectedStrategy,
          outlook: currentState.outlook,
          capitalBudget: currentState.capitalBudget,
          traderProfile: currentState.traderProfile,
          expectedMovePct: currentState.expectedMovePct,
        });

        if (!candidateResult.success) {
          throw new Error(candidateResult.error || candidateResult.data?.error || 'Failed to generate candidates');
        }

        const candidates = candidateResult.data.candidates || candidateResult.state?.candidates || [];

        if (candidates.length === 0) {
          throw new Error('No candidates found matching your criteria. Try adjusting budget or strategy.');
        }

        setState((prev) => ({
          ...prev,
          isProcessing: false,
          candidates,
          selectedCandidateIds: [], // Clear selections when regenerating
          simulations: [], // Clear previous simulations
          stage: 'candidates',
          error: null,
        }));

        addLogEntry({
          type: 'ai_message',
          message: `Generated ${candidates.length} ${currentState.selectedStrategy} candidates`,
          data: { candidateCount: candidates.length },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          error: message,
        }));
        addLogEntry({ type: 'error', message });
      }
    },
    [addLogEntry, callAgent]
  );

  // -------------------------------------------------------------------------
  // Step 1: Strategy (now comes before Expiration in new flow)
  // -------------------------------------------------------------------------
  const setOutlook = useCallback(
    (outlook: MarketOutlook) => {
      setState((prev) => ({ ...prev, outlook }));
      addLogEntry({ type: 'user_action', message: `Set outlook: ${outlook}` });
    },
    [addLogEntry]
  );

  const selectStrategy = useCallback(
    (strategy: StrategyType) => {
      setState((prev) => ({
        ...prev,
        selectedStrategy: strategy,
        error: null,
      }));
      addLogEntry({ type: 'user_action', message: `Selected strategy: ${strategy}` });
    },
    [addLogEntry]
  );

  const setCapitalBudget = useCallback(
    (budget: number) => {
      setState((prev) => ({ ...prev, capitalBudget: budget }));
      addLogEntry({ type: 'user_action', message: `Set budget: $${budget}` });
    },
    [addLogEntry]
  );

  const setTraderProfile = useCallback(
    (profile: TraderProfileType) => {
      setState((prev) => ({ ...prev, traderProfile: profile }));
      addLogEntry({
        type: 'user_action',
        message: `Set trader profile: ${profile}`,
      });
    },
    [addLogEntry]
  );

  const setExpectedMovePct = useCallback(
    (pct: number) => {
      setState((prev) => ({ ...prev, expectedMovePct: pct }));
      addLogEntry({
        type: 'user_action',
        message: `Set expected move: ${(pct * 100).toFixed(0)}%`,
      });
    },
    [addLogEntry]
  );

  // -------------------------------------------------------------------------
  // Step 3: Generate Candidates (now auto-triggered by selectExpiration in new flow)
  // -------------------------------------------------------------------------
  const generateCandidates = useCallback(async () => {
    const { selectedStrategy, outlook, capitalBudget, traderProfile, expectedMovePct } = state;

    if (!selectedStrategy) {
      setState((prev) => ({
        ...prev,
        error: 'Please select a strategy type first',
      }));
      return;
    }

    setState((prev) => ({ ...prev, isProcessing: true, error: null }));
    addLogEntry({
      type: 'action',
      message: `Generating ${selectedStrategy} candidates...`,
    });

    try {
      const result = await callAgent('generate_candidates', {
        strategy: selectedStrategy,
        outlook,
        capitalBudget,
        // Pass trader profile for scoring (especially important for LEAPS)
        traderProfile,
        expectedMovePct,
      });

      if (!result.success) {
        throw new Error(result.error || result.data?.error || 'Failed to generate candidates');
      }

      const candidates = result.data.candidates || result.state?.candidates || [];

      if (candidates.length === 0) {
        throw new Error('No candidates found matching your criteria. Try adjusting budget or outlook.');
      }

      setState((prev) => ({
        ...prev,
        isProcessing: false,
        candidates,
        selectedCandidateIds: [], // Clear selections when regenerating
        simulations: [], // Clear previous simulations
        stage: 'candidates',
        error: null,
      }));

      addLogEntry({
        type: 'ai_message',
        message: `Generated ${candidates.length} ${selectedStrategy} candidates`,
        data: { candidateCount: candidates.length },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: message,
      }));
      addLogEntry({ type: 'error', message });
    }
  }, [state, addLogEntry, callAgent]);

  const toggleCandidateSelection = useCallback((id: string) => {
    setState((prev) => {
      const isSelected = prev.selectedCandidateIds.includes(id);
      if (isSelected) {
        return {
          ...prev,
          selectedCandidateIds: prev.selectedCandidateIds.filter((i) => i !== id),
        };
      }
      // Max 3 selections
      if (prev.selectedCandidateIds.length >= 3) {
        return prev;
      }
      return {
        ...prev,
        selectedCandidateIds: [...prev.selectedCandidateIds, id],
      };
    });
  }, []);

  // -------------------------------------------------------------------------
  // Step 4: Simulations
  // -------------------------------------------------------------------------
  const runSimulations = useCallback(async () => {
    const { selectedCandidateIds } = state;

    if (selectedCandidateIds.length === 0) {
      setState((prev) => ({
        ...prev,
        error: 'Please select at least one candidate',
      }));
      return;
    }

    setState((prev) => ({ ...prev, isProcessing: true, error: null }));
    addLogEntry({
      type: 'action',
      message: `Running simulations for ${selectedCandidateIds.length} candidate(s)...`,
    });

    try {
      const result = await callAgent('run_simulations', {
        selectedCandidateIds,
      });

      if (!result.success) {
        throw new Error(result.error || result.data?.error || 'Failed to run simulations');
      }

      const simulations = result.data.simulations || result.state?.simulations || [];

      setState((prev) => ({
        ...prev,
        isProcessing: false,
        simulations,
        stage: 'simulation',
        error: null,
      }));

      addLogEntry({
        type: 'ai_message',
        message: `Completed simulations for ${simulations.length} position(s)`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: message,
      }));
      addLogEntry({ type: 'error', message });
    }
  }, [state, addLogEntry, callAgent]);

  // -------------------------------------------------------------------------
  // Heatmap Data (local calculation from chain)
  // -------------------------------------------------------------------------
  const loadHeatmapData = useCallback(async () => {
    const { chain, selectedExpiration, spotPrice } = state;

    if (!selectedExpiration || chain.length === 0) return;

    const expContracts = chain.filter(
      (c) => c.expiration === selectedExpiration
    );

    // Get unique strikes within ±10% of spot
    const spot = spotPrice || 100;
    const minStrike = spot * 0.9;
    const maxStrike = spot * 1.1;

    const strikeSet = new Set<number>();
    expContracts.forEach((c) => {
      if (c.strike >= minStrike && c.strike <= maxStrike) {
        strikeSet.add(c.strike);
      }
    });

    const strikes = Array.from(strikeSet).sort((a, b) => a - b);

    // Build heatmap cells
    let maxNetOI = 0;
    let minNetOI = 0;

    const cells = strikes.map((strike) => {
      const callsAtStrike = expContracts.filter(
        (c) => c.strike === strike && c.optionType === 'call'
      );
      const putsAtStrike = expContracts.filter(
        (c) => c.strike === strike && c.optionType === 'put'
      );

      const callOI = callsAtStrike.reduce((sum, c) => sum + c.openInterest, 0);
      const putOI = putsAtStrike.reduce((sum, c) => sum + c.openInterest, 0);
      const netOI = callOI - putOI;

      maxNetOI = Math.max(maxNetOI, netOI);
      minNetOI = Math.min(minNetOI, netOI);

      return {
        strike,
        callOI,
        putOI,
        netOI,
        callVolume: callsAtStrike.reduce((sum, c) => sum + c.volume, 0),
        putVolume: putsAtStrike.reduce((sum, c) => sum + c.volume, 0),
        callIV: callsAtStrike[0]?.iv || 0,
        putIV: putsAtStrike[0]?.iv || 0,
      };
    });

    const heatmapData: HeatmapData = {
      spotPrice: spot,
      strikes,
      cells,
      maxNetOI,
      minNetOI,
    };

    setState((prev) => ({ ...prev, heatmapData }));
  }, [state.chain, state.selectedExpiration, state.spotPrice]);

  // -------------------------------------------------------------------------
  // CopilotKit Readable State
  // -------------------------------------------------------------------------
  useCopilotReadable({
    description: 'Current Strategy Builder state for AI assistant context',
    value: JSON.stringify({
      stage: state.stage,
      ticker: state.ticker,
      spotPrice: state.spotPrice,
      selectedExpiration: state.selectedExpiration,
      outlook: state.outlook,
      selectedStrategy: state.selectedStrategy,
      capitalBudget: state.capitalBudget,
      traderProfile: state.traderProfile,
      expectedMovePct: state.expectedMovePct,
      candidateCount: state.candidates.length,
      selectedCandidateIds: state.selectedCandidateIds,
      simulationCount: state.simulations.length,
      error: state.error,
    }),
  });

  // More detailed readable for candidates
  useCopilotReadable({
    description: 'Strategy candidates being analyzed',
    value:
      state.candidates.length > 0
        ? JSON.stringify(
            state.candidates.slice(0, 5).map((c) => ({
              id: c.id,
              strategy: c.strategyType,
              legs: c.legs.map((l) => ({
                strike: l.contract.strike,
                type: l.contract.optionType,
                action: l.action,
              })),
              maxLoss: c.maxLoss,
              maxProfit: c.maxProfit,
              pop: c.pop,
              overallScore: c.overallScore,
              why: c.why,
            }))
          )
        : 'No candidates generated yet',
  });

  // -------------------------------------------------------------------------
  // Actions object
  // -------------------------------------------------------------------------
  const actions: StrategyBuilderActions = {
    goToStage,
    reset,
    setTicker,
    selectExpiration,
    setOutlook,
    selectStrategy,
    setCapitalBudget,
    setTraderProfile,
    setExpectedMovePct,
    generateCandidates,
    toggleCandidateSelection,
    runSimulations,
    loadHeatmapData,
    addLogEntry,
  };

  return (
    <StrategyBuilderContext.Provider value={{ state, actions }}>
      {children}
    </StrategyBuilderContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useStrategyBuilder() {
  const context = useContext(StrategyBuilderContext);
  if (context === undefined) {
    throw new Error(
      'useStrategyBuilder must be used within a StrategyBuilderProvider'
    );
  }
  return context;
}
