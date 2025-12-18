"""
Long Put Strategy Generator.

Generates long put candidates for bearish outlook.
"""

from __future__ import annotations

from typing import List, Dict

import os
import sys

# Add paths for imports
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, AGENT_DIR)

from types_ import OptionContract, StrategyCandidate
from tools.common import (
    calculate_liquidity_score,
    calculate_theta_efficiency,
    calculate_delta_efficiency,
    calculate_breakeven_score,
    calculate_breakeven_hurdle,
)
from tools.risk_assessment import assess_long_option_risks, TradingStyle


# ============================================================================
# Filtering Constants (can be overridden by user profile)
# ============================================================================
MIN_OPEN_INTEREST = 50
MIN_DELTA = 0.30
MAX_DELTA = 0.70


def generate_long_puts(
    contracts: List[OptionContract],
    budget: float,
    spot_price: float,
) -> List[StrategyCandidate]:
    """
    Generate long put candidates.

    Args:
        contracts: List of option contracts
        budget: Capital budget in dollars
        spot_price: Current underlying price

    Returns:
        List of ranked long put candidates
    """
    # Filter puts that meet criteria
    puts = [
        c for c in contracts
        if c["optionType"] == "put"
        and c["mark"] > 0
        and c["mark"] * 100 <= budget
        and c["openInterest"] >= MIN_OPEN_INTEREST
        and MIN_DELTA <= abs(c["delta"]) <= MAX_DELTA
    ]

    candidates: List[StrategyCandidate] = []

    for idx, c in enumerate(puts):
        candidate = _build_long_put_candidate(c, idx, spot_price)
        candidates.append(candidate)

    # Sort by overall score descending, return top 10
    candidates = sorted(candidates, key=lambda c: c["overallScore"], reverse=True)[:10]

    return candidates


def _build_long_put_candidate(
    contract: OptionContract,
    idx: int,
    spot_price: float,
) -> StrategyCandidate:
    """Build a single long put candidate from a contract."""
    # Explicit naming for clarity
    mark_price = contract["mark"]
    strike_price = contract["strike"]
    premium_usd = mark_price * 100  # Cost per contract in dollars
    breakeven_price = strike_price - mark_price
    max_profit_usd = breakeven_price * 100  # Max profit if stock goes to 0

    # Delta as ITM proxy (NOT probability of profit)
    # Under risk-neutral assumptions, |delta| ≈ P(ITM at expiration)
    prob_itm_proxy = int(abs(contract["delta"]) * 100)

    # Calculate scores using proper metrics
    scores = _calculate_long_put_scores(contract, breakeven_price, spot_price)
    overall = round(_calculate_overall_score(scores), 1)

    # Calculate breakeven hurdle for display
    be_hurdle = calculate_breakeven_hurdle(breakeven_price, spot_price, is_call=False)

    candidate: StrategyCandidate = {
        "id": f"long-put-{idx}-{contract['contractSymbol']}",
        "strategyType": "long_put",
        "legs": [{"contract": contract, "action": "buy", "quantity": 1}],
        "maxLoss": -premium_usd,
        "maxProfit": max_profit_usd,
        "breakeven": breakeven_price,
        "probITMProxy": prob_itm_proxy,
        "netDelta": contract["delta"],
        "netTheta": contract["theta"],
        "netVega": contract["vega"],
        "netPremium": premium_usd,
        "scores": scores,
        "overallScore": overall,
        "why": _generate_reasons(contract, be_hurdle),
        "risks": _generate_risks(contract, premium_usd, spot_price),
    }

    return candidate


def _calculate_long_put_scores(
    contract: OptionContract,
    breakeven_price: float,
    spot_price: float,
) -> Dict[str, int]:
    """
    Calculate scores for long put candidate.

    Metrics:
    - breakevenHurdle: How far stock needs to drop to break even (lower = better)
    - thetaEfficiency: Daily decay per dollar of premium (lower = better)
    - deltaEfficiency: Delta exposure per dollar (higher = better)
    - liquidity: OI + bid-ask spread quality
    """
    return {
        "breakevenHurdle": calculate_breakeven_score(breakeven_price, spot_price, is_call=False),
        "thetaEfficiency": calculate_theta_efficiency(contract["theta"], contract["mark"]),
        "deltaEfficiency": calculate_delta_efficiency(contract["delta"], contract["mark"]),
        "liquidity": calculate_liquidity_score(
            contract["openInterest"],
            contract["bid"],
            contract["ask"]
        ),
    }


def _calculate_overall_score(scores: Dict[str, int]) -> float:
    """
    Calculate weighted overall score.

    Weights:
    - Breakeven Hurdle: 30% (most important - how much does stock need to drop?)
    - Delta Efficiency: 25% (directional bang for buck)
    - Theta Efficiency: 25% (time decay cost)
    - Liquidity: 20% (execution quality)
    """
    return (
        scores["breakevenHurdle"] * 0.30 +
        scores["deltaEfficiency"] * 0.25 +
        scores["thetaEfficiency"] * 0.25 +
        scores["liquidity"] * 0.20
    )


def _generate_reasons(
    contract: OptionContract,
    be_hurdle: float,
) -> List[str]:
    """Generate explanatory reasons for candidate selection."""
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

    # Delta insight
    delta = abs(contract["delta"])
    if delta >= 0.6:
        reasons.append(f"High delta ({delta:.2f}) - strong downside exposure")
    elif delta >= 0.5:
        reasons.append(f"ATM delta ({delta:.2f}) - balanced risk/reward")
    else:
        reasons.append(f"OTM delta ({delta:.2f}) - leveraged downside")

    # Strike protection
    reasons.append(f"Strike ${contract['strike']:.0f} provides protection level")

    return reasons[:3]


def _generate_risks(
    contract: OptionContract,
    premium_usd: float,
    spot_price: float,
    trading_style: TradingStyle = TradingStyle.SWING,
) -> List[str]:
    """Generate comprehensive risk warnings for candidate."""
    return assess_long_option_risks(
        delta=contract["delta"],
        gamma=contract.get("gamma", 0),
        theta=contract["theta"],
        vega=contract.get("vega", 0),
        iv=contract["iv"],
        dte=contract["dte"],
        premium_usd=premium_usd,
        spot_price=spot_price,
        open_interest=contract["openInterest"],
        volume=contract.get("volume", 0),
        bid=contract["bid"],
        ask=contract["ask"],
        trading_style=trading_style,
    )
