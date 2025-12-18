'use client';

/**
 * LEAPSFlowContext - Shared state management for LEAPS workflow
 *
 * Implements:
 * 1. viewContext writes from UI (bidirectional state with useCoAgent)
 * 2. Activity feed tracking
 * 3. Step chips highlighting
 * 4. HITL checkpoint management
 * 5. Tool failure fallback
 */

import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import { useCoAgent } from '@copilotkit/react-core';

// ============================================================================
// Types
// ============================================================================

export type WorkflowStep = 'filter' | 'rank' | 'simulate' | 'risk_scan' | 'decide';

export interface ActivityItem {
  id: string;
  timestamp: Date;
  type: 'step_start' | 'step_complete' | 'tool_call' | 'tool_result' | 'checkpoint' | 'error' | 'user_action';
  step: WorkflowStep;
  message: string;
  details?: Record<string, unknown>;
  status?: 'running' | 'success' | 'warning' | 'error';
}

export interface HITLCheckpoint {
  id: string;
  type: 'missing_scope' | 'stale_data' | 'confirmation_required' | 'tool_failure';
  step: WorkflowStep;
  message: string;
  options: Array<{
    label: string;
    action: string;
    variant: 'primary' | 'secondary' | 'danger';
  }>;
  resolved: boolean;
}

export interface LEAPSCandidate {
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

export interface LEAPSFlowState {
  // User context (written from UI)
  viewContext: {
    symbol: string;
    direction: 'bullish' | 'bearish' | 'neutral';
    capitalBudget: number;
    intent?: 'stock_replacement' | 'income_underlier' | 'leverage' | 'speculative_leverage' | 'hedge';
    dteRange?: { min: number; max: number };
    deltaRange?: { min: number; max: number };
  };

  // Workflow state
  currentStep: WorkflowStep;
  completedSteps: WorkflowStep[];
  isProcessing: boolean;

  // Activity feed
  activities: ActivityItem[];

  // HITL checkpoints
  pendingCheckpoint: HITLCheckpoint | null;
  lastUserAction?: string;

  // Step results
  filterResults?: {
    passedCount: number;
    excludedCount: number;
    candidates: LEAPSCandidate[];
  };
  rankResults?: {
    rankedCandidates: Array<{
      contract: LEAPSCandidate;
      scores: Record<string, number>;
      overallScore: number;
      why: string[];
      riskFlags: string[];
    }>;
  };
  simulateResults?: {
    simulations: Array<{
      rank: number;
      contract: LEAPSCandidate;
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
      scenarios: Array<{ move: string; price: number; pnl: number; roi: number }>;
    }>;
  };
  riskScanResults?: {
    overallRisk: string;
    ivRank: number;
    warnings: string[];
    recommendations: string[];
  };

  // Error state
  error?: {
    step: WorkflowStep;
    message: string;
    recoverable: boolean;
  };
}

// ============================================================================
// Actions
// ============================================================================

type LEAPSFlowAction =
  | { type: 'SET_VIEW_CONTEXT'; payload: Partial<LEAPSFlowState['viewContext']> }
  | { type: 'START_STEP'; payload: { step: WorkflowStep } }
  | { type: 'COMPLETE_STEP'; payload: { step: WorkflowStep; results?: unknown } }
  | { type: 'ADD_ACTIVITY'; payload: Omit<ActivityItem, 'id' | 'timestamp'> }
  | { type: 'SET_CHECKPOINT'; payload: Omit<HITLCheckpoint, 'id' | 'resolved'> }
  | { type: 'RESOLVE_CHECKPOINT'; payload: { action: string } }
  | { type: 'SET_ERROR'; payload: { step: WorkflowStep; message: string; recoverable: boolean } }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SYNC_AGENT_STATE'; payload: Partial<LEAPSFlowState> }
  | { type: 'RESET' };

// ============================================================================
// Reducer
// ============================================================================

const initialState: LEAPSFlowState = {
  viewContext: {
    symbol: '',
    direction: 'bullish',
    capitalBudget: 10000,
    intent: 'stock_replacement',
    dteRange: { min: 540, max: 900 },
  },
  currentStep: 'filter',
  completedSteps: [],
  isProcessing: false,
  activities: [],
  pendingCheckpoint: null,
};

function reducer(state: LEAPSFlowState, action: LEAPSFlowAction): LEAPSFlowState {
  switch (action.type) {
    case 'SET_VIEW_CONTEXT':
      return {
        ...state,
        viewContext: { ...state.viewContext, ...action.payload },
      };

    case 'START_STEP':
      return {
        ...state,
        currentStep: action.payload.step,
        isProcessing: true,
        activities: [
          ...state.activities,
          {
            id: `act-${Date.now()}`,
            timestamp: new Date(),
            type: 'step_start',
            step: action.payload.step,
            message: `Starting ${action.payload.step} step...`,
            status: 'running',
          },
        ],
      };

    case 'COMPLETE_STEP':
      const stepResultKey = `${action.payload.step}Results` as keyof LEAPSFlowState;
      return {
        ...state,
        isProcessing: false,
        completedSteps: [...state.completedSteps, action.payload.step],
        [stepResultKey]: action.payload.results,
        activities: [
          ...state.activities,
          {
            id: `act-${Date.now()}`,
            timestamp: new Date(),
            type: 'step_complete',
            step: action.payload.step,
            message: `${action.payload.step} step completed`,
            status: 'success',
          },
        ],
      };

    case 'ADD_ACTIVITY':
      return {
        ...state,
        activities: [
          ...state.activities,
          {
            ...action.payload,
            id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date(),
          },
        ],
      };

    case 'SET_CHECKPOINT':
      return {
        ...state,
        isProcessing: false,
        pendingCheckpoint: {
          ...action.payload,
          id: `cp-${Date.now()}`,
          resolved: false,
        },
        activities: [
          ...state.activities,
          {
            id: `act-${Date.now()}`,
            timestamp: new Date(),
            type: 'checkpoint',
            step: action.payload.step,
            message: action.payload.message,
            status: 'warning',
          },
        ],
      };

    case 'RESOLVE_CHECKPOINT':
      return {
        ...state,
        pendingCheckpoint: state.pendingCheckpoint
          ? { ...state.pendingCheckpoint, resolved: true }
          : null,
        activities: [
          ...state.activities,
          {
            id: `act-${Date.now()}`,
            timestamp: new Date(),
            type: 'user_action',
            step: state.currentStep,
            message: `User selected: ${action.payload.action}`,
            status: 'success',
          },
        ],
      };

    case 'SET_ERROR':
      return {
        ...state,
        isProcessing: false,
        error: action.payload,
        activities: [
          ...state.activities,
          {
            id: `act-${Date.now()}`,
            timestamp: new Date(),
            type: 'error',
            step: action.payload.step,
            message: action.payload.message,
            status: 'error',
          },
        ],
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: undefined,
      };

    case 'SYNC_AGENT_STATE':
      return {
        ...state,
        ...action.payload,
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

interface LEAPSFlowContextType {
  state: LEAPSFlowState;
  dispatch: React.Dispatch<LEAPSFlowAction>;
  // Convenience methods
  setViewContext: (ctx: Partial<LEAPSFlowState['viewContext']>) => void;
  startStep: (step: WorkflowStep) => void;
  completeStep: (step: WorkflowStep, results?: unknown) => void;
  addActivity: (activity: Omit<ActivityItem, 'id' | 'timestamp'>) => void;
  setCheckpoint: (checkpoint: Omit<HITLCheckpoint, 'id' | 'resolved'>) => void;
  resolveCheckpoint: (action: string) => void;
  setError: (step: WorkflowStep, message: string, recoverable: boolean) => void;
  clearError: () => void;
  reset: () => void;
}

const LEAPSFlowContext = createContext<LEAPSFlowContextType | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

export function LEAPSFlowProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Connect to CoAgent for bidirectional state sync
  // This writes viewContext to the agent and receives agent state updates
  const { state: agentState, setState: setAgentState } = useCoAgent<LEAPSFlowState>({
    name: 'leaps_builder',
    initialState: state,
  });

  // Sync agent state changes to local state
  React.useEffect(() => {
    if (agentState && agentState !== state) {
      dispatch({ type: 'SYNC_AGENT_STATE', payload: agentState });
    }
  }, [agentState]);

  // Convenience methods
  const setViewContext = useCallback(
    (ctx: Partial<LEAPSFlowState['viewContext']>) => {
      dispatch({ type: 'SET_VIEW_CONTEXT', payload: ctx });
      // Also write to agent
      setAgentState((prev) => {
        const current = prev ?? state;
        return {
          ...current,
          viewContext: { ...current.viewContext, ...ctx },
        };
      });
    },
    [setAgentState, state]
  );

  const startStep = useCallback((step: WorkflowStep) => {
    dispatch({ type: 'START_STEP', payload: { step } });
  }, []);

  const completeStep = useCallback((step: WorkflowStep, results?: unknown) => {
    dispatch({ type: 'COMPLETE_STEP', payload: { step, results } });
  }, []);

  const addActivity = useCallback((activity: Omit<ActivityItem, 'id' | 'timestamp'>) => {
    dispatch({ type: 'ADD_ACTIVITY', payload: activity });
  }, []);

  const setCheckpoint = useCallback((checkpoint: Omit<HITLCheckpoint, 'id' | 'resolved'>) => {
    dispatch({ type: 'SET_CHECKPOINT', payload: checkpoint });
  }, []);

  const resolveCheckpoint = useCallback(
    (action: string) => {
      dispatch({ type: 'RESOLVE_CHECKPOINT', payload: { action } });
      // Notify agent of user decision
      setAgentState((prev) => {
        const current = prev ?? state;
        return {
          ...current,
          pendingCheckpoint: null,
          lastUserAction: action,
        };
      });
    },
    [setAgentState, state]
  );

  const setError = useCallback(
    (step: WorkflowStep, message: string, recoverable: boolean) => {
      dispatch({ type: 'SET_ERROR', payload: { step, message, recoverable } });
    },
    []
  );

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
    setAgentState(initialState);
  }, [setAgentState]);

  const value: LEAPSFlowContextType = {
    state,
    dispatch,
    setViewContext,
    startStep,
    completeStep,
    addActivity,
    setCheckpoint,
    resolveCheckpoint,
    setError,
    clearError,
    reset,
  };

  return <LEAPSFlowContext.Provider value={value}>{children}</LEAPSFlowContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

export function useLEAPSFlow() {
  const context = useContext(LEAPSFlowContext);
  if (!context) {
    throw new Error('useLEAPSFlow must be used within a LEAPSFlowProvider');
  }
  return context;
}

export default LEAPSFlowContext;
