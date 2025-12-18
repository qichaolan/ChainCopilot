"""
Phase 2.5 Tool: Suggest Next Edit
Generates the single best improvement suggestion for a position.
"""


def suggest_next_edit(
    position_json: str,
    payoff_json: str,
    probability_json: str,
    greeks_json: str,
    liquidity_json: str,
    underlying_price: float,
    days_to_expiration: int,
) -> dict:
    """
    Generate the single best edit suggestion for a position.

    This tool analyzes all aspects of the position and suggests
    the most impactful improvement.

    Priority order:
    1. Fix critical issues (gamma risk, poor liquidity)
    2. Improve probability of profit
    3. Optimize risk/reward

    Args:
        position_json: Current position (StrategyPosition)
        payoff_json: Payoff analysis results
        probability_json: Probability heuristics results
        greeks_json: Greeks exposure results
        liquidity_json: Liquidity analysis results
        underlying_price: Current stock price
        days_to_expiration: Days until expiration

    Returns:
        Edit suggestion including:
        - suggestion_type: Type of edit ("roll_strike", "adjust_width", etc.)
        - description: Human-readable description of the edit
        - rationale: Why this edit is recommended
        - expected_improvement: What metrics would improve

    Example Response:
        {
            "suggestion_type": "roll_strike",
            "description": "Roll short strike up $5 for more room",
            "rationale": "Breakevens are within expected move range, increasing risk",
            "expected_improvement": {
                "probability_of_profit": "+5-10%",
                "breakeven_distance": "+2-5%"
            },
            "new_position": null
        }
    """
    # TODO: Implement actual suggestion logic
    # For now, return mock data

    return {
        "suggestion_type": "roll_strike",
        "description": "Position is well-balanced - no immediate changes needed",
        "rationale": "Current position has good risk/reward and acceptable probability. Monitor theta decay and adjust if underlying moves significantly.",
        "expected_improvement": {
            "status": "Position optimized for current conditions"
        },
        "new_position": None,
        "_mock": True
    }
