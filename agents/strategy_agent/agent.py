"""
Strategy Builder Agent (LangGraph)

State machine agent for options strategy building with HITL workflow.

Flow: Ticker → Strategy → Expiration → Candidates → Simulation
Routing: Primarily by `action` field, fallback to stage inference.
"""

from __future__ import annotations

import os
import sys

# Add paths for imports when running as script
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
AGENTS_DIR = os.path.dirname(AGENT_DIR)
PROJECT_ROOT = os.path.dirname(AGENTS_DIR)
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, AGENTS_DIR)
sys.path.insert(0, AGENT_DIR)

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from types_ import AgentState
from tools import (
    fetch_options_chain,
    fetch_expiration_chain,
    generate_candidates,
    simulate_candidates,
    get_expected_move_from_ai,
)

# Supported strategies for validation
SUPPORTED_STRATEGIES = {
    "long_call", "long_put", "credit_spread", "iron_condor",
    "leaps", "covered_call", "cash_secured_put"
}


# ============================================================================
# Node Functions
# ============================================================================

def ticker_node(state: AgentState) -> AgentState:
    """
    Process ticker input and fetch options chain.

    Validation:
    - ticker must be provided and non-empty

    Transitions to: strategy stage
    """
    ticker = state.get("ticker")

    # Strict validation
    if not ticker or not isinstance(ticker, str) or len(ticker.strip()) == 0:
        return {
            **state,
            "action": None,  # Clear action after processing
            "error": "No ticker provided",
            "response": {
                "stage": "ticker",
                "success": False,
                "data": {"error": "No ticker provided"},
            },
        }

    ticker = ticker.strip().upper()

    try:
        contracts, expirations, spot_price = fetch_options_chain(ticker)

        if not contracts:
            return {
                **state,
                "action": None,
                "error": f"No options data found for {ticker}",
                "response": {
                    "stage": "ticker",
                    "success": False,
                    "data": {"error": f"No options data found for {ticker}"},
                },
            }

        # Get AI-determined expected move for this ticker
        ai_result = get_expected_move_from_ai(ticker)
        expected_move_pct = ai_result["expectedMovePct"]
        print(f"[ticker_node] AI expected move for {ticker}: {expected_move_pct*100:.1f}% (source: {ai_result['source']}, sector: {ai_result.get('sector')})")

        # New flow: Ticker → Strategy (not Expiration)
        return {
            **state,
            "ticker": ticker,
            "chain": contracts,
            "expirations": expirations,
            "spotPrice": spot_price,
            "expectedMovePct": expected_move_pct,  # AI-determined default
            "stage": "strategy",  # Go to strategy selection next
            "action": None,
            "error": None,
            "response": {
                "stage": "strategy",
                "success": True,
                "data": {
                    "ticker": ticker,
                    "spotPrice": spot_price,
                    "expirations": expirations,
                    "contractCount": len(contracts),
                    "expectedMovePct": expected_move_pct,
                    "expectedMoveSource": ai_result["source"],
                    "sector": ai_result.get("sector"),
                },
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "stage": "ticker",
                "success": False,
                "data": {"error": str(e)},
            },
        }


def expiration_node(state: AgentState) -> AgentState:
    """
    Process expiration selection and fetch filtered chain.

    Validation:
    - expiration must be in available expirations list
    - ticker must exist

    Transitions to: candidates stage (triggers candidate generation)
    """
    expiration = state.get("selectedExpiration")
    ticker = state.get("ticker")
    available_expirations = state.get("expirations", [])

    # Strict validation: ticker required
    if not ticker:
        return {
            **state,
            "action": None,
            "error": "No ticker set. Please enter a ticker first.",
            "response": {
                "stage": "ticker",
                "success": False,
                "data": {"error": "No ticker set. Please enter a ticker first."},
            },
        }

    # Strict validation: expiration required
    if not expiration:
        return {
            **state,
            "action": None,
            "error": "No expiration selected",
            "response": {
                "stage": "expiration",
                "success": False,
                "data": {"error": "No expiration selected"},
            },
        }

    # Strict validation: expiration must be in available list
    valid_expirations = {exp.get("expiration") for exp in available_expirations}
    if expiration not in valid_expirations:
        return {
            **state,
            "action": None,
            "error": f"Invalid expiration '{expiration}'. Not in available expirations.",
            "response": {
                "stage": "expiration",
                "success": False,
                "data": {
                    "error": f"Invalid expiration '{expiration}'",
                    "availableExpirations": list(valid_expirations),
                },
            },
        }

    try:
        # Fetch contracts for this specific expiration
        contracts, spot_price = fetch_expiration_chain(ticker, expiration)

        if not contracts:
            return {
                **state,
                "action": None,
                "error": f"No contracts found for expiration {expiration}",
                "response": {
                    "stage": "expiration",
                    "success": False,
                    "data": {"error": f"No contracts found for expiration {expiration}"},
                },
            }

        # New flow: Expiration → Candidates (auto-generate)
        return {
            **state,
            "chain": contracts,
            "spotPrice": spot_price,
            "stage": "candidates",  # Ready for candidate generation
            "action": None,
            "error": None,
            "response": {
                "stage": "candidates",
                "success": True,
                "data": {
                    "expiration": expiration,
                    "contractCount": len(contracts),
                    "spotPrice": spot_price,
                },
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "stage": "expiration",
                "success": False,
                "data": {"error": str(e)},
            },
        }


def candidates_node(state: AgentState) -> AgentState:
    """
    Generate strategy candidates.

    Validation:
    - strategy must be in supported list
    - chain must have contracts
    - spotPrice must be positive

    Transitions to: candidates stage
    """
    chain = state.get("chain", [])
    strategy = state.get("selectedStrategy")
    outlook = state.get("outlook", "bullish")
    budget = state.get("capitalBudget", 10000)
    spot_price = state.get("spotPrice")
    trader_profile = state.get("traderProfile", "stock_replacement")
    expected_move_pct = state.get("expectedMovePct", 0.10)

    # Strict validation: strategy required and must be supported
    if not strategy:
        return {
            **state,
            "action": None,
            "error": "No strategy selected",
            "response": {
                "stage": "strategy",
                "success": False,
                "data": {"error": "No strategy selected"},
            },
        }

    if strategy not in SUPPORTED_STRATEGIES:
        return {
            **state,
            "action": None,
            "error": f"Unsupported strategy '{strategy}'",
            "response": {
                "stage": "strategy",
                "success": False,
                "data": {
                    "error": f"Unsupported strategy '{strategy}'",
                    "supportedStrategies": list(SUPPORTED_STRATEGIES),
                },
            },
        }

    # Strict validation: chain required
    if not chain or len(chain) == 0:
        return {
            **state,
            "action": None,
            "error": "No options chain data. Please select an expiration first.",
            "response": {
                "stage": "expiration",
                "success": False,
                "data": {"error": "No options chain data. Please select an expiration first."},
            },
        }

    # Strict validation: spot price required
    if not spot_price or spot_price <= 0:
        return {
            **state,
            "action": None,
            "error": "Invalid spot price",
            "response": {
                "stage": "strategy",
                "success": False,
                "data": {"error": "Invalid spot price. Please re-enter ticker."},
            },
        }

    try:
        candidates = generate_candidates(
            chain, strategy, outlook, budget, spot_price,
            trader_profile=trader_profile,
            expected_move_pct=expected_move_pct,
        )

        if not candidates:
            return {
                **state,
                "action": None,
                "error": "No candidates found matching criteria",
                "response": {
                    "stage": "candidates",
                    "success": False,
                    "data": {"error": "No candidates found matching your criteria. Try adjusting budget or outlook."},
                },
            }

        return {
            **state,
            "candidates": candidates,
            "stage": "candidates",
            "action": None,
            "error": None,
            "response": {
                "stage": "candidates",
                "success": True,
                "data": {
                    "candidates": candidates,
                    "count": len(candidates),
                },
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "stage": "candidates",
                "success": False,
                "data": {"error": str(e)},
            },
        }


def simulation_node(state: AgentState) -> AgentState:
    """
    Run simulations for selected candidates.

    Validation:
    - selectedCandidateIds must be provided
    - IDs must exist in candidates list
    - spotPrice must be valid

    Transitions to: simulation stage
    """
    candidates = state.get("candidates", [])
    selected_ids = state.get("selectedCandidateIds", [])
    spot_price = state.get("spotPrice", 100)

    # Strict validation: selected IDs required
    if not selected_ids or len(selected_ids) == 0:
        return {
            **state,
            "action": None,
            "error": "No candidates selected",
            "response": {
                "stage": "candidates",
                "success": False,
                "data": {"error": "Please select at least one candidate for simulation"},
            },
        }

    # Strict validation: IDs must exist in candidates
    candidate_id_set = {c.get("id") for c in candidates}
    invalid_ids = [sid for sid in selected_ids if sid not in candidate_id_set]
    if invalid_ids:
        return {
            **state,
            "action": None,
            "error": f"Invalid candidate IDs: {invalid_ids}",
            "response": {
                "stage": "candidates",
                "success": False,
                "data": {
                    "error": f"Invalid candidate IDs: {invalid_ids}",
                    "validIds": list(candidate_id_set),
                },
            },
        }

    # Filter to selected candidates
    selected = [c for c in candidates if c["id"] in selected_ids]

    if not selected:
        return {
            **state,
            "action": None,
            "error": "Selected candidates not found",
            "response": {
                "stage": "candidates",
                "success": False,
                "data": {"error": "Selected candidates not found"},
            },
        }

    try:
        # Get expected move percentage for LEAPS horizon scenarios
        expected_move_pct = state.get("expectedMovePct", 0.10)
        simulations = simulate_candidates(selected, spot_price, expected_move_pct=expected_move_pct)

        return {
            **state,
            "simulations": simulations,
            "stage": "simulation",
            "action": None,
            "error": None,
            "response": {
                "stage": "simulation",
                "success": True,
                "data": {
                    "simulations": simulations,
                    "count": len(simulations),
                },
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "stage": "candidates",
                "success": False,
                "data": {"error": str(e)},
            },
        }


# ============================================================================
# Router (Action-First)
# ============================================================================

# Map actions to node names
ACTION_TO_NODE = {
    "set_ticker": "ticker_node",
    "select_strategy": END,  # No backend processing, UI-only
    "select_expiration": "expiration_node",
    "generate_candidates": "candidates_node",
    "run_simulations": "simulation_node",
}


def route_action(state: AgentState) -> str:
    """
    Route based on the action requested.

    Priority:
    1. Explicit action field (primary routing method)
    2. Fallback to stage + presence inference (legacy compatibility)
    """
    action = state.get("action")

    # Primary routing: by explicit action
    if action and action in ACTION_TO_NODE:
        return ACTION_TO_NODE[action]

    # Fallback: stage + presence inference (for backward compatibility)
    stage = state.get("stage", "ticker")

    # If we have ticker but no chain yet, fetch it
    if state.get("ticker") and not state.get("chain"):
        return "ticker_node"

    # If expiration selected and we're at expiration stage
    if state.get("selectedExpiration") and stage == "expiration":
        return "expiration_node"

    # If strategy selected and we need candidates (at strategy stage)
    if state.get("selectedStrategy") and stage == "strategy":
        return "candidates_node"

    # If candidates selected for simulation
    if state.get("selectedCandidateIds") and stage == "candidates":
        return "simulation_node"

    return END


# ============================================================================
# Build Graph
# ============================================================================

def build_strategy_graph():
    """Build the LangGraph state machine."""
    workflow = StateGraph(AgentState)

    # Add nodes
    workflow.add_node("ticker_node", ticker_node)
    workflow.add_node("expiration_node", expiration_node)
    workflow.add_node("candidates_node", candidates_node)
    workflow.add_node("simulation_node", simulation_node)

    # Set entry point with conditional routing
    workflow.set_conditional_entry_point(route_action)

    # All nodes end after processing (HITL - wait for user input)
    workflow.add_edge("ticker_node", END)
    workflow.add_edge("expiration_node", END)
    workflow.add_edge("candidates_node", END)
    workflow.add_edge("simulation_node", END)

    # Compile with checkpointer for state persistence
    checkpointer = MemorySaver()
    return workflow.compile(checkpointer=checkpointer)


# Create the graph instance
strategy_graph = build_strategy_graph()
