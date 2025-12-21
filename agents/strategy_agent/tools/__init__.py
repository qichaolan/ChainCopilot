"""
Strategy Builder Tools Package.

Provides modular strategy generation tools:
- Common utilities and options data fetching
- Individual strategy generators (long call, long put, credit spread, iron condor)
- Simulation and P&L calculation
"""

from __future__ import annotations

from typing import List

import os
import sys

# Add paths for imports
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, AGENT_DIR)

from types_ import OptionContract, StrategyCandidate, StrategyType, MarketOutlook

# Import from submodules
from tools.common import (
    safe_float,
    safe_int,
    fetch_options_chain,
    fetch_expiration_chain,
    calculate_liquidity_score,
    calculate_theta_burn_score,
    calculate_delta_suitability,
)

from tools.long_call_strategy import generate_long_calls
from tools.long_put_strategy import generate_long_puts
from tools.credit_spread_strategy import generate_credit_spreads
from tools.iron_condor_strategy import generate_iron_condors
from tools.leaps_strategy import generate_leaps
from tools.simulation import (
    simulate_candidates,
    simulate_candidate_with_assumptions,
    build_assumptions,
    build_iv_based_assumptions,
    generate_scenario_moves,
    detect_horizon_type,
    format_assumptions_summary,
    compute_projected_price,
    compute_annualized_growth,
    calculate_roi_at_price,
    calculate_roi_score,
    calculate_reward_score,
    DEFAULT_ASSUMPTIONS,
    DEFAULT_ANNUAL_GROWTH_PCT,
)
from tools.risk_assessment import (
    assess_long_option_risks,
    assess_credit_spread_risks,
    assess_iron_condor_risks,
    assess_leaps_risks,
    TradingStyle,
    RiskLevel,
)
from tools.expected_move_ai import (
    get_expected_move_from_ai,
    get_sector_fallback_return,
    DEFAULT_EXPECTED_MOVE_PCT,
    SECTOR_FALLBACK_RETURNS,
)


# ============================================================================
# Main Strategy Generator Orchestrator
# ============================================================================

def generate_candidates(
    contracts: List[OptionContract],
    strategy: StrategyType,
    outlook: MarketOutlook,
    budget: float,
    spot_price: float,
    trader_profile: str = "stock_replacement",
    expected_move_pct: float = 0.10,
) -> List[StrategyCandidate]:
    """
    Generate strategy candidates based on parameters.

    This is the main orchestrator that routes to specific strategy generators.

    Args:
        contracts: List of option contracts
        strategy: Strategy type to generate
        outlook: Market outlook (bullish/bearish/neutral)
        budget: Capital budget in dollars
        spot_price: Current underlying price
        trader_profile: Trader profile for scoring ('income', 'momentum', 'stock_replacement', 'speculator', 'hedger')
        expected_move_pct: Expected price move % for ROI scoring (0.10 = 10%)

    Returns:
        List of candidates sorted by overall score (descending)
    """
    candidates: List[StrategyCandidate] = []

    if strategy == "long_call":
        candidates = generate_long_calls(contracts, budget, spot_price)

    elif strategy == "long_put":
        candidates = generate_long_puts(contracts, budget, spot_price)

    elif strategy == "credit_spread":
        candidates = generate_credit_spreads(contracts, outlook, budget, spot_price)

    elif strategy == "iron_condor":
        candidates = generate_iron_condors(contracts, budget, spot_price)

    elif strategy == "leaps":
        # LEAPS with dedicated generator (long-dated, higher delta)
        # Build assumptions from user-provided expected move
        # Get representative DTE from contracts for assumption building
        leaps_contracts = [c for c in contracts if c.get("dte", 0) >= 540]
        avg_dte = int(sum(c.get("dte", 540) for c in leaps_contracts) / max(len(leaps_contracts), 1)) if leaps_contracts else 540

        # Build assumptions with user-provided expected move (stress = 2x expected auto)
        assumptions = build_assumptions(
            dte=avg_dte,
            custom_expected_move=expected_move_pct,
            spot_price=spot_price,
        )

        candidates = generate_leaps(
            contracts, outlook, budget, spot_price,
            assumptions=assumptions,
            profile_override=trader_profile,
        )

    else:
        # Default to long calls
        candidates = generate_long_calls(contracts, outlook, budget, spot_price)

    # Sort by overall score (descending)
    return sorted(candidates, key=lambda c: c["overallScore"], reverse=True)


# ============================================================================
# Public API
# ============================================================================

__all__ = [
    # Common utilities
    "safe_float",
    "safe_int",
    "fetch_options_chain",
    "fetch_expiration_chain",
    "calculate_liquidity_score",
    "calculate_theta_burn_score",
    "calculate_delta_suitability",
    # Strategy generators
    "generate_candidates",
    "generate_long_calls",
    "generate_long_puts",
    "generate_credit_spreads",
    "generate_iron_condors",
    "generate_leaps",
    # Simulation
    "simulate_candidates",
    "simulate_candidate_with_assumptions",
    "build_assumptions",
    "build_iv_based_assumptions",
    "generate_scenario_moves",
    "detect_horizon_type",
    "format_assumptions_summary",
    "compute_projected_price",
    "compute_annualized_growth",
    "calculate_roi_at_price",
    "calculate_roi_score",
    "calculate_reward_score",
    "DEFAULT_ASSUMPTIONS",
    "DEFAULT_ANNUAL_GROWTH_PCT",
    # Risk Assessment
    "assess_long_option_risks",
    "assess_credit_spread_risks",
    "assess_iron_condor_risks",
    "assess_leaps_risks",
    "TradingStyle",
    "RiskLevel",
    # Expected Move AI
    "get_expected_move_from_ai",
    "get_sector_fallback_return",
    "DEFAULT_EXPECTED_MOVE_PCT",
    "SECTOR_FALLBACK_RETURNS",
]
