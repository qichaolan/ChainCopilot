"""
Strategy Simulation Tools.

Simulates P&L scenarios and payoff curves for strategy candidates.

Key design principle: All assumptions are explicit and visible in output.
Price move scenarios are dynamically generated based on time horizon,
not hardcoded static values.
"""

from __future__ import annotations

from typing import List, Dict, Optional
import math

import os
import sys

# Add paths for imports
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, AGENT_DIR)

from types_ import (
    StrategyCandidate,
    SimulationResult,
    SimulationAssumption,
    HorizonType,
)


# ============================================================================
# Default Movement Assumptions by Time Horizon
# ============================================================================
# These are reasonable defaults based on historical equity volatility.
# Expected move ≈ 1 standard deviation move for the period
# Stress move ≈ 2 standard deviation move (tail risk scenario)

DEFAULT_ASSUMPTIONS: Dict[HorizonType, Dict[str, float]] = {
    "intraweek": {      # 0-7 days
        "expected": 0.03,   # ±3%
        "stress": 0.06,     # ±6%
    },
    "weekly": {         # 7-30 days
        "expected": 0.08,   # ±8%
        "stress": 0.15,     # ±15%
    },
    "monthly": {        # 30-90 days
        "expected": 0.12,   # ±12%
        "stress": 0.22,     # ±22%
    },
    "quarterly": {      # 90-180 days
        "expected": 0.18,   # ±18%
        "stress": 0.32,     # ±32%
    },
    "leaps": {          # 180-730+ days
        "expected": 0.30,   # ±30%
        "stress": 0.50,     # ±50%
    },
}

# Default annual growth rate assumption for LEAPS
# Based on historical S&P 500 average returns (~8-10% nominal)
# This is a starting point; user can override based on their thesis
DEFAULT_ANNUAL_GROWTH_PCT = 0.08  # 8% annual growth assumption


# ============================================================================
# Horizon Detection
# ============================================================================

def detect_horizon_type(dte: int) -> HorizonType:
    """
    Map days-to-expiration to a horizon category.

    Args:
        dte: Days to expiration

    Returns:
        HorizonType category
    """
    if dte <= 7:
        return "intraweek"
    elif dte <= 30:
        return "weekly"
    elif dte <= 90:
        return "monthly"
    elif dte <= 180:
        return "quarterly"
    else:
        return "leaps"


def get_candidate_dte(candidate: StrategyCandidate) -> int:
    """Extract DTE from candidate's first leg."""
    if candidate["legs"]:
        return candidate["legs"][0]["contract"].get("dte", 30)
    return 30  # Default fallback


# ============================================================================
# Growth Rate Helpers
# ============================================================================

def compute_projected_price(
    spot_price: float,
    dte: int,
    annual_growth_pct: float,
) -> float:
    """
    Compute projected price at expiry using compound growth.

    Formula: spot * (1 + annual_growth)^(dte/365)

    Args:
        spot_price: Current underlying price
        dte: Days to expiration
        annual_growth_pct: Annual growth rate as decimal (0.08 = 8%)

    Returns:
        Projected price at expiration
    """
    years = dte / 365
    return spot_price * ((1 + annual_growth_pct) ** years)


def compute_annualized_growth(
    spot_price: float,
    target_price: float,
    dte: int,
) -> float:
    """
    Back-compute annual growth rate from a target price.

    Useful when user provides a price target.

    Args:
        spot_price: Current underlying price
        target_price: User's price target at expiration
        dte: Days to expiration

    Returns:
        Implied annual growth rate as decimal
    """
    if spot_price <= 0 or target_price <= 0 or dte <= 0:
        return 0.0
    years = dte / 365
    return (target_price / spot_price) ** (1 / years) - 1


# ============================================================================
# Assumption Building
# ============================================================================

def build_assumptions(
    dte: int,
    custom_moves: Optional[List[float]] = None,
    custom_expected: Optional[float] = None,
    custom_stress: Optional[float] = None,
    spot_price: Optional[float] = None,
    custom_annual_growth: Optional[float] = None,
) -> SimulationAssumption:
    """
    Build simulation assumptions based on time horizon.

    Args:
        dte: Days to expiration
        custom_moves: User-provided custom price moves (overrides defaults)
        custom_expected: User-provided expected move %
        custom_stress: User-provided stress move %
        spot_price: Current underlying price (required for growth projection)
        custom_annual_growth: User-provided annual growth assumption

    Returns:
        SimulationAssumption with all parameters explicit
    """
    horizon = detect_horizon_type(dte)
    defaults = DEFAULT_ASSUMPTIONS[horizon]

    # Determine source
    if custom_moves:
        source = "user"
    elif custom_expected is not None or custom_stress is not None:
        source = "user"
    elif custom_annual_growth is not None:
        source = "user"
    else:
        source = "default"

    # Use custom values if provided, otherwise defaults
    expected_move = custom_expected if custom_expected is not None else defaults["expected"]
    stress_move = custom_stress if custom_stress is not None else defaults["stress"]

    # Compute annual growth and projected price for LEAPS
    annual_growth: Optional[float] = None
    projected_price: Optional[float] = None

    if horizon == "leaps":
        # Use custom growth if provided, otherwise default
        annual_growth = custom_annual_growth if custom_annual_growth is not None else DEFAULT_ANNUAL_GROWTH_PCT
        # Compute projected price if spot is available
        if spot_price is not None and spot_price > 0:
            projected_price = round(compute_projected_price(spot_price, dte, annual_growth), 2)

    return {
        "horizonType": horizon,
        "timeHorizonDays": dte,
        "expectedMovePct": expected_move,
        "stressMovePct": stress_move,
        "customMoves": custom_moves,
        "source": source,
        "annualGrowthPct": annual_growth,
        "projectedPriceAtExpiry": projected_price,
    }


def build_iv_based_assumptions(
    dte: int,
    avg_iv: float,
    spot_price: Optional[float] = None,
    custom_annual_growth: Optional[float] = None,
) -> SimulationAssumption:
    """
    Build assumptions using implied volatility.

    Uses IV to calculate expected move: IV * sqrt(DTE/365)
    This is more accurate than static defaults for IV-rich products.

    Args:
        dte: Days to expiration
        avg_iv: Average implied volatility (as decimal, e.g., 0.30 = 30%)
        spot_price: Current underlying price (for growth projection)
        custom_annual_growth: User-provided annual growth assumption

    Returns:
        SimulationAssumption calibrated to implied vol
    """
    horizon = detect_horizon_type(dte)

    # Expected move = IV * sqrt(DTE/365)
    # This is the 1-sigma move implied by options pricing
    expected_move = avg_iv * math.sqrt(dte / 365)

    # Stress move = ~2 sigma
    stress_move = expected_move * 1.8

    # Cap at reasonable bounds
    expected_move = min(expected_move, 0.50)
    stress_move = min(stress_move, 0.80)

    # Compute annual growth and projected price for LEAPS
    annual_growth: Optional[float] = None
    projected_price: Optional[float] = None

    if horizon == "leaps":
        annual_growth = custom_annual_growth if custom_annual_growth is not None else DEFAULT_ANNUAL_GROWTH_PCT
        if spot_price is not None and spot_price > 0:
            projected_price = round(compute_projected_price(spot_price, dte, annual_growth), 2)

    return {
        "horizonType": horizon,
        "timeHorizonDays": dte,
        "expectedMovePct": round(expected_move, 3),
        "stressMovePct": round(stress_move, 3),
        "customMoves": None,
        "source": "implied_vol",
        "annualGrowthPct": annual_growth,
        "projectedPriceAtExpiry": projected_price,
    }


# ============================================================================
# Scenario Generation
# ============================================================================

def generate_scenario_moves(
    assumptions: SimulationAssumption,
    horizon_move: Optional[float] = None,
    is_leaps: bool = False,
) -> List[float]:
    """
    Generate price move percentages from assumptions.

    For LEAPS: Use horizon_move ± 20pp (e.g., if horizon=24%, show 4%, 14%, 24%, 34%, 44%)
    For other strategies: Use symmetric ladder around zero.

    Args:
        assumptions: SimulationAssumption object
        horizon_move: Expected horizon move for LEAPS (decimal, e.g., 0.24 = 24%)
        is_leaps: Whether this is a LEAPS strategy

    Returns:
        List of price move percentages as decimals
    """
    # Use custom moves if provided
    if assumptions.get("customMoves"):
        return sorted(assumptions["customMoves"])

    # For LEAPS: use horizon_move ± 20pp
    if is_leaps and horizon_move is not None:
        return [
            horizon_move - 0.20,
            horizon_move - 0.10,
            horizon_move,  # expected
            horizon_move + 0.10,
            horizon_move + 0.20,
        ]

    expected = assumptions["expectedMovePct"]
    stress = assumptions["stressMovePct"]

    # Build symmetric ladder around zero
    moves = [
        -stress,
        -expected,
        -expected / 2,
        0,
        expected / 2,
        expected,
        stress,
    ]

    return moves


# ============================================================================
# Main Simulation Functions
# ============================================================================

def simulate_candidates(
    candidates: List[StrategyCandidate],
    spot_price: float,
    custom_moves: Optional[List[float]] = None,
    use_iv_assumptions: bool = False,
    expected_move_pct: Optional[float] = None,
) -> List[SimulationResult]:
    """
    Simulate P&L scenarios for selected candidates.

    Args:
        candidates: List of strategy candidates to simulate
        spot_price: Current underlying price
        custom_moves: Optional custom price moves (overrides auto-detection)
        use_iv_assumptions: If True, use IV to calculate expected moves
        expected_move_pct: AI-determined expected move (annual) for LEAPS horizon scenarios

    Returns:
        List of simulation results with scenarios, payoff curves, and visible assumptions
    """
    results: List[SimulationResult] = []

    for candidate in candidates:
        dte = get_candidate_dte(candidate)
        is_leaps = candidate.get("strategyType") == "leaps"

        # Build assumptions for this candidate
        if use_iv_assumptions and candidate["legs"]:
            # Average IV across legs
            ivs = [leg["contract"].get("iv", 0.25) for leg in candidate["legs"]]
            avg_iv = sum(ivs) / len(ivs) if ivs else 0.25
            assumptions = build_iv_based_assumptions(dte, avg_iv, spot_price=spot_price)
        else:
            assumptions = build_assumptions(dte, custom_moves=custom_moves, spot_price=spot_price)

        # For LEAPS: calculate horizon move and use horizon ± 20pp scenarios
        horizon_move = None
        if is_leaps and expected_move_pct is not None:
            t_years = dte / 365
            horizon_move = expected_move_pct * math.sqrt(t_years)

        # Generate scenario moves - use horizon-based for LEAPS
        moves = generate_scenario_moves(assumptions, horizon_move=horizon_move, is_leaps=is_leaps)

        # Calculate all components with custom scenario labels for LEAPS
        if is_leaps and horizon_move is not None:
            scenarios = _calculate_leaps_scenarios(candidate, spot_price, moves, horizon_move)
        else:
            scenarios = _calculate_scenarios(candidate, spot_price, moves)

        payoff_curve = _calculate_payoff_curve(candidate, spot_price, assumptions)
        theta_decay = _calculate_theta_decay(candidate)

        result: SimulationResult = {
            "candidateId": candidate["id"],
            "candidate": candidate,
            "scenarios": scenarios,
            "thetaDecay": theta_decay,
            "payoffCurve": payoff_curve,
            "assumptions": assumptions,  # Always include for transparency
        }
        results.append(result)

    return results


def simulate_candidate_with_assumptions(
    candidate: StrategyCandidate,
    spot_price: float,
    assumptions: SimulationAssumption,
) -> SimulationResult:
    """
    Simulate a single candidate with explicit assumptions.

    Use this when you want full control over assumptions.

    Args:
        candidate: Strategy candidate to simulate
        spot_price: Current underlying price
        assumptions: Explicit assumptions to use

    Returns:
        SimulationResult with provided assumptions
    """
    moves = generate_scenario_moves(assumptions)
    scenarios = _calculate_scenarios(candidate, spot_price, moves)
    payoff_curve = _calculate_payoff_curve(candidate, spot_price, assumptions)
    theta_decay = _calculate_theta_decay(candidate)

    return {
        "candidateId": candidate["id"],
        "candidate": candidate,
        "scenarios": scenarios,
        "thetaDecay": theta_decay,
        "payoffCurve": payoff_curve,
        "assumptions": assumptions,
    }


# ============================================================================
# Internal Calculation Functions
# ============================================================================

def _calculate_scenarios(
    candidate: StrategyCandidate,
    spot_price: float,
    moves: List[float],
) -> List[Dict]:
    """Calculate P&L scenarios for different price moves."""
    scenarios = []

    for move in moves:
        price = spot_price * (1 + move)
        pnl = _calculate_pnl_at_price(candidate, price)
        roi = _calculate_roi(pnl, candidate["netPremium"])

        scenarios.append({
            "priceMove": f"{'+' if move >= 0 else ''}{int(move * 100)}%",
            "price": round(price, 2),
            "pnl": round(pnl, 2),
            "roi": round(roi, 1),
        })

    return scenarios


def _calculate_leaps_scenarios(
    candidate: StrategyCandidate,
    spot_price: float,
    moves: List[float],
    horizon_move: float,
) -> List[Dict]:
    """
    Calculate P&L scenarios for LEAPS with horizon-based labels.

    Labels show "(expected)" for the horizon move scenario.
    E.g., if horizon=24%, scenarios are: +4%, +14%, +24% (expected), +34%, +44%
    """
    scenarios = []

    for move in moves:
        price = spot_price * (1 + move)
        pnl = _calculate_pnl_at_price(candidate, price)
        roi = _calculate_roi(pnl, candidate["netPremium"])

        # Check if this is the expected horizon move (within 0.001 tolerance)
        is_expected = abs(move - horizon_move) < 0.001
        move_label = f"+{int(move * 100)}% (expected)" if is_expected else f"{'+' if move >= 0 else ''}{int(move * 100)}%"

        scenarios.append({
            "priceMove": move_label,
            "price": round(price, 2),
            "pnl": round(pnl, 2),
            "roi": round(roi, 1),
        })

    return scenarios


def _calculate_pnl_at_price(
    candidate: StrategyCandidate,
    target_price: float,
) -> float:
    """Calculate P&L at a specific underlying price at expiration."""
    pnl = -candidate["netPremium"]

    for leg in candidate["legs"]:
        contract = leg["contract"]
        qty = leg["quantity"]

        # Calculate intrinsic value at expiration
        if contract["optionType"] == "call":
            leg_value = max(0, target_price - contract["strike"]) * 100 * qty
        else:
            leg_value = max(0, contract["strike"] - target_price) * 100 * qty

        # Buy legs add value, sell legs subtract value
        if leg["action"] == "buy":
            pnl += leg_value
        else:
            pnl -= leg_value

    return pnl


def _calculate_roi(pnl: float, net_premium: float) -> float:
    """Calculate return on investment percentage."""
    if net_premium == 0:
        return 0.0
    return (pnl / abs(net_premium)) * 100


# ============================================================================
# ROI-Based Reward Scoring (for LEAPS)
# ============================================================================

def calculate_roi_at_price(
    candidate: StrategyCandidate,
    target_price: float,
) -> float:
    """
    Calculate ROI % at a specific target price.

    Public wrapper for use in strategy scoring.

    Args:
        candidate: Strategy candidate
        target_price: Target underlying price at expiration

    Returns:
        ROI percentage (e.g., 50.0 = 50% return)
    """
    pnl = _calculate_pnl_at_price(candidate, target_price)
    return _calculate_roi(pnl, candidate["netPremium"])


def calculate_roi_score(roi_pct: float) -> int:
    """
    Map ROI percentage to a 0-100 score.

    Uses piecewise mapping to prevent lottery strikes from dominating:
    - -100% → 0
    - -50% → 17
    - 0% → 33
    - +50% → 50
    - +100% → 67
    - +200% → 83
    - +300%+ → 100 (capped)

    Args:
        roi_pct: ROI percentage (e.g., 50.0 = 50%)

    Returns:
        Score 0-100
    """
    # Clamp extreme values
    roi_pct = max(-100, min(300, roi_pct))

    # Map -100 to +300 range to 0-100 score
    # Using formula: score = (roi + 100) / 4
    score = (roi_pct + 100) / 4
    return int(max(0, min(100, score)))


def calculate_reward_score(
    candidate: StrategyCandidate,
    spot_price: float,
    expected_move_pct: float,
    stress_move_pct: float,
    is_bullish: bool = True,
) -> Dict[str, float]:
    """Calculate ROI-based reward scores for expected and stress scenarios."""
    sign = 1 if is_bullish else -1

    roi_exp = calculate_roi_at_price(candidate, spot_price * (1 + sign * expected_move_pct))
    roi_stress = calculate_roi_at_price(candidate, spot_price * (1 + sign * stress_move_pct))

    exp_score = calculate_roi_score(roi_exp)
    stress_score = calculate_roi_score(roi_stress)

    return {
        "roiExpectedScore": exp_score,
        "roiStressScore": stress_score,
        "rewardScore": int(0.7 * exp_score + 0.3 * stress_score),
        "roiExpectedPct": round(roi_exp, 1),
        "roiStressPct": round(roi_stress, 1),
    }


def _calculate_payoff_curve(
    candidate: StrategyCandidate,
    spot_price: float,
    assumptions: SimulationAssumption,
    num_points: int = 31,
) -> List[Dict[str, float]]:
    """
    Calculate payoff curve at expiration.

    Price range is tied to assumptions (stress move defines bounds).

    Args:
        candidate: Strategy candidate
        spot_price: Current underlying price
        assumptions: Simulation assumptions (used for range)
        num_points: Number of points on the curve

    Returns:
        List of price/pnl points for the payoff curve
    """
    # Use stress move to define curve range (with 10% buffer)
    price_range = assumptions["stressMovePct"] * 1.1

    payoff_curve = []

    min_price = spot_price * (1 - price_range)
    max_price = spot_price * (1 + price_range)
    step = (max_price - min_price) / (num_points - 1)

    for i in range(num_points):
        price = min_price + (i * step)
        pnl = _calculate_pnl_at_price(candidate, price)
        payoff_curve.append({
            "price": round(price, 2),
            "pnl": round(pnl, 2),
        })

    return payoff_curve


def _calculate_theta_decay(candidate: StrategyCandidate) -> Dict[str, float]:
    """Calculate theta decay estimates."""
    total_theta = sum(
        leg["contract"]["theta"] * (1 if leg["action"] == "buy" else -1)
        for leg in candidate["legs"]
    )

    # Theta is typically quoted as daily decay per share, multiply by 100 for contract
    return {
        "daily": round(total_theta * 100, 2),
        "weekly": round(total_theta * 100 * 7, 2),
        "monthly": round(total_theta * 100 * 30, 2),
    }


# ============================================================================
# Utility Functions
# ============================================================================

def format_assumptions_summary(assumptions: SimulationAssumption) -> str:
    """
    Format assumptions as a human-readable summary.

    Useful for displaying in UI or logs.
    """
    horizon = assumptions["horizonType"]
    dte = assumptions["timeHorizonDays"]
    expected = assumptions["expectedMovePct"] * 100
    stress = assumptions["stressMovePct"] * 100
    source = assumptions["source"]

    base = (
        f"Horizon: {horizon} ({dte} days) | "
        f"Expected: ±{expected:.0f}% | "
        f"Stress: ±{stress:.0f}% | "
        f"Source: {source}"
    )

    # Add growth projection for LEAPS
    annual_growth = assumptions.get("annualGrowthPct")
    projected_price = assumptions.get("projectedPriceAtExpiry")

    if annual_growth is not None:
        growth_info = f" | Growth: {annual_growth * 100:.0f}%/yr"
        if projected_price is not None:
            growth_info += f" → ${projected_price:.0f}"
        base += growth_info

    return base
