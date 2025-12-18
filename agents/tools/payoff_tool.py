"""
Phase 2.1 Tool: Compute Payoff
Calculates P/L curve, breakevens, max profit/loss for a position.
"""


def compute_payoff(
    legs_json: str,
    underlying_price: float,
) -> dict:
    """
    Compute detailed payoff analysis for a multi-leg options position.

    Args:
        legs_json: JSON string of option legs. Each leg should have:
            - leg_id: Unique identifier
            - option_type: "call" or "put"
            - strike: Strike price
            - quantity: Number of contracts (positive=long, negative=short)
            - mark: Mid price (bid+ask)/2
        underlying_price: Current price of underlying stock

    Returns:
        Payoff analysis including:
        - net_credit_debit: Net premium received (positive) or paid (negative)
        - max_profit: Maximum possible profit
        - max_loss: Maximum possible loss (negative number)
        - breakeven_points: List of stock prices where P/L = 0
        - payoff_curve: Array of {price, profit} for charting

    Example Response:
        {
            "net_credit_debit": -2.50,
            "max_profit": 2.50,
            "max_profit_price": 190.0,
            "max_loss": -2.50,
            "max_loss_price": 180.0,
            "breakeven_points": [187.50],
            "payoff_curve": [
                {"price": 180.0, "profit": -2.50},
                {"price": 185.0, "profit": -2.50},
                {"price": 187.5, "profit": 0.0},
                {"price": 190.0, "profit": 2.50},
                {"price": 195.0, "profit": 2.50}
            ]
        }
    """
    # TODO: Implement actual payoff calculation
    # For now, return mock data

    return {
        "net_credit_debit": -2.50,
        "max_profit": 2.50,
        "max_profit_price": 190.0,
        "max_loss": -2.50,
        "max_loss_price": 180.0,
        "breakeven_points": [187.50],
        "payoff_curve": [
            {"price": 175.0, "profit": -2.50},
            {"price": 180.0, "profit": -2.50},
            {"price": 185.0, "profit": -2.50},
            {"price": 187.5, "profit": 0.0},
            {"price": 190.0, "profit": 2.50},
            {"price": 195.0, "profit": 2.50},
            {"price": 200.0, "profit": 2.50}
        ],
        "_mock": True
    }
