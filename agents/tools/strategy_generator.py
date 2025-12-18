"""
Strategy Generator Tool (Phase 1)
Takes validated intent and returns 1-3 ranked strategy suggestions.
No legs, no strikes, no expirations - just strategy type recommendations.
"""

from typing import List, Optional
from datetime import datetime, timezone


# === V1 Strategy Catalog ===

STRATEGY_CATALOG = {
    "covered_call": {
        "displayName": "Covered Call",
        "description": "Sell call against owned shares for income",
        "creditOrDebit": "credit",
        "definedRisk": True,
        "direction": "bullish",  # slightly bullish to neutral
        "volatilityPreference": "down",
    },
    "cash_secured_put": {
        "displayName": "Cash Secured Put",
        "description": "Sell put with cash collateral to acquire shares or collect premium",
        "creditOrDebit": "credit",
        "definedRisk": True,
        "direction": "bullish",
        "volatilityPreference": "down",
    },
    "long_call": {
        "displayName": "Long Call",
        "description": "Buy call for bullish directional exposure",
        "creditOrDebit": "debit",
        "definedRisk": True,
        "direction": "bullish",
        "volatilityPreference": "up",
    },
    "long_put": {
        "displayName": "Long Put",
        "description": "Buy put for bearish directional exposure or hedge",
        "creditOrDebit": "debit",
        "definedRisk": True,
        "direction": "bearish",
        "volatilityPreference": "up",
    },
    "bull_call_debit_spread": {
        "displayName": "Bull Call Spread",
        "description": "Buy lower call, sell higher call for reduced cost bullish play",
        "creditOrDebit": "debit",
        "definedRisk": True,
        "direction": "bullish",
        "volatilityPreference": "up",
    },
    "bear_put_debit_spread": {
        "displayName": "Bear Put Spread",
        "description": "Buy higher put, sell lower put for reduced cost bearish play",
        "creditOrDebit": "debit",
        "definedRisk": True,
        "direction": "bearish",
        "volatilityPreference": "up",
    },
    "bull_put_credit_spread": {
        "displayName": "Bull Put Spread",
        "description": "Sell higher put, buy lower put for credit with bullish bias",
        "creditOrDebit": "credit",
        "definedRisk": True,
        "direction": "bullish",
        "volatilityPreference": "down",
    },
    "bear_call_credit_spread": {
        "displayName": "Bear Call Spread",
        "description": "Sell lower call, buy higher call for credit with bearish bias",
        "creditOrDebit": "credit",
        "definedRisk": True,
        "direction": "bearish",
        "volatilityPreference": "down",
    },
    "leaps_call": {
        "displayName": "LEAPS Call",
        "description": "Long-dated call for stock replacement or leverage",
        "creditOrDebit": "debit",
        "definedRisk": True,
        "direction": "bullish",
        "volatilityPreference": "up",
    },
    "leaps_put": {
        "displayName": "LEAPS Put",
        "description": "Long-dated put for long-term hedge or bearish view",
        "creditOrDebit": "debit",
        "definedRisk": True,
        "direction": "bearish",
        "volatilityPreference": "up",
    },
    "iron_condor": {
        "displayName": "Iron Condor",
        "description": "Sell put spread + call spread for range-bound income",
        "creditOrDebit": "credit",
        "definedRisk": True,
        "direction": "neutral",
        "volatilityPreference": "down",
    },
}

# Risk flags catalog
RISK_FLAGS = {
    "assignment_risk_warning": "Strategy conflicts with your assignment avoidance preference",
    "theta_decay_high": "Time decay works against you significantly",
    "assignment_possible": "Short options may be assigned early",
    "requires_100_shares": "Requires owning 100 shares of underlying",
    "capital_intensive": "Requires significant cash collateral",
    "vol_spike_risk": "Volatility increase hurts position",
    "limited_upside": "Profit potential is capped",
    "directional_risk": "Losses if stock moves opposite direction",
}

# Strategies with short legs (assignment risk)
STRATEGIES_WITH_SHORT_LEGS = [
    "covered_call",
    "cash_secured_put",
    "bull_put_credit_spread",
    "bear_call_credit_spread",
    "iron_condor",
]

# Credit strategies
CREDIT_STRATEGIES = [
    "covered_call",
    "cash_secured_put",
    "bull_put_credit_spread",
    "bear_call_credit_spread",
    "iron_condor",
]

# Debit strategies
DEBIT_STRATEGIES = [
    "long_call",
    "long_put",
    "bull_call_debit_spread",
    "bear_put_debit_spread",
    "leaps_call",
    "leaps_put",
]


def suggest_strategies(intent: dict) -> dict:
    """
    Generate 1-3 ranked strategy suggestions based on validated intent.

    This is Phase 1 of the HITL workflow. Returns strategy TYPES only,
    no specific legs, strikes, or expirations.

    Args:
        intent: Validated intent object from parse_strategy_intent
            Required fields:
            - symbol
            - marketView.direction (bullish|bearish|neutral)
            - marketView.volatility (up|down|unsure)
            - timeframe (week|month|year|leaps)
            - risk.maxLossUsd
            - risk.definedRiskOnly
            - creditOrDebit (credit|debit|either)
            - goal
            - avoidAssignmentRisk

    Returns:
        {
            "success": true,
            "symbol": "QQQ",
            "asOf": "2025-12-14T19:12:00Z",
            "strategies": [...],
            "nextStep": {
                "action": "choose_strategy",
                "requiresUserAction": true
            }
        }
    """
    if not intent:
        return _build_error_response("Intent is required")

    # Extract intent fields
    symbol = intent.get("symbol", "")
    market_view = intent.get("marketView", {})
    direction = market_view.get("direction", "neutral")
    volatility = market_view.get("volatility", "unsure")
    predicted_pct = market_view.get("predictedAnnualIncreasePct")

    timeframe = intent.get("timeframe", "month")
    risk = intent.get("risk", {})
    defined_risk_only = risk.get("definedRiskOnly", True)

    credit_or_debit = intent.get("creditOrDebit", "either")
    goal = intent.get("goal", "income")
    avoid_assignment = intent.get("avoidAssignmentRisk", True)

    # === Step 1: Apply Hard Filters ===
    eligible_strategies = _apply_hard_filters(
        credit_or_debit=credit_or_debit,
        defined_risk_only=defined_risk_only,
        timeframe=timeframe,
    )

    if not eligible_strategies:
        return _build_error_response("No strategies match your constraints")

    # === Step 2: Score Each Strategy ===
    scored_strategies = []
    for strategy_id in eligible_strategies:
        score = _calculate_fit_score(
            strategy_id=strategy_id,
            goal=goal,
            direction=direction,
            volatility=volatility,
            timeframe=timeframe,
            avoid_assignment=avoid_assignment,
            predicted_pct=predicted_pct,
        )
        scored_strategies.append((strategy_id, score))

    # === Step 3: Rank and Select Top 3 ===
    scored_strategies.sort(key=lambda x: x[1], reverse=True)
    top_strategies = scored_strategies[:3]

    # === Step 4: Build Response ===
    strategies_output = []
    for rank, (strategy_id, fit_score) in enumerate(top_strategies, 1):
        catalog_entry = STRATEGY_CATALOG[strategy_id]

        # Generate why[] explanations
        why_reasons = _generate_why_reasons(
            strategy_id=strategy_id,
            goal=goal,
            direction=direction,
            volatility=volatility,
            timeframe=timeframe,
            credit_or_debit=credit_or_debit,
        )

        # Generate risk flags
        risk_flags = _generate_risk_flags(
            strategy_id=strategy_id,
            timeframe=timeframe,
            avoid_assignment=avoid_assignment,
        )

        strategies_output.append({
            "rank": rank,
            "strategyType": strategy_id,
            "displayName": catalog_entry["displayName"],
            "description": catalog_entry["description"],
            "fitScore": min(100, max(0, fit_score)),  # Clamp 0-100
            "tradeProfile": {
                "creditOrDebit": catalog_entry["creditOrDebit"],
                "definedRisk": catalog_entry["definedRisk"],
                "direction": catalog_entry["direction"],
                "volatilityView": catalog_entry["volatilityPreference"],
                "timeframe": timeframe,
            },
            "why": why_reasons,
            "riskFlags": risk_flags if risk_flags else [],
        })

    return {
        "success": True,
        "symbol": symbol.upper() if symbol else "",
        "asOf": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "strategyCount": len(strategies_output),
        "strategies": strategies_output,
        "nextStep": {
            "action": "choose_strategy",
            "requiresUserAction": True,
        },
    }


def _apply_hard_filters(
    credit_or_debit: str,
    defined_risk_only: bool,
    timeframe: str,
) -> List[str]:
    """
    Apply hard filters to exclude ineligible strategies.

    Returns list of strategy IDs that pass all filters.
    """
    _ = timeframe  # Reserved for future LEAPS-only hard filtering
    eligible = list(STRATEGY_CATALOG.keys())

    # Filter by credit/debit preference
    if credit_or_debit == "credit":
        eligible = [s for s in eligible if s in CREDIT_STRATEGIES]
    elif credit_or_debit == "debit":
        eligible = [s for s in eligible if s in DEBIT_STRATEGIES]
    # "either" keeps all

    # Filter by defined risk (all v1 strategies are defined-risk, but future-proof)
    if defined_risk_only:
        eligible = [s for s in eligible if STRATEGY_CATALOG[s]["definedRisk"]]

    # For LEAPS timeframe, strongly prefer LEAPS strategies
    # (don't exclude others, but they'll score lower)

    return eligible


def _calculate_fit_score(
    strategy_id: str,
    goal: str,
    direction: str,
    volatility: str,
    timeframe: str,
    avoid_assignment: bool,
    predicted_pct: Optional[float] = None,
) -> int:
    """
    Calculate fit score (0-100) based on intent alignment.

    Scoring breakdown:
    - Goal fit: 0-40 points
    - Direction fit: 0-20 points
    - Volatility fit: 0-15 points
    - Timeframe fit: 0-15 points
    - Assignment penalty: -5 to -15 points
    - Conviction bonus: 0-10 points
    """
    score = 0
    catalog = STRATEGY_CATALOG[strategy_id]

    # === Goal Fit (0-40) ===
    goal_scores = _get_goal_scores(goal)
    score += goal_scores.get(strategy_id, 0)

    # === Direction Fit (0-20) ===
    strategy_direction = catalog["direction"]
    if direction == strategy_direction:
        score += 20
    elif direction == "neutral" and strategy_direction in ["bullish", "bearish"]:
        score += 5  # Slight penalty for directional when neutral wanted
    elif strategy_direction == "neutral" and direction in ["bullish", "bearish"]:
        score += 10  # Neutral strategies can work for directional views
    # Opposite direction gets 0

    # === Volatility Fit (0-15) ===
    vol_pref = catalog["volatilityPreference"]
    if volatility == "down" and vol_pref == "down":
        score += 15
    elif volatility == "up" and vol_pref == "up":
        score += 15
    elif volatility == "unsure":
        score += 5  # Small neutral bonus
    # Mismatch gets 0

    # === Timeframe Fit (0-15) ===
    if timeframe == "leaps":
        if strategy_id in ["leaps_call", "leaps_put"]:
            score += 15
        elif strategy_id in ["long_call", "long_put"]:
            score += 8  # Long options work for LEAPS
        else:
            score += 0  # Credit spreads less ideal for LEAPS
    elif timeframe == "week":
        if strategy_id in ["bull_put_credit_spread", "bear_call_credit_spread", "iron_condor"]:
            score += 12  # Credit spreads work well for weekly
        elif strategy_id in ["long_call", "long_put"]:
            score += 5  # High theta decay warning
        else:
            score += 8
    elif timeframe == "month":
        score += 12  # Most strategies work well for monthly
    elif timeframe == "year":
        if strategy_id in ["leaps_call", "leaps_put"]:
            score += 15
        else:
            score += 10

    # === Assignment Penalty ===
    if avoid_assignment and strategy_id in STRATEGIES_WITH_SHORT_LEGS:
        if strategy_id in ["covered_call", "cash_secured_put"]:
            score -= 15  # Higher penalty for 100-share strategies
        else:
            score -= 8  # Lower penalty for spreads

    # === Conviction Bonus (from predicted %) ===
    if predicted_pct is not None:
        if direction == "bullish" and predicted_pct > 20:
            # High conviction bullish
            if strategy_id in ["long_call", "bull_call_debit_spread", "leaps_call"]:
                score += 10
        elif direction == "bearish" and predicted_pct < -20:
            # High conviction bearish
            if strategy_id in ["long_put", "bear_put_debit_spread", "leaps_put"]:
                score += 10

    return score


def _get_goal_scores(goal: str) -> dict:
    """
    Return goal-based scores for each strategy.
    Max 40 points for perfect goal alignment.
    """
    scores = {
        "income": {
            "covered_call": 40,
            "cash_secured_put": 40,
            "bull_put_credit_spread": 40,
            "bear_call_credit_spread": 35,
            "iron_condor": 40,
            "long_call": 5,
            "long_put": 5,
            "bull_call_debit_spread": 10,
            "bear_put_debit_spread": 10,
            "leaps_call": 5,
            "leaps_put": 5,
        },
        "high_probability": {
            "covered_call": 35,
            "cash_secured_put": 35,
            "bull_put_credit_spread": 40,
            "bear_call_credit_spread": 40,
            "iron_condor": 40,
            "long_call": 10,
            "long_put": 10,
            "bull_call_debit_spread": 20,
            "bear_put_debit_spread": 20,
            "leaps_call": 15,
            "leaps_put": 15,
        },
        "big_upside": {
            "covered_call": 10,
            "cash_secured_put": 10,
            "bull_put_credit_spread": 15,
            "bear_call_credit_spread": 15,
            "iron_condor": 10,
            "long_call": 40,
            "long_put": 40,
            "bull_call_debit_spread": 35,
            "bear_put_debit_spread": 35,
            "leaps_call": 40,
            "leaps_put": 40,
        },
        "hedge": {
            "covered_call": 5,
            "cash_secured_put": 5,
            "bull_put_credit_spread": 10,
            "bear_call_credit_spread": 20,
            "iron_condor": 5,
            "long_call": 15,
            "long_put": 40,
            "bull_call_debit_spread": 10,
            "bear_put_debit_spread": 35,
            "leaps_call": 10,
            "leaps_put": 40,
        },
        "stock_replacement": {
            "covered_call": 5,
            "cash_secured_put": 15,
            "bull_put_credit_spread": 10,
            "bear_call_credit_spread": 10,
            "iron_condor": 5,
            "long_call": 30,
            "long_put": 25,
            "bull_call_debit_spread": 25,
            "bear_put_debit_spread": 20,
            "leaps_call": 40,
            "leaps_put": 35,
        },
    }
    return scores.get(goal, {})


def _generate_why_reasons(
    strategy_id: str,
    goal: str,
    direction: str,
    volatility: str,
    timeframe: str,
    credit_or_debit: str,
) -> List[str]:
    """
    Generate human-readable explanations for why this strategy fits.
    Must reference goal + at least one constraint.
    """
    reasons = []
    catalog = STRATEGY_CATALOG[strategy_id]

    # Goal-based reason
    goal_reasons = {
        "income": {
            "covered_call": "Income goal matches premium-selling structure.",
            "cash_secured_put": "Income goal aligns with collecting premium.",
            "bull_put_credit_spread": "Income goal favors credit-generating spreads.",
            "bear_call_credit_spread": "Income goal favors credit-generating spreads.",
            "iron_condor": "Income goal fits range-bound premium collection.",
            "long_call": "Potential income from capital gains if bullish thesis plays out.",
            "long_put": "Potential income from capital gains if bearish thesis plays out.",
        },
        "high_probability": {
            "bull_put_credit_spread": "High probability goal aligns with credit spreads' favorable win rate.",
            "bear_call_credit_spread": "High probability goal aligns with credit spreads' favorable win rate.",
            "iron_condor": "High probability goal fits range-bound strategies with wide profit zone.",
            "covered_call": "High probability of profit from premium decay.",
            "cash_secured_put": "High probability of profit from premium decay.",
        },
        "big_upside": {
            "long_call": "Big upside goal matches unlimited profit potential of long calls.",
            "long_put": "Big upside goal matches significant profit potential of long puts.",
            "leaps_call": "Big upside goal matches leveraged long-term bullish exposure.",
            "leaps_put": "Big upside goal matches leveraged long-term bearish exposure.",
            "bull_call_debit_spread": "Big upside goal fits debit spreads with favorable risk/reward.",
            "bear_put_debit_spread": "Big upside goal fits debit spreads with favorable risk/reward.",
        },
        "hedge": {
            "long_put": "Hedge goal perfectly matches protective put structure.",
            "bear_put_debit_spread": "Hedge goal fits bearish protection with reduced cost.",
            "leaps_put": "Hedge goal matches long-term portfolio protection.",
        },
        "stock_replacement": {
            "leaps_call": "Stock replacement goal perfectly matches LEAPS call strategy.",
            "long_call": "Stock replacement goal fits leveraged bullish exposure.",
            "leaps_put": "Stock replacement goal fits leveraged bearish exposure.",
        },
    }
    if goal in goal_reasons and strategy_id in goal_reasons[goal]:
        reasons.append(goal_reasons[goal][strategy_id])
    else:
        reasons.append(f"{goal.replace('_', ' ').title()} goal considered in ranking.")

    # Direction-based reason
    strategy_dir = catalog["direction"]
    if direction == strategy_dir:
        reasons.append(f"{direction.capitalize()} view aligns with strategy's directional bias.")
    elif strategy_dir == "neutral":
        reasons.append("Neutral strategy provides flexibility for range-bound markets.")

    # Volatility-based reason
    vol_pref = catalog["volatilityPreference"]
    if volatility == vol_pref:
        if volatility == "down":
            reasons.append("Volatility-down view favors premium-selling strategies.")
        else:
            reasons.append("Volatility-up view favors options buying strategies.")
    elif volatility == "unsure":
        reasons.append("Defined-risk structure works for uncertain volatility.")

    # Credit/Debit constraint reason
    if credit_or_debit != "either":
        if catalog["creditOrDebit"] == credit_or_debit:
            reasons.append(f"{credit_or_debit.capitalize()} preference satisfied.")

    # Timeframe-based reason
    if timeframe == "leaps" and strategy_id in ["leaps_call", "leaps_put"]:
        reasons.append("LEAPS timeframe aligns with long-dated option strategy.")
    elif timeframe == "week" and catalog["creditOrDebit"] == "credit":
        reasons.append("Weekly timeframe suits premium decay strategies.")

    return reasons[:3]  # Limit to 3 reasons


def _generate_risk_flags(
    strategy_id: str,
    timeframe: str,
    avoid_assignment: bool,
) -> List[str]:
    """
    Generate evidence-based risk flags.
    Only include flags that actually apply.
    """
    flags = []

    # Assignment risk (highlight more prominently if user wants to avoid)
    if strategy_id in STRATEGIES_WITH_SHORT_LEGS:
        if strategy_id in ["covered_call", "cash_secured_put"]:
            flags.append("assignment_possible")
            flags.append("requires_100_shares")
            if avoid_assignment:
                flags.insert(0, "assignment_risk_warning")  # Prioritize warning
        else:
            flags.append("assignment_possible")

    # Capital intensive
    if strategy_id == "cash_secured_put":
        flags.append("capital_intensive")

    # Theta decay for long options
    if strategy_id in ["long_call", "long_put"] and timeframe == "week":
        flags.append("theta_decay_high")

    # Vol spike risk for credit strategies
    if strategy_id in ["bull_put_credit_spread", "bear_call_credit_spread", "iron_condor"]:
        flags.append("vol_spike_risk")

    # Limited upside for covered calls and credit spreads
    if strategy_id in ["covered_call", "bull_put_credit_spread", "bear_call_credit_spread", "iron_condor"]:
        flags.append("limited_upside")

    # Directional risk
    if strategy_id in ["long_call", "long_put", "bull_call_debit_spread", "bear_put_debit_spread", "leaps_call", "leaps_put"]:
        flags.append("directional_risk")

    return flags


def _build_error_response(message: str) -> dict:
    """Build error response for Phase 1."""
    return {
        "success": False,
        "symbol": "",
        "asOf": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "strategies": [],
        "error": {
            "message": message,
        },
        "nextStep": {
            "action": "handle_error",
            "requiresUserAction": True,
        },
    }


# === Legacy Function (for backwards compatibility) ===

def generate_strategy_candidates(
    symbol: str,
    direction: str,
    volatility: str = "unsure",
    goal: str = "income",
    timeframe: str = "month",
    credit_or_debit: str = "either",
    max_loss: float = 500,
    defined_risk_only: bool = True,
    avoid_assignment: bool = True,
) -> dict:
    """
    Legacy function for backwards compatibility.
    Wraps suggest_strategies with flat args.
    """
    intent = {
        "symbol": symbol,
        "marketView": {
            "direction": direction,
            "volatility": volatility,
            "predictedAnnualIncreasePct": None,
        },
        "timeframe": timeframe,
        "risk": {
            "maxLossUsd": max_loss,
            "definedRiskOnly": defined_risk_only,
        },
        "creditOrDebit": credit_or_debit,
        "goal": goal,
        "avoidAssignmentRisk": avoid_assignment,
    }
    return suggest_strategies(intent)
