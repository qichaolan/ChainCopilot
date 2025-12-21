"""
LEAPS (Long-Term Equity Anticipation Securities) Strategy Generator.

Generates LEAPS candidates for long-term directional plays.
LEAPS are options with expiration dates typically 1-3 years out.

Key differences from regular long calls/puts:
- Filter for DTE >= 540 days (18 months minimum)
- Prefer higher delta (0.6-0.8) for stock replacement
- Weight theta burn score lower (less decay concern for long-dated)
- Weight liquidity higher (LEAPS often have lower OI)

Scoring Model (Two-Stage):
- RiskQualityScore: breakeven hurdle, liquidity, theta efficiency, DTE
- RewardScore: ROI at expected and stress price moves (assumption-driven)
- Overall = weighted combination based on LEAPS profile
"""

from __future__ import annotations

from typing import List, Optional, Dict, Any, Literal

import os
import sys

# Add paths for imports
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, AGENT_DIR)

from types_ import OptionContract, StrategyCandidate, MarketOutlook, SimulationAssumption
from tools.common import (
    calculate_liquidity_score,
    calculate_theta_efficiency,
    calculate_delta_efficiency,
    calculate_breakeven_score,
    calculate_breakeven_hurdle,
)
from tools.risk_assessment import assess_leaps_risks
from tools.simulation import calculate_roi_at_price, calculate_roi_score
from config import TRADER_PROFILES


# LEAPS-specific constants
MIN_DTE_LEAPS = 540  # Minimum 18 months to qualify as LEAPS
LEAPS_DELTA_MIN = 0.35  # Higher delta for stock replacement
LEAPS_DELTA_MAX = 0.85
MIN_OPEN_INTEREST = 5  # Lower OI threshold for LEAPS (typically less liquid)

# Profile thresholds
STOCK_REPLACEMENT_DELTA_THRESHOLD = 0.65

# ============================================================================
# New 0-1 Scoring Model: Balance Expected ROC with Distance to Breakeven
# ============================================================================

import math

# Scoring constants (calibrated for LEAPS)
ROC_TARGET = 0.50  # 50% ROC = excellent LEAPS (more realistic target)
BE_ALPHA = 0.30    # 30% move to BE gives ~37% score (forgiving for long-dated)
BE_BETA = 1.20     # Gentler decay curve


def _breakeven_score(breakeven_price: float, spot_price: float, is_call: bool = True) -> float:
    """
    Calculate breakeven score [0, 1] using exponential decay.
    Closer to spot = higher score (easier to profit).

    Uses Weibull-like decay: exp(-(be_pct / alpha)^beta)
    - alpha=0.30: 30% move gives ~37% score (calibrated for LEAPS)
    - beta=1.20: gentler decay curve

    Args:
        is_call: True for calls (BE > spot), False for puts (BE < spot)
    """
    be_pct = breakeven_price / spot_price - 1
    if is_call:
        # For calls: need stock to go UP to BE
        if be_pct <= 0:
            return 1.0  # Already ITM
        return math.exp(-((be_pct / BE_ALPHA) ** BE_BETA))
    else:
        # For puts: need stock to go DOWN to BE
        if be_pct >= 0:
            return 1.0  # Already ITM
        return math.exp(-((-be_pct / BE_ALPHA) ** BE_BETA))


def _roc_score(expected_roc: float) -> float:
    """
    Calculate ROC score [0, 1].
    50% ROC = perfect score (calibrated for LEAPS), capped at 1.0.
    """
    if expected_roc <= 0:
        return 0.0
    return min(expected_roc / ROC_TARGET, 1.0)


def _calculate_overall_score_v2(
    breakeven_price: float,
    spot_price: float,
    expected_profit_usd: float,
    premium_usd: float,
    is_call: bool = True,
) -> Dict[str, float]:
    """
    New 0-1 scoring model combining Expected ROC and Breakeven distance.

    Uses normal-distribution-inspired combination:
    - Geometric mean: sqrt(be_score * roc_score) - penalizes low scores in either
    - Scales to 0-100 for UI display

    Args:
        is_call: True for calls (BE > spot), False for puts (BE < spot)

    Returns dict with component scores for transparency.
    """
    # Calculate component scores
    be_score = _breakeven_score(breakeven_price, spot_price, is_call=is_call)

    # Expected ROC as decimal
    expected_roc = expected_profit_usd / premium_usd if premium_usd > 0 else 0
    roc_score = _roc_score(expected_roc)

    # Geometric mean combination (penalizes if either is low)
    # This is "normal-distribution-based" in spirit:
    # both components must be good for high overall score
    if be_score > 0 and roc_score > 0:
        combined = math.sqrt(be_score * roc_score)
    else:
        combined = 0.0

    # Scale to 0-100 for display
    overall_score = round(combined * 100, 1)

    return {
        "breakevenScore": round(be_score, 3),
        "rocScore": round(roc_score, 3),
        "expectedRocPct": round(expected_roc * 100, 1),
        "combinedScore": round(combined, 3),
        "overallScore": overall_score,
    }


def _get_profile_weights(profile_type: str) -> Dict[str, float]:
    """Get reward/risk weights from trader profile config."""
    if profile_type in TRADER_PROFILES:
        profile = TRADER_PROFILES[profile_type]
        return {
            "reward": profile["rewardWeight"],
            "risk": profile["riskWeight"],
        }
    # Fallback to stock_replacement defaults
    return {"reward": 0.45, "risk": 0.55}

def generate_leaps(
    contracts: List[OptionContract],
    outlook: MarketOutlook,
    budget: float,
    spot_price: float,
    assumptions: Optional[SimulationAssumption] = None,
    profile_override: Optional[str] = None,
) -> List[StrategyCandidate]:
    """
    Generate LEAPS candidates for long-term directional exposure.

    Args:
        contracts: List of option contracts
        outlook: Market outlook (bullish = calls, bearish = puts)
        budget: Capital budget in dollars
        spot_price: Current underlying price
        assumptions: Optional simulation assumptions for ROI-based scoring.
                     If provided, enables two-stage risk/reward scoring.
        profile_override: Optional profile to use instead of auto-detection.
                          Either 'stock_replacement' or 'leverage_leaps'.

    Returns:
        List of ranked LEAPS candidates
    """
    # Determine option type based on outlook
    opt_type = "put" if outlook == "bearish" else "call"

    # Filter for LEAPS-qualifying options
    leaps_options = [
        c for c in contracts
        if c["optionType"] == opt_type
        and c["dte"] >= MIN_DTE_LEAPS
        and c["mark"] > 0
        and c["mark"] * 100 <= budget
        and c["openInterest"] >= MIN_OPEN_INTEREST
        and LEAPS_DELTA_MIN <= abs(c["delta"]) <= LEAPS_DELTA_MAX
    ]

    # Build candidates (final ranking determined by overallScore, not input order)
    candidates: List[StrategyCandidate] = []

    for idx, c in enumerate(leaps_options):
        if outlook == "bearish":
            candidate = _build_leaps_put_candidate(c, idx, spot_price, assumptions, profile_override)
        else:
            candidate = _build_leaps_call_candidate(c, idx, spot_price, assumptions, profile_override)
        candidates.append(candidate)

    # Sort by overall score descending, return top 10
    candidates = sorted(candidates, key=lambda c: c["overallScore"], reverse=True)[:10]

    return candidates


def _detect_leaps_profile(delta: float) -> Literal["stock_replacement", "leverage_leaps"]:
    """
    Detect LEAPS profile based on delta.

    Stock replacement: high delta (>= 0.65) - prioritize risk quality
    Leverage LEAPS: lower delta (< 0.65) - prioritize ROI potential
    """
    if abs(delta) >= STOCK_REPLACEMENT_DELTA_THRESHOLD:
        return "stock_replacement"
    return "leverage_leaps"


def _build_leaps_call_candidate(
    contract: OptionContract,
    idx: int,
    spot_price: float,
    assumptions: Optional[SimulationAssumption] = None,
    profile_override: Optional[str] = None,
) -> StrategyCandidate:
    """Build a LEAPS call candidate with two-stage risk/reward scoring."""
    mark_price = contract["mark"]
    strike_price = contract["strike"]
    premium_usd = mark_price * 100
    breakeven_price = strike_price + mark_price

    # Delta as ITM proxy (NOT probability of profit)
    prob_itm_proxy = int(abs(contract["delta"]) * 100)

    # Risk quality scores (always calculated)
    risk_scores = _calculate_leaps_scores(contract, breakeven_price, spot_price, is_call=True)
    risk_quality_score = round(_calculate_risk_quality_score(risk_scores, contract["dte"]), 1)

    # Use profile override if provided, otherwise detect from delta
    if profile_override and profile_override in TRADER_PROFILES:
        profile_type = profile_override
    else:
        profile_type = _detect_leaps_profile(contract["delta"])
    weights = _get_profile_weights(profile_type)

    # Calculate reward score if assumptions provided
    reward_scores: Dict[str, Any] = {}
    reward_score_value: Optional[float] = None

    if assumptions:
        # Build minimal proto-candidate for multi-leg P&L calculation
        proto_candidate: StrategyCandidate = {
            "id": "",
            "strategyType": "leaps",
            "legs": [{"contract": contract, "action": "buy", "quantity": 1}],
            "netPremium": premium_usd,
            "maxLoss": -premium_usd,
            "maxProfit": "unlimited",
            "breakeven": breakeven_price,
            "probITMProxy": prob_itm_proxy,
            "netDelta": contract["delta"],
            "netTheta": contract["theta"],
            "netVega": contract["vega"],
            "scores": {},
            "overallScore": 0,
            "why": [],
            "risks": [],
        }
        reward_scores = _calculate_reward_scores(
            proto_candidate, spot_price, assumptions, is_bullish=True
        )
        reward_score_value = float(reward_scores.get("rewardScore", 0))

    # Calculate effective leverage (delta-adjusted participation)
    leverage = (abs(contract["delta"]) * spot_price) / mark_price if mark_price > 0 else 0

    # Calculate breakeven hurdle for display
    be_hurdle = calculate_breakeven_hurdle(breakeven_price, spot_price, is_call=True)

    # Calculate expected profit based on expected move
    expected_profit_data = None
    expected_profit_usd = 0.0
    if assumptions:
        dte = contract["dte"]
        annualized_move = assumptions["expectedMovePct"]
        # Scale to horizon using compound growth: (1 + annual_move)^years - 1
        t_years = dte / 365.0
        horizon_move = (1 + annualized_move) ** t_years - 1
        expected_price_at_expiry = spot_price * (1 + horizon_move)
        intrinsic_at_expiry = max(0, expected_price_at_expiry - strike_price) * 100
        expected_profit_usd = intrinsic_at_expiry - premium_usd
        expected_roi_pct = (expected_profit_usd / premium_usd) * 100 if premium_usd > 0 else 0
        expected_profit_data = {
            "expectedPriceAtExpiry": round(expected_price_at_expiry, 2),
            "expectedProfitUsd": round(expected_profit_usd, 2),
            "expectedRoiPct": round(expected_roi_pct, 1),
            "horizonMovePct": round(horizon_move * 100, 1),
            "annualizedMovePct": round(annualized_move * 100, 1),
        }

    # NEW: Calculate overall score using 0-1 model (Expected ROC + Breakeven distance)
    score_v2 = _calculate_overall_score_v2(
        breakeven_price=breakeven_price,
        spot_price=spot_price,
        expected_profit_usd=expected_profit_usd,
        premium_usd=premium_usd,
        is_call=True,  # This is a call
    )
    overall = score_v2["overallScore"]

    # Merge all scores for transparency
    all_scores = {**risk_scores, **reward_scores, **score_v2}

    candidate: StrategyCandidate = {
        "id": f"leaps-call-{idx}-{contract['contractSymbol']}",
        "strategyType": "leaps",
        "legs": [{"contract": contract, "action": "buy", "quantity": 1}],
        "maxLoss": -premium_usd,
        "maxProfit": "unlimited",
        "breakeven": breakeven_price,
        "probITMProxy": prob_itm_proxy,
        "netDelta": contract["delta"],
        "netTheta": contract["theta"],
        "netVega": contract["vega"],
        "netPremium": premium_usd,
        "scores": all_scores,
        "overallScore": overall,
        "why": _generate_leaps_call_reasons(contract, spot_price, leverage, be_hurdle),
        "risks": _generate_leaps_risks(contract, premium_usd),
        # Explicit risk vs reward split for UI display
        "riskQualityScore": risk_quality_score,
        "rewardScore": reward_score_value,
        "profile": {
            "profileType": profile_type,
            "rewardWeight": weights["reward"],
            "riskWeight": weights["risk"],
        },
        "assumptionsUsed": dict(assumptions) if assumptions else None,
        # Expected profit calculation
        "expectedProfit": expected_profit_data,
    }

    return candidate


def _build_leaps_put_candidate(
    contract: OptionContract,
    idx: int,
    spot_price: float,
    assumptions: Optional[SimulationAssumption] = None,
    profile_override: Optional[str] = None,
) -> StrategyCandidate:
    """Build a LEAPS put candidate with two-stage risk/reward scoring."""
    mark_price = contract["mark"]
    strike_price = contract["strike"]
    premium_usd = mark_price * 100
    breakeven_price = strike_price - mark_price
    max_profit_usd = breakeven_price * 100  # Max profit if stock goes to 0

    # Delta as ITM proxy (NOT probability of profit)
    prob_itm_proxy = int(abs(contract["delta"]) * 100)

    # Risk quality scores (always calculated)
    risk_scores = _calculate_leaps_scores(contract, breakeven_price, spot_price, is_call=False)
    risk_quality_score = round(_calculate_risk_quality_score(risk_scores, contract["dte"]), 1)

    # Use profile override if provided, otherwise detect from delta
    if profile_override and profile_override in TRADER_PROFILES:
        profile_type = profile_override
    else:
        profile_type = _detect_leaps_profile(contract["delta"])
    weights = _get_profile_weights(profile_type)

    # Calculate reward score if assumptions provided
    reward_scores: Dict[str, Any] = {}
    reward_score_value: Optional[float] = None

    if assumptions:
        # Build minimal proto-candidate for multi-leg P&L calculation
        proto_candidate: StrategyCandidate = {
            "id": "",
            "strategyType": "leaps",
            "legs": [{"contract": contract, "action": "buy", "quantity": 1}],
            "netPremium": premium_usd,
            "maxLoss": -premium_usd,
            "maxProfit": max_profit_usd,
            "breakeven": breakeven_price,
            "probITMProxy": prob_itm_proxy,
            "netDelta": contract["delta"],
            "netTheta": contract["theta"],
            "netVega": contract["vega"],
            "scores": {},
            "overallScore": 0,
            "why": [],
            "risks": [],
        }
        reward_scores = _calculate_reward_scores(
            proto_candidate, spot_price, assumptions, is_bullish=False
        )
        reward_score_value = float(reward_scores.get("rewardScore", 0))

    # Merge all scores for transparency
    all_scores = {**risk_scores, **reward_scores}

    # Calculate breakeven hurdle for display
    be_hurdle = calculate_breakeven_hurdle(breakeven_price, spot_price, is_call=False)

    # Calculate expected profit based on expected move (for puts, expect price to drop)
    expected_profit_data = None
    expected_profit_usd = 0.0
    if assumptions:
        dte = contract["dte"]
        annualized_move = assumptions["expectedMovePct"]
        # Scale to horizon using compound growth: (1 + annual_move)^years - 1
        t_years = dte / 365.0
        horizon_move = (1 + annualized_move) ** t_years - 1
        # For puts: expect price to DROP by horizon_move
        expected_price_at_expiry = spot_price * (1 - horizon_move)
        intrinsic_at_expiry = max(0, strike_price - expected_price_at_expiry) * 100
        expected_profit_usd = intrinsic_at_expiry - premium_usd
        expected_roi_pct = (expected_profit_usd / premium_usd) * 100 if premium_usd > 0 else 0
        expected_profit_data = {
            "expectedPriceAtExpiry": round(expected_price_at_expiry, 2),
            "expectedProfitUsd": round(expected_profit_usd, 2),
            "expectedRoiPct": round(expected_roi_pct, 1),
            "horizonMovePct": round(horizon_move * 100, 1),
            "annualizedMovePct": round(annualized_move * 100, 1),
        }

    # NEW: Calculate overall score using 0-1 model (Expected ROC + Breakeven distance)
    score_v2 = _calculate_overall_score_v2(
        breakeven_price=breakeven_price,
        spot_price=spot_price,
        expected_profit_usd=expected_profit_usd,
        premium_usd=premium_usd,
        is_call=False,  # This is a put
    )
    overall = score_v2["overallScore"]

    # Merge v2 scores into all_scores for transparency
    all_scores = {**all_scores, **score_v2}

    candidate: StrategyCandidate = {
        "id": f"leaps-put-{idx}-{contract['contractSymbol']}",
        "strategyType": "leaps",
        "legs": [{"contract": contract, "action": "buy", "quantity": 1}],
        "maxLoss": -premium_usd,
        "maxProfit": max_profit_usd,
        "breakeven": breakeven_price,
        "probITMProxy": prob_itm_proxy,
        "netDelta": contract["delta"],
        "netTheta": contract["theta"],
        "netVega": contract["vega"],
        "netPremium": premium_usd,
        "scores": all_scores,
        "overallScore": overall,
        "why": _generate_leaps_put_reasons(contract, spot_price, be_hurdle),
        "risks": _generate_leaps_risks(contract, premium_usd),
        # Explicit risk vs reward split for UI display
        "riskQualityScore": risk_quality_score,
        "rewardScore": reward_score_value,
        "profile": {
            "profileType": profile_type,
            "rewardWeight": weights["reward"],
            "riskWeight": weights["risk"],
        },
        "assumptionsUsed": dict(assumptions) if assumptions else None,
        # Expected profit calculation
        "expectedProfit": expected_profit_data,
    }

    return candidate


def _calculate_leaps_scores(
    contract: OptionContract,
    breakeven_price: float,
    spot_price: float,
    is_call: bool,
) -> dict:
    """
    Calculate LEAPS-specific scores.

    LEAPS scoring differs from regular options:
    - Breakeven Hurdle: How far stock needs to move (lower = better)
    - Theta Efficiency: Daily decay per dollar (less important for LEAPS)
    - Delta Efficiency: Delta exposure per dollar
    - Liquidity: Lower threshold acceptable for LEAPS
    - DTE Score: Prefer longer-dated within LEAPS range
    """
    # Breakeven hurdle (same as long call/put)
    breakeven_hurdle = calculate_breakeven_score(breakeven_price, spot_price, is_call)

    # Theta efficiency: raw score without floor (weight adjusted in overall score)
    theta_efficiency = calculate_theta_efficiency(contract["theta"], contract["mark"])

    # Delta efficiency: delta per dollar
    delta_efficiency = calculate_delta_efficiency(contract["delta"], contract["mark"])

    # Liquidity: scaled for LEAPS (typically lower OI), include spread
    liquidity = calculate_liquidity_score(
        contract["openInterest"],
        contract["bid"],
        contract["ask"],
        divisor=20  # Lower divisor since LEAPS have less liquidity
    )

    # DTE bonus: prefer longer-dated within LEAPS range
    dte_score = _calculate_dte_score(contract["dte"])

    return {
        "breakevenHurdle": breakeven_hurdle,
        "thetaEfficiency": theta_efficiency,
        "deltaEfficiency": delta_efficiency,
        "liquidity": liquidity,
        "dteScore": dte_score,
    }


def _calculate_dte_score(dte: int) -> int:
    """
    Calculate DTE score for LEAPS (longer is better, scaled within range).

    540 DTE (18mo) → 60
    720 DTE (24mo) → 80
    900+ DTE (30mo+) → 100
    """
    if dte < MIN_DTE_LEAPS:
        return 50  # Below minimum (shouldn't happen with filtering)

    # Scale within LEAPS band: 540-900 maps to 60-100
    capped = min(dte, 900)
    return int(60 + (capped - MIN_DTE_LEAPS) / (900 - MIN_DTE_LEAPS) * 40)


def _calculate_risk_quality_score(scores: dict, dte: int = 540) -> float:
    """
    Calculate risk quality score for LEAPS with dynamic theta weighting.

    This is the "risk" component of the two-stage scoring system.
    Focuses on execution quality and position structure.

    Theta matters less for longer-dated LEAPS:
    - DTE < 720: theta_weight = 0.15
    - DTE 720-900: theta_weight = 0.10
    - DTE > 900: theta_weight = 0.05

    Redistributed weight goes to breakeven hurdle (most actionable metric).
    """
    # Dynamic theta weight based on DTE
    if dte > 900:
        theta_weight = 0.05
    elif dte > 720:
        theta_weight = 0.10
    else:
        theta_weight = 0.15

    # Redistribute reduced theta weight to breakeven hurdle
    breakeven_weight = 0.25 + (0.15 - theta_weight)

    # Note: deltaEfficiency is reduced slightly (from 0.25 to 0.20)
    # since ROI-based reward now explicitly captures upside potential
    return (
        scores["breakevenHurdle"] * breakeven_weight +
        scores["deltaEfficiency"] * 0.20 +
        scores.get("dteScore", 50) * 0.20 +
        scores["liquidity"] * 0.20 +
        scores["thetaEfficiency"] * theta_weight
    )


def _scale_annualized_move_to_horizon(
    annualized_move: float,
    dte: int,
) -> float:
    """
    Scale annualized move to the actual time horizon using compound growth.

    For LEAPS with long DTEs, annualized assumptions must be scaled:
    - compound growth: (1 + annual_move)^years - 1

    Args:
        annualized_move: Annualized move as decimal (0.10 = 10%)
        dte: Days to expiration

    Returns:
        Horizon-scaled move as decimal
    """
    t_years = dte / 365.0
    return (1 + annualized_move) ** t_years - 1


def _calculate_reward_scores(
    candidate: StrategyCandidate,
    spot_price: float,
    assumptions: SimulationAssumption,
    is_bullish: bool = True,
) -> Dict[str, Any]:
    """
    Calculate ROI-based reward scores under assumption scenarios.

    This is the "reward" component of the two-stage scoring system.
    Explicitly answers: "How much can I make on capital under plausible moves?"

    Move Scaling (CRITICAL for LEAPS):
    - Assumptions contain ANNUALIZED moves (e.g., 10% annual vol)
    - For LEAPS, these must be scaled using compound growth:
      horizon_move = (1 + annual_move)^years - 1

    Probability-Weighted Scoring:
    - If stressProb is provided, uses EV-style weighting:
      reward = (1 - stressProb) * expected_score + stressProb * stress_score
    - Otherwise falls back to fixed 70/30 weighting

    Args:
        candidate: Strategy candidate (with legs for multi-leg P&L calc)
        spot_price: Current underlying price
        assumptions: Simulation assumptions with expected/stress moves (ANNUALIZED)
        is_bullish: Direction (True = calls, False = puts)

    Returns:
        Dict with roiExpectedScore, roiStressScore, rewardScore, raw ROI %, and scaling info
    """
    # Get DTE from candidate's first leg
    dte = candidate["legs"][0]["contract"]["dte"] if candidate["legs"] else MIN_DTE_LEAPS

    # Get annualized moves from assumptions
    annualized_expected = assumptions["expectedMovePct"]
    annualized_stress = assumptions["stressMovePct"]

    # Scale to horizon for LEAPS using compound growth
    if dte >= MIN_DTE_LEAPS:
        expected_move = _scale_annualized_move_to_horizon(annualized_expected, dte)
        stress_move = _scale_annualized_move_to_horizon(annualized_stress, dte)
    else:
        # Short-dated: assume moves are already horizon-level
        expected_move = annualized_expected
        stress_move = annualized_stress

    # Calculate target prices based on direction
    if is_bullish:
        expected_price = spot_price * (1 + expected_move)
        stress_price = spot_price * (1 + stress_move)
    else:
        expected_price = spot_price * (1 - expected_move)
        stress_price = spot_price * (1 - stress_move)

    # Use shared multi-leg ROI calculation from simulation module
    roi_expected = calculate_roi_at_price(candidate, expected_price)
    roi_stress = calculate_roi_at_price(candidate, stress_price)

    # Map ROI to 0-100 scores using shared scoring function
    roi_expected_score = calculate_roi_score(roi_expected)
    roi_stress_score = calculate_roi_score(roi_stress)

    # Probability-weighted reward scoring
    stress_prob = assumptions.get("stressProb")
    if stress_prob is not None and 0 <= stress_prob <= 1:
        # EV-style weighting: (1 - p) * expected + p * stress
        reward_score = int((1 - stress_prob) * roi_expected_score + stress_prob * roi_stress_score)
    else:
        # Fallback: fixed 70/30 weighting (expected scenario more likely)
        reward_score = int(0.7 * roi_expected_score + 0.3 * roi_stress_score)

    return {
        "roiExpectedScore": roi_expected_score,
        "roiStressScore": roi_stress_score,
        "rewardScore": reward_score,
        "roiExpectedPct": round(roi_expected, 1),
        "roiStressPct": round(roi_stress, 1),
        # Transparency: show the actual scaled moves used
        "horizonExpectedMovePct": round(expected_move * 100, 1),
        "horizonStressMovePct": round(stress_move * 100, 1),
        "horizonYears": round(dte / 365.0, 2),
    }


def _generate_leaps_call_reasons(
    contract: OptionContract,
    spot_price: float,
    leverage: float,
    be_hurdle: float,
) -> List[str]:
    """Generate explanatory reasons for LEAPS call selection."""
    reasons = []

    # Breakeven insight
    if be_hurdle <= 0:
        reasons.append(f"ITM - already profitable above ${contract['strike']:.0f}")
    elif be_hurdle <= 5:
        reasons.append(f"Low {be_hurdle:.1f}% move to breakeven")
    elif be_hurdle <= 10:
        reasons.append(f"Moderate {be_hurdle:.1f}% move needed to breakeven")
    else:
        reasons.append(f"Needs {be_hurdle:.1f}% move to breakeven")

    # Time explanation
    dte = contract["dte"]
    if dte >= 365:
        reasons.append(f"{dte} DTE ({dte // 30} months) provides ample time")
    else:
        reasons.append(f"{dte} DTE allows time for thesis to play out")

    # Leverage explanation
    if leverage > 3:
        reasons.append(f"{leverage:.1f}x leverage vs owning shares")

    # Delta explanation
    delta = abs(contract["delta"])
    if delta >= 0.70:
        reasons.append(f"High delta ({delta:.2f}) for stock replacement")

    return reasons[:3]  # Limit to 3 reasons


def _generate_leaps_put_reasons(
    contract: OptionContract,
    spot_price: float,
    be_hurdle: float,
) -> List[str]:
    """Generate explanatory reasons for LEAPS put selection."""
    reasons = []

    # Breakeven insight (be_hurdle is negative for puts)
    if be_hurdle >= 0:
        reasons.append(f"ITM - profitable below ${contract['strike']:.0f}")
    elif be_hurdle >= -5:
        reasons.append(f"Low {abs(be_hurdle):.1f}% drop to breakeven")
    elif be_hurdle >= -10:
        reasons.append(f"Moderate {abs(be_hurdle):.1f}% drop needed to breakeven")
    else:
        reasons.append(f"Needs {abs(be_hurdle):.1f}% drop to breakeven")

    dte = contract["dte"]
    reasons.append(f"{dte} DTE ({dte // 30} months) for extended protection")

    delta = abs(contract["delta"])
    if delta >= 0.70:
        reasons.append(f"High delta ({delta:.2f}) for bearish exposure")
    else:
        reasons.append(f"Delta {delta:.2f} offers downside protection")

    return reasons[:3]


def _generate_leaps_risks(contract: OptionContract, premium_usd: float) -> List[str]:
    """Generate comprehensive risk warnings for LEAPS position."""
    return assess_leaps_risks(
        delta=contract["delta"],
        theta=contract["theta"],
        vega=contract.get("vega", 0),
        iv=contract["iv"],
        dte=contract["dte"],
        premium_usd=premium_usd,
        open_interest=contract["openInterest"],
        bid=contract["bid"],
        ask=contract["ask"],
    )
