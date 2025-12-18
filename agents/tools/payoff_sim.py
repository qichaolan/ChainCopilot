"""
Payoff Simulation Tool
Simulates P&L scenarios and theta decay for LEAPS positions.
"""

from typing import List, Dict, Any, Optional
import json
import math

# Default scenario price moves (percentage)
DEFAULT_SCENARIOS = [-20, -10, -5, 0, 5, 10, 20, 30]


def simulate_leaps_payoff(
    candidates_json: str,
    underlying_price: float,
    scenarios: Optional[List[int]] = None,
) -> dict:
    """
    Simulate P&L at various price scenarios for ranked LEAPS candidates.

    Calculates:
    1. Breakeven price
    2. P&L at each scenario percentage
    3. ROI at each scenario
    4. Theta decay estimates (daily, weekly, monthly)

    Args:
        candidates_json: JSON string of ranked candidates from contract_rank:
            [
                {
                    "rank": 1,
                    "contract": {...},
                    "scores": {...},
                    "overallScore": 78.75
                },
                ...
            ]
        underlying_price: Current underlying price
        scenarios: List of price move percentages (default: [-20, -10, 0, 10, 20, 30])

    Returns:
        {
            "simulations": [
                {
                    "rank": 1,
                    "contract": {...},
                    "payoff": {
                        "breakeven": 215.50,
                        "maxProfit": "unlimited",
                        "maxLoss": -2550,
                        "costBasis": 2550
                    },
                    "scenarios": [
                        {"move": "-20%", "price": 160.00, "pnl": -2550, "roi": -100},
                        {"move": "0%", "price": 200.00, "pnl": -550, "roi": -21.6},
                        {"move": "+20%", "price": 240.00, "pnl": 1950, "roi": 76.5},
                        ...
                    ],
                    "thetaDecay": {
                        "daily": -4.50,
                        "weekly": -31.50,
                        "monthly": -135.00,
                        "daysToBreakeven": 57
                    }
                },
                ...
            ],
            "scenarioLabels": ["-20%", "-10%", "0%", "+10%", "+20%", "+30%"]
        }
    """
    try:
        candidates = json.loads(candidates_json) if isinstance(candidates_json, str) else candidates_json
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON input: {str(e)}"}

    if scenarios is None:
        scenarios = DEFAULT_SCENARIOS

    simulations = []

    for candidate in candidates:
        contract = candidate.get("contract", candidate)
        rank = candidate.get("rank", 0)

        # Extract contract details
        strike = contract.get("strike", underlying_price)
        mark = contract.get("mark", 0)
        option_type = contract.get("optionType", "call").lower()
        theta = contract.get("theta", 0)
        dte = contract.get("dte", 365)

        # Cost basis (premium paid)
        cost_basis = mark * 100  # Per contract

        # Calculate breakeven
        if option_type == "call":
            breakeven = strike + mark
        else:  # put
            breakeven = strike - mark

        # Simulate scenarios
        scenario_results = []
        for pct in scenarios:
            target_price = underlying_price * (1 + pct / 100)

            # Calculate intrinsic value at expiration
            if option_type == "call":
                intrinsic = max(0, target_price - strike)
            else:
                intrinsic = max(0, strike - target_price)

            # P&L calculation
            value_at_expiry = intrinsic * 100
            pnl = value_at_expiry - cost_basis

            # ROI calculation
            roi = (pnl / cost_basis * 100) if cost_basis > 0 else 0

            scenario_results.append({
                "move": f"{pct:+d}%",
                "price": round(target_price, 2),
                "pnl": round(pnl, 2),
                "roi": round(roi, 1),
            })

        # Theta decay calculations
        daily_decay = theta * 100  # Per contract
        weekly_decay = daily_decay * 7
        monthly_decay = daily_decay * 30

        # Estimate days until theta erodes entire position
        days_to_breakeven = int(cost_basis / abs(daily_decay)) if daily_decay != 0 else dte

        # Max profit/loss
        if option_type == "call":
            max_profit = "unlimited"
            max_loss = -cost_basis
        else:
            max_profit = (strike - mark) * 100  # Max is strike goes to 0
            max_loss = -cost_basis

        simulations.append({
            "rank": rank,
            "contract": contract,
            "payoff": {
                "breakeven": round(breakeven, 2),
                "maxProfit": max_profit,
                "maxLoss": round(max_loss, 2),
                "costBasis": round(cost_basis, 2),
            },
            "scenarios": scenario_results,
            "thetaDecay": {
                "daily": round(daily_decay, 2),
                "weekly": round(weekly_decay, 2),
                "monthly": round(monthly_decay, 2),
                "daysToBreakeven": min(days_to_breakeven, dte),
            },
        })

    return {
        "simulations": simulations,
        "scenarioLabels": [f"{p:+d}%" for p in scenarios],
        "underlyingPrice": underlying_price,
    }


def calculate_greeks_impact(
    contract_json: str,
    underlying_price: float,
    time_horizons: Optional[List[int]] = None,
) -> dict:
    """
    Calculate Greek-based projections for a LEAPS contract.

    Projects how option value changes over time due to:
    - Theta decay
    - Delta exposure
    - Vega sensitivity (IV changes)

    Args:
        contract_json: Single contract JSON
        underlying_price: Current underlying price
        time_horizons: Days to project (default: [30, 60, 90, 180])

    Returns:
        {
            "projections": [
                {
                    "days": 30,
                    "thetaLoss": -135,
                    "deltaGain_5pct": 650,
                    "vegaImpact_5pctIV": 425,
                    "netValue_flat": 2415
                },
                ...
            ],
            "greeksSummary": {
                "delta": 0.65,
                "theta": -4.50,
                "vega": 0.85,
                "gamma": 0.012,
                "interpretation": "Strongly directional with moderate time decay"
            }
        }
    """
    try:
        contract = json.loads(contract_json) if isinstance(contract_json, str) else contract_json
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {str(e)}"}

    if time_horizons is None:
        time_horizons = [30, 60, 90, 180]

    delta = contract.get("delta", 0.5)
    theta = contract.get("theta", -0.05)
    vega = contract.get("vega", 0.5)
    gamma = contract.get("gamma", 0.01)
    mark = contract.get("mark", 10)
    current_value = mark * 100

    projections = []
    for days in time_horizons:
        # Theta loss over period
        theta_loss = theta * 100 * days

        # Delta gain if underlying moves 5%
        price_move_5pct = underlying_price * 0.05
        delta_gain = delta * price_move_5pct * 100

        # Vega impact if IV increases 5%
        vega_impact = vega * 5 * 100

        # Net value if flat (only theta decay)
        net_flat = current_value + theta_loss

        projections.append({
            "days": days,
            "thetaLoss": round(theta_loss, 2),
            "deltaGain_5pct": round(delta_gain, 2),
            "vegaImpact_5pctIV": round(vega_impact, 2),
            "netValue_flat": round(max(0, net_flat), 2),
        })

    # Generate interpretation
    if abs(delta) > 0.7:
        direction = "Strongly directional"
    elif abs(delta) > 0.4:
        direction = "Moderately directional"
    else:
        direction = "Speculative"

    if abs(theta * 100) > 10:
        decay = "significant time decay"
    elif abs(theta * 100) > 5:
        decay = "moderate time decay"
    else:
        decay = "minimal time decay"

    interpretation = f"{direction} with {decay}"

    return {
        "projections": projections,
        "greeksSummary": {
            "delta": delta,
            "theta": round(theta * 100, 2),
            "vega": round(vega * 100, 2),
            "gamma": gamma,
            "interpretation": interpretation,
        },
        "currentValue": current_value,
    }


def build_payoff_table(
    simulation_json: str,
) -> dict:
    """
    Build a formatted payoff table for display.

    Args:
        simulation_json: Single simulation result from simulate_leaps_payoff

    Returns:
        {
            "table": {
                "headers": ["Scenario", "Price", "P&L", "ROI"],
                "rows": [
                    ["-20%", "$160.00", "-$2,550", "-100%"],
                    ...
                ]
            },
            "summary": {
                "breakeven": "$215.50",
                "maxLoss": "-$2,550",
                "bestCase": "+$4,950 (+194%)",
                "worstCase": "-$2,550 (-100%)"
            }
        }
    """
    try:
        sim = json.loads(simulation_json) if isinstance(simulation_json, str) else simulation_json
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {str(e)}"}

    scenarios = sim.get("scenarios", [])
    payoff = sim.get("payoff", {})

    # Build table rows
    rows = []
    for s in scenarios:
        rows.append([
            s["move"],
            f"${s['price']:,.2f}",
            f"${s['pnl']:+,.0f}",
            f"{s['roi']:+.1f}%",
        ])

    # Find best and worst cases
    if scenarios:
        best = max(scenarios, key=lambda x: x["pnl"])
        worst = min(scenarios, key=lambda x: x["pnl"])
        best_case = f"${best['pnl']:+,.0f} ({best['roi']:+.1f}%)"
        worst_case = f"${worst['pnl']:+,.0f} ({worst['roi']:+.1f}%)"
    else:
        best_case = "N/A"
        worst_case = "N/A"

    return {
        "table": {
            "headers": ["Scenario", "Price", "P&L", "ROI"],
            "rows": rows,
        },
        "summary": {
            "breakeven": f"${payoff.get('breakeven', 0):,.2f}",
            "maxLoss": f"${payoff.get('maxLoss', 0):,.0f}",
            "costBasis": f"${payoff.get('costBasis', 0):,.0f}",
            "bestCase": best_case,
            "worstCase": worst_case,
        },
    }
