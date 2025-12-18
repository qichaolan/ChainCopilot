"""
Chain Filter Tool
Filters options contracts based on LEAPS criteria and user intent.
"""

from typing import List, Dict, Any, Optional
import json


def filter_leaps_contracts(
    contracts_json: str,
    intent_json: str,
) -> dict:
    """
    Filter options chain to find LEAPS candidates matching user criteria.

    Filters by:
    1. DTE range (LEAPS = 180-730 days typically)
    2. Delta range (for directional bias)
    3. Liquidity thresholds (OI, spread %)
    4. Premium within capital budget

    Args:
        contracts_json: JSON string of options contracts:
            [
                {
                    "contractSymbol": "AAPL250117C00200000",
                    "strike": 200.0,
                    "expiration": "2025-01-17",
                    "optionType": "call",
                    "bid": 25.50,
                    "ask": 26.00,
                    "mark": 25.75,
                    "delta": 0.65,
                    "gamma": 0.012,
                    "theta": -0.045,
                    "vega": 0.85,
                    "iv": 0.32,
                    "openInterest": 5420,
                    "volume": 234,
                    "dte": 395
                },
                ...
            ]
        intent_json: JSON string of user intent:
            {
                "symbol": "AAPL",
                "direction": "bullish",  // bullish, bearish, neutral
                "capitalBudget": 5000,   // Max premium to spend
                "maxLoss": 5000,         // Max $ willing to lose
                "dteRange": {"min": 180, "max": 730},
                "deltaRange": {"min": 0.5, "max": 0.8},
                "liquidityThreshold": {
                    "minOI": 100,
                    "maxSpreadPct": 5.0
                }
            }

    Returns:
        {
            "passed": [
                {
                    "contract": {...},
                    "filterReasons": ["DTE 395 within range", "Delta 0.65 within range", ...]
                },
                ...
            ],
            "excluded": [
                {
                    "contract": {...},
                    "excludeReason": "Delta 0.25 below minimum 0.5"
                },
                ...
            ],
            "summary": {
                "totalContracts": 150,
                "passedCount": 24,
                "excludedCount": 126,
                "filterBreakdown": {
                    "dte": {"passed": 80, "failed": 70},
                    "delta": {"passed": 45, "failed": 35},
                    "liquidity": {"passed": 30, "failed": 15},
                    "budget": {"passed": 24, "failed": 6}
                }
            }
        }
    """
    try:
        contracts = json.loads(contracts_json) if isinstance(contracts_json, str) else contracts_json
        intent = json.loads(intent_json) if isinstance(intent_json, str) else intent_json
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON input: {str(e)}"}

    # Extract intent parameters with defaults
    direction = intent.get("direction", "bullish")
    capital_budget = intent.get("capitalBudget", 10000)
    dte_range = intent.get("dteRange", {"min": 180, "max": 730})
    delta_range = intent.get("deltaRange", {"min": 0.5, "max": 0.8})
    liquidity = intent.get("liquidityThreshold", {"minOI": 100, "maxSpreadPct": 5.0})

    passed = []
    excluded = []
    filter_stats = {
        "dte": {"passed": 0, "failed": 0},
        "delta": {"passed": 0, "failed": 0},
        "liquidity": {"passed": 0, "failed": 0},
        "budget": {"passed": 0, "failed": 0},
    }

    for contract in contracts:
        reasons = []
        exclude_reason = None

        # 1. DTE Filter
        dte = contract.get("dte", 0)
        if dte_range["min"] <= dte <= dte_range["max"]:
            filter_stats["dte"]["passed"] += 1
            reasons.append(f"DTE {dte} within {dte_range['min']}-{dte_range['max']} range")
        else:
            filter_stats["dte"]["failed"] += 1
            exclude_reason = f"DTE {dte} outside {dte_range['min']}-{dte_range['max']} range"
            excluded.append({"contract": contract, "excludeReason": exclude_reason})
            continue

        # 2. Option Type Filter (based on direction)
        option_type = contract.get("optionType", "").lower()
        if direction == "bullish" and option_type != "call":
            excluded.append({"contract": contract, "excludeReason": f"Put option for bullish intent"})
            continue
        elif direction == "bearish" and option_type != "put":
            excluded.append({"contract": contract, "excludeReason": f"Call option for bearish intent"})
            continue

        # 3. Delta Filter
        delta = abs(contract.get("delta", 0))
        if delta_range["min"] <= delta <= delta_range["max"]:
            filter_stats["delta"]["passed"] += 1
            reasons.append(f"Delta {delta:.2f} within {delta_range['min']}-{delta_range['max']} range")
        else:
            filter_stats["delta"]["failed"] += 1
            exclude_reason = f"Delta {delta:.2f} outside {delta_range['min']}-{delta_range['max']} range"
            excluded.append({"contract": contract, "excludeReason": exclude_reason})
            continue

        # 4. Liquidity Filter
        oi = contract.get("openInterest", 0)
        bid = contract.get("bid", 0)
        ask = contract.get("ask", 0)
        spread_pct = ((ask - bid) / ask * 100) if ask > 0 else 100

        if oi >= liquidity["minOI"] and spread_pct <= liquidity["maxSpreadPct"]:
            filter_stats["liquidity"]["passed"] += 1
            reasons.append(f"OI {oi} >= {liquidity['minOI']}, spread {spread_pct:.1f}% <= {liquidity['maxSpreadPct']}%")
        else:
            filter_stats["liquidity"]["failed"] += 1
            if oi < liquidity["minOI"]:
                exclude_reason = f"OI {oi} below minimum {liquidity['minOI']}"
            else:
                exclude_reason = f"Spread {spread_pct:.1f}% exceeds {liquidity['maxSpreadPct']}% max"
            excluded.append({"contract": contract, "excludeReason": exclude_reason})
            continue

        # 5. Budget Filter
        mark = contract.get("mark", 0) * 100  # Convert to dollar cost per contract
        if mark <= capital_budget:
            filter_stats["budget"]["passed"] += 1
            reasons.append(f"Premium ${mark:.0f} within ${capital_budget} budget")
        else:
            filter_stats["budget"]["failed"] += 1
            exclude_reason = f"Premium ${mark:.0f} exceeds ${capital_budget} budget"
            excluded.append({"contract": contract, "excludeReason": exclude_reason})
            continue

        # Contract passed all filters
        passed.append({
            "contract": contract,
            "filterReasons": reasons,
        })

    return {
        "passed": passed,
        "excluded": excluded,
        "summary": {
            "totalContracts": len(contracts),
            "passedCount": len(passed),
            "excludedCount": len(excluded),
            "filterBreakdown": filter_stats,
        },
    }


def get_leaps_expirations(
    expirations_json: str,
    min_dte: int = 180,
    max_dte: int = 730,
) -> dict:
    """
    Filter expirations to only return LEAPS-eligible dates.

    Args:
        expirations_json: JSON array of expiration dates with DTE
        min_dte: Minimum days to expiration (default 180)
        max_dte: Maximum days to expiration (default 730)

    Returns:
        {
            "leapsExpirations": ["2025-01-17", "2025-06-20", "2026-01-16"],
            "filtered": 3,
            "total": 12
        }
    """
    try:
        expirations = json.loads(expirations_json) if isinstance(expirations_json, str) else expirations_json
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {str(e)}"}

    leaps = [
        exp for exp in expirations
        if min_dte <= exp.get("dte", 0) <= max_dte
    ]

    return {
        "leapsExpirations": [exp.get("date") or exp.get("expiration") for exp in leaps],
        "filtered": len(leaps),
        "total": len(expirations),
    }
