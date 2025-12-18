'use client';

/**
 * OptionsChainContext - Shares viewed options chain data across the app
 *
 * This context allows components like LEAPS Builder to access:
 * - The currently viewed symbol and underlying price
 * - All available expirations
 * - The current chain data (calls/puts)
 * - User-selected contracts from the table
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface ViewedContract {
  contractSymbol: string;
  strike: number;
  expiration: string;
  optionType: 'call' | 'put';
  mark: number;
  bid: number;
  ask: number;
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
  iv: number;
  openInterest: number;
  volume: number;
  dte: number;
}

export interface ChainSummary {
  symbol: string;
  underlyingPrice: number;
  expirations: string[];
  leapsExpirations: string[]; // Expirations with DTE >= 180
  totalCalls: number;
  totalPuts: number;
  leapsCallsCount: number;
  leapsPutsCount: number;
  // Currently viewed expiration
  currentExpiration: string | null;
  currentExpirationDte: number | null;
  isViewingLeaps: boolean; // True if current expiration is LEAPS (DTE >= 180)
}

interface OptionsChainContextType {
  // Current viewed data
  chainSummary: ChainSummary | null;
  viewedCalls: ViewedContract[];
  viewedPuts: ViewedContract[];

  // User selections
  selectedContracts: ViewedContract[];

  // Actions
  setChainData: (
    symbol: string,
    underlyingPrice: number,
    expirations: string[],
    calls: ViewedContract[],
    puts: ViewedContract[],
    currentExpiration?: string
  ) => void;
  setCurrentExpiration: (expiration: string) => void;
  clearChainData: () => void;

  // Contract selection
  addSelectedContract: (contract: ViewedContract) => void;
  removeSelectedContract: (contractSymbol: string) => void;
  clearSelectedContracts: () => void;
  isContractSelected: (contractSymbol: string) => boolean;

  // LEAPS filtering
  getLeapsContracts: () => { calls: ViewedContract[]; puts: ViewedContract[] };
}

// ============================================================================
// Context
// ============================================================================

const OptionsChainContext = createContext<OptionsChainContextType | undefined>(undefined);

const LEAPS_MIN_DTE = 180; // Minimum DTE for LEAPS

export function OptionsChainProvider({ children }: { children: ReactNode }) {
  const [chainSummary, setChainSummary] = useState<ChainSummary | null>(null);
  const [viewedCalls, setViewedCalls] = useState<ViewedContract[]>([]);
  const [viewedPuts, setViewedPuts] = useState<ViewedContract[]>([]);
  const [selectedContracts, setSelectedContracts] = useState<ViewedContract[]>([]);

  const setChainData = useCallback((
    symbol: string,
    underlyingPrice: number,
    expirations: string[],
    calls: ViewedContract[],
    puts: ViewedContract[],
    currentExpiration?: string
  ) => {
    // Calculate LEAPS stats
    const leapsCalls = calls.filter(c => c.dte >= LEAPS_MIN_DTE);
    const leapsPuts = puts.filter(p => p.dte >= LEAPS_MIN_DTE);
    const leapsExpirations = [...new Set([
      ...leapsCalls.map(c => c.expiration),
      ...leapsPuts.map(p => p.expiration)
    ])].sort();

    // Calculate current expiration DTE
    const currentDte = currentExpiration
      ? Math.max(0, Math.ceil((new Date(currentExpiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;
    const isViewingLeaps = currentDte !== null && currentDte >= LEAPS_MIN_DTE;

    setChainSummary({
      symbol,
      underlyingPrice,
      expirations,
      leapsExpirations,
      totalCalls: calls.length,
      totalPuts: puts.length,
      leapsCallsCount: leapsCalls.length,
      leapsPutsCount: leapsPuts.length,
      currentExpiration: currentExpiration || null,
      currentExpirationDte: currentDte,
      isViewingLeaps,
    });
    setViewedCalls(calls);
    setViewedPuts(puts);
  }, []);

  const setCurrentExpiration = useCallback((expiration: string) => {
    setChainSummary(prev => {
      if (!prev) return prev;
      const dte = Math.max(0, Math.ceil((new Date(expiration).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
      return {
        ...prev,
        currentExpiration: expiration,
        currentExpirationDte: dte,
        isViewingLeaps: dte >= LEAPS_MIN_DTE,
      };
    });
  }, []);

  const clearChainData = useCallback(() => {
    setChainSummary(null);
    setViewedCalls([]);
    setViewedPuts([]);
    setSelectedContracts([]);
  }, []);

  const addSelectedContract = useCallback((contract: ViewedContract) => {
    setSelectedContracts(prev => {
      if (prev.some(c => c.contractSymbol === contract.contractSymbol)) {
        return prev;
      }
      return [...prev, contract];
    });
  }, []);

  const removeSelectedContract = useCallback((contractSymbol: string) => {
    setSelectedContracts(prev => prev.filter(c => c.contractSymbol !== contractSymbol));
  }, []);

  const clearSelectedContracts = useCallback(() => {
    setSelectedContracts([]);
  }, []);

  const isContractSelected = useCallback((contractSymbol: string) => {
    return selectedContracts.some(c => c.contractSymbol === contractSymbol);
  }, [selectedContracts]);

  const getLeapsContracts = useCallback(() => {
    return {
      calls: viewedCalls.filter(c => c.dte >= LEAPS_MIN_DTE),
      puts: viewedPuts.filter(p => p.dte >= LEAPS_MIN_DTE),
    };
  }, [viewedCalls, viewedPuts]);

  return (
    <OptionsChainContext.Provider
      value={{
        chainSummary,
        viewedCalls,
        viewedPuts,
        selectedContracts,
        setChainData,
        setCurrentExpiration,
        clearChainData,
        addSelectedContract,
        removeSelectedContract,
        clearSelectedContracts,
        isContractSelected,
        getLeapsContracts,
      }}
    >
      {children}
    </OptionsChainContext.Provider>
  );
}

export function useOptionsChain() {
  const context = useContext(OptionsChainContext);
  if (context === undefined) {
    throw new Error('useOptionsChain must be used within an OptionsChainProvider');
  }
  return context;
}
