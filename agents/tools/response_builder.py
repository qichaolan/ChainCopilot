"""
Response Builder Tool
Guarantees strict JSON output for all agent responses.
Supports 3-phase HITL workflow with nextStep actions.
"""

import json
from typing import Optional, List, Any
from datetime import datetime


# === Phase 1: Strategy Suggest ===

def build_strategy_suggest_response(
    symbol: str,
    intent_summary: str,
    strategies: List[dict],
    underlying_price: Optional[float] = None,
    iv_rank: Optional[float] = None,
) -> str:
    """
    Build response for Phase 1: Strategy Suggest.

    Returns strategy TYPES (not legs) with nextStep = "choose_strategy".
    """
    validated_strategies = []
    for i, strategy in enumerate(strategies[:10]):
        validated_strategies.append({
            "rank": strategy.get("rank", i + 1),
            "strategy_type": str(strategy.get("strategy_type", "unknown")),
            "display_name": str(strategy.get("display_name", strategy.get("strategy_type", "Unknown"))),
            "description": str(strategy.get("description", "")),
            "expiry_suggestion": str(strategy.get("expiry_suggestion", "")),
            "credit_or_debit": str(strategy.get("credit_or_debit", "either")),
            "risk_profile": str(strategy.get("risk_profile", "defined")),
            "fit_score": _safe_int(strategy.get("fit_score", 0)),
            "why": strategy.get("why", []),
            "liquidity_feasible": bool(strategy.get("liquidity_feasible", True)),
        })

    response = {
        "phase": "strategy_suggest",
        "success": True,
        "data": {
            "symbol": str(symbol).upper(),
            "underlying_price": _safe_float(underlying_price) if underlying_price else None,
            "iv_rank": _safe_float(iv_rank) if iv_rank else None,
            "intent_summary": str(intent_summary),
            "strategy_count": len(validated_strategies),
            "strategies": validated_strategies,
        },
        "nextStep": {
            "action": "choose_strategy",
            "message": "Select a strategy type to see leg candidates",
            "required": True,
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    return json.dumps(response, indent=2, default=str)


# === Phase 2: Legs Ranking ===

def build_legs_rank_response(
    symbol: str,
    strategy_type: str,
    expiration: str,
    candidates: List[dict],
    risk_checks: List[dict],
    underlying_price: Optional[float] = None,
) -> str:
    """
    Build response for Phase 2: Legs Ranking.

    Returns leg candidates with nextStep = "choose_legs_candidate" or "requires_user_override".
    """
    validated_candidates = []
    for i, candidate in enumerate(candidates[:10]):
        validated_candidates.append({
            "rank": candidate.get("rank", i + 1),
            "candidate_id": str(candidate.get("candidate_id", f"candidate_{i+1}")),
            "legs": _validate_legs(candidate.get("legs", [])),
            "metrics": {
                "credit_debit": _safe_float(candidate.get("credit_debit", candidate.get("credit", 0))),
                "max_profit": _safe_float(candidate.get("max_profit", 0)),
                "max_loss": _safe_float(candidate.get("max_loss", 0)),
                "breakeven": _safe_float(candidate.get("breakeven")) if candidate.get("breakeven") else None,
                "breakevens": _safe_float_list(candidate.get("breakevens", [])),
                "pop": _safe_float(candidate.get("pop", 50)),
            },
            "fit_score": _safe_int(candidate.get("fit_score", 0)),
            "why": candidate.get("why", []),
            "risk_flags": candidate.get("risk_flags", ["Monitor position"]),
        })

    # Validate risk checks
    validated_checks = []
    has_failure = False
    failed_checks = []
    for check in risk_checks:
        status = str(check.get("status", "pass"))
        if status == "fail":
            has_failure = True
            failed_checks.append(check.get("message", "Check failed"))
        validated_checks.append({
            "check": str(check.get("check", "")),
            "status": status,
            "message": str(check.get("message", "")),
        })

    # Determine nextStep based on risk checks
    if has_failure:
        next_step = {
            "action": "requires_user_override",
            "message": "Some candidates exceed risk limits. Acknowledge to proceed.",
            "required": True,
            "failed_checks": failed_checks,
        }
    else:
        next_step = {
            "action": "choose_legs_candidate",
            "message": "Select a candidate for detailed analysis",
            "required": True,
        }

    response = {
        "phase": "legs_rank",
        "success": True,
        "data": {
            "symbol": str(symbol).upper(),
            "underlying_price": _safe_float(underlying_price) if underlying_price else None,
            "strategy_type": str(strategy_type),
            "expiration": str(expiration),
            "candidate_count": len(validated_candidates),
            "candidates": validated_candidates,
            "risk_checks": validated_checks,
        },
        "nextStep": next_step,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    return json.dumps(response, indent=2, default=str)


# === Phase 3: Deep Analysis ===

def build_deep_analysis_response(
    symbol: str,
    strategy_type: str,
    legs: List[dict],
    underlying_price: float,
    payoff: dict,
    probability: dict,
    greeks: dict,
    liquidity: dict,
    constraints: dict,
    suggestion: dict,
    summary: str,
) -> str:
    """
    Build response for Phase 3: Deep Analysis.

    Returns detailed analysis with nextStep = "ready_for_review".
    """
    response = {
        "phase": "legs_deep_analysis",
        "success": True,
        "data": {
            "position": {
                "symbol": str(symbol).upper(),
                "strategy_type": str(strategy_type),
                "legs": _validate_legs(legs),
                "underlying_price": _safe_float(underlying_price),
            },
            "analysis": {
                "payoff": _validate_payoff(payoff),
                "probability": _validate_probability(probability),
                "greeks": _validate_greeks(greeks),
                "liquidity": _validate_liquidity(liquidity),
            },
            "constraints": {
                "passed": bool(constraints.get("passed", True)),
                "can_proceed": bool(constraints.get("can_proceed", True)),
                "checks": constraints.get("checks", []),
            },
            "suggestion": _validate_suggestion(suggestion),
            "summary": str(summary),
        },
        "nextStep": {
            "action": "ready_for_review",
            "options": ["modify_position", "save_plan", "start_over"],
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    return json.dumps(response, indent=2, default=str)


# === Error Response ===

def build_error_response(
    phase: str,
    error_code: str,
    error_message: str,
    details: Optional[dict] = None,
) -> str:
    """Build a strict JSON error response."""
    response = {
        "phase": str(phase),
        "success": False,
        "error": {
            "code": str(error_code),
            "message": str(error_message),
            "details": details if details else None,
        },
        "nextStep": {
            "action": "handle_error",
            "options": ["retry", "modify_input", "start_over"],
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    return json.dumps(response, indent=2, default=str)


# === Validation Helpers ===

def _safe_float(value: Any, default: float = 0.0) -> float:
    """Safely convert value to float."""
    if value is None:
        return default
    try:
        result = float(value)
        if result == float('inf'):
            return 999999.99
        if result == float('-inf'):
            return -999999.99
        return round(result, 2)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    """Safely convert value to int."""
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float_list(values: List[Any]) -> List[float]:
    """Safely convert list to float list."""
    if not isinstance(values, list):
        return []
    return [_safe_float(v) for v in values]


def _validate_legs(legs: List[dict]) -> List[dict]:
    """Validate and clean leg data."""
    validated = []
    for leg in legs:
        validated.append({
            "leg_id": str(leg.get("leg_id", f"leg_{len(validated) + 1}")),
            "option_type": str(leg.get("option_type", "call")).lower(),
            "strike": _safe_float(leg.get("strike")),
            "expiration": str(leg.get("expiration", "")),
            "quantity": int(leg.get("quantity", 0)),
            "mark": _safe_float(leg.get("mark")),
            "bid": _safe_float(leg.get("bid")) if leg.get("bid") else None,
            "ask": _safe_float(leg.get("ask")) if leg.get("ask") else None,
        })
    return validated


def _validate_payoff(payoff: dict) -> dict:
    """Validate payoff analysis."""
    return {
        "credit_debit": _safe_float(payoff.get("credit_debit", payoff.get("net_credit_debit", 0))),
        "max_profit": _safe_float(payoff.get("max_profit", 0)),
        "max_loss": _safe_float(payoff.get("max_loss", 0)),
        "breakevens": _safe_float_list(payoff.get("breakevens", payoff.get("breakeven_points", []))),
        "payoff_curve": payoff.get("payoff_curve", []),
    }


def _validate_probability(probability: dict) -> dict:
    """Validate probability heuristics."""
    return {
        "pop": _safe_float(probability.get("pop", probability.get("delta_based_pop", 50))),
        "expected_move_1sd": _safe_float(probability.get("expected_move_1sd", 0)),
        "expected_move_2sd": _safe_float(probability.get("expected_move_2sd", 0)),
        "prob_above_breakeven": _safe_float(probability.get("prob_above_breakeven", 0)),
        "notes": probability.get("notes", probability.get("confidence_notes", [])),
    }


def _validate_greeks(greeks: dict) -> dict:
    """Validate Greeks exposure."""
    return {
        "delta": _safe_float(greeks.get("delta", greeks.get("net_delta", 0))),
        "gamma": _safe_float(greeks.get("gamma", greeks.get("net_gamma", 0))),
        "theta": _safe_float(greeks.get("theta", greeks.get("net_theta", 0))),
        "vega": _safe_float(greeks.get("vega", greeks.get("net_vega", 0))),
        "gamma_warning": greeks.get("gamma_warning"),
    }


def _validate_liquidity(liquidity: dict) -> dict:
    """Validate liquidity analysis."""
    return {
        "overall_score": str(liquidity.get("overall_score", "unknown")),
        "execution_estimate": str(liquidity.get("execution_estimate", "")),
        "legs": liquidity.get("legs", []),
        "warnings": liquidity.get("warnings", liquidity.get("execution_warnings", [])),
    }


def _validate_suggestion(suggestion: dict) -> dict:
    """Validate suggestion."""
    return {
        "type": str(suggestion.get("type", suggestion.get("suggestion_type", "none"))),
        "description": str(suggestion.get("description", "")),
        "rationale": str(suggestion.get("rationale", "")),
        "expected_improvement": suggestion.get("expected_improvement", {}),
    }


# === Main Tool Function ===

def build_response(
    phase: str,
    data: dict,
) -> str:
    """
    Main tool function: Build strict JSON response for any phase.

    Args:
        phase: "strategy_suggest", "legs_rank", "legs_deep_analysis", or "error"
        data: Dictionary containing all required data for the phase

    Returns:
        Strict JSON string guaranteed to be parseable

    Example Usage:
        # Phase 1: Strategy Suggest
        build_response("strategy_suggest", {
            "symbol": "AAPL",
            "intent_summary": "Bullish, income goal, max loss $500",
            "strategies": [...],
            "underlying_price": 185.50,
            "iv_rank": 35.0
        })

        # Phase 2: Legs Ranking
        build_response("legs_rank", {
            "symbol": "AAPL",
            "strategy_type": "bull_put_spread",
            "expiration": "2024-02-16",
            "candidates": [...],
            "risk_checks": [...],
            "underlying_price": 185.50
        })

        # Phase 3: Deep Analysis
        build_response("legs_deep_analysis", {
            "symbol": "AAPL",
            "strategy_type": "bull_put_spread",
            "legs": [...],
            "underlying_price": 185.50,
            "payoff": {...},
            "probability": {...},
            "greeks": {...},
            "liquidity": {...},
            "constraints": {...},
            "suggestion": {...},
            "summary": "Strong income play..."
        })

        # Error
        build_response("error", {
            "phase": "strategy_suggest",
            "code": "INVALID_TICKER",
            "message": "Ticker not found"
        })
    """
    try:
        if phase == "strategy_suggest":
            return build_strategy_suggest_response(
                symbol=data.get("symbol", ""),
                intent_summary=data.get("intent_summary", ""),
                strategies=data.get("strategies", []),
                underlying_price=data.get("underlying_price"),
                iv_rank=data.get("iv_rank"),
            )
        elif phase == "legs_rank":
            return build_legs_rank_response(
                symbol=data.get("symbol", ""),
                strategy_type=data.get("strategy_type", ""),
                expiration=data.get("expiration", ""),
                candidates=data.get("candidates", []),
                risk_checks=data.get("risk_checks", []),
                underlying_price=data.get("underlying_price"),
            )
        elif phase == "legs_deep_analysis":
            return build_deep_analysis_response(
                symbol=data.get("symbol", ""),
                strategy_type=data.get("strategy_type", ""),
                legs=data.get("legs", []),
                underlying_price=data.get("underlying_price", 0),
                payoff=data.get("payoff", {}),
                probability=data.get("probability", {}),
                greeks=data.get("greeks", {}),
                liquidity=data.get("liquidity", {}),
                constraints=data.get("constraints", {}),
                suggestion=data.get("suggestion", {}),
                summary=data.get("summary", ""),
            )
        elif phase == "error":
            return build_error_response(
                phase=data.get("phase", "unknown"),
                error_code=data.get("code", "UNKNOWN_ERROR"),
                error_message=data.get("message", "An unknown error occurred"),
                details=data.get("details"),
            )
        else:
            return build_error_response(
                phase="unknown",
                error_code="INVALID_PHASE",
                error_message=f"Unknown phase: {phase}. Use: strategy_suggest, legs_rank, legs_deep_analysis, error",
            )
    except Exception as e:
        return build_error_response(
            phase=phase,
            error_code="BUILD_ERROR",
            error_message=f"Failed to build response: {str(e)}",
        )


# === Legacy Aliases (for backwards compatibility) ===

def build_phase1_response(*args, **kwargs):
    """Legacy alias for build_strategy_suggest_response."""
    return build_strategy_suggest_response(*args, **kwargs)


def build_phase2_response(*args, **kwargs):
    """Legacy alias for build_deep_analysis_response."""
    return build_deep_analysis_response(*args, **kwargs)
