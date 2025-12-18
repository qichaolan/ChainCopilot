# Shared Agent Tools
# Tools available to all ChainCopilot agents

from .intent_parser import parse_strategy_intent, build_intent_summary
from .strategy_generator import generate_strategy_candidates, suggest_strategies
from .payoff_tool import compute_payoff
from .probability_tool import calculate_probabilities
from .greeks_tool import analyze_position_greeks
from .liquidity_tool import check_position_liquidity
from .suggestion_tool import suggest_next_edit
from .response_builder import (
    build_response,
    build_strategy_suggest_response,
    build_legs_rank_response,
    build_deep_analysis_response,
    build_error_response,
    # Legacy aliases
    build_phase1_response,
    build_phase2_response,
)
from .constraints_tool import (
    check_constraints,
    get_available_policies,
    validate_position_risk,
    check_single_constraint,
)
from .ranking_tool import (
    rank_and_explain,
    calculate_fit_score,
    generate_explanation,
)

# LEAPS Builder Tools
from .chain_filter import (
    filter_leaps_contracts,
    get_leaps_expirations,
)
from .contract_rank import (
    rank_leaps_candidates,
    compare_candidates,
)
from .payoff_sim import (
    simulate_leaps_payoff,
    calculate_greeks_impact,
    build_payoff_table,
)
from .risk_scan import (
    scan_leaps_risks,
    generate_risk_report,
)

__all__ = [
    # Phase 1 tools - Strategy Intent workflow
    "parse_strategy_intent",
    "build_intent_summary",
    "suggest_strategies",
    "generate_strategy_candidates",  # Legacy wrapper
    "rank_and_explain",
    "calculate_fit_score",
    "generate_explanation",
    # Phase 2 tools - Leg Builder
    "compute_payoff",
    "calculate_probabilities",
    "analyze_position_greeks",
    "check_position_liquidity",
    "suggest_next_edit",
    # Response builder (3-phase HITL workflow)
    "build_response",
    "build_strategy_suggest_response",
    "build_legs_rank_response",
    "build_deep_analysis_response",
    "build_error_response",
    # Legacy aliases
    "build_phase1_response",
    "build_phase2_response",
    # Constraints tool (policy-based validation)
    "check_constraints",
    "get_available_policies",
    "validate_position_risk",
    "check_single_constraint",
    # LEAPS Builder Tools
    "filter_leaps_contracts",
    "get_leaps_expirations",
    "rank_leaps_candidates",
    "compare_candidates",
    "simulate_leaps_payoff",
    "calculate_greeks_impact",
    "build_payoff_table",
    "scan_leaps_risks",
    "generate_risk_report",
]
