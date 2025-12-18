/**
 * Strategy Builder Types
 *
 * Type definitions for the AI Strategy Builder state machine.
 * Follows CopilotKit state-machine pattern for HITL workflows.
 */

// ============================================================================
// Stage Types
// ============================================================================

export type StrategyStage =
  | 'ticker'        // Step 0: Enter ticker
  | 'strategy'      // Step 1: Choose strategy type (profile + strategy)
  | 'expiration'    // Step 2: Select expiration (filtered by strategy)
  | 'candidates'    // Step 3: AI generates candidates
  | 'simulation';   // Step 4: Review simulations

export type StrategyType =
  | 'leaps'           // Long-dated calls/puts
  | 'credit_spread'   // Bull put spread / Bear call spread
  | 'iron_condor'     // Sell OTM strangle + buy wings
  | 'long_call'       // Simple long call
  | 'long_put'        // Simple long put
  | 'covered_call'    // Own shares + sell call
  | 'cash_secured_put';  // Cash + sell put

export type MarketOutlook = 'bullish' | 'bearish' | 'neutral';

// Trader profile types for scoring weight adjustment
export type TraderProfileType =
  | 'income'           // Consistent cash flow, loves theta
  | 'momentum'         // Fast capital gains, loves delta
  | 'stock_replacement' // Capital efficiency, LEAPS-focused
  | 'speculator'       // Explosive upside, loves gamma
  | 'hedger';          // Wealth preservation, protective

// Profile configuration for UI display
export interface TraderProfileConfig {
  id: TraderProfileType;
  label: string;
  description: string;
  primaryGoal: string;
  directionalBias: 'bullish' | 'bearish' | 'neutral' | 'hedged';
  riskTolerance: 'low' | 'low_medium' | 'medium' | 'medium_high' | 'high';
  greekPreferences: {
    delta: 'loves' | 'hates' | 'neutral';
    theta: 'loves' | 'hates' | 'neutral';
    gamma: 'loves' | 'hates' | 'neutral';
    vega: 'loves' | 'hates' | 'neutral';
  };
  typicalStrategies: StrategyType[];
  defaultStrategy: StrategyType;  // Default strategy for this profile
}

// ============================================================================
// Contract & Chain Types
// ============================================================================

export interface OptionContract {
  contractSymbol: string;
  strike: number;
  expiration: string;
  optionType: 'call' | 'put';
  bid: number;
  ask: number;
  mark: number;
  last: number;
  volume: number;
  openInterest: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  dte: number;
}

export interface ExpirationGroup {
  expiration: string;
  dte: number;
  callCount: number;
  putCount: number;
  totalOI: number;
  avgIV: number;
}

// ============================================================================
// OI Heatmap Types
// ============================================================================

export interface HeatmapCell {
  strike: number;
  callOI: number;
  putOI: number;
  netOI: number;        // callOI - putOI
  callVolume: number;
  putVolume: number;
  callIV: number;
  putIV: number;
}

export interface HeatmapData {
  spotPrice: number;
  strikes: number[];
  cells: HeatmapCell[];
  maxNetOI: number;     // For color scale normalization
  minNetOI: number;
}

// ============================================================================
// Candidate Types
// ============================================================================

export interface StrategyLeg {
  contract: OptionContract;
  action: 'buy' | 'sell';
  quantity: number;
}

export interface StrategyCandidate {
  id: string;
  strategyType: StrategyType;
  legs: StrategyLeg[];

  // Summary metrics
  maxLoss: number;
  maxProfit: number | 'unlimited';
  breakeven: number | number[];  // Can be multiple for spreads
  pop: number;                   // Probability of profit (0-100)

  // Greeks aggregate
  netDelta: number;
  netTheta: number;
  netVega: number;

  // Cost/credit
  netPremium: number;  // Positive = debit, Negative = credit

  // Scoring
  scores: {
    riskReward: number;     // 0-100
    liquidity: number;      // 0-100
    thetaBurn: number;      // 0-100
    deltaSuitability: number; // 0-100
  };
  overallScore: number;

  // Explanations
  why: string[];
  risks: string[];
}

// ============================================================================
// Simulation Types
// ============================================================================

export interface PriceScenario {
  priceMove: string;      // e.g., "+10%", "-5%"
  price: number;
  pnl: number;
  roi: number;
}

export interface SimulationResult {
  candidate: StrategyCandidate;
  scenarios: PriceScenario[];
  thetaDecay: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  // At expiration payoff curve points
  payoffCurve: Array<{ price: number; pnl: number }>;
}

// ============================================================================
// Global State
// ============================================================================

export interface StrategyBuilderState {
  // Current stage
  stage: StrategyStage;
  isProcessing: boolean;
  error: string | null;

  // Step 0: Ticker
  ticker: string | null;
  spotPrice: number | null;

  // Step 1: Expiration
  expirations: ExpirationGroup[];
  selectedExpiration: string | null;

  // Step 2: Strategy
  outlook: MarketOutlook;
  selectedStrategy: StrategyType | null;
  capitalBudget: number;
  traderProfile: TraderProfileType;  // Trader scoring profile
  expectedMovePct: number;            // Expected price move % for simulation (0.05 = 5%)
  expectedMoveSector: string | null;  // Sector ETF (XLK, XLC, etc.) for expected move
  expectedMoveSource: 'ai' | 'ai_sector' | 'fallback' | 'default' | null;  // Source of expected move

  // Chain data
  chain: OptionContract[];
  heatmapData: HeatmapData | null;

  // Step 3: Candidates
  candidates: StrategyCandidate[];
  selectedCandidateIds: string[];  // For simulation

  // Step 4: Simulations
  simulations: SimulationResult[];

  // Activity log for copilot panel
  activityLog: ActivityLogEntry[];
}

export interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  type: 'stage_change' | 'action' | 'ai_message' | 'user_action' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================================
// Action Types
// ============================================================================

export interface StrategyBuilderActions {
  // Navigation
  goToStage: (stage: StrategyStage) => void;
  reset: () => void;

  // Step 0: Ticker
  setTicker: (ticker: string) => Promise<void>;

  // Step 1: Expiration
  selectExpiration: (expiration: string) => void;

  // Step 2: Strategy
  setOutlook: (outlook: MarketOutlook) => void;
  selectStrategy: (strategy: StrategyType) => void;
  setCapitalBudget: (budget: number) => void;
  setTraderProfile: (profile: TraderProfileType) => void;
  setExpectedMovePct: (pct: number) => void;

  // Step 3: Candidates
  generateCandidates: () => Promise<void>;
  toggleCandidateSelection: (id: string) => void;

  // Step 4: Simulation
  runSimulations: () => Promise<void>;

  // Heatmap
  loadHeatmapData: () => Promise<void>;

  // Activity log
  addLogEntry: (entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>) => void;
}

// ============================================================================
// Context Type
// ============================================================================

export interface StrategyBuilderContextType {
  state: StrategyBuilderState;
  actions: StrategyBuilderActions;
}

// ============================================================================
// Trader Profile Configurations
// ============================================================================

export const TRADER_PROFILES: Record<TraderProfileType, TraderProfileConfig> = {
  income: {
    id: 'income',
    label: 'Income',
    description: 'Consistent cash flow from premium collection',
    primaryGoal: 'Consistent cash flow',
    directionalBias: 'neutral',
    riskTolerance: 'low_medium',
    greekPreferences: {
      delta: 'neutral',
      theta: 'loves',
      gamma: 'hates',
      vega: 'neutral',
    },
    typicalStrategies: ['credit_spread', 'covered_call', 'cash_secured_put', 'iron_condor'],
    defaultStrategy: 'cash_secured_put',
  },
  momentum: {
    id: 'momentum',
    label: 'Momentum',
    description: 'Fast capital gains, strong directional',
    primaryGoal: 'Fast capital gains',
    directionalBias: 'bullish',
    riskTolerance: 'medium_high',
    greekPreferences: {
      delta: 'loves',
      theta: 'hates',
      gamma: 'neutral',
      vega: 'neutral',
    },
    typicalStrategies: ['long_call', 'long_put', 'credit_spread'],
    defaultStrategy: 'long_call',
  },
  stock_replacement: {
    id: 'stock_replacement',
    label: 'Stock Replacement',
    description: 'Capital efficiency vs shares',
    primaryGoal: 'Capital efficiency',
    directionalBias: 'bullish',
    riskTolerance: 'medium',
    greekPreferences: {
      delta: 'loves',
      theta: 'neutral',
      gamma: 'neutral',
      vega: 'neutral',
    },
    typicalStrategies: ['leaps'],
    defaultStrategy: 'leaps',
  },
  speculator: {
    id: 'speculator',
    label: 'Speculator',
    description: 'Explosive upside, extreme directional',
    primaryGoal: 'Explosive upside',
    directionalBias: 'bullish',
    riskTolerance: 'high',
    greekPreferences: {
      delta: 'neutral',
      theta: 'hates',
      gamma: 'loves',
      vega: 'loves',
    },
    typicalStrategies: ['long_call', 'long_put'],
    defaultStrategy: 'long_call',
  },
  hedger: {
    id: 'hedger',
    label: 'Hedger',
    description: 'Wealth preservation, protective',
    primaryGoal: 'Wealth preservation',
    directionalBias: 'hedged',
    riskTolerance: 'low',
    greekPreferences: {
      delta: 'neutral',
      theta: 'neutral',
      gamma: 'neutral',
      vega: 'loves',
    },
    typicalStrategies: ['long_put'],
    defaultStrategy: 'long_put',
  },
};
