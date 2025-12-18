"""
LEAPS CoAgent - LangGraph Agent for LEAPS Options Analysis (HITL, step-by-step)

Aligned with system.md workflow:
- Single step per run: Filter -> (HITL confirm) -> Rank -> (HITL select 1-3) -> Simulate -> (optional) Risk Scan
- Never auto-advance past required HITL checkpoints
- Output is a single unified JSON response object stored in state["response"]
"""

from __future__ import annotations

from typing import TypedDict, List, Literal, Optional, Annotated, Dict, Any
from typing_extensions import NotRequired
import operator
import uuid
import sys
import os
from datetime import datetime, time, timezone

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

# Add lib path to import options_fetcher
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'lib', 'openbb'))
from options_fetcher import get_expiration_dates, get_options_chain


# =============================================================================
# Constants (from prompt defaults)
# =============================================================================

DISCLAIMER = "This analysis is for educational purposes only and is not financial advice."

# LEAPS configuration
LEAPS_MIN_DTE = 540  # Minimum DTE for LEAPS (18 months)
DEFAULT_DTE_RANGE = {"min": LEAPS_MIN_DTE, "max": 900}
DEFAULT_MIN_OI = 10
DEFAULT_MAX_SPREAD_PCT = 2.0
DEFAULT_CAPITAL_BUDGET = 10000.0  # Default budget when not specified

# Intent -> delta ranges (calls/puts)
INTENT_DELTA_RANGES = {
    "stock_replacement": {"min": 0.85, "max": 0.95},
    "income_underlier": {"min": 0.65, "max": 0.85},
    "leverage": {"min": 0.35, "max": 0.65},
    "speculative_leverage": {"min": 0.25, "max": 0.50},
    # hedge handled separately (puts abs delta)
    "hedge": {"min": 0.50, "max": 0.80},
}

# Intent-based weights for multi-perspective scoring
# Each intent weights P(win), Profit Rate, Delta Fit, Theta Efficiency, Liquidity differently
INTENT_WEIGHTS = {
    "stock_replacement": {
        "p_win": 0.40,        # wants high probability
        "profit_rate": 0.20,  # steady growth matters
        "delta_fit": 0.25,    # deep ITM participation
        "theta_eff": 0.10,    # decay per dollar
        "liquidity": 0.05,
    },
    "income_underlier": {
        "p_win": 0.35,
        "profit_rate": 0.15,
        "delta_fit": 0.25,    # stable underlier for PMCC
        "theta_eff": 0.15,
        "liquidity": 0.10,
    },
    "leverage": {
        "p_win": 0.20,
        "profit_rate": 0.45,  # upside ROI priority
        "delta_fit": 0.15,
        "theta_eff": 0.05,
        "liquidity": 0.15,
    },
    "speculative_leverage": {
        "p_win": 0.10,
        "profit_rate": 0.55,  # maximum convexity/ROI
        "delta_fit": 0.15,
        "theta_eff": 0.05,
        "liquidity": 0.15,
    },
    "hedge": {
        "p_win": 0.45,        # "win" = protection triggers
        "profit_rate": 0.10,
        "delta_fit": 0.25,
        "theta_eff": 0.10,
        "liquidity": 0.10,
    },
}

# Default weights when no specific intent is provided
DEFAULT_INTENT_WEIGHTS = {
    "p_win": 0.25,
    "profit_rate": 0.30,
    "delta_fit": 0.20,
    "theta_eff": 0.15,
    "liquidity": 0.10,
}

# Intent detection keywords for natural language parsing
# Maps user phrases to structured intents
INTENT_KEYWORDS = {
    "stock_replacement": [
        "steady growth", "lower risk", "low risk", "conservative", "safe",
        "stock-like", "equity replacement", "replace stock", "minimal risk",
        "stable", "long-term hold", "buy and hold", "consistent",
    ],
    "income_underlier": [
        "income", "covered call", "sell calls", "premium income",
        "generate income", "cash flow", "dividend-like", "yield",
        "monthly income", "write calls against",
    ],
    "leverage": [
        "leverage", "balanced", "moderate", "growth", "capital efficient",
        "amplify", "exposure", "participation",
    ],
    "speculative_leverage": [
        "max leverage", "maximum leverage", "aggressive", "high risk",
        "speculative", "lottery", "home run", "big gains", "moonshot",
        "10x", "yolo", "high reward",
    ],
    "hedge": [
        "hedge", "protect", "protection", "downside", "insurance",
        "portfolio protection", "risk management", "defensive",
        "crash protection", "tail risk",
    ],
}


def detect_intent_from_description(description: str) -> Optional[str]:
    """
    Detect LEAPS intent from natural language description.

    Examples:
        "I want steady growth with lower risk" → "stock_replacement"
        "Looking for max leverage" → "speculative_leverage"
        "Need to hedge my portfolio" → "hedge"

    Returns:
        Intent string if detected, None otherwise
    """
    if not description:
        return None

    desc_lower = description.lower()

    # Count keyword matches for each intent
    scores: Dict[str, int] = {}
    for intent, keywords in INTENT_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in desc_lower)
        if score > 0:
            scores[intent] = score

    if not scores:
        return None

    # Return intent with highest match count
    return max(scores, key=scores.get)


# =============================================================================
# Scoring Functions (Intent-Aware Multi-Perspective Scoring)
# =============================================================================

import math
from scipy.stats import norm


def delta_fit_score(delta: float, intent: str, is_put: bool = False) -> float:
    """
    Smooth delta fit score (0-1) based on intent's preferred delta range.

    Instead of pass/fail, provides a gradient:
    - Inside optimal range: 0.6-1.0 (closer to mid = higher)
    - Outside range: penalty band (0-0.6)

    Args:
        delta: Contract delta (use abs value for puts)
        intent: User's LEAPS intent
        is_put: True for put options (uses abs delta)
    """
    if intent not in INTENT_DELTA_RANGES:
        intent = "leverage"  # default fallback

    rng = INTENT_DELTA_RANGES[intent]
    lo, hi = rng["min"], rng["max"]

    # For puts, use absolute delta
    d = abs(delta) if is_put else delta

    # Outside range: penalty band (linear decay over 0.15 delta units)
    if d < lo:
        return max(0.0, 1.0 - (lo - d) / 0.15)
    if d > hi:
        return max(0.0, 1.0 - (d - hi) / 0.15)

    # Inside range: reward closeness to midpoint (0.6-1.0)
    mid = (lo + hi) / 2.0
    width = (hi - lo) / 2.0 or 1e-6
    return max(0.6, 1.0 - abs(d - mid) / width)


def compute_p_win(
    spot: float,
    strike: float,
    premium: float,
    iv: float,
    dte: int,
    option_type: str = "call",
    intent: str = "leverage",
) -> float:
    """
    Compute probability of profit (P(win)) for a LEAPS option.

    For calls: P(S_T > strike + premium)
    For puts/hedge: P(S_T < strike - premium) or P(drawdown triggers protection)

    Uses Black-Scholes lognormal model with IV and DTE.

    Returns: Probability (0-1) normalized to score
    """
    if spot <= 0 or strike <= 0 or premium <= 0 or iv <= 0 or dte <= 0:
        return 0.5  # No data, neutral score

    # Time to expiry in years
    T = dte / 365.0

    # Risk-free rate approximation (use 4.5% as typical)
    r = 0.045

    # Breakeven price
    if option_type == "call":
        breakeven = strike + premium
    else:
        breakeven = strike - premium

    # For hedge intent with puts, "win" means protection triggers (stock drops significantly)
    # We model P(stock drops 10-15% from current level)
    if intent == "hedge" and option_type == "put":
        # Protection threshold: -10% to -15% from spot
        protection_threshold = spot * 0.85  # -15% drop
        target_price = min(breakeven, protection_threshold)
    else:
        target_price = breakeven

    # d2 for P(S_T > K) = N(d2) under lognormal
    # d2 = (ln(S/K) + (r - 0.5*sigma^2)*T) / (sigma*sqrt(T))
    sigma = iv  # IV is already in decimal form (e.g., 0.30 for 30%)
    sqrt_T = math.sqrt(T)

    if target_price <= 0:
        return 0.5

    d2 = (math.log(spot / target_price) + (r - 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)

    if option_type == "call":
        # P(S_T > breakeven)
        p_win = norm.cdf(d2)
    else:
        # P(S_T < breakeven)
        p_win = norm.cdf(-d2)

    return p_win


def compute_profit_rate(
    spot: float,
    strike: float,
    premium: float,
    option_type: str = "call",
    target_move_pct: float = 0.20,
) -> Dict[str, float]:
    """
    Compute expected profit rate (ROI) at a target price move.

    Default: ROI if underlying moves +20% for calls, -20% for puts.

    Returns: Dict with:
        - score: Normalized 0-1 score for ranking (used in weighted scoring)
        - roiPct: Actual ROI percentage at target move (e.g., 150.0 for 150% return)
    """
    if spot <= 0 or premium <= 0:
        return {"score": 0.0, "roiPct": 0.0}

    # Target price based on move
    if option_type == "call":
        target_price = spot * (1 + target_move_pct)
    else:
        target_price = spot * (1 - target_move_pct)

    # Intrinsic value at target
    if option_type == "call":
        intrinsic = max(0.0, target_price - strike)
    else:
        intrinsic = max(0.0, strike - target_price)

    # P&L and ROI
    cost_basis = premium * 100  # per contract
    pnl = (intrinsic - premium) * 100
    roi = pnl / cost_basis if cost_basis > 0 else 0.0

    # Actual ROI as percentage (e.g., 1.5 ratio = 150%)
    roi_pct = roi * 100.0

    # Normalize ROI to 0-1 score for ranking (cap at 300% ROI = 1.0)
    # Negative ROI maps to 0, 300%+ maps to 1.0
    normalized = max(0.0, min(1.0, (roi + 1.0) / 4.0))  # -100% = 0, 300% = 1

    return {"score": normalized, "roiPct": round(roi_pct, 1)}


def compute_theta_efficiency(theta: float, premium: float, dte: int) -> float:
    """
    Compute theta efficiency score (0-1).

    Lower |theta|/premium ratio is better (less decay per dollar invested).
    Score considers DTE since longer-dated options have lower theta.

    Returns: Efficiency score (0-1), higher = less decay relative to premium
    """
    if premium <= 0 or dte <= 0:
        return 0.5

    # Theta is typically negative; use absolute value
    abs_theta = abs(theta)

    # Daily decay as percentage of premium
    daily_decay_pct = (abs_theta / premium) * 100.0

    # For LEAPS (540-900 DTE), good theta efficiency is < 0.05% per day
    # Score: 0% decay = 1.0, 0.1% decay = 0.5, 0.2%+ decay = 0
    score = max(0.0, 1.0 - (daily_decay_pct / 0.2))

    # Bonus for longer DTE (time value advantage)
    dte_bonus = min(0.1, (dte - 180) / 7200.0)  # Max 0.1 bonus for 900+ DTE

    return min(1.0, score + dte_bonus)


def compute_liquidity_score(
    open_interest: int,
    volume: int = 0,
    spread_pct: float = 0.0,
) -> float:
    """
    Compute liquidity score (0-1) based on OI, volume, and bid-ask spread.

    Higher OI, higher volume, tighter spread = better score.
    """
    # OI score: 0-50 OI = 0, 500+ OI = 1.0
    oi_score = min(1.0, max(0.0, (open_interest - 50) / 450.0))

    # Volume score: bonus for recent activity
    vol_score = min(0.3, volume / 100.0) if volume > 0 else 0.0

    # Spread penalty: < 1% = no penalty, > 3% = severe penalty
    spread_penalty = max(0.0, min(0.5, (spread_pct - 1.0) / 4.0))

    return min(1.0, max(0.0, (oi_score * 0.6 + vol_score + 0.1) - spread_penalty))


def compute_risk_penalty(
    iv: float,
    open_interest: int,
    spread_pct: float,
    dte: int,
    delta: float,
    intent: str,
) -> float:
    """
    Compute risk penalty (0-1) based on various risk factors.

    Higher penalty = more risk concerns.
    """
    penalty = 0.0

    # High IV penalty (IV > 50% is elevated)
    if iv > 0.50:
        penalty += min(0.2, (iv - 0.50) * 0.5)

    # Low OI penalty (liquidity risk)
    if open_interest < 100:
        penalty += 0.15 if open_interest < 50 else 0.08

    # Wide spread penalty
    if spread_pct > 2.0:
        penalty += min(0.15, (spread_pct - 2.0) * 0.05)

    # Short DTE penalty for LEAPS (under 365 days less ideal)
    if dte < 365:
        penalty += 0.05

    # Delta mismatch for intent (already captured in delta_fit, but add small penalty for extremes)
    if intent in ("leverage", "speculative_leverage") and delta > 0.80:
        penalty += 0.05  # Too deep ITM for leverage intent
    if intent == "stock_replacement" and delta < 0.80:
        penalty += 0.10  # Not deep enough for replacement

    return min(0.5, penalty)  # Cap total penalty


def score_candidate(
    contract: Dict[str, Any],
    spot_price: float,
    intent: str,
    weights: Dict[str, float],
) -> Dict[str, Any]:
    """
    Score a LEAPS candidate using the multi-perspective framework.

    Returns:
        Dict with individual scores, overall score, and explanation
    """
    strike = contract.get("strike", 0)
    premium = contract.get("mark", 0)
    delta = contract.get("delta", 0)
    theta = contract.get("theta", 0)
    iv = contract.get("iv", 0)
    oi = contract.get("openInterest", 0)
    volume = contract.get("volume", 0)
    spread_pct = contract.get("spreadPct", 0)
    dte = contract.get("dte", 0)
    option_type = contract.get("optionType", "call")
    is_put = option_type == "put"

    # Compute individual scores
    p_win = compute_p_win(spot_price, strike, premium, iv, dte, option_type, intent)
    profit_rate_result = compute_profit_rate(spot_price, strike, premium, option_type)
    profit_rate_score = profit_rate_result["score"]  # 0-1 normalized for ranking
    roi_target_20pct = profit_rate_result["roiPct"]  # Actual ROI % at +20% move
    delta_fit = delta_fit_score(delta, intent, is_put)
    theta_eff = compute_theta_efficiency(theta, premium, dte)
    liquidity = compute_liquidity_score(oi, volume, spread_pct)
    risk_penalty = compute_risk_penalty(iv, oi, spread_pct, dte, delta, intent)

    # Weighted overall score (uses normalized score for profit_rate)
    overall = (
        weights["p_win"] * p_win +
        weights["profit_rate"] * profit_rate_score +
        weights["delta_fit"] * delta_fit +
        weights["theta_eff"] * theta_eff +
        weights["liquidity"] * liquidity
    ) - risk_penalty

    # Normalize to 0-100 scale
    overall_scaled = max(0, min(100, overall * 100))

    # Generate explanations
    why = []
    if p_win > 0.5:
        why.append(f"Good probability of profit ({p_win*100:.0f}%)")
    if profit_rate_score > 0.5:
        why.append(f"Strong ROI potential ({roi_target_20pct:+.0f}% at +20% move)")
    if delta_fit > 0.7:
        why.append(f"Delta {delta:.2f} fits {intent} strategy well")
    if theta_eff > 0.6:
        why.append(f"Efficient theta decay ({abs(theta):.3f}/day)")
    if liquidity > 0.5:
        why.append(f"Good liquidity (OI: {oi})")

    risk_flags = []
    if iv > 0.50:
        risk_flags.append(f"Elevated IV ({iv*100:.0f}%)")
    if oi < 100:
        risk_flags.append(f"Low OI ({oi}) - liquidity risk")
    if spread_pct > 2.0:
        risk_flags.append(f"Wide spread ({spread_pct:.1f}%)")
    if delta_fit < 0.5:
        risk_flags.append(f"Delta {delta:.2f} outside optimal range for {intent}")

    return {
        "scores": {
            "pWin": round(p_win * 100, 1),
            "profitRateScore": round(profit_rate_score * 100, 1),  # 0-100 normalized score for ranking
            "roiTarget20Pct": roi_target_20pct,  # Actual ROI % at +20% move (e.g., 150.0 = 150%)
            "deltaFit": round(delta_fit * 100, 1),
            "thetaEfficiency": round(theta_eff * 100, 1),
            "liquidity": round(liquidity * 100, 1),
            "riskPenalty": round(risk_penalty * 100, 1),
        },
        "overallScore": round(overall_scaled, 1),
        "why": why if why else ["Balanced metrics across perspectives"],
        "riskFlags": risk_flags,
        "breakdown": {
            "p_win_raw": p_win,
            "profit_rate_score_raw": profit_rate_score,
            "roi_target_20pct": roi_target_20pct,
            "delta_fit_raw": delta_fit,
            "theta_eff_raw": theta_eff,
            "liquidity_raw": liquidity,
            "risk_penalty_raw": risk_penalty,
        },
    }


# =============================================================================
# Real Data Fetching (using options_fetcher.py)
# =============================================================================

def fetch_spot_price(symbol: str) -> float:
    """
    Fetch current spot price for a symbol.
    Uses the options chain data to extract underlying price.
    """
    try:
        # Get first expiration to fetch chain with underlying price
        exp_result = get_expiration_dates(symbol)
        if exp_result.get("error") or not exp_result.get("expiration_dates"):
            return 0.0

        first_exp = exp_result["expiration_dates"][0]
        chain_result = get_options_chain(symbol, first_exp)

        if chain_result.underlying_price and chain_result.underlying_price > 0:
            return chain_result.underlying_price

        # Fallback: estimate from ATM options
        if chain_result.contracts:
            # Find ATM strike (closest to where call delta ~ 0.5)
            for c in chain_result.contracts:
                if c.get("option_type", "").lower() == "call":
                    delta = c.get("delta", 0)
                    if 0.45 <= delta <= 0.55:
                        return c.get("strike", 0)

        return 0.0
    except Exception as e:
        print(f"[LEAPS Agent] Error fetching spot price for {symbol}: {e}")
        return 0.0


def fetch_all_leaps_contracts(
    symbol: str,
    direction: str,
    dte_range: Dict[str, int] | None = None
) -> tuple[List[Dict[str, Any]], float]:
    """
    Fetch LEAPS-qualified contracts for a symbol using options_fetcher.

    First gets expiration dates, filters by DTE range, then fetches
    options chain only for those expirations.

    Args:
        symbol: Stock ticker (e.g., 'AAPL')
        direction: 'bullish' (calls) or 'bearish' (puts)
        dte_range: Optional user-specified DTE range {"min": int, "max": int}
                   If not provided, uses DEFAULT_DTE_RANGE

    Returns:
        Tuple of (List of contracts in LEAPSCandidate format, spot price)
    """
    spot_price = 0.0

    # Use user-specified DTE range or default
    min_dte = dte_range["min"] if dte_range else LEAPS_MIN_DTE
    max_dte = dte_range["max"] if dte_range else DEFAULT_DTE_RANGE["max"]

    try:
        # Step 1: Get all expiration dates
        exp_result = get_expiration_dates(symbol)

        if exp_result.get("error") or not exp_result.get("expiration_dates"):
            print(f"[LEAPS Agent] No expirations found for {symbol}: {exp_result.get('error')}")
            return [], 0.0

        # Step 2: Filter to expirations within DTE range
        today = datetime.now().date()
        leaps_expirations = []

        for exp_str in exp_result["expiration_dates"]:
            try:
                exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
                dte = (exp_date - today).days
                if min_dte <= dte <= max_dte:
                    leaps_expirations.append((exp_str, dte))
            except ValueError:
                continue

        if not leaps_expirations:
            print(f"[LEAPS Agent] No expirations found within DTE range {min_dte}-{max_dte} for {symbol}")
            return [], 0.0

        print(f"[LEAPS Agent] Found {len(leaps_expirations)} LEAPS expirations for {symbol}")

        # Step 3: Fetch options chain for each LEAPS expiration
        leaps_contracts = []
        option_type = "call" if direction == "bullish" else "put" if direction == "bearish" else "call"

        for exp_str, dte in leaps_expirations:
            chain_result = get_options_chain(symbol, exp_str)

            if chain_result.error or not chain_result.contracts:
                print(f"[LEAPS Agent] No contracts for {symbol} {exp_str}: {chain_result.error}")
                continue

            # Capture spot price from first successful chain fetch
            if spot_price == 0.0 and chain_result.underlying_price:
                spot_price = chain_result.underlying_price
                print(f"[LEAPS Agent] Captured spot price: ${spot_price:.2f}")

            for c in chain_result.contracts:
                # Skip wrong option type
                if c.get("option_type", "").lower() != option_type:
                    continue

                # Transform to LEAPSCandidate format
                bid = c.get("bid") or 0
                ask = c.get("ask") or 0
                mark = c.get("mark") or ((bid + ask) / 2 if bid and ask else c.get("last_price") or 0)
                spread_pct = 100.0 * (ask - bid) / ((ask + bid) / 2.0) if bid and ask and (ask + bid) > 0 else 0

                leaps_contracts.append({
                    "contractSymbol": c.get("contract_symbol", ""),
                    "strike": c.get("strike") or 0,
                    "expiration": exp_str,
                    "optionType": c.get("option_type", "call").lower(),
                    "mark": mark,
                    "delta": c.get("delta") or 0,
                    "theta": c.get("theta") or 0,
                    "iv": c.get("implied_volatility") or 0,
                    "openInterest": c.get("open_interest") or 0,
                    "dte": dte,
                    "bid": bid,
                    "ask": ask,
                    "spreadPct": spread_pct,
                    "gamma": c.get("gamma") or 0,
                    "vega": c.get("vega") or 0,
                    "volume": c.get("volume") or 0,
                })

        print(f"[LEAPS Agent] Found {len(leaps_contracts)} LEAPS {option_type}s for {symbol}")
        return leaps_contracts, spot_price

    except Exception as e:
        print(f"[LEAPS Agent] Error fetching contracts for {symbol}: {e}")
        import traceback
        traceback.print_exc()
        return [], 0.0


# =============================================================================
# Shared State Schema (synced with frontend)
# =============================================================================

class LEAPSCandidate(TypedDict):
    contractSymbol: str
    strike: float
    expiration: str
    optionType: Literal["call", "put"]
    mark: float
    delta: float
    theta: float
    iv: float
    openInterest: int
    bid: NotRequired[float]
    ask: NotRequired[float]
    spreadPct: NotRequired[float]
    dte: int


class RankedCandidate(TypedDict):
    rank: int
    contract: LEAPSCandidate
    scores: Dict[str, float]
    overallScore: float
    explanation: str
    why: List[str]
    riskFlags: List[str]


class Simulation(TypedDict, total=False):
    rank: int
    contract: LEAPSCandidate
    payoff: Dict[str, Any]
    expectedProfit: Dict[str, Any]  # {expectedProfitUsd, expectedRoiPct, horizonMovePct, ...}
    scenarios: List[Dict[str, Any]]
    thetaDecay: Dict[str, float]


class NextStep(TypedDict, total=False):
    action: str
    message: str
    required: bool
    options: List[Any]


class ResponseEnvelope(TypedDict, total=False):
    step: Literal["filter", "rank", "simulate", "risk_scan"]
    success: bool
    data: Dict[str, Any]
    nextStep: NextStep
    disclaimer: str


class HITLCheckpoint(TypedDict):
    id: str
    type: Literal["missing_scope", "stale_data", "confirmation_required", "tool_failure", "selection_required"]
    step: Literal["filter", "rank", "simulate", "risk_scan"]
    message: str
    options: List[Dict[str, Any]]
    resolved: bool


class LeapsAgentState(TypedDict):
    # --- user intent / inputs ---
    symbol: str
    direction: Literal["bullish", "bearish", "neutral"]
    capitalBudget: float
    leapsIntent: NotRequired[Literal["stock_replacement", "income_underlier", "leverage", "speculative_leverage", "hedge"]]
    userDescription: NotRequired[str]  # Natural language description like "steady growth, lower risk"

    # user overrides (optional)
    dteRange: NotRequired[Dict[str, int]]
    deltaRange: NotRequired[Dict[str, float]]
    minOpenInterest: NotRequired[int]
    maxSpreadPct: NotRequired[float]

    # market data
    spotPrice: NotRequired[float]  # Current underlying price for scoring

    # --- control / routing ---
    requestedStep: NotRequired[Literal["filter", "rank", "simulate", "risk_scan"]]
    lastUserAction: NotRequired[str]                 # e.g. "confirm_filter", "select_candidates", "proceed_risk_scan"
    selectedContracts: NotRequired[List[str]]        # contractSymbol(s)

    # --- progress / UX ---
    currentStep: Literal["filter", "rank", "simulate", "risk_scan", "complete"]
    stepProgress: str
    isProcessing: bool
    activity: NotRequired[List[Dict[str, Any]]]      # [{id, at, status, label, detail, tool}]
    pendingCheckpoint: NotRequired[HITLCheckpoint]
    error: NotRequired[Dict[str, Any]]

    # --- data ---
    filterResults: NotRequired[Dict[str, Any]]
    candidates: NotRequired[List[LEAPSCandidate]]
    rankedCandidates: NotRequired[List[RankedCandidate]]
    simulations: NotRequired[List[Simulation]]
    riskScan: NotRequired[Dict[str, Any]]

    # --- response (what UI consumes) ---
    response: NotRequired[ResponseEnvelope]

    # Chat messages (optional)
    messages: Annotated[List[dict], operator.add]


# =============================================================================
# Helpers
# =============================================================================

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _activity_append(state: LeapsAgentState, *, status: str, label: str, detail: str | None = None, tool: str | None = None) -> LeapsAgentState:
    item = {
        "id": f"act-{uuid.uuid4().hex[:8]}",
        "at": _now_iso(),
        "status": status,   # planned|running|success|error
        "label": label,
    }
    if detail:
        item["detail"] = detail
    if tool:
        item["tool"] = tool
    activity = list(state.get("activity", []))
    activity.append(item)
    return {**state, "activity": activity}

def _checkpoint(state: LeapsAgentState, *, cp_type: HITLCheckpoint["type"], step: HITLCheckpoint["step"], message: str, options: List[Dict[str, Any]]) -> LeapsAgentState:
    cp: HITLCheckpoint = {
        "id": f"cp-{uuid.uuid4().hex[:8]}",
        "type": cp_type,
        "step": step,
        "message": message,
        "options": options,
        "resolved": False,
    }
    # also provide a response envelope (so UI can render it without special-casing)
    resp: ResponseEnvelope = {
        "step": step,
        "success": False,
        "data": {"error": {"type": cp_type, "message": message}},
        "nextStep": {
            "action": "resolve_checkpoint",
            "message": message,
            "required": True,
            "options": options,
        },
        "disclaimer": DISCLAIMER,
    }
    return {
        **state,
        "isProcessing": False,
        "pendingCheckpoint": cp,
        "stepProgress": f"Waiting for user input: {message}",
        "response": resp,
    }

def validate_symbol(symbol: str) -> tuple[bool, str]:
    if not symbol:
        return False, "Symbol is required"
    if len(symbol) > 6:
        return False, f"Symbol '{symbol}' appears invalid (too long)"
    if not symbol.replace(".", "").isalpha():
        return False, f"Symbol '{symbol}' contains invalid characters"
    return True, ""

def is_market_hours_us_eastern_best_effort() -> bool:
    """
    Best-effort check (NOT holiday-aware). Server TZ can differ; treat as a soft warning.
    """
    now = datetime.now()
    market_open = time(9, 30)
    market_close = time(16, 0)
    if now.weekday() >= 5:
        return False
    return market_open <= now.time() <= market_close

def resolve_constraints(state: LeapsAgentState) -> Dict[str, Any]:
    dte = state.get("dteRange") or DEFAULT_DTE_RANGE
    min_oi = int(state.get("minOpenInterest") or DEFAULT_MIN_OI)
    max_spread = float(state.get("maxSpreadPct") or DEFAULT_MAX_SPREAD_PCT)

    # delta range: explicit override wins; else derived from intent
    delta = state.get("deltaRange")
    intent = state.get("leapsIntent")
    if delta is None and intent in INTENT_DELTA_RANGES:
        derived = INTENT_DELTA_RANGES[intent]
        delta = {"min": derived["min"], "max": derived["max"]}
    if delta is None:
        # reasonable default for bullish calls if unspecified
        delta = {"min": 0.60, "max": 0.85}

    return {
        "dteRange": {"min": int(dte["min"]), "max": int(dte["max"])},
        "deltaRange": {"min": float(delta["min"]), "max": float(delta["max"])},
        "minOpenInterest": min_oi,
        "maxSpreadPct": max_spread,
    }

def determine_next_step(state: LeapsAgentState) -> Literal["filter", "rank", "simulate", "risk_scan"]:
    """
    Follows the prompt routing logic (single step per response):
    - If step == risk_scan OR simulations provided -> risk_scan
    - Else if step == simulate OR rankedCandidates provided -> simulate
    - Else if step == rank OR candidates provided -> rank
    - Else -> filter
    """
    requested = state.get("requestedStep")
    if requested in ("filter", "rank", "simulate", "risk_scan"):
        return requested

    if state.get("simulations"):
        return "risk_scan"
    if state.get("rankedCandidates"):
        return "simulate"
    if state.get("candidates"):
        return "rank"
    return "filter"


# =============================================================================
# Step nodes (each returns ONE response; does not auto-advance)
# =============================================================================

async def filter_node(state: LeapsAgentState) -> LeapsAgentState:
    # If there's an unresolved checkpoint, do not proceed
    cp = state.get("pendingCheckpoint")
    if cp and not cp.get("resolved"):
        return state

    symbol = (state.get("symbol") or "").upper()
    ok, msg = validate_symbol(symbol)
    if not ok:
        return _checkpoint(
            state,
            cp_type="missing_scope",
            step="filter",
            message=f"Invalid symbol: {msg}",
            options=[
                {"label": "Enter New Symbol", "action": "change_symbol", "variant": "primary"},
                {"label": "Cancel", "action": "abort", "variant": "secondary"},
            ],
        )

    # Non-blocking warning: market may be closed (best-effort check, not timezone-aware)
    # Don't block workflow - just add activity warning for user awareness
    if not is_market_hours_us_eastern_best_effort():
        state = _activity_append(
            state,
            status="warning",
            label="Market may be closed",
            detail="Options data may be stale. Prices shown are from last market close.",
        )

    constraints = resolve_constraints(state)

    # Handle missing/zero capital budget - use default and notify user
    raw_budget = state.get("capitalBudget")
    if not raw_budget or float(raw_budget) <= 0:
        budget = DEFAULT_CAPITAL_BUDGET
        state = {**state, "capitalBudget": budget}
        state = _activity_append(
            state,
            status="warning",
            label="Using default budget",
            detail=f"No capital budget specified. Assuming ${budget:,.0f} max premium per contract.",
        )
    else:
        budget = float(raw_budget)

    state = _activity_append(state, status="running", label=f"Filtering LEAPS contracts for {symbol}", tool="filter_leaps_contracts")

    # Fetch real options data using options_fetcher
    # Use user-specified DTE range if provided, otherwise use defaults
    direction = state.get("direction", "bullish")
    user_dte_range = constraints["dteRange"]  # Already resolved from user overrides or defaults
    all_contracts, spot_price = fetch_all_leaps_contracts(symbol, direction, user_dte_range)

    if not all_contracts:
        return _checkpoint(
            state,
            cp_type="tool_failure",
            step="filter",
            message=f"No LEAPS contracts found for {symbol}. The symbol may not have options with {LEAPS_MIN_DTE}+ days to expiration, or the market data service is unavailable.",
            options=[
                {"label": "Try Another Symbol", "action": "change_symbol", "variant": "primary"},
                {"label": "Retry", "action": "retry_filter", "variant": "secondary"},
            ],
        )

    # Apply constraint filters (basic) - track exclusion reasons for debugging
    passed: List[Dict[str, Any]] = []
    exclusion_counts = {"dte": 0, "delta": 0, "oi": 0, "spread": 0, "budget": 0}
    for c in all_contracts:
        reasons = []
        if not (constraints["dteRange"]["min"] <= c["dte"] <= constraints["dteRange"]["max"]):
            exclusion_counts["dte"] += 1
            continue
        # delta handling: hedge uses abs delta for puts; otherwise use delta range directly
        if state.get("leapsIntent") == "hedge" and c["optionType"] == "put":
            d = abs(c["delta"])
            if not (constraints["deltaRange"]["min"] <= d <= constraints["deltaRange"]["max"]):
                exclusion_counts["delta"] += 1
                continue
            reasons.append(f"Abs delta {d:.2f} within range")
        else:
            if not (constraints["deltaRange"]["min"] <= c["delta"] <= constraints["deltaRange"]["max"]):
                exclusion_counts["delta"] += 1
                continue
            reasons.append(f"Delta {c['delta']:.2f} within range")

        if c["openInterest"] < constraints["minOpenInterest"]:
            exclusion_counts["oi"] += 1
            continue
        if "spreadPct" in c and c["spreadPct"] > constraints["maxSpreadPct"]:
            exclusion_counts["spread"] += 1
            continue

        # Budget guard: premium cost per contract *100
        if budget > 0 and (c["mark"] * 100.0) > budget:
            exclusion_counts["budget"] += 1
            continue

        reasons.append(f"DTE {c['dte']} within range")
        reasons.append(f"OI {c['openInterest']} meets threshold")
        passed.append({"contract": c, "filterReasons": reasons})

    excluded = sum(exclusion_counts.values())

    # If no candidates pass, provide detailed feedback
    if not passed and all_contracts:
        exclusion_details = []
        if exclusion_counts["dte"]:
            exclusion_details.append(f"{exclusion_counts['dte']} excluded by DTE ({constraints['dteRange']['min']}-{constraints['dteRange']['max']} days)")
        if exclusion_counts["delta"]:
            exclusion_details.append(f"{exclusion_counts['delta']} excluded by delta ({constraints['deltaRange']['min']:.2f}-{constraints['deltaRange']['max']:.2f})")
        if exclusion_counts["oi"]:
            exclusion_details.append(f"{exclusion_counts['oi']} excluded by low OI (<{constraints['minOpenInterest']})")
        if exclusion_counts["spread"]:
            exclusion_details.append(f"{exclusion_counts['spread']} excluded by wide spread (>{constraints['maxSpreadPct']}%)")
        if exclusion_counts["budget"]:
            exclusion_details.append(f"{exclusion_counts['budget']} excluded by budget (>${budget:,.0f} premium)")

        return _checkpoint(
            state,
            cp_type="tool_failure",
            step="filter",
            message=f"Found {len(all_contracts)} contracts but none passed filters. " + "; ".join(exclusion_details),
            options=[
                {"label": "Widen Filters", "action": "refine_filters", "variant": "primary"},
                {"label": "Try Another Symbol", "action": "change_symbol", "variant": "secondary"},
            ],
        )

    state = _activity_append(state, status="success", label="Filter complete", detail=f"Passed {len(passed)}, excluded {excluded}", tool="filter_leaps_contracts")

    resp: ResponseEnvelope = {
        "step": "filter",
        "success": True,
        "data": {
            "symbol": symbol,
            "intent": {
                "direction": state.get("direction"),
                "capitalBudget": state.get("capitalBudget"),
                "dteRange": constraints["dteRange"],
                "deltaRange": constraints["deltaRange"],
                "minOpenInterest": constraints["minOpenInterest"],
                "maxSpreadPct": constraints["maxSpreadPct"],
                "leapsIntent": state.get("leapsIntent"),
            },
            "summary": {
                "totalContracts": len(all_contracts),
                "passedCount": len(passed),
                "excludedCount": excluded,
                "spotPrice": spot_price,
            },
            "candidates": passed,
        },
        "nextStep": {
            "action": "confirm_filter",
            "message": f"Found {len(passed)} LEAPS candidates. Proceed to ranking?",
            "required": True,
        },
        "disclaimer": DISCLAIMER,
    }

    # Required HITL A: confirm to proceed
    checkpoint = {
        "id": f"cp-{uuid.uuid4().hex[:8]}",
        "type": "confirmation_required",
        "step": "filter",
        "message": resp["nextStep"]["message"],
        "options": [
            {"label": "Proceed to Ranking", "action": "confirm_filter", "variant": "primary"},
            {"label": "Refine Filters", "action": "refine_filters", "variant": "secondary"},
            {"label": "Abort", "action": "abort", "variant": "danger"},
        ],
        "resolved": False,
    }

    return {
        **state,
        "symbol": symbol,
        "spotPrice": spot_price,  # Save for ranking calculations
        "currentStep": "filter",
        "isProcessing": False,
        "stepProgress": "Filter complete. Awaiting confirmation to rank.",
        "candidates": [x["contract"] for x in passed],
        "filterResults": resp["data"]["summary"],
        "pendingCheckpoint": checkpoint,
        "response": resp,
        "error": None,
    }


async def rank_node(state: LeapsAgentState) -> LeapsAgentState:
    cp = state.get("pendingCheckpoint")
    if cp and not cp.get("resolved"):
        # must confirm filter first
        return state

    # Require HITL A: explicit confirm_filter
    if state.get("lastUserAction") != "confirm_filter":
        return _checkpoint(
            state,
            cp_type="confirmation_required",
            step="rank",
            message="Please confirm filter results before ranking.",
            options=[
                {"label": "Proceed to Ranking", "action": "confirm_filter", "variant": "primary"},
                {"label": "Refine Filters", "action": "refine_filters", "variant": "secondary"},
            ],
        )

    candidates = state.get("candidates", [])
    if not candidates:
        return _checkpoint(
            state,
            cp_type="missing_scope",
            step="rank",
            message="No filtered candidates found. Run filter first or adjust constraints.",
            options=[{"label": "Run Filter", "action": "run_filter", "variant": "primary"}],
        )

    # Get intent and weights for scoring
    raw_intent = state.get("leapsIntent")
    if not raw_intent:
        # Try to detect intent from user's natural language description
        user_description = state.get("userDescription", "")
        detected_intent = detect_intent_from_description(user_description)

        if detected_intent:
            intent = detected_intent
            # Truncate description for display if needed
            desc_display = user_description[:50] + ("..." if len(user_description) > 50 else "")
            state = _activity_append(
                state,
                status="info",
                label=f"Detected intent: {intent}",
                detail=f"Based on your description ('{desc_display}'), using '{intent}' strategy.",
            )
        else:
            intent = "leverage"  # Default to balanced approach
            state = _activity_append(
                state,
                status="warning",
                label="Using default intent",
                detail="No LEAPS intent specified. Assuming 'leverage' strategy (balanced ROI and probability). "
                       "For different goals, specify intent: 'stock_replacement' (steady growth, lower risk), "
                       "'income_underlier' (covered call base), 'speculative_leverage' (max leverage), or 'hedge'.",
            )
    else:
        intent = raw_intent
    weights = INTENT_WEIGHTS.get(intent, DEFAULT_INTENT_WEIGHTS)
    spot_price = state.get("spotPrice", 0.0)

    # Fallback if spot price not captured
    if spot_price <= 0:
        # Estimate from ATM strike (first candidate with delta ~0.5)
        for c in candidates:
            if 0.45 <= c.get("delta", 0) <= 0.55:
                spot_price = c["strike"]
                break
        if spot_price <= 0 and candidates:
            # Use average of min/max strikes as rough estimate
            strikes = [c["strike"] for c in candidates if c.get("strike", 0) > 0]
            if strikes:
                spot_price = sum(strikes) / len(strikes)

    state = _activity_append(
        state,
        status="running",
        label=f"Scoring candidates with {intent} weights (P(win), Profit Rate, Delta Fit, Theta, Liquidity)",
        tool="rank_leaps_candidates"
    )

    ranked: List[RankedCandidate] = []

    for c in candidates:
        # Use the new multi-perspective scoring function
        score_result = score_candidate(c, spot_price, intent, weights)

        ranked.append({
            "rank": 0,  # Will be set after sorting
            "contract": c,
            "scores": score_result["scores"],
            "overallScore": score_result["overallScore"],
            "explanation": f"Scored using {intent} intent weights: P(win)={weights['p_win']:.0%}, Profit Rate={weights['profit_rate']:.0%}, Delta Fit={weights['delta_fit']:.0%}, Theta Eff={weights['theta_eff']:.0%}, Liquidity={weights['liquidity']:.0%}",
            "why": score_result["why"],
            "riskFlags": score_result["riskFlags"],
        })

    # Sort by overall score (descending)
    ranked.sort(key=lambda x: x["overallScore"], reverse=True)

    # Assign ranks after sorting
    for idx, item in enumerate(ranked, start=1):
        item["rank"] = idx

    state = _activity_append(state, status="success", label="Ranking complete", detail=f"Scored {len(ranked)} candidates using {intent} strategy weights", tool="rank_leaps_candidates")

    # Prepare weight summary for UI
    weight_summary = {
        "intent": intent,
        "weights": {
            "pWin": weights["p_win"],
            "profitRate": weights["profit_rate"],
            "deltaFit": weights["delta_fit"],
            "thetaEfficiency": weights["theta_eff"],
            "liquidity": weights["liquidity"],
        },
        "spotPrice": spot_price,
    }

    resp: ResponseEnvelope = {
        "step": "rank",
        "success": True,
        "data": {
            "rankedCandidates": ranked,
            "scoringMethod": weight_summary,
        },
        "nextStep": {
            "action": "select_candidates",
            "message": "Select 1–3 candidates for payoff simulation.",
            "required": True,
            "options": [{"contractSymbol": r["contract"]["contractSymbol"], "rank": r["rank"]} for r in ranked[:10]],
        },
        "disclaimer": DISCLAIMER,
    }

    # Required HITL B: selection
    checkpoint = {
        "id": f"cp-{uuid.uuid4().hex[:8]}",
        "type": "selection_required",
        "step": "rank",
        "message": resp["nextStep"]["message"],
        "options": [
            {"label": "Select 1–3 Candidates", "action": "select_candidates", "variant": "primary"},
            {"label": "Back to Filters", "action": "refine_filters", "variant": "secondary"},
        ],
        "resolved": False,
    }

    return {
        **state,
        "currentStep": "rank",
        "isProcessing": False,
        "stepProgress": "Ranking complete. Awaiting candidate selection.",
        "rankedCandidates": ranked,
        "pendingCheckpoint": checkpoint,
        "response": resp,
        "error": None,
    }


def _build_horizon_scenarios(horizon_move: float) -> List[Dict[str, Any]]:
    """
    Build scenarios at horizon_move ± 20pp from spot.
    E.g., if horizon=24%, scenarios are +4%, +14%, +24% (expected), +34%, +44%
    """
    moves = [
        horizon_move - 0.20,
        horizon_move - 0.10,
        horizon_move,  # expected
        horizon_move + 0.10,
        horizon_move + 0.20,
    ]
    return [{"pct": m, "is_expected": m == horizon_move} for m in moves]


async def simulate_node(state: LeapsAgentState) -> LeapsAgentState:
    cp = state.get("pendingCheckpoint")
    if cp and not cp.get("resolved"):
        return state

    # Require HITL B: selection
    selected = state.get("selectedContracts") or []
    if state.get("lastUserAction") != "select_candidates" or not selected:
        return _checkpoint(
            state,
            cp_type="selection_required",
            step="simulate",
            message="Select 1–3 contracts before simulation.",
            options=[
                {"label": "Select Candidates", "action": "select_candidates", "variant": "primary"},
            ],
        )
    if len(selected) > 3:
        return _checkpoint(
            state,
            cp_type="selection_required",
            step="simulate",
            message="Please select at most 3 contracts for simulation.",
            options=[{"label": "Select 1–3", "action": "select_candidates", "variant": "primary"}],
        )

    ranked = state.get("rankedCandidates", [])
    by_symbol = {r["contract"]["contractSymbol"]: r for r in ranked}
    chosen = [by_symbol[s]["contract"] for s in selected if s in by_symbol]
    if not chosen:
        return _checkpoint(
            state,
            cp_type="missing_scope",
            step="simulate",
            message="Selected contracts not found in ranked candidates. Re-select from the list.",
            options=[{"label": "Re-select", "action": "select_candidates", "variant": "primary"}],
        )

    state = _activity_append(state, status="running", label="Running payoff simulations", tool="simulate_leaps_payoff")

    simulations: List[Simulation] = []

    # Get spot price from state (captured during filter step)
    spot = state.get("spotPrice", 0.0)
    if spot <= 0:
        # Fallback: estimate from first chosen contract's strike if ATM-ish
        for c in chosen:
            if 0.45 <= abs(c.get("delta", 0)) <= 0.55:
                spot = c["strike"]
                break
        if spot <= 0 and chosen:
            spot = chosen[0]["strike"]  # Last resort fallback

    # Get expected move from state (defaults to 10% annual if not set)
    expected_move_pct = state.get("expectedMovePct", 0.10)

    import math

    for idx, contract in enumerate(chosen, start=1):
        strike = contract["strike"]
        premium = contract["mark"]
        dte = contract.get("dte", 540)
        premium_usd = premium * 100.0

        # Calculate horizon move for this contract's DTE
        t_years = dte / 365.0
        horizon_move = expected_move_pct * math.sqrt(t_years)

        # Payoff structure - use simple strings for maxProfit for UI compatibility
        if contract["optionType"] == "call":
            breakeven = strike + premium
            max_profit = "unlimited"
        else:
            breakeven = strike - premium
            max_profit = round(max(0.0, (strike - premium) * 100.0), 2)

        payoff = {
            "breakeven": breakeven,
            "maxProfit": max_profit,
            "maxLoss": -premium_usd,
            "costBasis": premium_usd,
            "spotPrice": spot,
        }

        # Calculate expected profit based on expected move
        if contract["optionType"] == "call":
            expected_price = spot * (1 + horizon_move)
            intrinsic_at_expiry = max(0.0, expected_price - strike) * 100.0
        else:
            expected_price = spot * (1 - horizon_move)
            intrinsic_at_expiry = max(0.0, strike - expected_price) * 100.0
        expected_profit_usd = intrinsic_at_expiry - premium_usd
        expected_roi_pct = (expected_profit_usd / premium_usd) * 100.0 if premium_usd > 0 else 0.0

        expected_profit = {
            "expectedPriceAtExpiry": round(expected_price, 2),
            "expectedProfitUsd": round(expected_profit_usd, 2),
            "expectedRoiPct": round(expected_roi_pct, 1),
            "horizonMovePct": round(horizon_move * 100, 1),
            "annualizedMovePct": round(expected_move_pct * 100, 1),
        }

        # Build scenarios at horizon_move ± 20pp
        scenarios = _build_horizon_scenarios(horizon_move)
        sc_rows: List[Dict[str, Any]] = []
        for scenario in scenarios:
            pct = scenario["pct"]
            is_expected = scenario["is_expected"]
            # Use spot price for scenario pricing
            price = spot * (1.0 + pct)
            # Calculate intrinsic
            if contract["optionType"] == "call":
                intrinsic = max(0.0, price - strike)
            else:
                intrinsic = max(0.0, strike - price)
            pnl = (intrinsic - premium) * 100.0
            roi = (pnl / (premium * 100.0)) * 100.0 if premium > 0 else 0.0
            # Format move label
            move_label = f"+{int(pct * 100)}% (expected)" if is_expected else f"{'+' if pct >= 0 else ''}{int(pct * 100)}%"
            sc_rows.append({"move": move_label, "price": round(price, 2), "pnl": round(pnl, 2), "roi": round(roi, 1)})

        simulations.append({
            "rank": idx,
            "contract": contract,
            "payoff": payoff,
            "expectedProfit": expected_profit,
            "scenarios": sc_rows,
            "thetaDecay": {
                "daily": contract["theta"],
                "weekly": contract["theta"] * 7.0,
                "monthly": contract["theta"] * 30.0,
            },
        })

    state = _activity_append(state, status="success", label="Simulation complete", detail=f"Simulated {len(simulations)} contracts", tool="simulate_leaps_payoff")

    resp: ResponseEnvelope = {
        "step": "simulate",
        "success": True,
        "data": {"simulations": simulations},
        "nextStep": {
            "action": "proceed_risk_scan",
            "message": "Run risk analysis before finalizing?",
            "required": False,
            "options": [
                {"label": "Run Risk Scan", "action": "proceed_risk_scan"},
                {"label": "Finalize Here", "action": "finalize"},
            ],
        },
        "disclaimer": DISCLAIMER,
    }

    # Optional HITL C (not blocking)
    return {
        **state,
        "currentStep": "simulate",
        "isProcessing": False,
        "stepProgress": "Simulation complete.",
        "simulations": simulations,
        "response": resp,
        "error": None,
        "pendingCheckpoint": None,
    }


async def risk_scan_node(state: LeapsAgentState) -> LeapsAgentState:
    # If user didn't ask, you may still run if requestedStep=risk_scan
    if state.get("lastUserAction") not in ("proceed_risk_scan", "finalize") and state.get("requestedStep") != "risk_scan":
        # If called accidentally, return a gentle nextStep to choose
        return {
            **state,
            "currentStep": "risk_scan",
            "isProcessing": False,
            "stepProgress": "Risk scan is optional. Choose whether to proceed.",
            "response": {
                "step": "risk_scan",
                "success": False,
                "data": {"error": {"type": "confirmation_required", "message": "Proceed to risk scan?"}},
                "nextStep": {
                    "action": "proceed_risk_scan",
                    "message": "Run risk analysis before finalizing?",
                    "required": False,
                    "options": [{"label": "Run Risk Scan", "action": "proceed_risk_scan"}],
                },
                "disclaimer": DISCLAIMER,
            },
        }

    state = _activity_append(state, status="running", label="Scanning risks (IV, events, liquidity)", tool="scan_leaps_risks")

    # TODO: Replace with real IV rank/percentile, earnings/dividends, etc.
    risk_scan = {
        "symbol": state["symbol"],
        "overallRisk": "moderate",
        "ivAnalysis": {
            "ivRank": None,
            "ivPercentile": None,
            "assessment": "IV rank/percentile unavailable (tool not connected).",
        },
        "events": [],
        "warnings": [],
        "recommendations": [
            "Monitor liquidity (OI/spreads) over time.",
            "Consider rolling 60–90 days before expiration to avoid liquidity drop-off.",
        ],
    }

    state = _activity_append(state, status="success", label="Risk scan complete", tool="scan_leaps_risks")

    resp: ResponseEnvelope = {
        "step": "risk_scan",
        "success": True,
        "data": {"riskScan": risk_scan},
        "nextStep": {
            "action": "finalize",
            "message": "Review complete. Ready to execute?",
            "required": False,
            "options": ["execute", "modify", "start_over"],
        },
        "disclaimer": DISCLAIMER,
    }

    return {
        **state,
        "currentStep": "complete",
        "isProcessing": False,
        "stepProgress": "Risk scan complete.",
        "riskScan": risk_scan,
        "response": resp,
        "error": None,
        "pendingCheckpoint": None,
    }


# =============================================================================
# Router node (runs exactly one step then ends)
# =============================================================================

def _resolve_checkpoint_if_action_matches(state: LeapsAgentState) -> LeapsAgentState:
    """
    Resolve pending checkpoint if lastUserAction matches one of its valid actions.
    Returns updated state with checkpoint cleared if resolved.
    """
    cp = state.get("pendingCheckpoint")
    if not cp or cp.get("resolved"):
        return state  # No checkpoint or already resolved

    last_action = state.get("lastUserAction")
    if not last_action:
        return state  # No user action provided

    # Extract valid actions from checkpoint options
    valid_actions = set()
    for opt in cp.get("options", []):
        if isinstance(opt, dict) and "action" in opt:
            valid_actions.add(opt["action"])
        elif isinstance(opt, str):
            valid_actions.add(opt)

    # Also accept common progression actions
    progression_actions = {
        "confirm_filter", "select_candidates", "proceed_risk_scan",
        "proceed_stale", "finalize", "retry_filter",
    }
    valid_actions.update(progression_actions)

    if last_action in valid_actions:
        # Resolve the checkpoint
        state = {**state, "pendingCheckpoint": None}

        # Handle special abort/reset actions
        if last_action == "abort":
            state = {
                **state,
                "currentStep": "filter",
                "candidates": [],
                "rankedCandidates": [],
                "simulations": [],
                "riskScan": None,
                "error": {"type": "aborted", "message": "Analysis aborted by user."},
            }
        elif last_action == "refine_filters":
            # Reset to filter step but keep symbol/direction/budget
            state = {
                **state,
                "currentStep": "filter",
                "requestedStep": "filter",
                "candidates": [],
                "rankedCandidates": [],
                "simulations": [],
            }

    return state


async def router_node(state: LeapsAgentState) -> LeapsAgentState:
    # First, resolve any pending checkpoint if user provided a matching action
    state = _resolve_checkpoint_if_action_matches(state)

    # If still unresolved checkpoint, return state as-is (UI should handle)
    cp = state.get("pendingCheckpoint")
    if cp and not cp.get("resolved"):
        return state

    step = determine_next_step(state)
    # Mark processing
    state = {**state, "isProcessing": True, "stepProgress": f"Running step: {step}", "currentStep": step}

    if step == "filter":
        return await filter_node(state)
    if step == "rank":
        return await rank_node(state)
    if step == "simulate":
        return await simulate_node(state)
    return await risk_scan_node(state)


# =============================================================================
# Build the Graph (single-node entry -> END)
# =============================================================================

def create_leaps_graph():
    workflow = StateGraph(LeapsAgentState)
    workflow.add_node("router", router_node)
    workflow.set_entry_point("router")
    workflow.add_edge("router", END)
    memory = MemorySaver()
    return workflow.compile(checkpointer=memory)

leaps_graph = create_leaps_graph()
