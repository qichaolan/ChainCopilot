"""
Intent Parser Tool
Takes structured UX parameters (flat args), validates them, and returns normalized knobs.
Router uses output to determine which phase to run.
"""

from typing import Optional, List


# === Enums for Validation ===

VALID_DIRECTIONS = ["bullish", "bearish", "neutral"]
VALID_VOLATILITY = ["up", "down", "unsure"]
VALID_TIMEFRAMES = ["week", "month", "year", "leaps"]
VALID_CREDIT_DEBIT = ["credit", "debit", "either"]
VALID_GOALS = ["income", "high_probability", "big_upside", "hedge", "stock_replacement"]

# Valid strategy types for Phase 2 routing
VALID_STRATEGIES = [
    "bull_put_spread",
    "bear_call_spread",
    "bull_call_spread",
    "bear_put_spread",
    "iron_condor",
    "iron_butterfly",
    "call_debit_spread",
    "put_debit_spread",
    "covered_call",
    "cash_secured_put",
    "protective_put",
    "collar",
    "long_straddle",
    "long_strangle",
    "short_straddle",
    "short_strangle",
    "calendar_spread",
    "diagonal_spread",
    "leaps_call",
    "leaps_put",
]

# Valid phases for explicit routing override
VALID_PHASES = ["auto", "strategy_suggest", "legs_rank", "legs_deep_analysis"]

# Valid data policies for scope
VALID_DATA_POLICIES = ["visible_or_selected_only", "agent_may_fetch_more"]

# Valid leg sides and types for builder_state_legs validation
VALID_LEG_SIDES = ["BUY", "SELL", "buy", "sell"]
VALID_LEG_TYPES = ["CALL", "PUT", "call", "put"]

# DTE mapping for timeframes
TIMEFRAME_TO_DTE = {
    "week": {"min": 0, "max": 7, "target": 5},
    "month": {"min": 8, "max": 45, "target": 30},
    "year": {"min": 46, "max": 365, "target": 180},
    "leaps": {"min": 366, "max": 730, "target": 450},
}

# Prediction bounds
PREDICTED_PCT_MIN = -50.0
PREDICTED_PCT_MAX = 100.0


# === Main Parser Function ===

def parse_strategy_intent(
    # Required fields
    symbol: str,
    market_view_direction: str,
    market_view_volatility: str,
    timeframe: str,
    risk_max_loss_usd: float,
    credit_or_debit: str,
    goal: str,
    execution_max_bid_ask_pct: float,
    # Optional fields
    market_view_predicted_annual_increase_pct: Optional[float] = None,
    risk_defined_risk_only: Optional[bool] = None,
    execution_min_open_interest: Optional[int] = None,
    avoid_assignment_risk: Optional[bool] = None,
    top_n: Optional[int] = None,
    # Scope parameters (prevents "strike not in view" errors)
    scope_data_policy: Optional[str] = None,
    scope_selected_expiration: Optional[str] = None,
    scope_included_strikes: Optional[List[float]] = None,
    # Phase routing fields (determines which phase to run)
    phase: Optional[str] = None,  # Explicit routing override
    requested_strategy_type: Optional[str] = None,
    builder_state_legs: Optional[List[dict]] = None,
    selected_candidate_rank: Optional[int] = None,
) -> dict:
    """
    Validate structured UX parameters and return normalized knobs.

    This is the entry point for the agent. The output includes:
    1. Validated/normalized intent parameters
    2. Routing context to determine which phase to run

    Routing Logic (HITL enforced):
    - "strategy_suggest" (Phase 1): Default, no valid requestedStrategyType
    - "legs_rank" (Phase 2): Auto-triggers when valid requestedStrategyType provided
    - "legs_deep_analysis" (Phase 3): MUST be explicitly requested via phase param
      (having legs alone does NOT auto-trigger Phase 3 - this enforces HITL checkpoint)

    Args:
        symbol: Ticker symbol (e.g., "AAPL", "SPY", max 10 chars)
        market_view_direction: "bullish", "bearish", "neutral"
        market_view_volatility: "up", "down", "unsure"
        timeframe: "week", "month", "year", "leaps"
        risk_max_loss_usd: Max dollar loss ($50-$100,000)
        credit_or_debit: "credit", "debit", "either"
        goal: "income", "high_probability", "big_upside", "hedge", "stock_replacement"
        execution_max_bid_ask_pct: Max spread % (0.1-5.0)
        market_view_predicted_annual_increase_pct: Optional annual % prediction (-50 to +100)
        risk_defined_risk_only: If True, no naked options (default: True)
        execution_min_open_interest: Min OI per leg (default: 500)
        avoid_assignment_risk: If True, avoid ITM shorts (default: True)
        top_n: Number of candidates to return (1-50, default: 10)
        scope_data_policy: "visible_or_selected_only" | "agent_may_fetch_more"
        scope_selected_expiration: Selected expiration date (YYYY-MM-DD)
        scope_included_strikes: List of strikes visible in UI
        phase: Explicit routing override ("auto", "strategy_suggest", "legs_rank", "legs_deep_analysis")
        requested_strategy_type: If valid, triggers Phase 2 (else warning + fallback to Phase 1)
        builder_state_legs: If valid, triggers Phase 3. Each leg needs: side, type, strike, qty
        selected_candidate_rank: Which candidate user selected in Phase 2
    Returns:
        {
            "success": true/false,
            "intent": { ...normalized knobs... },
            "routing": {
                "phase": "strategy_suggest" | "legs_rank" | "legs_deep_analysis",
                "requestedStrategyType": "bull_put_spread" | null,
                "builderStateLegs": [...] | null,
                "selectedCandidateRank": 1 | null
            },
            "errors": [],
            "warnings": []
        }
    """
    errors: List[str] = []
    warnings: List[str] = []

    # === Validate Required Fields ===

    # Symbol (allow up to 10 chars for ETFs/foreign tickers)
    v_symbol = None
    if not symbol:
        errors.append("symbol is required")
    elif not str(symbol).replace(".", "").replace("-", "").isalpha():  # Allow BRK.B, BRK-B style
        errors.append(f"Invalid symbol: {symbol}")
    elif len(symbol) > 10:
        errors.append(f"Symbol too long: {symbol}")
    else:
        v_symbol = str(symbol).upper()

    # Direction
    v_direction = None
    if not market_view_direction:
        errors.append("market_view_direction is required")
    elif str(market_view_direction).lower() not in VALID_DIRECTIONS:
        errors.append(f"Invalid direction: {market_view_direction}. Use: {VALID_DIRECTIONS}")
    else:
        v_direction = str(market_view_direction).lower()

    # Volatility
    v_volatility = None
    if not market_view_volatility:
        errors.append("market_view_volatility is required")
    elif str(market_view_volatility).lower() not in VALID_VOLATILITY:
        errors.append(f"Invalid volatility: {market_view_volatility}. Use: {VALID_VOLATILITY}")
    else:
        v_volatility = str(market_view_volatility).lower()

    # Timeframe
    v_timeframe = None
    v_dte_range = None
    if not timeframe:
        errors.append("timeframe is required")
    elif str(timeframe).lower() not in VALID_TIMEFRAMES:
        errors.append(f"Invalid timeframe: {timeframe}. Use: {VALID_TIMEFRAMES}")
    else:
        v_timeframe = str(timeframe).lower()
        v_dte_range = TIMEFRAME_TO_DTE[v_timeframe]

    # Max Loss
    v_max_loss = None
    try:
        v_max_loss = float(risk_max_loss_usd)
        if v_max_loss < 50:
            errors.append("risk_max_loss_usd must be at least $50")
        elif v_max_loss > 100000:
            errors.append("risk_max_loss_usd cannot exceed $100,000")
    except (TypeError, ValueError):
        errors.append("risk_max_loss_usd must be a number")

    # Credit/Debit
    v_credit_debit = None
    if not credit_or_debit:
        errors.append("credit_or_debit is required")
    elif str(credit_or_debit).lower() not in VALID_CREDIT_DEBIT:
        errors.append(f"Invalid credit_or_debit: {credit_or_debit}. Use: {VALID_CREDIT_DEBIT}")
    else:
        v_credit_debit = str(credit_or_debit).lower()

    # Goal
    v_goal = None
    if not goal:
        errors.append("goal is required")
    elif str(goal).lower() not in VALID_GOALS:
        errors.append(f"Invalid goal: {goal}. Use: {VALID_GOALS}")
    else:
        v_goal = str(goal).lower()

    # Max Bid-Ask
    v_max_bid_ask = None
    try:
        v_max_bid_ask = float(execution_max_bid_ask_pct)
        if v_max_bid_ask < 0.1:
            errors.append("execution_max_bid_ask_pct must be at least 0.1%")
        elif v_max_bid_ask > 5.0:
            errors.append("execution_max_bid_ask_pct cannot exceed 5.0%")
    except (TypeError, ValueError):
        errors.append("execution_max_bid_ask_pct must be a number")

    # === Validate Optional Fields ===

    # Predicted annual increase (bounds: -50% to +100%)
    v_predicted_pct = None
    if market_view_predicted_annual_increase_pct is not None:
        try:
            v_predicted_pct = float(market_view_predicted_annual_increase_pct)
            # Bounds check with clamping
            if v_predicted_pct < PREDICTED_PCT_MIN:
                warnings.append(f"Prediction {v_predicted_pct}% clamped to {PREDICTED_PCT_MIN}%")
                v_predicted_pct = PREDICTED_PCT_MIN
            elif v_predicted_pct > PREDICTED_PCT_MAX:
                warnings.append(f"Prediction {v_predicted_pct}% clamped to {PREDICTED_PCT_MAX}%")
                v_predicted_pct = PREDICTED_PCT_MAX
            # Consistency check
            if v_direction == "bullish" and v_predicted_pct < 0:
                warnings.append("Negative prediction with bullish direction")
            elif v_direction == "bearish" and v_predicted_pct > 0:
                warnings.append("Positive prediction with bearish direction")
        except (TypeError, ValueError):
            warnings.append("Invalid predicted_annual_increase_pct, ignoring")

    # Defined risk only (default: True for safety)
    v_defined_risk = True
    if risk_defined_risk_only is not None:
        v_defined_risk = bool(risk_defined_risk_only)

    # Min open interest (default: 500 for better liquidity)
    v_min_oi = 500
    if execution_min_open_interest is not None:
        try:
            v_min_oi = max(0, int(execution_min_open_interest))
        except (TypeError, ValueError):
            warnings.append("Invalid min_open_interest, using default 500")

    # Avoid assignment risk (default: True - safer for retail users)
    v_avoid_assignment = True
    if avoid_assignment_risk is not None:
        v_avoid_assignment = bool(avoid_assignment_risk)

    # Top N (default: 10)
    v_top_n = 10
    if top_n is not None:
        try:
            v_top_n = int(top_n)
            if v_top_n < 1:
                v_top_n = 1
                warnings.append("top_n must be at least 1, using 1")
            elif v_top_n > 50:
                v_top_n = 50
                warnings.append("top_n cannot exceed 50, using 50")
        except (TypeError, ValueError):
            warnings.append("Invalid top_n, using default 10")

    # === Validate Scope Parameters ===

    v_data_policy = "visible_or_selected_only"  # Default: conservative
    if scope_data_policy is not None:
        if str(scope_data_policy).lower() in VALID_DATA_POLICIES:
            v_data_policy = str(scope_data_policy).lower()
        else:
            warnings.append(f"Invalid scope_data_policy: {scope_data_policy}, using default")

    v_selected_exp = None
    if scope_selected_expiration is not None:
        # Basic date format validation (YYYY-MM-DD)
        exp_str = str(scope_selected_expiration)
        if len(exp_str) == 10 and exp_str[4] == "-" and exp_str[7] == "-":
            v_selected_exp = exp_str
        else:
            warnings.append(f"Invalid scope_selected_expiration format: {scope_selected_expiration}")

    v_strikes: List[float] = []
    if scope_included_strikes is not None:
        if isinstance(scope_included_strikes, list):
            for s in scope_included_strikes:
                try:
                    strike_val = float(s)
                    if strike_val > 0:
                        v_strikes.append(strike_val)
                except (TypeError, ValueError):
                    pass
            if len(v_strikes) != len(scope_included_strikes):
                warnings.append("Some invalid strikes in scope_included_strikes were ignored")

    # === Validate Routing Fields ===

    # Validate requested_strategy_type (warning + fallback to Phase 1 if invalid)
    v_requested_strategy = None
    if requested_strategy_type:
        strategy_lower = str(requested_strategy_type).lower()
        if strategy_lower in VALID_STRATEGIES:
            v_requested_strategy = strategy_lower
        else:
            warnings.append(
                f"Unknown strategy type '{requested_strategy_type}', falling back to Phase 1. "
                f"Valid types: {VALID_STRATEGIES[:5]}..."
            )

    # Validate builder_state_legs shape (minimal schema validation)
    v_builder_legs: List[dict] = []
    if builder_state_legs and len(builder_state_legs) > 0:
        for i, leg in enumerate(builder_state_legs):
            if not isinstance(leg, dict):
                errors.append(f"builder_state_legs[{i}] must be a dict")
                continue

            leg_errors = []

            # Validate side
            side = leg.get("side")
            if side is None or str(side).upper() not in [s.upper() for s in VALID_LEG_SIDES]:
                leg_errors.append(f"invalid side '{side}'")

            # Validate type
            leg_type = leg.get("type")
            if leg_type is None or str(leg_type).upper() not in [t.upper() for t in VALID_LEG_TYPES]:
                leg_errors.append(f"invalid type '{leg_type}'")

            # Validate strike
            strike = leg.get("strike")
            try:
                strike_val = float(strike) if strike is not None else 0
                if strike_val <= 0:
                    leg_errors.append("strike must be > 0")
            except (TypeError, ValueError):
                leg_errors.append(f"invalid strike '{strike}'")

            # Validate qty
            qty = leg.get("qty", leg.get("quantity"))
            try:
                qty_val = int(qty) if qty is not None else 0
                if qty_val < 1:
                    leg_errors.append("qty must be >= 1")
            except (TypeError, ValueError):
                leg_errors.append(f"invalid qty '{qty}'")

            if leg_errors:
                errors.append(f"builder_state_legs[{i}]: {', '.join(leg_errors)}")
            else:
                # Normalize the leg
                v_builder_legs.append({
                    "side": str(side).upper(),
                    "type": str(leg_type).upper(),
                    "strike": float(strike),
                    "qty": int(qty) if qty else int(leg.get("quantity", 1)),
                    "expiration": leg.get("expiration", v_selected_exp),
                })

    # === Determine Routing Phase ===

    # 1) Explicit phase override always wins
    v_phase = None
    if phase is not None and phase != "auto":
        phase_lower = str(phase).lower()
        if phase_lower in VALID_PHASES and phase_lower != "auto":
            v_phase = phase_lower
        else:
            warnings.append(f"Invalid phase '{phase}', using auto-routing")

    # 2) Auto-routing (NO implicit Phase 3)
    if v_phase is None:
        if v_requested_strategy:
            v_phase = "legs_rank"
        else:
            v_phase = "strategy_suggest"

    # === Build Response ===

    if errors:
        return {
            "success": False,
            "intent": None,
            "routing": {
                "phase": "error",
                "requestedStrategyType": v_requested_strategy,
                "builderStateLegs": v_builder_legs if v_builder_legs else None,
                "selectedCandidateRank": selected_candidate_rank,
            },
            "errors": errors,
            "warnings": warnings,
        }

    return {
        "success": True,
        "intent": {
            "symbol": v_symbol,
            "marketView": {
                "direction": v_direction,
                "volatility": v_volatility,
                "predictedAnnualIncreasePct": v_predicted_pct,
            },
            "timeframe": v_timeframe,
            "dteRange": v_dte_range,
            "risk": {
                "maxLossUsd": v_max_loss,
                "definedRiskOnly": v_defined_risk,
            },
            "creditOrDebit": v_credit_debit,
            "goal": v_goal,
            "execution": {
                "minOpenInterest": v_min_oi,
                "maxBidAskPct": v_max_bid_ask,
            },
            "avoidAssignmentRisk": v_avoid_assignment,
            "topN": v_top_n,
            "scope": {
                "dataPolicy": v_data_policy,
                "selectedExpiration": v_selected_exp,
                "includedStrikes": v_strikes if v_strikes else None,
            },
        },
        "routing": {
            "phase": v_phase,
            "requestedStrategyType": v_requested_strategy,
            "builderStateLegs": v_builder_legs if v_builder_legs else None,
            "selectedCandidateRank": selected_candidate_rank,
        },
        "errors": [],
        "warnings": warnings,
    }


def build_intent_summary(intent: dict) -> str:
    """
    Build a human-readable summary of the intent for display.

    Args:
        intent: The validated intent object from parse_strategy_intent

    Returns:
        Summary string like "Bullish AAPL, income goal, max loss $500, 30 DTE"
    """
    if not intent:
        return ""

    parts = []

    # Direction + Symbol
    direction = intent.get("marketView", {}).get("direction", "").capitalize()
    symbol = intent.get("symbol", "")
    if direction and symbol:
        parts.append(f"{direction} {symbol}")

    # Goal
    goal = intent.get("goal", "")
    if goal:
        parts.append(f"{goal.replace('_', ' ')} goal")

    # Credit/Debit preference
    cd = intent.get("creditOrDebit", "")
    if cd and cd != "either":
        parts.append(f"{cd} preferred")

    # Max loss
    max_loss = intent.get("risk", {}).get("maxLossUsd")
    if max_loss:
        parts.append(f"max loss ${int(max_loss)}")

    # DTE
    dte_range = intent.get("dteRange", {})
    if dte_range:
        target = dte_range.get("target", 30)
        parts.append(f"{target} DTE")

    return ", ".join(parts)
