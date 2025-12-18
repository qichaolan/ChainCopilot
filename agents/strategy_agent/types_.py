"""
Type definitions for Strategy Builder Agent.
"""

from __future__ import annotations

from typing import TypedDict, Literal, Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ============================================================================
# State Machine Types
# ============================================================================

Stage = Literal["ticker", "expiration", "strategy", "candidates", "simulation"]
StrategyType = Literal[
    "long_call", "long_put", "credit_spread", "iron_condor", "leaps",
    "covered_call", "cash_secured_put"
]
MarketOutlook = Literal["bullish", "bearish", "neutral"]

# Trader profile types for scoring weight adjustment
TraderProfileType = Literal[
    "income",           # Consistent cash flow, loves theta
    "momentum",         # Fast capital gains, loves delta
    "stock_replacement", # Capital efficiency, LEAPS-focused
    "speculator",       # Explosive upside, loves gamma
    "hedger",           # Wealth preservation, protective
]


# ============================================================================
# Option Contract
# ============================================================================

class OptionContract(TypedDict, total=False):
    contractSymbol: str
    strike: float
    expiration: str
    optionType: Literal["call", "put"]
    bid: float
    ask: float
    mark: float
    last: float
    volume: int
    openInterest: int
    delta: float
    gamma: float
    theta: float
    vega: float
    iv: float
    dte: int


class ExpirationGroup(TypedDict):
    expiration: str
    dte: int
    callCount: int
    putCount: int
    totalOI: int
    avgIV: float


# ============================================================================
# Strategy Candidate
# ============================================================================

class StrategyLeg(TypedDict):
    contract: OptionContract
    action: Literal["buy", "sell"]
    quantity: int


class CandidateScores(TypedDict, total=False):
    """
    Flexible scores dict - different strategies use different metrics.
    All values are 0-100 integers.
    """
    # Common metrics
    riskReward: int
    liquidity: int
    thetaBurn: int
    deltaSuitability: int
    # Long call/put metrics
    breakevenHurdle: int
    thetaEfficiency: int
    deltaEfficiency: int
    # LEAPS-specific
    dteScore: int
    # Credit spread / iron condor
    creditEfficiency: int
    safetyMargin: int
    rangeSafety: int
    deltaBalance: int
    # ROI-based reward metrics (for LEAPS with assumptions)
    roiExpectedScore: int
    roiStressScore: int
    rewardScore: int
    roiExpectedPct: float  # Raw ROI % for transparency
    roiStressPct: float


class TraderProfile(TypedDict):
    """Trader profile for dynamic scoring weight adjustment."""
    profileType: TraderProfileType
    rewardWeight: float
    riskWeight: float


class StrategyCandidate(TypedDict, total=False):
    """
    Strategy candidate with risk/reward scoring.

    Required fields (always present):
    - id, strategyType, legs, maxLoss, maxProfit, breakeven
    - probITMProxy, netDelta, netTheta, netVega, netPremium
    - scores, overallScore, why, risks

    Optional fields (LEAPS with assumptions):
    - riskQualityScore, rewardScore (explicit split)
    - assumptionsUsed (for transparency)
    - profile (LEAPS profile type)
    """
    # Core fields (always present)
    id: str
    strategyType: StrategyType
    legs: List[StrategyLeg]
    maxLoss: float
    maxProfit: float | Literal["unlimited"]
    breakeven: float | List[float]
    probITMProxy: int  # Delta-based ITM probability proxy (NOT true POP)
    netDelta: float
    netTheta: float
    netVega: float
    netPremium: float
    scores: CandidateScores
    overallScore: float
    why: List[str]
    risks: List[str]
    # Optional: explicit risk vs reward split (with assumptions)
    riskQualityScore: Optional[float]
    rewardScore: Optional[float]
    assumptionsUsed: Optional[Dict[str, Any]]  # SimulationAssumption-like
    profile: Optional[TraderProfile]
    # Expected profit calculation (LEAPS with assumptions)
    expectedProfit: Optional[Dict[str, Any]]  # {expectedProfitUsd, expectedRoiPct, horizonMovePct, ...}


# ============================================================================
# Simulation
# ============================================================================

# Time horizon categories for assumption mapping
HorizonType = Literal["intraweek", "weekly", "monthly", "quarterly", "leaps"]


class SimulationAssumption(TypedDict):
    """
    Transparent assumptions used for simulation.

    These assumptions drive price move scenarios and should always
    be visible in output for user trust and auditability.

    Move Semantics:
    - For short-dated (<90 DTE): moves are horizon-level (no scaling needed)
    - For LEAPS (>540 DTE): moves are ANNUALIZED and must be scaled to horizon

    Scaling (vol-style, for scenario bands):
        horizon_move = annualized_move * sqrt(T_years)
        where T_years = DTE / 365

    Example: 10% annualized vol over 2 years = 10% * sqrt(2) ≈ 14.1% horizon move
    """
    horizonType: HorizonType
    timeHorizonDays: int
    # For LEAPS: these are ANNUALIZED moves (will be scaled to horizon)
    # For short-dated: these are horizon-level moves (no scaling)
    expectedMovePct: float  # Expected move as decimal (0.10 = 10%)
    stressMovePct: float    # Stress/tail risk move magnitude (0.20 = 20%)
    # Probability of stress move occurring (for EV-weighted scoring)
    stressProb: Optional[float]  # 0.0-1.0, e.g., 0.15 = 15% probability
    customMoves: Optional[List[float]]  # User-provided custom moves (optional)
    source: str             # Where assumption came from ("default", "user", "implied_vol")
    # LEAPS-specific: annual growth rate projection (drift-like)
    annualGrowthPct: Optional[float]  # Assumed annual drift (0.08 = 8%/year)
    projectedPriceAtExpiry: Optional[float]  # Computed: spot * (1 + growth)^years
    # Whether to use vol-style sqrt(T) scaling or drift-style linear scaling
    scalingType: Optional[Literal["vol", "drift"]]  # Default: "vol" for LEAPS


class PriceScenario(TypedDict):
    priceMove: str
    price: float
    pnl: float
    roi: float


class ThetaDecay(TypedDict):
    daily: float
    weekly: float
    monthly: float


class PayoffPoint(TypedDict):
    price: float
    pnl: float


class SimulationResult(TypedDict):
    candidateId: str
    candidate: StrategyCandidate  # Full candidate for frontend rendering
    scenarios: List[PriceScenario]
    thetaDecay: ThetaDecay
    payoffCurve: List[PayoffPoint]
    assumptions: SimulationAssumption  # Always show what assumptions were used


# ============================================================================
# Action Types (for explicit routing)
# ============================================================================

ActionType = Literal[
    "set_ticker",           # Step 0: Load chain for ticker
    "select_strategy",      # Step 1: Set strategy type (no chain fetch needed)
    "select_expiration",    # Step 2: Select expiration and fetch filtered chain
    "generate_candidates",  # Step 3: Generate strategy candidates
    "run_simulations",      # Step 4: Run simulations for selected candidates
]


# ============================================================================
# Agent State (LangGraph TypedDict)
# ============================================================================

class AgentState(TypedDict, total=False):
    # Routing: action takes priority over stage inference
    action: Optional[ActionType]

    # Current stage
    stage: Stage
    isProcessing: bool
    error: Optional[str]

    # Step 0: Ticker
    ticker: Optional[str]
    spotPrice: Optional[float]

    # Step 1: Strategy (before expiration in new flow)
    outlook: MarketOutlook
    selectedStrategy: Optional[StrategyType]
    capitalBudget: float
    traderProfile: Optional[TraderProfileType]  # Trader scoring profile
    expectedMovePct: Optional[float]             # Expected price move % for simulation

    # Step 2: Expiration
    chain: List[OptionContract]
    expirations: List[ExpirationGroup]
    selectedExpiration: Optional[str]

    # Step 3: Candidates
    candidates: List[StrategyCandidate]
    selectedCandidateIds: List[str]

    # Step 4: Simulations
    simulations: List[SimulationResult]

    # Response envelope
    response: Optional[Dict[str, Any]]


# ============================================================================
# API Request/Response Models (Pydantic)
# ============================================================================

class StrategyRequest(BaseModel):
    """Request to the Strategy Builder API."""
    ticker: Optional[str] = None

    # Consistent naming with state fields (aliases for backward compatibility)
    selectedExpiration: Optional[str] = Field(
        default=None,
        alias="expiration",
        description="Selected expiration date"
    )
    selectedStrategy: Optional[StrategyType] = Field(
        default=None,
        alias="strategy",
        description="Selected strategy type"
    )

    outlook: MarketOutlook = "bullish"
    capitalBudget: float = 10000
    traderProfile: Optional[TraderProfileType] = "stock_replacement"
    expectedMovePct: Optional[float] = 0.10  # Default 10% expected move
    selectedCandidateIds: Optional[List[str]] = None

    # Control - action drives routing in agent
    action: ActionType = "set_ticker"
    thread_id: Optional[str] = None

    model_config = {"populate_by_name": True}


class StrategyResponse(BaseModel):
    """Response from Strategy Builder API."""
    success: bool
    thread_id: str
    stage: Stage
    data: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
