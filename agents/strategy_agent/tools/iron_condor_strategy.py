"""
Iron Condor Strategy Generator.

Generates iron condor candidates for neutral outlook.
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
from tools.common import calculate_liquidity_score
from tools.risk_assessment import assess_iron_condor_risks


# ============================================================================
# Filtering Constants (can be overridden by user profile)
# ============================================================================
MIN_OPEN_INTEREST = 50
MIN_TOTAL_CREDIT = 0.20  # Minimum total credit to collect


def generate_iron_condors(
    contracts: List[OptionContract],
    budget: float,
    spot_price: float,
) -> List[StrategyCandidate]:
    """
    Generate iron condor candidates.

    Args:
        contracts: List of option contracts
        budget: Capital budget in dollars
        spot_price: Current underlying price

    Returns:
        List of iron condor candidates (usually just one optimal one)
    """
    # Sort calls and puts by strike
    calls = sorted(
        [
            c for c in contracts
            if c["optionType"] == "call"
            and c["mark"] > 0
            and c["openInterest"] >= MIN_OPEN_INTEREST
        ],
        key=lambda x: x["strike"]
    )

    puts = sorted(
        [
            c for c in contracts
            if c["optionType"] == "put"
            and c["mark"] > 0
            and c["openInterest"] >= MIN_OPEN_INTEREST
        ],
        key=lambda x: -x["strike"]  # Descending for puts
    )

    # Find ATM strikes
    atm_call_idx = next(
        (i for i, c in enumerate(calls) if c["strike"] >= spot_price),
        None
    )
    atm_put_idx = next(
        (i for i, c in enumerate(puts) if c["strike"] <= spot_price),
        None
    )

    # Validate we have enough contracts
    if (atm_call_idx is None or atm_put_idx is None or
            atm_call_idx + 1 >= len(calls) or atm_put_idx + 1 >= len(puts)):
        return []

    # Select the four legs
    short_call = calls[atm_call_idx]
    long_call = calls[atm_call_idx + 1]
    short_put = puts[atm_put_idx]
    long_put = puts[atm_put_idx + 1]

    # Calculate credits
    call_credit = short_call["mark"] - long_call["mark"]
    put_credit = short_put["mark"] - long_put["mark"]
    total_credit = call_credit + put_credit

    if total_credit < MIN_TOTAL_CREDIT:
        return []

    # Calculate max loss
    call_width = long_call["strike"] - short_call["strike"]
    put_width = short_put["strike"] - long_put["strike"]
    max_width = max(call_width, put_width)
    max_loss_usd = (max_width - total_credit) * 100
    max_profit_usd = total_credit * 100

    if max_loss_usd > budget:
        return []

    candidate = _build_iron_condor_candidate(
        short_call, long_call, short_put, long_put,
        total_credit, max_loss_usd, max_profit_usd, spot_price
    )

    return [candidate]


def _build_iron_condor_candidate(
    short_call: OptionContract,
    long_call: OptionContract,
    short_put: OptionContract,
    long_put: OptionContract,
    total_credit: float,
    max_loss_usd: float,
    max_profit_usd: float,
    spot_price: float,
) -> StrategyCandidate:
    """Build an iron condor candidate from four legs."""
    # Delta-based range probability proxy (NOT true POP)
    # Sum of short deltas approximates probability of breaching either wing
    prob_in_range_proxy = int((1 - abs(short_call["delta"]) - abs(short_put["delta"])) * 100)

    # Breakeven prices
    lower_breakeven = short_put["strike"] - total_credit
    upper_breakeven = short_call["strike"] + total_credit

    # Calculate scores using proper metrics
    scores = _calculate_iron_condor_scores(
        short_call, long_call, short_put, long_put,
        max_profit_usd, max_loss_usd, spot_price
    )
    overall = round(_calculate_overall_score(scores), 1)

    # Calculate profit range for display
    profit_range_width = short_call["strike"] - short_put["strike"]
    range_pct = (profit_range_width / spot_price * 100) if spot_price > 0 else 0

    candidate: StrategyCandidate = {
        "id": f"iron-condor-0-{short_call['contractSymbol']}",
        "strategyType": "iron_condor",
        "legs": [
            {"contract": short_call, "action": "sell", "quantity": 1},
            {"contract": long_call, "action": "buy", "quantity": 1},
            {"contract": short_put, "action": "sell", "quantity": 1},
            {"contract": long_put, "action": "buy", "quantity": 1},
        ],
        "maxLoss": -max_loss_usd,
        "maxProfit": max_profit_usd,
        "breakeven": [lower_breakeven, upper_breakeven],
        "probITMProxy": prob_in_range_proxy,  # For condors: P(stays in range)
        "netDelta": (
            short_call["delta"] + short_put["delta"] -
            long_call["delta"] - long_put["delta"]
        ),
        "netTheta": (
            short_call["theta"] + short_put["theta"] -
            long_call["theta"] - long_put["theta"]
        ),
        "netVega": (
            short_call["vega"] + short_put["vega"] -
            long_call["vega"] - long_put["vega"]
        ),
        "netPremium": -max_profit_usd,  # Negative = credit received
        "scores": scores,
        "overallScore": overall,
        "why": _generate_reasons(
            short_call, short_put, max_profit_usd, max_loss_usd, range_pct, spot_price
        ),
        "risks": _generate_risks(short_call, short_put, spot_price, short_call["dte"]),
    }

    return candidate


def _calculate_iron_condor_scores(
    short_call: OptionContract,
    long_call: OptionContract,
    short_put: OptionContract,
    long_put: OptionContract,
    max_profit_usd: float,
    max_loss_usd: float,
    spot_price: float,
) -> Dict[str, int]:
    """
    Calculate scores for iron condor candidate.

    Metrics:
    - creditEfficiency: Credit received / max loss (risk/reward ratio)
    - rangeSafety: How far short strikes are from current price
    - thetaEfficiency: Net theta per dollar of margin at risk
    - deltaBalance: How neutral the position is (closer to 0 = better)
    """
    # Credit efficiency: max_profit / max_loss
    credit_efficiency = min(100, int((max_profit_usd / max_loss_usd) * 200)) if max_loss_usd > 0 else 50

    # Range safety: average distance of short strikes from spot
    call_distance = (short_call["strike"] - spot_price) / spot_price * 100 if spot_price > 0 else 0
    put_distance = (spot_price - short_put["strike"]) / spot_price * 100 if spot_price > 0 else 0
    avg_distance = (call_distance + put_distance) / 2
    # 10% average distance = 100, 0% = 0
    range_score = min(100, max(0, int(avg_distance * 10)))

    # Theta efficiency: net positive theta per $100 of margin
    net_theta = (
        short_call["theta"] + short_put["theta"] -
        long_call["theta"] - long_put["theta"]
    )
    if max_loss_usd > 0:
        theta_per_100 = net_theta / (max_loss_usd / 100)
        theta_score = min(100, max(0, int(50 + theta_per_100 * 500)))
    else:
        theta_score = 50

    # Delta balance: how close to delta-neutral
    net_delta = abs(short_call["delta"] + short_put["delta"] - long_call["delta"] - long_put["delta"])
    # 0 net delta = 100, 0.5 net delta = 0
    delta_score = max(0, int(100 * (1 - net_delta * 2)))

    return {
        "creditEfficiency": credit_efficiency,
        "rangeSafety": range_score,
        "thetaEfficiency": theta_score,
        "deltaBalance": delta_score,
    }


def _calculate_overall_score(scores: Dict[str, int]) -> float:
    """
    Calculate weighted overall score.

    Weights:
    - Range Safety: 35% (most important - how likely to stay in profit zone)
    - Credit Efficiency: 25% (risk/reward)
    - Theta Efficiency: 25% (time decay working for you)
    - Delta Balance: 15% (directional neutrality)
    """
    return (
        scores["rangeSafety"] * 0.35 +
        scores["creditEfficiency"] * 0.25 +
        scores["thetaEfficiency"] * 0.25 +
        scores["deltaBalance"] * 0.15
    )


def _generate_reasons(
    short_call: OptionContract,
    short_put: OptionContract,
    max_profit_usd: float,
    max_loss_usd: float,
    range_pct: float,
    spot_price: float,
) -> List[str]:
    """Generate explanatory reasons for candidate selection."""
    reasons = []

    # Range insight
    reasons.append(f"Profit range ${short_put['strike']:.0f}-${short_call['strike']:.0f} ({range_pct:.0f}% width)")

    # Credit insight
    roi = (max_profit_usd / max_loss_usd * 100) if max_loss_usd > 0 else 0
    reasons.append(f"${max_profit_usd:.0f} credit ({roi:.0f}% ROI on risk)")

    # Balance insight
    net_delta = short_call["delta"] + short_put["delta"]
    if abs(net_delta) < 0.1:
        reasons.append("Well-balanced (near delta-neutral)")
    else:
        direction = "bullish" if net_delta > 0 else "bearish"
        reasons.append(f"Slight {direction} bias (delta: {net_delta:.2f})")

    return reasons[:3]


def _generate_risks(
    short_call: OptionContract,
    short_put: OptionContract,
    spot_price: float,
    dte: int,
) -> List[str]:
    """Generate comprehensive risk warnings for iron condor."""
    avg_iv = (short_call["iv"] + short_put["iv"]) / 2

    return assess_iron_condor_risks(
        short_call_strike=short_call["strike"],
        short_put_strike=short_put["strike"],
        spot_price=spot_price,
        short_call_delta=short_call["delta"],
        short_put_delta=short_put["delta"],
        avg_iv=avg_iv,
        short_call_oi=short_call["openInterest"],
        short_put_oi=short_put["openInterest"],
        dte=dte,
    )
