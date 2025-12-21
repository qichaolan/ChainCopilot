"""
LEAPS Simulation Engine.

Clean, deterministic simulation for LEAPS options.

Core Principles:
1. Expected Move ≠ Volatility - it's a baseline growth assumption
2. Scenarios are relative to projected price, not spot
3. All numbers are reproducible - no Monte Carlo, no probability guessing
4. No IV unless explicitly passed

All math is standard options P&L - no magic.
"""

from __future__ import annotations

from typing import List, Dict, Optional, TypedDict
import os
import sys

# Add paths for imports
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, AGENT_DIR)

from types_ import StrategyCandidate


# ============================================================================
# Fixed Scenario Deltas (UX-driven, deviation from projected price)
# ============================================================================

# Grid cards: 6 scenarios (deviation from projected price)
# UI shows: -15%, -10%, 0% (expected), +5%, +10%, +20%
GRID_DELTAS = [-0.15, -0.10, 0.0, 0.05, 0.10, 0.20]

# Bar chart: 9 scenarios (deviation from projected price)
# UI shows: -15%, -10%, -5%, 0%, +5%, +10%, +15%, +20%, +25%
BAR_DELTAS = [-0.15, -0.10, -0.05, 0.0, 0.05, 0.10, 0.15, 0.20, 0.25]

# ============================================================================
# Type Definitions
# ============================================================================

class ScenarioResult(TypedDict):
    """A single scenario result."""
    label: str       # e.g., "+15%", "0% (expected)"
    price: float     # Underlying price at this scenario
    pnl: float       # P&L in dollars
    roi: float       # ROI as percentage


class LeapsSimulationResult(TypedDict):
    """Complete simulation result for a LEAPS candidate."""
    candidateId: str
    candidate: StrategyCandidate

    # Core projection
    projectedPrice: float      # spot * (1 + horizon_move)
    horizonMovePct: float      # (1 + expected_move)^years - 1

    # Scenarios
    gridScenarios: List[ScenarioResult]   # 5 cards
    barScenarios: List[ScenarioResult]    # 9 bars

    # Summary metrics
    summary: Dict[str, float]

    # Payoff curve for charting
    payoffCurve: List[Dict[str, float]]

    # Theta decay
    thetaDecay: Dict[str, float]


# ============================================================================
# Step 1: Time Normalization
# ============================================================================

def _get_years(dte: int) -> float:
    """Convert DTE to years."""
    return dte / 365.0


# ============================================================================
# Step 2: Compute Projected Price (Center Line)
# ============================================================================

def compute_horizon_move(expected_move: float, dte: int) -> float:
    """
    Compute horizon move using compound growth.

    horizon_move = (1 + expected_move)^years - 1

    Args:
        expected_move: Expected annualized move (decimal, e.g., 0.10 = 10%)
        dte: Days to expiration

    Returns:
        Horizon move as decimal
    """
    years = _get_years(dte)
    return (1 + expected_move) ** years - 1


def compute_projected_price(spot_price: float, expected_move: float, dte: int) -> float:
    """
    Compute projected price at expiry.

    projected_price = spot_price * (1 + horizon_move)

    This is the anchor for all scenarios.
    """
    horizon_move = compute_horizon_move(expected_move, dte)
    return spot_price * (1 + horizon_move)


# ============================================================================
# Step 3-4: Convert Deltas to Absolute Prices
# ============================================================================

def _delta_to_scenario(
    delta: float,
    projected_price: float,
    spot_price: float,
) -> Dict[str, float]:
    """
    Convert a delta (deviation from projected) to scenario price and move.

    scenario_price = projected_price * (1 + delta)
    scenario_move = (scenario_price / spot_price) - 1
    """
    scenario_price = projected_price * (1 + delta)
    scenario_move = (scenario_price / spot_price) - 1
    return {
        "delta": delta,
        "price": scenario_price,
        "move": scenario_move,
    }


# ============================================================================
# Step 5: P&L Calculation
# ============================================================================

def calculate_pnl_long_call(
    scenario_price: float,
    strike: float,
    premium: float,
) -> float:
    """
    Calculate P&L for a long call at expiration.

    intrinsic = max(0, scenario_price - strike) * 100
    pnl = intrinsic - premium
    """
    intrinsic = max(0, scenario_price - strike) * 100
    return intrinsic - premium


def calculate_pnl_long_put(
    scenario_price: float,
    strike: float,
    premium: float,
) -> float:
    """
    Calculate P&L for a long put at expiration.

    intrinsic = max(0, strike - scenario_price) * 100
    pnl = intrinsic - premium
    """
    intrinsic = max(0, strike - scenario_price) * 100
    return intrinsic - premium


def calculate_pnl_at_price(
    candidate: StrategyCandidate,
    target_price: float,
) -> float:
    """
    Calculate P&L for any strategy at a specific price.

    Handles multi-leg strategies correctly.
    """
    pnl = -candidate["netPremium"]

    for leg in candidate["legs"]:
        contract = leg["contract"]
        qty = leg["quantity"]

        if contract["optionType"] == "call":
            leg_value = max(0, target_price - contract["strike"]) * 100 * qty
        else:
            leg_value = max(0, contract["strike"] - target_price) * 100 * qty

        if leg["action"] == "buy":
            pnl += leg_value
        else:
            pnl -= leg_value

    return pnl


def calculate_roi(pnl: float, premium: float) -> float:
    """ROI % = pnl / premium * 100"""
    if premium == 0:
        return 0.0
    return (pnl / abs(premium)) * 100


# ============================================================================
# Step 6-7: Summary Metrics
# ============================================================================

def calculate_breakeven(strike: float, premium: float, is_call: bool = True) -> float:
    """
    Standard breakeven calculation.

    Call: strike + (premium / 100)
    Put: strike - (premium / 100)
    """
    premium_per_share = premium / 100
    if is_call:
        return strike + premium_per_share
    else:
        return strike - premium_per_share


def calculate_breakeven_pct(breakeven: float, spot_price: float) -> float:
    """Breakeven as % move from spot."""
    return (breakeven / spot_price) - 1


# ============================================================================
# Step 9: Theta Decay
# ============================================================================

def calculate_theta_decay(candidate: StrategyCandidate) -> Dict[str, float]:
    """
    Calculate theta decay from contract data.

    daily_theta = abs(theta) * 100
    """
    total_theta = sum(
        leg["contract"]["theta"] * (1 if leg["action"] == "buy" else -1)
        for leg in candidate["legs"]
    )

    daily = abs(total_theta) * 100

    return {
        "daily": round(daily, 2),
        "weekly": round(daily * 7, 2),
        "monthly": round(daily * 30, 2),
    }


# ============================================================================
# Main Simulation Function
# ============================================================================

def simulate_leaps(
    candidate: StrategyCandidate,
    spot_price: float,
    expected_move: float,
) -> LeapsSimulationResult:
    """
    Simulate a LEAPS candidate with clean, deterministic math.

    Args:
        candidate: LEAPS strategy candidate
        spot_price: Current underlying price
        expected_move: Expected annualized move (decimal, e.g., 0.10 = 10%)

    Returns:
        Complete simulation result with all scenarios and metrics
    """
    # Extract contract details
    leg = candidate["legs"][0]
    contract = leg["contract"]
    strike = contract["strike"]
    dte = contract["dte"]
    is_call = contract["optionType"] == "call"
    premium = candidate["netPremium"]

    # Step 1-2: Compute horizon move and projected price
    horizon_move = compute_horizon_move(expected_move, dte)
    projected_price = spot_price * (1 + horizon_move)

    # Step 3-5: Generate grid scenarios
    grid_scenarios: List[ScenarioResult] = []
    for delta in GRID_DELTAS:
        scenario = _delta_to_scenario(delta, projected_price, spot_price)
        pnl = calculate_pnl_at_price(candidate, scenario["price"])
        roi = calculate_roi(pnl, premium)

        # Label: delta as %, with "(expected)" at 0
        if abs(delta) < 0.001:
            label = "0% (expected)"
        else:
            label = f"{'+' if delta >= 0 else ''}{int(delta * 100)}%"

        grid_scenarios.append({
            "label": label,
            "price": round(scenario["price"], 2),
            "pnl": round(pnl, 2),
            "roi": round(roi, 1),
        })

    # Generate bar scenarios (same engine, different deltas)
    bar_scenarios: List[ScenarioResult] = []
    for delta in BAR_DELTAS:
        scenario = _delta_to_scenario(delta, projected_price, spot_price)
        pnl = calculate_pnl_at_price(candidate, scenario["price"])
        roi = calculate_roi(pnl, premium)

        if abs(delta) < 0.001:
            label = "0% (expected)"
        else:
            label = f"{'+' if delta >= 0 else ''}{int(delta * 100)}%"

        bar_scenarios.append({
            "label": label,
            "price": round(scenario["price"], 2),
            "pnl": round(pnl, 2),
            "roi": round(roi, 1),
        })

    # Step 6: Expected profit = P&L at projected price
    expected_profit = calculate_pnl_at_price(candidate, projected_price)

    # Step 7: Breakeven
    breakeven = calculate_breakeven(strike, premium, is_call)
    breakeven_pct = calculate_breakeven_pct(breakeven, spot_price)

    # Step 8: Max loss = premium (for long options)
    max_loss = premium

    # Step 9: Theta decay
    theta_decay = calculate_theta_decay(candidate)

    # Build payoff curve (for chart visualization)
    payoff_curve = _build_payoff_curve(candidate, spot_price, horizon_move)

    # Summary object
    summary = {
        "expectedProfit": round(expected_profit, 2),
        "expectedRoi": round(calculate_roi(expected_profit, premium), 1),
        "maxLoss": round(max_loss, 2),
        "breakevenPrice": round(breakeven, 2),
        "breakevenPct": round(breakeven_pct, 4),
        "dailyTheta": theta_decay["daily"],
    }

    return {
        "candidateId": candidate["id"],
        "candidate": candidate,
        "projectedPrice": round(projected_price, 2),
        "horizonMovePct": round(horizon_move, 4),
        "gridScenarios": grid_scenarios,
        "barScenarios": bar_scenarios,
        "summary": summary,
        "payoffCurve": payoff_curve,
        "thetaDecay": theta_decay,
    }


def simulate_leaps_candidates(
    candidates: List[StrategyCandidate],
    spot_price: float,
    expected_move: float,
) -> List[LeapsSimulationResult]:
    """
    Simulate multiple LEAPS candidates.

    Args:
        candidates: List of LEAPS candidates
        spot_price: Current underlying price
        expected_move: Expected annualized move (decimal)

    Returns:
        List of simulation results
    """
    return [
        simulate_leaps(candidate, spot_price, expected_move)
        for candidate in candidates
    ]


# ============================================================================
# Payoff Curve (for charting)
# ============================================================================

def _build_payoff_curve(
    candidate: StrategyCandidate,
    spot_price: float,
    horizon_move: float,
    num_points: int = 31,
) -> List[Dict[str, float]]:
    """
    Build payoff curve for visualization.

    Range: spot * (1 - 0.20) to spot * (1 + horizon_move * 1.5)
    """
    min_price = spot_price * 0.80
    max_price = spot_price * (1 + horizon_move * 1.5)

    if max_price <= min_price:
        max_price = spot_price * 1.50

    step = (max_price - min_price) / (num_points - 1)

    curve = []
    for i in range(num_points):
        price = min_price + (i * step)
        pnl = calculate_pnl_at_price(candidate, price)
        curve.append({
            "price": round(price, 2),
            "pnl": round(pnl, 2),
        })

    return curve


# ============================================================================
# Legacy Compatibility Layer
# ============================================================================
# These functions maintain backward compatibility with existing code.
# New code should use simulate_leaps() directly.

from types_ import SimulationResult, SimulationAssumption, HorizonType

DEFAULT_ANNUAL_GROWTH_PCT = 0.10

DEFAULT_ASSUMPTIONS: Dict[HorizonType, Dict[str, float]] = {
    "intraweek": {"expected": 0.03, "stress": 0.06},
    "weekly": {"expected": 0.05, "stress": 0.10},
    "monthly": {"expected": 0.08, "stress": 0.16},
    "quarterly": {"expected": 0.12, "stress": 0.24},
    "leaps": {"expected": 0.10, "stress": 0.20},
}


def detect_horizon_type(dte: int) -> HorizonType:
    """Map DTE to horizon category."""
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
    return 30


def build_assumptions(
    dte: int,
    custom_moves: Optional[List[float]] = None,
    custom_expected_move: Optional[float] = None,
    spot_price: Optional[float] = None,
) -> SimulationAssumption:
    """Build simulation assumptions based on time horizon."""
    horizon = detect_horizon_type(dte)
    defaults = DEFAULT_ASSUMPTIONS[horizon]

    if custom_expected_move is not None:
        expected_move = custom_expected_move
        stress_move = custom_expected_move * 2
    else:
        expected_move = defaults["expected"]
        stress_move = defaults["stress"]

    source = "user" if (custom_moves or custom_expected_move is not None) else "default"

    # Compute projected move
    years = dte / 365
    projected_move_pct = (1 + expected_move) ** years - 1

    projected_price = None
    if spot_price and spot_price > 0:
        projected_price = round(spot_price * (1 + projected_move_pct), 2)

    return {
        "horizonType": horizon,
        "timeHorizonDays": dte,
        "expectedMovePct": expected_move,
        "stressMovePct": stress_move,
        "customMoves": custom_moves,
        "source": source,
        "projectedMovePct": projected_move_pct,
        "projectedPriceAtExpiry": projected_price,
    }


def build_iv_based_assumptions(
    dte: int,
    avg_iv: float,
    spot_price: Optional[float] = None,
) -> SimulationAssumption:
    """Build assumptions using implied volatility."""
    import math
    horizon = detect_horizon_type(dte)

    expected_move = avg_iv * math.sqrt(dte / 365)
    stress_move = expected_move * 2

    expected_move = min(expected_move, 0.50)
    stress_move = min(stress_move, 1.00)

    years = dte / 365
    projected_move_pct = (1 + expected_move) ** years - 1

    projected_price = None
    if spot_price and spot_price > 0:
        projected_price = round(spot_price * (1 + projected_move_pct), 2)

    return {
        "horizonType": horizon,
        "timeHorizonDays": dte,
        "expectedMovePct": round(expected_move, 3),
        "stressMovePct": round(stress_move, 3),
        "customMoves": None,
        "source": "implied_vol",
        "projectedMovePct": round(projected_move_pct, 3) if projected_move_pct else None,
        "projectedPriceAtExpiry": projected_price,
    }


def simulate_candidates(
    candidates: List[StrategyCandidate],
    spot_price: float,
    custom_moves: Optional[List[float]] = None,
    use_iv_assumptions: bool = False,
    expected_move_pct: Optional[float] = None,
) -> List[SimulationResult]:
    """
    Simulate P&L scenarios for candidates.

    For LEAPS: Uses the new clean simulation engine.
    For others: Uses legacy symmetric scenario generation.
    """
    results: List[SimulationResult] = []

    for candidate in candidates:
        dte = get_candidate_dte(candidate)
        is_leaps = candidate.get("strategyType") == "leaps"

        if is_leaps:
            # Use new clean LEAPS simulation
            expected = expected_move_pct if expected_move_pct else 0.10
            leaps_result = simulate_leaps(candidate, spot_price, expected)

            # Convert to legacy format for backward compatibility
            assumptions = build_assumptions(dte, custom_expected_move=expected, spot_price=spot_price)

            # Map grid scenarios to legacy format
            scenarios = [
                {
                    "priceMove": s["label"],
                    "price": s["price"],
                    "pnl": s["pnl"],
                    "roi": s["roi"],
                }
                for s in leaps_result["gridScenarios"]
            ]

            scenarios_bars = [
                {
                    "priceMove": s["label"],
                    "price": s["price"],
                    "pnl": s["pnl"],
                    "roi": s["roi"],
                }
                for s in leaps_result["barScenarios"]
            ]

            result: SimulationResult = {
                "candidateId": candidate["id"],
                "candidate": candidate,
                "scenarios": scenarios,
                "scenariosBars": scenarios_bars,
                "thetaDecay": leaps_result["thetaDecay"],
                "payoffCurve": leaps_result["payoffCurve"],
                "assumptions": assumptions,
            }
            results.append(result)
        else:
            # Legacy path for non-LEAPS
            if use_iv_assumptions and candidate["legs"]:
                ivs = [leg["contract"].get("iv", 0.25) for leg in candidate["legs"]]
                avg_iv = sum(ivs) / len(ivs) if ivs else 0.25
                assumptions = build_iv_based_assumptions(dte, avg_iv, spot_price=spot_price)
            else:
                assumptions = build_assumptions(
                    dte,
                    custom_moves=custom_moves,
                    custom_expected_move=expected_move_pct,
                    spot_price=spot_price,
                )

            moves = _generate_legacy_moves(assumptions)
            scenarios = _calculate_legacy_scenarios(candidate, spot_price, moves)
            payoff_curve = _build_legacy_payoff_curve(candidate, spot_price, assumptions)
            theta_decay = calculate_theta_decay(candidate)

            result: SimulationResult = {
                "candidateId": candidate["id"],
                "candidate": candidate,
                "scenarios": scenarios,
                "thetaDecay": theta_decay,
                "payoffCurve": payoff_curve,
                "assumptions": assumptions,
            }
            results.append(result)

    return results


def _generate_legacy_moves(assumptions: SimulationAssumption) -> List[float]:
    """Generate symmetric moves around zero for non-LEAPS."""
    expected = assumptions["expectedMovePct"]
    stress = assumptions["stressMovePct"]

    return [
        -stress,
        -expected,
        -expected / 2,
        0,
        expected / 2,
        expected,
        stress,
    ]


def _calculate_legacy_scenarios(
    candidate: StrategyCandidate,
    spot_price: float,
    moves: List[float],
) -> List[Dict]:
    """Calculate scenarios for non-LEAPS strategies."""
    scenarios = []
    premium = candidate["netPremium"]

    for move in moves:
        price = spot_price * (1 + move)
        pnl = calculate_pnl_at_price(candidate, price)
        roi = calculate_roi(pnl, premium)

        scenarios.append({
            "priceMove": f"{'+' if move >= 0 else ''}{int(move * 100)}%",
            "price": round(price, 2),
            "pnl": round(pnl, 2),
            "roi": round(roi, 1),
        })

    return scenarios


def _build_legacy_payoff_curve(
    candidate: StrategyCandidate,
    spot_price: float,
    assumptions: SimulationAssumption,
    num_points: int = 31,
) -> List[Dict[str, float]]:
    """Build payoff curve for non-LEAPS."""
    price_range = assumptions["stressMovePct"] * 1.1

    min_price = spot_price * (1 - price_range)
    max_price = spot_price * (1 + price_range)
    step = (max_price - min_price) / (num_points - 1)

    curve = []
    for i in range(num_points):
        price = min_price + (i * step)
        pnl = calculate_pnl_at_price(candidate, price)
        curve.append({
            "price": round(price, 2),
            "pnl": round(pnl, 2),
        })

    return curve


def simulate_candidate_with_assumptions(
    candidate: StrategyCandidate,
    spot_price: float,
    assumptions: SimulationAssumption,
) -> SimulationResult:
    """Simulate a single candidate with explicit assumptions."""
    moves = _generate_legacy_moves(assumptions)
    scenarios = _calculate_legacy_scenarios(candidate, spot_price, moves)
    payoff_curve = _build_legacy_payoff_curve(candidate, spot_price, assumptions)
    theta_decay = calculate_theta_decay(candidate)

    return {
        "candidateId": candidate["id"],
        "candidate": candidate,
        "scenarios": scenarios,
        "thetaDecay": theta_decay,
        "payoffCurve": payoff_curve,
        "assumptions": assumptions,
    }


# ============================================================================
# Utility Exports (for backward compatibility)
# ============================================================================

def generate_scenario_moves(
    assumptions: SimulationAssumption,
    horizon_move: Optional[float] = None,
    is_leaps: bool = False,
    for_bar: bool = False,
) -> List[float]:
    """Generate scenario moves (legacy compatibility)."""
    if is_leaps and horizon_move is not None:
        deltas = BAR_DELTAS if for_bar else GRID_DELTAS
        return [(1 + horizon_move) * (1 + d) - 1 for d in deltas]
    return _generate_legacy_moves(assumptions)


def format_assumptions_summary(assumptions: SimulationAssumption) -> str:
    """Format assumptions as human-readable summary."""
    horizon = assumptions["horizonType"]
    dte = assumptions["timeHorizonDays"]
    expected = assumptions["expectedMovePct"] * 100
    source = assumptions["source"]

    base = f"Horizon: {horizon} ({dte} days) | Expected: {expected:.0f}% | Source: {source}"

    projected_move = assumptions.get("projectedMovePct")
    projected_price = assumptions.get("projectedPriceAtExpiry")

    if projected_move is not None:
        base += f" | Projected: +{projected_move * 100:.0f}%"
        if projected_price:
            base += f" → ${projected_price:.0f}"

    return base


def calculate_roi_at_price(
    candidate: StrategyCandidate,
    target_price: float,
) -> float:
    """Calculate ROI % at a specific target price."""
    pnl = calculate_pnl_at_price(candidate, target_price)
    return calculate_roi(pnl, candidate["netPremium"])


def calculate_roi_score(roi_pct: float) -> int:
    """Map ROI % to 0-100 score."""
    roi_pct = max(-100, min(300, roi_pct))
    return int(max(0, min(100, (roi_pct + 100) / 4)))


def calculate_reward_score(
    candidate: StrategyCandidate,
    spot_price: float,
    expected_move_pct: float,
    stress_move_pct: float,
    is_bullish: bool = True,
) -> Dict[str, float]:
    """Calculate ROI-based reward scores."""
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


def compute_annualized_growth(
    spot_price: float,
    target_price: float,
    dte: int,
) -> float:
    """Back-compute annual growth rate from a target price."""
    if spot_price <= 0 or target_price <= 0 or dte <= 0:
        return 0.0
    years = dte / 365
    return (target_price / spot_price) ** (1 / years) - 1
