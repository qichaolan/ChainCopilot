"""
Constraints Tool
Hard checks against trading policies with pass/fail and reasons.
Validates strategies before execution based on configurable policies.
"""

from typing import Optional, List, Dict, Any
from enum import Enum


class ConstraintSeverity(str, Enum):
    """Severity level for constraint violations."""
    BLOCK = "block"      # Hard stop - cannot proceed
    WARN = "warn"        # Warning - can proceed with caution
    INFO = "info"        # Informational only


class PolicyType(str, Enum):
    """Types of trading policies."""
    CAPITAL = "capital"
    RISK = "risk"
    LIQUIDITY = "liquidity"
    MARGIN = "margin"
    REGULATORY = "regulatory"
    ACCOUNT = "account"


# Default policy configuration
DEFAULT_POLICIES = {
    # Capital constraints
    "max_position_size": {
        "enabled": True,
        "value": 10000,  # Max $10k per position
        "severity": "block",
        "policy_type": "capital",
    },
    "max_loss_per_trade": {
        "enabled": True,
        "value": 500,  # Max $500 loss per trade
        "severity": "block",
        "policy_type": "capital",
    },
    "min_buying_power_remaining": {
        "enabled": True,
        "value": 0.2,  # Keep 20% buying power
        "severity": "warn",
        "policy_type": "capital",
    },

    # Risk constraints
    "max_delta_exposure": {
        "enabled": True,
        "value": 100,  # Max 100 delta (equivalent to 100 shares)
        "severity": "warn",
        "policy_type": "risk",
    },
    "max_vega_exposure": {
        "enabled": True,
        "value": 500,  # Max $500 vega exposure
        "severity": "warn",
        "policy_type": "risk",
    },
    "no_naked_calls": {
        "enabled": True,
        "value": True,
        "severity": "block",
        "policy_type": "risk",
    },
    "no_naked_puts": {
        "enabled": False,  # Some accounts allow CSPs
        "value": True,
        "severity": "warn",
        "policy_type": "risk",
    },
    "min_days_to_expiration": {
        "enabled": True,
        "value": 7,  # Avoid 0-7 DTE for beginners
        "severity": "warn",
        "policy_type": "risk",
    },

    # Liquidity constraints
    "min_open_interest": {
        "enabled": True,
        "value": 100,  # Min 100 OI per leg
        "severity": "warn",
        "policy_type": "liquidity",
    },
    "max_bid_ask_spread_pct": {
        "enabled": True,
        "value": 5.0,  # Max 5% spread
        "severity": "warn",
        "policy_type": "liquidity",
    },
    "min_volume": {
        "enabled": True,
        "value": 10,  # Min 10 contracts traded today
        "severity": "info",
        "policy_type": "liquidity",
    },

    # Margin constraints
    "max_margin_usage_pct": {
        "enabled": True,
        "value": 50,  # Max 50% margin usage
        "severity": "block",
        "policy_type": "margin",
    },

    # Regulatory constraints
    "pattern_day_trader_check": {
        "enabled": True,
        "value": True,
        "severity": "block",
        "policy_type": "regulatory",
    },

    # Account constraints
    "options_level_required": {
        "enabled": True,
        "value": 2,  # Min level 2 for spreads
        "severity": "block",
        "policy_type": "account",
    },
}


def check_constraints(
    position_json: str,
    greeks_json: str,
    liquidity_json: str,
    account_info_json: Optional[str] = None,
    custom_policies_json: Optional[str] = None,
) -> dict:
    """
    Check position against all enabled trading constraints/policies.

    Returns hard pass/fail with detailed reasons for each constraint.

    Args:
        position_json: Position with legs, quantities, prices
        greeks_json: Position Greeks (delta, gamma, theta, vega)
        liquidity_json: Per-leg liquidity metrics
        account_info_json: Optional account info (buying power, margin, level)
        custom_policies_json: Optional custom policy overrides

    Returns:
        Constraint check results:
        {
            "passed": false,
            "can_proceed": false,
            "summary": "2 blocking constraints, 1 warning",
            "checks": [
                {
                    "constraint": "max_position_size",
                    "policy_type": "capital",
                    "passed": false,
                    "severity": "block",
                    "value_checked": 15000,
                    "threshold": 10000,
                    "reason": "Position size $15,000 exceeds maximum $10,000"
                },
                ...
            ],
            "blocking": [...],
            "warnings": [...],
            "info": [...]
        }
    """
    # TODO: Implement actual constraint checking with real data
    # For now, return mock data showing the structure

    checks = [
        {
            "constraint": "max_position_size",
            "policy_type": "capital",
            "passed": True,
            "severity": "block",
            "value_checked": 2500,
            "threshold": 10000,
            "reason": "Position size $2,500 within limit of $10,000"
        },
        {
            "constraint": "max_loss_per_trade",
            "policy_type": "capital",
            "passed": True,
            "severity": "block",
            "value_checked": 250,
            "threshold": 500,
            "reason": "Max loss $250 within limit of $500"
        },
        {
            "constraint": "no_naked_calls",
            "policy_type": "risk",
            "passed": True,
            "severity": "block",
            "value_checked": False,
            "threshold": True,
            "reason": "No naked call positions detected"
        },
        {
            "constraint": "min_days_to_expiration",
            "policy_type": "risk",
            "passed": True,
            "severity": "warn",
            "value_checked": 30,
            "threshold": 7,
            "reason": "DTE 30 days meets minimum of 7 days"
        },
        {
            "constraint": "min_open_interest",
            "policy_type": "liquidity",
            "passed": True,
            "severity": "warn",
            "value_checked": 5000,
            "threshold": 100,
            "reason": "All legs have OI > 100"
        },
        {
            "constraint": "max_bid_ask_spread_pct",
            "policy_type": "liquidity",
            "passed": False,
            "severity": "warn",
            "value_checked": 5.2,
            "threshold": 5.0,
            "reason": "Leg 2 has 5.2% spread, exceeds 5.0% threshold"
        },
        {
            "constraint": "max_delta_exposure",
            "policy_type": "risk",
            "passed": True,
            "severity": "warn",
            "value_checked": 20,
            "threshold": 100,
            "reason": "Net delta 20 within limit of 100"
        },
    ]

    # Separate by severity
    blocking = [c for c in checks if not c["passed"] and c["severity"] == "block"]
    warnings = [c for c in checks if not c["passed"] and c["severity"] == "warn"]
    info = [c for c in checks if not c["passed"] and c["severity"] == "info"]

    # Determine if can proceed
    passed = len(blocking) == 0 and len(warnings) == 0
    can_proceed = len(blocking) == 0  # Can proceed with warnings

    # Build summary
    parts = []
    if blocking:
        parts.append(f"{len(blocking)} blocking")
    if warnings:
        parts.append(f"{len(warnings)} warning{'s' if len(warnings) > 1 else ''}")
    if info:
        parts.append(f"{len(info)} info")

    if not parts:
        summary = "All constraints passed"
    else:
        summary = ", ".join(parts)

    return {
        "passed": passed,
        "can_proceed": can_proceed,
        "summary": summary,
        "total_checks": len(checks),
        "checks": checks,
        "blocking": blocking,
        "warnings": warnings,
        "info": info,
        "_mock": True
    }


def get_available_policies() -> dict:
    """
    Get list of all available constraint policies.

    Returns:
        Dictionary of all configurable policies with their defaults:
        {
            "policies": [
                {
                    "name": "max_position_size",
                    "policy_type": "capital",
                    "description": "Maximum position size in dollars",
                    "default_value": 10000,
                    "default_enabled": true,
                    "severity": "block"
                },
                ...
            ]
        }
    """
    policies = []

    descriptions = {
        "max_position_size": "Maximum position size in dollars",
        "max_loss_per_trade": "Maximum potential loss per trade in dollars",
        "min_buying_power_remaining": "Minimum buying power to keep as percentage",
        "max_delta_exposure": "Maximum net delta exposure",
        "max_vega_exposure": "Maximum vega exposure in dollars",
        "no_naked_calls": "Prohibit naked (uncovered) call positions",
        "no_naked_puts": "Prohibit naked put positions (allow CSPs if false)",
        "min_days_to_expiration": "Minimum DTE for new positions",
        "min_open_interest": "Minimum open interest per leg",
        "max_bid_ask_spread_pct": "Maximum bid-ask spread as percentage",
        "min_volume": "Minimum daily volume per leg",
        "max_margin_usage_pct": "Maximum margin usage percentage",
        "pattern_day_trader_check": "Check for pattern day trader restrictions",
        "options_level_required": "Minimum options approval level required",
    }

    for name, config in DEFAULT_POLICIES.items():
        policies.append({
            "name": name,
            "policy_type": config["policy_type"],
            "description": descriptions.get(name, ""),
            "default_value": config["value"],
            "default_enabled": config["enabled"],
            "severity": config["severity"],
        })

    return {
        "policies": policies,
        "policy_types": [t.value for t in PolicyType],
        "severity_levels": [s.value for s in ConstraintSeverity],
    }


def validate_position_risk(
    legs_json: str,
    underlying_price: float,
    account_buying_power: Optional[float] = None,
) -> dict:
    """
    Quick risk validation focused on position safety.

    Checks for common dangerous setups:
    - Naked positions
    - Undefined risk
    - Excessive leverage
    - Earnings exposure

    Args:
        legs_json: Position legs
        underlying_price: Current stock price
        account_buying_power: Optional account buying power for sizing

    Returns:
        Risk validation result:
        {
            "risk_level": "moderate",
            "defined_risk": true,
            "max_loss": -250,
            "capital_at_risk": 250,
            "leverage_ratio": 1.5,
            "flags": [
                {"flag": "short_gamma", "severity": "warn", "message": "..."}
            ]
        }
    """
    # TODO: Implement actual risk validation
    # For now, return mock data

    return {
        "risk_level": "moderate",  # low, moderate, high, extreme
        "defined_risk": True,
        "max_loss": -250.00,
        "capital_at_risk": 250.00,
        "leverage_ratio": 1.5,
        "margin_requirement": 500.00,
        "flags": [
            {
                "flag": "short_gamma",
                "severity": "info",
                "message": "Position has negative gamma - profits are capped"
            }
        ],
        "recommendation": "Position has defined risk and moderate leverage. Suitable for most accounts.",
        "_mock": True
    }


def check_single_constraint(
    constraint_name: str,
    value: Any,
    threshold: Optional[Any] = None,
) -> dict:
    """
    Check a single constraint with custom value/threshold.

    Useful for real-time validation as user builds position.

    Args:
        constraint_name: Name of constraint to check
        value: Current value to check
        threshold: Optional custom threshold (uses default if not provided)

    Returns:
        Single constraint check result
    """
    policy = DEFAULT_POLICIES.get(constraint_name)

    if not policy:
        return {
            "constraint": constraint_name,
            "passed": False,
            "severity": "block",
            "reason": f"Unknown constraint: {constraint_name}",
            "error": True
        }

    check_threshold = threshold if threshold is not None else policy["value"]

    # Determine pass/fail based on constraint type
    # This is simplified - real implementation would have per-constraint logic
    if isinstance(check_threshold, bool):
        passed = value == check_threshold or (not policy["enabled"])
    elif isinstance(check_threshold, (int, float)):
        if "max" in constraint_name:
            passed = value <= check_threshold
        elif "min" in constraint_name:
            passed = value >= check_threshold
        else:
            passed = value == check_threshold
    else:
        passed = True

    if passed:
        reason = f"{constraint_name}: {value} meets threshold {check_threshold}"
    else:
        reason = f"{constraint_name}: {value} violates threshold {check_threshold}"

    return {
        "constraint": constraint_name,
        "policy_type": policy["policy_type"],
        "passed": passed,
        "severity": policy["severity"],
        "value_checked": value,
        "threshold": check_threshold,
        "reason": reason,
        "_mock": True
    }
