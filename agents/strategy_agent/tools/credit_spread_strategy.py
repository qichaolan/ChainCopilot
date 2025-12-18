"""
Credit Spread Strategy Generator.

Generates bull put spread or bear call spread candidates.
"""

from __future__ import annotations

from typing import List, Dict

import os
import sys

# Add paths for imports
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, AGENT_DIR)

from types_ import OptionContract, StrategyCandidate, MarketOutlook
from tools.common import calculate_liquidity_score
from tools.risk_assessment import assess_credit_spread_risks


# ============================================================================
# Filtering Constants (can be overridden by user profile)
# ============================================================================
MIN_OPEN_INTEREST = 50
MIN_CREDIT = 0.10  # Minimum credit to collect per spread


def generate_credit_spreads(
    contracts: List[OptionContract],
    outlook: MarketOutlook,
    budget: float,
    spot_price: float,
) -> List[StrategyCandidate]:
    """
    Generate credit spread candidates (bull put or bear call).

    Args:
        contracts: List of option contracts
        outlook: Market outlook (bullish = bull put, bearish = bear call)
        budget: Capital budget in dollars
        spot_price: Current underlying price

    Returns:
        List of ranked credit spread candidates
    """
    # Select option type based on outlook
    # Bullish -> sell puts (bull put spread)
    # Bearish -> sell calls (bear call spread)
    opt_type = "put" if outlook == "bullish" else "call"

    options = sorted(
        [
            c for c in contracts
            if c["optionType"] == opt_type
            and c["mark"] > 0
            and c["openInterest"] >= MIN_OPEN_INTEREST
        ],
        key=lambda x: x["strike"]
    )

    candidates: List[StrategyCandidate] = []
    candidate_idx = 0

    for i in range(len(options) - 1):
        candidate = _try_build_spread(options, i, outlook, budget, spot_price, candidate_idx)
        if candidate:
            candidates.append(candidate)
            candidate_idx += 1

    # Sort by overall score descending, return top 10
    candidates = sorted(candidates, key=lambda c: c["overallScore"], reverse=True)[:10]

    return candidates


def _try_build_spread(
    options: List[OptionContract],
    index: int,
    outlook: MarketOutlook,
    budget: float,
    spot_price: float,
    candidate_idx: int,
) -> StrategyCandidate | None:
    """Try to build a credit spread from two adjacent options."""
    # For bullish: sell higher strike put, buy lower strike put
    # For bearish: sell lower strike call, buy higher strike call
    if outlook == "bullish":
        short_leg = options[index + 1]
        long_leg = options[index]
    else:
        short_leg = options[index]
        long_leg = options[index + 1]

    credit = short_leg["mark"] - long_leg["mark"]
    if credit < MIN_CREDIT:
        return None

    width = abs(short_leg["strike"] - long_leg["strike"])
    max_loss_usd = (width - credit) * 100
    max_profit_usd = credit * 100

    if max_loss_usd > budget:
        return None

    return _build_credit_spread_candidate(
        short_leg, long_leg, outlook, credit, width, max_loss_usd, max_profit_usd,
        spot_price, candidate_idx
    )


def _build_credit_spread_candidate(
    short_leg: OptionContract,
    long_leg: OptionContract,
    outlook: MarketOutlook,
    credit: float,
    width: float,
    max_loss_usd: float,
    max_profit_usd: float,
    spot_price: float,
    idx: int,
) -> StrategyCandidate:
    """Build a credit spread candidate."""
    # Delta-based OTM proxy (NOT true probability of profit)
    # For credit spreads, 1 - |short_delta| approximates P(short strike stays OTM)
    prob_otm_proxy = int((1 - abs(short_leg["delta"])) * 100)

    # Breakeven calculation
    if outlook == "bullish":
        breakeven_price = short_leg["strike"] - credit
    else:
        breakeven_price = short_leg["strike"] + credit

    # Calculate scores using proper metrics
    scores = _calculate_credit_spread_scores(
        short_leg, long_leg, max_profit_usd, max_loss_usd, breakeven_price, spot_price, outlook
    )
    overall = round(_calculate_overall_score(scores), 1)

    # Calculate safety margin for display
    safety_margin = _calculate_safety_margin(short_leg["strike"], spot_price, outlook)

    candidate: StrategyCandidate = {
        "id": f"credit-spread-{idx}-{short_leg['contractSymbol']}",
        "strategyType": "credit_spread",
        "legs": [
            {"contract": short_leg, "action": "sell", "quantity": 1},
            {"contract": long_leg, "action": "buy", "quantity": 1},
        ],
        "maxLoss": -max_loss_usd,
        "maxProfit": max_profit_usd,
        "breakeven": breakeven_price,
        "probITMProxy": prob_otm_proxy,  # For spreads: P(short stays OTM)
        "netDelta": short_leg["delta"] - long_leg["delta"],
        "netTheta": short_leg["theta"] - long_leg["theta"],
        "netVega": short_leg["vega"] - long_leg["vega"],
        "netPremium": -max_profit_usd,  # Negative = credit received
        "scores": scores,
        "overallScore": overall,
        "why": _generate_reasons(short_leg, max_profit_usd, max_loss_usd, safety_margin, outlook),
        "risks": _generate_risks(short_leg, long_leg, width, safety_margin, max_loss_usd, short_leg["dte"]),
    }

    return candidate


def _calculate_credit_spread_scores(
    short_leg: OptionContract,
    long_leg: OptionContract,
    max_profit_usd: float,
    max_loss_usd: float,
    breakeven_price: float,
    spot_price: float,
    outlook: MarketOutlook,
) -> Dict[str, int]:
    """
    Calculate scores for credit spread candidate.

    Metrics:
    - creditEfficiency: Credit received / max loss (risk/reward ratio)
    - safetyMargin: How far OTM the short strike is (% buffer before losing)
    - thetaEfficiency: Net theta per dollar of margin at risk
    - liquidity: Combined OI + bid-ask spread quality
    """
    # Credit efficiency: max_profit / max_loss (0-100 scale)
    # 50% return on risk = 100, 10% = 20
    credit_efficiency = min(100, int((max_profit_usd / max_loss_usd) * 200)) if max_loss_usd > 0 else 50

    # Safety margin: how far OTM is the short strike
    safety_pct = _calculate_safety_margin(short_leg["strike"], spot_price, outlook)
    # 10% OTM = 100, 0% = 0
    safety_score = min(100, max(0, int(safety_pct * 10)))

    # Theta efficiency: net theta per $100 of margin
    net_theta = short_leg["theta"] - long_leg["theta"]
    # Positive theta is good for credit spreads
    if max_loss_usd > 0:
        theta_per_100 = net_theta / (max_loss_usd / 100)
        # Scale: 0.05 theta per $100 = 100, 0 = 50
        theta_score = min(100, max(0, int(50 + theta_per_100 * 1000)))
    else:
        theta_score = 50

    # Liquidity: combined OI + spread
    liquidity = calculate_liquidity_score(
        short_leg["openInterest"] + long_leg["openInterest"],
        (short_leg["bid"] + long_leg["bid"]) / 2,
        (short_leg["ask"] + long_leg["ask"]) / 2,
        divisor=200
    )

    return {
        "creditEfficiency": credit_efficiency,
        "safetyMargin": safety_score,
        "thetaEfficiency": theta_score,
        "liquidity": liquidity,
    }


def _calculate_overall_score(scores: Dict[str, int]) -> float:
    """
    Calculate weighted overall score.

    Weights:
    - Safety Margin: 30% (most important - how likely to stay OTM)
    - Credit Efficiency: 25% (risk/reward)
    - Theta Efficiency: 25% (time decay working for you)
    - Liquidity: 20% (execution quality)
    """
    return (
        scores["safetyMargin"] * 0.30 +
        scores["creditEfficiency"] * 0.25 +
        scores["thetaEfficiency"] * 0.25 +
        scores["liquidity"] * 0.20
    )


def _calculate_safety_margin(
    short_strike: float,
    spot_price: float,
    outlook: MarketOutlook,
) -> float:
    """Calculate % distance from spot to short strike."""
    if spot_price <= 0:
        return 0.0
    if outlook == "bullish":
        # Bull put spread: short strike is below spot
        return (spot_price - short_strike) / spot_price * 100
    else:
        # Bear call spread: short strike is above spot
        return (short_strike - spot_price) / spot_price * 100


def _generate_reasons(
    short_leg: OptionContract,
    max_profit_usd: float,
    max_loss_usd: float,
    safety_margin: float,
    outlook: MarketOutlook,
) -> List[str]:
    """Generate explanatory reasons for candidate selection."""
    reasons = []

    # Safety insight
    if safety_margin >= 10:
        reasons.append(f"{safety_margin:.1f}% OTM - generous safety buffer")
    elif safety_margin >= 5:
        reasons.append(f"{safety_margin:.1f}% OTM - moderate safety margin")
    else:
        reasons.append(f"{safety_margin:.1f}% OTM - tight but higher credit")

    # Credit insight
    roi = (max_profit_usd / max_loss_usd * 100) if max_loss_usd > 0 else 0
    reasons.append(f"${max_profit_usd:.0f} credit ({roi:.0f}% ROI on risk)")

    # Theta insight
    net_theta = short_leg["theta"]
    if net_theta > 0:
        reasons.append(f"Positive theta (${net_theta:.2f}/day)")

    return reasons[:3]


def _generate_risks(
    short_leg: OptionContract,
    long_leg: OptionContract,
    width: float,
    safety_margin: float,
    max_loss_usd: float,
    dte: int,
) -> List[str]:
    """Generate comprehensive risk warnings for credit spread."""
    return assess_credit_spread_risks(
        short_delta=short_leg["delta"],
        short_iv=short_leg["iv"],
        short_oi=short_leg["openInterest"],
        short_bid=short_leg["bid"],
        short_ask=short_leg["ask"],
        long_bid=long_leg["bid"],
        long_ask=long_leg["ask"],
        dte=dte,
        safety_margin_pct=safety_margin,
        width=width,
        max_loss_usd=max_loss_usd,
    )
