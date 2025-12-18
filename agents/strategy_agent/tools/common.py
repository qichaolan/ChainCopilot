"""
Common utilities for Strategy Builder tools.

Shared helper functions and options data fetching.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime
from typing import List, Dict, Tuple, Any

# Add paths for imports when running as script
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(TOOLS_DIR)
AGENTS_DIR = os.path.dirname(AGENT_DIR)
PROJECT_ROOT = os.path.dirname(AGENTS_DIR)
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, AGENTS_DIR)
sys.path.insert(0, AGENT_DIR)

from lib.openbb.options_fetcher import get_expiration_dates, get_options_chain

from types_ import (
    OptionContract,
    ExpirationGroup,
    StrategyCandidate,
    SimulationResult,
    StrategyType,
    MarketOutlook,
)


# ============================================================================
# Safe Type Conversion Helpers
# ============================================================================

def safe_float(val: Any, default: float = 0.0) -> float:
    """Safely convert value to float, returning default if None or invalid."""
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def safe_int(val: Any, default: int = 0) -> int:
    """Safely convert value to int, returning default if None or invalid."""
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


# ============================================================================
# Options Data Fetching
# ============================================================================

def fetch_options_chain(ticker: str) -> Tuple[List[OptionContract], List[ExpirationGroup], float]:
    """
    Fetch options chain for a ticker.

    Returns:
        Tuple of (contracts, expirations, spot_price)
    """
    ticker = ticker.upper().strip()

    # Get expiration dates with first chain included
    result = get_expiration_dates(ticker, include_first_chain=True)

    # Check for actual error (not just key existence)
    if result.get("error"):
        raise ValueError(result["error"])

    spot_price = result.get("spotPrice") or result.get("underlying_price") or result.get("underlyingPrice") or 100.0
    expirations_raw = result.get("expiration_dates", []) or result.get("expirations", [])
    # The fetcher returns "contracts" not "options"
    options_raw = result.get("contracts", []) or result.get("options", [])

    # Convert to typed contracts
    contracts = _convert_contracts(options_raw)

    # Build expiration groups from ALL expiration dates
    expirations = _build_expiration_groups(expirations_raw, contracts)

    return contracts, expirations, spot_price


def fetch_expiration_chain(ticker: str, expiration: str) -> Tuple[List[OptionContract], float]:
    """
    Fetch options chain for a specific expiration.

    Returns:
        Tuple of (contracts, spot_price)
    """
    ticker = ticker.upper().strip()
    result = get_options_chain(ticker, expiration)

    # get_options_chain returns an OptionsChainResult dataclass, not a dict
    if result.error:
        raise ValueError(result.error)

    spot_price = result.underlying_price or 100.0
    options_raw = result.contracts or []

    # Convert to typed contracts
    contracts = _convert_contracts(options_raw, default_expiration=expiration)

    return contracts, spot_price


def _convert_contracts(
    options_raw: List[Dict],
    default_expiration: str = ""
) -> List[OptionContract]:
    """Convert raw options data to typed OptionContract list."""
    contracts: List[OptionContract] = []

    for opt in options_raw:
        bid = safe_float(opt.get("bid"))
        ask = safe_float(opt.get("ask"))
        mark = safe_float(opt.get("mark")) or (bid + ask) / 2 if (bid + ask) > 0 else 0

        # Handle both snake_case (OpenBB) and camelCase
        option_type = opt.get("option_type") or opt.get("optionType") or ""
        contract_symbol = opt.get("contract_symbol") or opt.get("contractSymbol") or opt.get("symbol") or ""
        open_interest = opt.get("open_interest") or opt.get("openInterest")
        implied_vol = opt.get("implied_volatility") or opt.get("impliedVolatility") or opt.get("iv")
        last_price = opt.get("last_price") or opt.get("lastPrice") or opt.get("last")

        contract: OptionContract = {
            "contractSymbol": contract_symbol,
            "strike": safe_float(opt.get("strike")),
            "expiration": opt.get("expiration") or default_expiration,
            "optionType": "call" if option_type.lower() == "call" else "put",
            "bid": bid,
            "ask": ask,
            "mark": mark,
            "last": safe_float(last_price),
            "volume": safe_int(opt.get("volume")),
            "openInterest": safe_int(open_interest),
            "delta": safe_float(opt.get("delta")),
            "gamma": safe_float(opt.get("gamma")),
            "theta": safe_float(opt.get("theta")),
            "vega": safe_float(opt.get("vega")),
            "iv": safe_float(implied_vol),
            "dte": safe_int(opt.get("dte")),
        }
        contracts.append(contract)

    return contracts


def _build_expiration_groups(
    expirations_raw: List[str],
    contracts: List[OptionContract]
) -> List[ExpirationGroup]:
    """Build expiration groups from expiration dates and contracts."""
    exp_map: Dict[str, ExpirationGroup] = {}
    today = datetime.now().date()

    # Create groups for ALL expiration dates
    for exp_date in expirations_raw:
        try:
            exp_dt = datetime.strptime(exp_date, "%Y-%m-%d").date()
            dte = (exp_dt - today).days
        except ValueError:
            dte = 0

        exp_map[exp_date] = {
            "expiration": exp_date,
            "dte": max(0, dte),
            "callCount": 0,
            "putCount": 0,
            "totalOI": 0,
            "avgIV": 0.0,
        }

    # Update groups that have contract data
    for c in contracts:
        exp = c["expiration"]
        if exp in exp_map:
            group = exp_map[exp]
            if c["optionType"] == "call":
                group["callCount"] += 1
            else:
                group["putCount"] += 1
            group["totalOI"] += c["openInterest"]
            if c["dte"] > 0:
                group["dte"] = c["dte"]

    # Sort by DTE
    expirations = sorted(exp_map.values(), key=lambda x: x["dte"])

    # Calculate avg IV per expiration
    for exp_group in expirations:
        exp_contracts = [c for c in contracts if c["expiration"] == exp_group["expiration"]]
        if exp_contracts:
            total_iv = sum(c["iv"] for c in exp_contracts)
            exp_group["avgIV"] = total_iv / len(exp_contracts)

    return expirations


# ============================================================================
# Score Calculation Helpers
# ============================================================================

def calculate_liquidity_score(
    open_interest: int,
    bid: float = 0,
    ask: float = 0,
    divisor: int = 100
) -> int:
    """
    Calculate liquidity score from open interest and bid-ask spread.

    Args:
        open_interest: Contract open interest
        bid: Bid price (optional)
        ask: Ask price (optional)
        divisor: OI divisor for scaling (default 100)

    Returns:
        Score 0-100 (higher = more liquid)
    """
    # OI component (0-70 points)
    oi_score = min(70, int(open_interest / divisor * 70 / 100))

    # Spread component (0-30 points) - tighter spread = better
    if bid > 0 and ask > 0:
        mid = (bid + ask) / 2
        spread_pct = (ask - bid) / mid if mid > 0 else 1.0
        # 0% spread = 30 pts, 10%+ spread = 0 pts
        spread_score = max(0, int(30 * (1 - spread_pct / 0.10)))
    else:
        spread_score = 15  # Default if no bid/ask

    return min(100, oi_score + spread_score)


def calculate_theta_efficiency(theta: float, mark: float) -> int:
    """
    Calculate theta efficiency score (lower daily decay per dollar = better).

    Args:
        theta: Daily theta decay (typically negative for long positions)
        mark: Option mark price

    Returns:
        Score 0-100 (higher = less theta decay relative to premium)
    """
    if mark <= 0:
        return 50

    # Theta per dollar of premium (daily decay rate)
    theta_per_dollar = abs(theta) / mark

    # Scale: 0% daily decay = 100, 5%+ daily decay = 0
    score = max(0, int(100 * (1 - theta_per_dollar / 0.05)))
    return min(100, score)


def calculate_delta_efficiency(delta: float, mark: float) -> int:
    """
    Calculate delta per dollar (directional exposure per premium paid).

    Args:
        delta: Option delta
        mark: Option mark price (per share)

    Returns:
        Score 0-100 (higher = more delta exposure per dollar)
    """
    if mark <= 0:
        return 50

    # Delta per $100 of premium
    delta_per_100 = abs(delta) / (mark * 100) * 100

    # Scale: higher is better, cap at reasonable levels
    # 0.01 delta per $100 = low, 0.10+ delta per $100 = excellent
    score = min(100, int(delta_per_100 * 1000))
    return score


def calculate_breakeven_hurdle(
    breakeven: float,
    spot_price: float,
    is_call: bool = True
) -> float:
    """
    Calculate breakeven hurdle (% move needed to break even).

    Args:
        breakeven: Breakeven price
        spot_price: Current underlying price
        is_call: True for calls, False for puts

    Returns:
        Percentage move needed (positive = upside, negative = downside)
    """
    if spot_price <= 0:
        return 0.0
    return (breakeven - spot_price) / spot_price * 100


def calculate_breakeven_score(
    breakeven: float,
    spot_price: float,
    is_call: bool = True
) -> int:
    """
    Calculate breakeven score (lower hurdle = better).

    Args:
        breakeven: Breakeven price
        spot_price: Current underlying price
        is_call: True for calls (want low positive hurdle), False for puts (want low negative hurdle)

    Returns:
        Score 0-100 (higher = easier to reach breakeven)
    """
    hurdle = calculate_breakeven_hurdle(breakeven, spot_price, is_call)

    if is_call:
        # For calls: 0% hurdle = 100, 20%+ hurdle = 0
        if hurdle <= 0:
            return 100  # Already ITM
        score = max(0, int(100 * (1 - hurdle / 20)))
    else:
        # For puts: 0% hurdle = 100, -20%+ hurdle = 0
        if hurdle >= 0:
            return 100  # Already ITM
        score = max(0, int(100 * (1 + hurdle / 20)))

    return min(100, score)


# Legacy alias for backward compatibility
def calculate_theta_burn_score(theta: float, mark: float) -> int:
    """Legacy alias for calculate_theta_efficiency."""
    return calculate_theta_efficiency(theta, mark)


def calculate_delta_suitability(delta: float) -> int:
    """Calculate delta suitability score (simple version)."""
    return min(100, int(abs(delta) * 100))
