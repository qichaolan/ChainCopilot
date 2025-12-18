"""
Strategy Builder Agent Server (FastAPI)

REST API for the Strategy Builder LangGraph agent.
"""

from __future__ import annotations

import os
import sys
import uuid
from typing import Optional, List

# Add paths for imports when running as script
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
AGENTS_DIR = os.path.dirname(AGENT_DIR)
PROJECT_ROOT = os.path.dirname(AGENTS_DIR)
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, AGENTS_DIR)
sys.path.insert(0, AGENT_DIR)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent import strategy_graph
from types_ import MarketOutlook, StrategyType, TraderProfileType, ActionType


app = FastAPI(
    title="Strategy Builder Agent",
    description="LangGraph agent for options strategy building (HITL, step-by-step)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Request/Response Models
# ============================================================================

class StrategyRequest(BaseModel):
    """Request to run a strategy builder step."""
    # Ticker step
    ticker: Optional[str] = None

    # Expiration step (matches state field name for consistency)
    selectedExpiration: Optional[str] = Field(
        default=None,
        alias="expiration",  # Accept "expiration" for backward compatibility
        description="Selected expiration date"
    )

    # Strategy step (matches state field name for consistency)
    selectedStrategy: Optional[StrategyType] = Field(
        default=None,
        alias="strategy",  # Accept "strategy" for backward compatibility
        description="Selected strategy type"
    )
    outlook: MarketOutlook = "bullish"
    capitalBudget: float = 10000
    traderProfile: Optional[TraderProfileType] = "stock_replacement"
    expectedMovePct: Optional[float] = 0.10  # 10% expected move

    # Simulation step
    selectedCandidateIds: Optional[List[str]] = None

    # Control - action drives routing in agent
    action: ActionType = Field(
        default="set_ticker",
        description="Action: set_ticker, select_strategy, select_expiration, generate_candidates, run_simulations"
    )
    thread_id: Optional[str] = None

    # Optional: include full chain in response (for heatmap)
    includeChain: bool = Field(
        default=False,
        description="Include full options chain in response (for heatmap visualization)"
    )

    model_config = {"populate_by_name": True}  # Allow both field name and alias


class StrategyResponse(BaseModel):
    """Response from strategy builder."""
    success: bool
    thread_id: str
    stage: str
    data: dict = Field(default_factory=dict)
    state: dict = Field(default_factory=dict)
    error: Optional[str] = None


# ============================================================================
# Endpoints
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "agent": "strategy_builder"}


@app.post("/run", response_model=StrategyResponse)
async def run_strategy(req: StrategyRequest):
    """
    Run a strategy builder step.

    Actions:
    - set_ticker: Load options chain for ticker
    - select_strategy: Set strategy type (UI-only, no backend processing)
    - select_expiration: Select an expiration date and fetch filtered chain
    - generate_candidates: Generate strategy candidates
    - run_simulations: Run simulations for selected candidates

    Note: `action` is passed to state and used for primary routing.
    """
    thread_id = req.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    try:
        # Build initial state based on action
        initial_state = {
            "stage": "ticker",
            "isProcessing": False,
            "error": None,
            "outlook": req.outlook,
            "capitalBudget": req.capitalBudget,
            "action": req.action,  # Pass action to state for routing
        }

        # If continuing a thread, get existing state
        if req.thread_id:
            try:
                saved = strategy_graph.get_state(config)
                if saved and saved.values:
                    initial_state = {**saved.values}
                    # Override action from request (not saved state)
                    initial_state["action"] = req.action
            except Exception as e:
                print(f"[Strategy] Could not retrieve state: {e}")

        # Apply action-specific updates
        if req.action == "set_ticker" and req.ticker:
            initial_state["ticker"] = req.ticker.upper()
            initial_state["chain"] = []  # Clear to trigger fetch

        elif req.action == "select_strategy" and req.selectedStrategy:
            # UI-only action: update strategy selection, no backend processing
            initial_state["selectedStrategy"] = req.selectedStrategy
            initial_state["outlook"] = req.outlook
            initial_state["capitalBudget"] = req.capitalBudget
            initial_state["traderProfile"] = req.traderProfile
            initial_state["expectedMovePct"] = req.expectedMovePct
            initial_state["stage"] = "strategy"
            # Return immediately without running graph
            return StrategyResponse(
                success=True,
                thread_id=thread_id,
                stage="strategy",
                data={"selectedStrategy": req.selectedStrategy, "message": "Strategy selection saved"},
                state=_build_state_response(initial_state, include_chain=req.includeChain),
                error=None,
            )

        elif req.action == "select_expiration" and req.selectedExpiration:
            initial_state["selectedExpiration"] = req.selectedExpiration
            initial_state["stage"] = "expiration"

        elif req.action == "generate_candidates" and req.selectedStrategy:
            initial_state["selectedStrategy"] = req.selectedStrategy
            initial_state["outlook"] = req.outlook
            initial_state["capitalBudget"] = req.capitalBudget
            initial_state["traderProfile"] = req.traderProfile
            initial_state["expectedMovePct"] = req.expectedMovePct
            initial_state["stage"] = "strategy"

        elif req.action == "run_simulations" and req.selectedCandidateIds:
            initial_state["selectedCandidateIds"] = req.selectedCandidateIds
            initial_state["stage"] = "candidates"

        # Run the graph
        final_state = None
        async for event in strategy_graph.astream(initial_state, config):
            for _, node_state in event.items():
                final_state = node_state

        state_out = final_state or initial_state
        response = state_out.get("response", {})

        return StrategyResponse(
            success=response.get("success", False),
            thread_id=thread_id,
            stage=response.get("stage", state_out.get("stage", "ticker")),
            data=response.get("data", {}),
            state=_build_state_response(state_out, include_chain=req.includeChain),
            error=state_out.get("error"),
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        return StrategyResponse(
            success=False,
            thread_id=thread_id,
            stage="ticker",
            data={"error": str(e)},
            error=str(e),
        )


def _build_state_response(state_out: dict, include_chain: bool = False) -> dict:
    """
    Build state response payload.

    Args:
        state_out: Full agent state
        include_chain: If True, include full options chain (for heatmap)

    Optimizations:
    - Excludes full chain by default to reduce payload size
    - Includes contractCount for UI display
    - Only includes essential fields
    """
    chain = state_out.get("chain", [])

    result = {
        "ticker": state_out.get("ticker"),
        "spotPrice": state_out.get("spotPrice"),
        "expirations": state_out.get("expirations", []),
        "selectedExpiration": state_out.get("selectedExpiration"),
        "outlook": state_out.get("outlook"),
        "selectedStrategy": state_out.get("selectedStrategy"),
        "capitalBudget": state_out.get("capitalBudget"),
        "traderProfile": state_out.get("traderProfile"),
        "expectedMovePct": state_out.get("expectedMovePct"),
        "candidates": state_out.get("candidates", []),
        "selectedCandidateIds": state_out.get("selectedCandidateIds", []),
        "simulations": state_out.get("simulations", []),
        "contractCount": len(chain),
    }

    # Include full chain only if explicitly requested (e.g., for heatmap)
    if include_chain:
        result["chain"] = chain

    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
