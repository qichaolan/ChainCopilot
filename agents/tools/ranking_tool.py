"""
Ranking Tool
Ranks scored candidates by fit to user intent and provides explanations.
"""

from typing import List, Optional


def rank_and_explain(
    scored_candidates_json: str,
    intent_json: str,
    top_n: int = 10,
) -> dict:
    """
    Rank scored candidates by fit to user intent and generate explanations.

    Takes candidates that have already been scored (payoff, probability, liquidity)
    and ranks them based on how well they match the user's specific intent.

    Args:
        scored_candidates_json: JSON string of candidates with scores:
            [
                {
                    "strategy_name": "Bull Put Spread",
                    "strategy_type": "credit_spread",
                    "legs": [...],
                    "payoff": {max_profit, max_loss, breakevens, credit_debit},
                    "probability": {pop, expected_move},
                    "liquidity": {overall_score, warnings}
                },
                ...
            ]
        intent_json: JSON string of parsed user intent:
            {
                "symbol": "AAPL",
                "market_view": {direction, volatility},
                "risk": {max_loss_usd, defined_risk_only},
                "goal": "income",
                "credit_or_debit": "credit",
                ...
            }
        top_n: Number of top candidates to return (default 10)

    Returns:
        Ranked candidates with fit scores and explanations:
        {
            "ranked_candidates": [
                {
                    "rank": 1,
                    "strategy_name": "Bull Put Spread",
                    "strategy_type": "credit_spread",
                    "legs": [...],
                    "metrics": {
                        "credit_debit": 1.25,
                        "max_profit": 125,
                        "max_loss": -375,
                        "breakevens": [182.75],
                        "pop": 68.5
                    },
                    "fitScore": 92,
                    "why": [
                        "Credit strategy matches income goal",
                        "68% POP exceeds high_probability threshold",
                        "Max loss $375 within $500 limit"
                    ],
                    "riskFlags": [
                        "Assignment risk if stock drops below short strike"
                    ]
                },
                ...
            ],
            "filtered_count": 3,
            "filter_reasons": ["2 candidates exceeded max loss limit"]
        }
    """
    # TODO: Implement actual ranking logic
    # For now, return mock data showing the structure

    return {
        "ranked_candidates": [
            {
                "rank": 1,
                "strategy_name": "Bull Put Spread",
                "strategy_type": "credit_spread",
                "legs": [
                    {
                        "leg_id": "leg_1",
                        "option_type": "put",
                        "strike": 180.0,
                        "expiration": "2024-02-16",
                        "quantity": -1,
                        "mark": 2.50,
                    },
                    {
                        "leg_id": "leg_2",
                        "option_type": "put",
                        "strike": 175.0,
                        "expiration": "2024-02-16",
                        "quantity": 1,
                        "mark": 1.25,
                    },
                ],
                "metrics": {
                    "credit_debit": 1.25,
                    "max_profit": 125.0,
                    "max_loss": -375.0,
                    "breakevens": [178.75],
                    "pop": 68.5,
                },
                "fitScore": 92,
                "why": [
                    "Credit strategy matches income goal",
                    "68% POP exceeds high_probability threshold",
                    "Max loss $375 within $500 limit",
                    "Good liquidity on both legs",
                ],
                "riskFlags": [
                    "Assignment risk if stock drops below $180 before expiration",
                ],
            },
            {
                "rank": 2,
                "strategy_name": "Bull Call Spread",
                "strategy_type": "debit_spread",
                "legs": [
                    {
                        "leg_id": "leg_1",
                        "option_type": "call",
                        "strike": 185.0,
                        "expiration": "2024-02-16",
                        "quantity": 1,
                        "mark": 3.50,
                    },
                    {
                        "leg_id": "leg_2",
                        "option_type": "call",
                        "strike": 190.0,
                        "expiration": "2024-02-16",
                        "quantity": -1,
                        "mark": 1.50,
                    },
                ],
                "metrics": {
                    "credit_debit": -2.00,
                    "max_profit": 300.0,
                    "max_loss": -200.0,
                    "breakevens": [187.00],
                    "pop": 45.2,
                },
                "fitScore": 78,
                "why": [
                    "Bullish bias aligns with market view",
                    "Defined risk within limit",
                    "Higher profit potential than credit spread",
                ],
                "riskFlags": [
                    "Debit strategy - pays premium upfront",
                    "Lower POP than credit alternatives",
                ],
            },
            {
                "rank": 3,
                "strategy_name": "Iron Condor",
                "strategy_type": "iron_condor",
                "legs": [
                    {
                        "leg_id": "leg_1",
                        "option_type": "put",
                        "strike": 175.0,
                        "expiration": "2024-02-16",
                        "quantity": 1,
                        "mark": 1.00,
                    },
                    {
                        "leg_id": "leg_2",
                        "option_type": "put",
                        "strike": 180.0,
                        "expiration": "2024-02-16",
                        "quantity": -1,
                        "mark": 2.00,
                    },
                    {
                        "leg_id": "leg_3",
                        "option_type": "call",
                        "strike": 195.0,
                        "expiration": "2024-02-16",
                        "quantity": -1,
                        "mark": 1.50,
                    },
                    {
                        "leg_id": "leg_4",
                        "option_type": "call",
                        "strike": 200.0,
                        "expiration": "2024-02-16",
                        "quantity": 1,
                        "mark": 0.75,
                    },
                ],
                "metrics": {
                    "credit_debit": 1.75,
                    "max_profit": 175.0,
                    "max_loss": -325.0,
                    "breakevens": [178.25, 196.75],
                    "pop": 72.0,
                },
                "fitScore": 65,
                "why": [
                    "Highest POP among candidates",
                    "Credit strategy matches preference",
                    "Defined risk within limit",
                ],
                "riskFlags": [
                    "Neutral strategy - may underperform if strongly bullish",
                    "Two breakeven points to monitor",
                    "More legs = higher commission cost",
                ],
            },
        ],
        "total_scored": 5,
        "filtered_count": 2,
        "filter_reasons": [
            "1 candidate exceeded max loss limit of $500",
            "1 candidate had poor liquidity (spread > 5%)",
        ],
        "_mock": True,
    }


def calculate_fit_score(
    candidate: dict,
    intent: dict,
) -> dict:
    """
    Calculate fit score for a single candidate against user intent.

    Scoring factors:
    - Goal alignment (income, high_probability, big_upside, etc.)
    - Risk compliance (max loss, defined risk)
    - Credit/debit preference match
    - Liquidity quality
    - Direction alignment

    Args:
        candidate: Single candidate with payoff/probability/liquidity scores
        intent: Parsed user intent

    Returns:
        {
            "fitScore": 85,
            "breakdown": {
                "goal_alignment": 25,
                "risk_compliance": 20,
                "preference_match": 15,
                "liquidity_score": 15,
                "direction_fit": 10
            },
            "why": [...],
            "riskFlags": [...]
        }
    """
    # TODO: Implement actual scoring logic
    # For now, return mock data

    return {
        "fitScore": 85,
        "breakdown": {
            "goal_alignment": 25,      # Max 30
            "risk_compliance": 20,     # Max 25
            "preference_match": 15,    # Max 15
            "liquidity_score": 15,     # Max 15
            "direction_fit": 10,       # Max 15
        },
        "why": [
            "Strategy aligns with income goal",
            "Max loss within specified limit",
        ],
        "riskFlags": [
            "Monitor for early assignment",
        ],
        "_mock": True,
    }


def generate_explanation(
    candidate: dict,
    intent: dict,
    fit_score: int,
) -> dict:
    """
    Generate human-readable explanation for why a strategy fits (or doesn't).

    Args:
        candidate: Scored candidate
        intent: User intent
        fit_score: Calculated fit score

    Returns:
        {
            "why": ["reason1", "reason2", ...],
            "riskFlags": ["warning1", "warning2", ...]
        }
    """
    # TODO: Implement actual explanation generation
    # For now, return mock data

    why = []
    risk_flags = []

    # Mock logic based on fit score
    if fit_score >= 80:
        why.append("Excellent match for your trading goals")
        why.append("Risk/reward profile aligns with your tolerance")
    elif fit_score >= 60:
        why.append("Good match with some trade-offs")
    else:
        why.append("Partial match - consider alternatives")

    # Always include at least one risk flag
    risk_flags.append("Monitor position as expiration approaches")

    return {
        "why": why,
        "riskFlags": risk_flags,
        "_mock": True,
    }
