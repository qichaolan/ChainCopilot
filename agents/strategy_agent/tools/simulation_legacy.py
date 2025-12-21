"""
Legacy Simulation Functions.

Backward compatibility layer for non-LEAPS strategies.
Import these explicitly when needed for non-LEAPS use cases.
"""

from __future__ import annotations

from typing import List, Dict, Optional
import math
import os
import sys

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, AGENT_DIR)

from types_ import StrategyCandidate, SimulationResult, SimulationAssumption, HorizonType


# ============================================================================
# Legacy Default Assumptions (for non-LEAPS strategies)
# ============================================================================

LEGACY_DEFAULT_ASSUMPTIONS: Dict[HorizonType, Dict[str, float]] = {
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
    defaults = LEGACY_DEFAULT_ASSUMPTIONS[horizon]

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


def generate_legacy_moves(assumptions: SimulationAssumption) -> List[float]:
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


def calculate_pnl_at_price(
    candidate: StrategyCandidate,
    target_price: float,
) -> float:
    """Calculate P&L at a specific underlying price at expiration."""
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


def calculate_legacy_scenarios(
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


def build_legacy_payoff_curve(
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


def calculate_theta_decay(candidate: StrategyCandidate) -> Dict[str, float]:
    """Calculate theta decay from contract data."""
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


def simulate_legacy_candidate(
    candidate: StrategyCandidate,
    spot_price: float,
    custom_moves: Optional[List[float]] = None,
    use_iv_assumptions: bool = False,
    expected_move_pct: Optional[float] = None,
) -> SimulationResult:
    """Simulate a non-LEAPS candidate."""
    dte = get_candidate_dte(candidate)

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

    moves = generate_legacy_moves(assumptions)
    scenarios = calculate_legacy_scenarios(candidate, spot_price, moves)
    payoff_curve = build_legacy_payoff_curve(candidate, spot_price, assumptions)
    theta_decay = calculate_theta_decay(candidate)

    return {
        "candidateId": candidate["id"],
        "candidate": candidate,
        "scenarios": scenarios,
        "thetaDecay": theta_decay,
        "payoffCurve": payoff_curve,
        "assumptions": assumptions,
    }


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
