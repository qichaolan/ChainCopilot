"""
Comprehensive Risk Assessment Module.

Provides multi-dimensional risk analysis for options candidates.
"""

from __future__ import annotations

from typing import List, Dict, Optional
from enum import Enum


class RiskLevel(str, Enum):
    """Risk severity levels."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TradingStyle(str, Enum):
    """Trading style affects which risks matter most."""
    INCOME = "income"
    MOMENTUM = "momentum"
    SWING = "swing"
    STOCK_REPLACEMENT = "stock_replacement"
    SPECULATIVE = "speculative"


# Risk sensitivity by trading style (higher = more important)
RISK_SENSITIVITY: Dict[str, Dict[TradingStyle, int]] = {
    "liquidity": {
        TradingStyle.INCOME: 3, TradingStyle.MOMENTUM: 2, TradingStyle.SWING: 2,
        TradingStyle.STOCK_REPLACEMENT: 3, TradingStyle.SPECULATIVE: 1
    },
    "theta_burn": {
        TradingStyle.INCOME: 3, TradingStyle.MOMENTUM: 2, TradingStyle.SWING: 2,
        TradingStyle.STOCK_REPLACEMENT: 1, TradingStyle.SPECULATIVE: 1
    },
    "breakeven_hurdle": {
        TradingStyle.INCOME: 3, TradingStyle.MOMENTUM: 2, TradingStyle.SWING: 3,
        TradingStyle.STOCK_REPLACEMENT: 3, TradingStyle.SPECULATIVE: 1
    },
    "iv_crush": {
        TradingStyle.INCOME: 2, TradingStyle.MOMENTUM: 3, TradingStyle.SWING: 2,
        TradingStyle.STOCK_REPLACEMENT: 1, TradingStyle.SPECULATIVE: 1
    },
    "timing": {
        TradingStyle.INCOME: 3, TradingStyle.MOMENTUM: 1, TradingStyle.SWING: 2,
        TradingStyle.STOCK_REPLACEMENT: 3, TradingStyle.SPECULATIVE: 1
    },
    "convexity": {
        TradingStyle.INCOME: 1, TradingStyle.MOMENTUM: 3, TradingStyle.SWING: 2,
        TradingStyle.STOCK_REPLACEMENT: 2, TradingStyle.SPECULATIVE: 3
    },
}


# ============================================================================
# Risk Assessment Functions
# ============================================================================

def assess_iv_crush_risk(
    iv: float,
    iv_percentile: Optional[float] = None,
    dte: int = 30,
    has_earnings_soon: bool = False,
) -> Optional[Dict]:
    """
    Assess IV crush / volatility compression risk.

    Even if price moves right, IV drop can kill a long option.

    Args:
        iv: Implied volatility (decimal, e.g., 0.35 = 35%)
        iv_percentile: IV percentile 0-100 if available
        dte: Days to expiration
        has_earnings_soon: Whether earnings are within DTE

    Returns:
        Risk dict with level and message, or None if low risk
    """
    # If we have IV percentile, use that
    if iv_percentile is not None:
        if iv_percentile >= 85:
            return {
                "type": "iv_crush",
                "level": RiskLevel.HIGH,
                "message": f"Very high IV ({iv_percentile:.0f}th percentile) - significant crush risk after events"
            }
        elif iv_percentile >= 70:
            return {
                "type": "iv_crush",
                "level": RiskLevel.MEDIUM,
                "message": f"Elevated IV ({iv_percentile:.0f}th percentile) - price may drop if volatility compresses"
            }

    # Fallback: use absolute IV with context
    if iv > 0.60 and (has_earnings_soon or dte <= 30):
        return {
            "type": "iv_crush",
            "level": RiskLevel.HIGH,
            "message": f"High IV ({iv*100:.0f}%) near events - expect volatility crush"
        }
    elif iv > 0.45 and dte <= 21:
        return {
            "type": "iv_crush",
            "level": RiskLevel.MEDIUM,
            "message": f"Elevated IV ({iv*100:.0f}%) - option price may drop if volatility compresses"
        }

    return None


def assess_convexity_risk(
    delta: float,
    gamma: float,
    premium_usd: float,
    spot_price: float,
) -> Optional[Dict]:
    """
    Assess low convexity risk (poor upside efficiency).

    Some options look cheap but don't accelerate gains quickly.

    Args:
        delta: Option delta
        gamma: Option gamma
        premium_usd: Premium in dollars (per contract)
        spot_price: Current underlying price

    Returns:
        Risk dict with level and message, or None if low risk
    """
    if premium_usd <= 0:
        return None

    # Delta efficiency: delta per $100 of premium
    delta_per_100 = abs(delta) / (premium_usd / 100)

    # Gamma efficiency: gamma per $100 of premium
    gamma_per_100 = gamma / (premium_usd / 100) * 100  # Normalize

    # Very low delta efficiency = poor leverage
    if delta_per_100 < 0.005:  # Less than 0.5 delta per $100
        return {
            "type": "convexity",
            "level": RiskLevel.HIGH,
            "message": "Low convexity - upside gains will be very slow relative to premium paid"
        }
    elif delta_per_100 < 0.01 and abs(delta) < 0.4:
        return {
            "type": "convexity",
            "level": RiskLevel.MEDIUM,
            "message": "Low convexity - gains may be slower than expected for premium paid"
        }

    return None


def assess_timing_risk(dte: int) -> Optional[Dict]:
    """
    Assess timing risk based on DTE.

    Too short DTE = requires immediate move, little margin for error.

    Args:
        dte: Days to expiration

    Returns:
        Risk dict with level and message, or None if low risk
    """
    if dte <= 7:
        return {
            "type": "timing",
            "level": RiskLevel.HIGH,
            "message": f"Very short DTE ({dte} days) - requires immediate move; little margin for error"
        }
    elif dte <= 21:
        return {
            "type": "timing",
            "level": RiskLevel.MEDIUM,
            "message": f"Short DTE ({dte} days) - limited time for thesis to play out"
        }

    return None


def assess_overpaying_for_time(
    dte: int,
    delta: float,
    premium_usd: float,
    spot_price: float,
    expected_move_pct: float = 10.0,  # Default expected move
) -> Optional[Dict]:
    """
    Assess if paying too much for time (common beginner mistake).

    Long DTE + low delta + small expected move = wasted premium.

    Args:
        dte: Days to expiration
        delta: Option delta
        premium_usd: Premium in dollars
        spot_price: Current underlying price
        expected_move_pct: Expected % move (if available)

    Returns:
        Risk dict with level and message, or None if low risk
    """
    # Only applies to long-dated options
    if dte < 90:
        return None

    # Low delta = far OTM
    if abs(delta) < 0.40:
        # Premium is high relative to delta exposure
        delta_cost = premium_usd / abs(delta) if abs(delta) > 0 else float('inf')

        if delta_cost > spot_price * 0.30:  # Paying more than 30% of spot for this delta
            return {
                "type": "time_overpay",
                "level": RiskLevel.MEDIUM,
                "message": f"Long-dated ({dte} DTE) low-delta option - may be unnecessary for short-term thesis"
            }

    return None


def assess_spread_risk(
    bid: float,
    ask: float,
) -> Optional[Dict]:
    """
    Assess bid-ask spread risk (execution cost).

    Wide spreads increase entry/exit costs significantly.

    Args:
        bid: Bid price
        ask: Ask price

    Returns:
        Risk dict with level and message, or None if low risk
    """
    if bid <= 0 or ask <= 0:
        return None

    mid = (bid + ask) / 2
    spread_pct = (ask - bid) / mid * 100 if mid > 0 else 100

    if spread_pct >= 15:
        return {
            "type": "spread",
            "level": RiskLevel.HIGH,
            "message": f"Very wide bid-ask spread ({spread_pct:.0f}%) - significant entry/exit cost"
        }
    elif spread_pct >= 8:
        return {
            "type": "spread",
            "level": RiskLevel.MEDIUM,
            "message": f"Wide bid-ask spread ({spread_pct:.1f}%) - increases transaction cost"
        }

    return None


def assess_liquidity_risk(
    open_interest: int,
    volume: int = 0,
) -> Optional[Dict]:
    """
    Assess liquidity risk based on OI and volume.

    Args:
        open_interest: Open interest
        volume: Daily volume

    Returns:
        Risk dict with level and message, or None if low risk
    """
    if open_interest < 50:
        return {
            "type": "liquidity",
            "level": RiskLevel.HIGH,
            "message": f"Very low open interest ({open_interest}) - difficult to exit position"
        }
    elif open_interest < 200:
        return {
            "type": "liquidity",
            "level": RiskLevel.MEDIUM,
            "message": f"Low open interest ({open_interest}) - may face wider spreads"
        }

    return None


def assess_far_otm_risk(
    delta: float,
    dte: int,
    premium_usd: float,
) -> Optional[Dict]:
    """
    Assess far OTM "lottery ticket" risk.

    Very low delta options rarely pay off.

    Args:
        delta: Option delta
        dte: Days to expiration
        premium_usd: Premium in dollars

    Returns:
        Risk dict with level and message, or None if low risk
    """
    if abs(delta) < 0.15:
        return {
            "type": "far_otm",
            "level": RiskLevel.HIGH,
            "message": f"Very far OTM (delta {abs(delta):.2f}) - low probability of profit"
        }
    elif abs(delta) < 0.25 and dte < 30:
        return {
            "type": "far_otm",
            "level": RiskLevel.MEDIUM,
            "message": f"Far OTM with short DTE - needs significant move to profit"
        }

    return None


def assess_theta_burn_risk(
    theta: float,
    premium_usd: float,
    dte: int,
) -> Optional[Dict]:
    """
    Assess theta decay risk relative to premium.

    Args:
        theta: Daily theta (typically negative for long positions)
        premium_usd: Premium in dollars
        dte: Days to expiration

    Returns:
        Risk dict with level and message, or None if low risk
    """
    if premium_usd <= 0:
        return None

    # Daily theta as % of premium
    theta_pct = abs(theta) * 100 / premium_usd * 100

    if theta_pct > 3 and dte <= 14:
        return {
            "type": "theta_burn",
            "level": RiskLevel.HIGH,
            "message": f"Rapid theta decay ({theta_pct:.1f}%/day) - time working against you"
        }
    elif theta_pct > 2:
        return {
            "type": "theta_burn",
            "level": RiskLevel.MEDIUM,
            "message": f"Elevated theta decay ({theta_pct:.1f}%/day of premium)"
        }

    return None


# ============================================================================
# Comprehensive Risk Assessment
# ============================================================================

def assess_long_option_risks(
    delta: float,
    gamma: float,
    theta: float,
    vega: float,
    iv: float,
    dte: int,
    premium_usd: float,
    spot_price: float,
    open_interest: int,
    volume: int = 0,
    bid: float = 0,
    ask: float = 0,
    iv_percentile: Optional[float] = None,
    has_earnings_soon: bool = False,
    trading_style: TradingStyle = TradingStyle.SWING,
) -> List[str]:
    """
    Comprehensive risk assessment for long options (calls or puts).

    Returns list of risk warning strings, filtered by trading style relevance.
    """
    risks: List[Dict] = []

    # Run all risk assessments
    assessments = [
        assess_iv_crush_risk(iv, iv_percentile, dte, has_earnings_soon),
        assess_convexity_risk(delta, gamma, premium_usd, spot_price),
        assess_timing_risk(dte),
        assess_overpaying_for_time(dte, delta, premium_usd, spot_price),
        assess_spread_risk(bid, ask),
        assess_liquidity_risk(open_interest, volume),
        assess_far_otm_risk(delta, dte, premium_usd),
        assess_theta_burn_risk(theta, premium_usd, dte),
    ]

    # Collect non-None risks
    for assessment in assessments:
        if assessment is not None:
            risks.append(assessment)

    # Sort by severity (HIGH first, then MEDIUM)
    severity_order = {RiskLevel.HIGH: 0, RiskLevel.MEDIUM: 1, RiskLevel.LOW: 2}
    risks.sort(key=lambda r: severity_order.get(r["level"], 2))

    # Filter by trading style relevance
    risk_type_map = {
        "iv_crush": "iv_crush",
        "convexity": "convexity",
        "timing": "timing",
        "time_overpay": "timing",
        "spread": "liquidity",
        "liquidity": "liquidity",
        "far_otm": "breakeven_hurdle",
        "theta_burn": "theta_burn",
    }

    filtered_risks = []
    for risk in risks:
        risk_category = risk_type_map.get(risk["type"], "liquidity")
        sensitivity = RISK_SENSITIVITY.get(risk_category, {}).get(trading_style, 2)

        # Include if HIGH level or if sensitivity >= 2
        if risk["level"] == RiskLevel.HIGH or sensitivity >= 2:
            filtered_risks.append(risk["message"])

    return filtered_risks[:5]  # Return top 5 most relevant risks


def assess_credit_spread_risks(
    short_delta: float,
    short_iv: float,
    short_oi: int,
    short_bid: float,
    short_ask: float,
    long_bid: float,
    long_ask: float,
    dte: int,
    safety_margin_pct: float,
    width: float,
    max_loss_usd: float,
) -> List[str]:
    """
    Risk assessment for credit spreads (bull put / bear call).
    """
    risks: List[str] = []

    # Assignment risk for short leg
    if abs(short_delta) > 0.40:
        risks.append(f"Short strike delta ({abs(short_delta):.2f}) - elevated assignment risk")

    # Safety margin
    if safety_margin_pct < 3:
        risks.append("Short strike very close to current price - high breach probability")
    elif safety_margin_pct < 5:
        risks.append("Tight safety margin - limited buffer before loss")

    # Wide spread = larger max loss
    if width > 10:
        risks.append(f"Wide ${width:.0f} spread increases max loss exposure")

    # Spread execution cost
    total_spread_cost = (short_ask - short_bid) + (long_ask - long_bid)
    if total_spread_cost > 0.20:
        risks.append("Combined leg spreads increase execution slippage")

    # Liquidity
    if short_oi < 200:
        risks.append("Lower liquidity on short leg - watch for wide markets")

    # IV risk (for credit spreads, high IV is actually favorable for entry)
    if short_iv > 0.50:
        risks.append(f"Elevated IV ({short_iv*100:.0f}%) - good for entry but watch for crush impact on margin")

    # Timing
    if dte < 14:
        risks.append("Short DTE - gamma risk elevated near expiration")

    return risks[:5]


def assess_iron_condor_risks(
    short_call_strike: float,
    short_put_strike: float,
    spot_price: float,
    short_call_delta: float,
    short_put_delta: float,
    avg_iv: float,
    short_call_oi: int,
    short_put_oi: int,
    dte: int,
) -> List[str]:
    """
    Risk assessment for iron condors.
    """
    risks: List[str] = []

    # Range safety
    call_distance_pct = (short_call_strike - spot_price) / spot_price * 100 if spot_price > 0 else 0
    put_distance_pct = (spot_price - short_put_strike) / spot_price * 100 if spot_price > 0 else 0

    if call_distance_pct < 3 or put_distance_pct < 3:
        risks.append("One or both short strikes very close to current price")
    elif call_distance_pct < 5 or put_distance_pct < 5:
        risks.append("Tight profit range - limited margin for movement")

    # Delta balance (directional exposure)
    net_short_delta = short_call_delta + short_put_delta
    if abs(net_short_delta) > 0.15:
        direction = "bullish" if net_short_delta > 0 else "bearish"
        risks.append(f"Directional bias ({direction}) - not truly market-neutral")

    # IV impact
    if avg_iv > 0.40:
        risks.append(f"Elevated IV ({avg_iv*100:.0f}%) - larger moves more likely")

    # Liquidity across legs
    min_oi = min(short_call_oi, short_put_oi)
    if min_oi < 200:
        risks.append("Lower liquidity on one or more legs - may face slippage")

    # Timing / gamma risk
    if dte < 14:
        risks.append("Short DTE - gamma risk elevated; position can move rapidly")
    elif dte > 60:
        risks.append("Long DTE - significant vega exposure; IV changes impact P&L")

    # Standard iron condor risk
    risks.append("Max loss if price gaps beyond either wing")

    return risks[:5]


def assess_leaps_risks(
    delta: float,
    theta: float,
    vega: float,
    iv: float,
    dte: int,
    premium_usd: float,
    open_interest: int,
    bid: float,
    ask: float,
) -> List[str]:
    """
    Risk assessment for LEAPS (long-dated options).
    """
    risks: List[str] = []

    # Liquidity (LEAPS typically have lower OI)
    if open_interest < 50:
        risks.append("Low open interest - wider spreads and difficult exit likely")
    elif open_interest < 100:
        risks.append("Limited liquidity typical for LEAPS - plan exit carefully")

    # Spread risk
    if bid > 0 and ask > 0:
        spread_pct = (ask - bid) / ((bid + ask) / 2) * 100
        if spread_pct > 10:
            risks.append(f"Wide bid-ask ({spread_pct:.0f}%) - significant transaction cost")

    # IV risk for LEAPS (high vega exposure)
    if vega > 0 and iv > 0.45:
        risks.append(f"High vega exposure - IV compression will hurt even if direction correct")

    # Delta risk
    if abs(delta) < 0.60:
        risks.append("Lower delta - higher risk of losing entire premium if stock stagnates")

    # Not true LEAPS
    if dte < 270:
        risks.append("Consider longer expiration for true LEAPS benefits (reduced theta)")

    # Capital tie-up
    if premium_usd > 2000:
        risks.append("Significant capital commitment - ensure position sizing appropriate")

    # Capital lock-up for very long-dated LEAPS
    if dte > 900:
        risks.append("Capital locked up 2.5+ years - opportunity cost may be significant vs rolling shorter calls")
    elif dte > 720:
        risks.append("Long holding period (2+ years) - consider flexibility vs rolling shorter-dated options")

    return risks[:5]
