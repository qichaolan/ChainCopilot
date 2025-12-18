"""
LEAPS CoAgent Server (FastAPI)

Direct REST API for LangGraph LEAPS step-by-step workflow (HITL).
Endpoints:
- GET /health
- POST /run    : runs exactly ONE step and returns the agent "response" JSON + updated state
- POST /stream : streams state updates for exactly ONE step via SSE
"""

from __future__ import annotations

import json
import uuid
from typing import Optional, List, Literal, Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Local import (same folder)
from agent import leaps_graph


app = FastAPI(
    title="LEAPS CoAgent Server",
    description="LangGraph agent for LEAPS options analysis (HITL, step-by-step)",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LEAPSRequest(BaseModel):
    # Core intent
    symbol: str = Field(..., description="Underlying ticker")
    direction: Literal["bullish", "bearish", "neutral"] = "bullish"
    capitalBudget: float = 10000

    # Intent helper
    leapsIntent: Optional[Literal["stock_replacement", "income_underlier", "leverage", "speculative_leverage", "hedge"]] = None
    userDescription: Optional[str] = Field(None, description="Natural language description like 'steady growth, lower risk'")

    # Optional overrides
    dteRange: Optional[Dict[str, int]] = None
    deltaRange: Optional[Dict[str, float]] = None
    minOpenInterest: Optional[int] = None
    maxSpreadPct: Optional[float] = None

    # HITL / routing
    step: Optional[Literal["filter", "rank", "simulate", "risk_scan"]] = None
    userAction: Optional[str] = None  # "confirm_filter" | "select_candidates" | "proceed_risk_scan" | etc.
    selectedContracts: Optional[List[str]] = None

    # Session
    thread_id: Optional[str] = None


class LEAPSRunResponse(BaseModel):
    success: bool
    thread_id: str
    response: Dict[str, Any]  # the unified Output Schema envelope (step/success/data/nextStep/disclaimer)
    state: Dict[str, Any]     # full shared state snapshot (for debugging/UI hydration)
    error: Optional[str] = None


@app.get("/health")
async def health_check():
    return {"status": "healthy", "agent": "leaps_builder"}


def _build_initial_state(req: LEAPSRequest) -> Dict[str, Any]:
    state: Dict[str, Any] = {
        "symbol": req.symbol.upper(),
        "direction": req.direction,
        "capitalBudget": req.capitalBudget,
        "currentStep": "filter",
        "stepProgress": "Starting LEAPS analysis...",
        "isProcessing": False,
        "messages": [],
    }
    if req.leapsIntent:
        state["leapsIntent"] = req.leapsIntent
    if req.userDescription:
        state["userDescription"] = req.userDescription
    if req.dteRange:
        state["dteRange"] = req.dteRange
    if req.deltaRange:
        state["deltaRange"] = req.deltaRange
    if req.minOpenInterest is not None:
        state["minOpenInterest"] = req.minOpenInterest
    if req.maxSpreadPct is not None:
        state["maxSpreadPct"] = req.maxSpreadPct

    if req.step:
        state["requestedStep"] = req.step
    if req.userAction:
        state["lastUserAction"] = req.userAction
    if req.selectedContracts is not None:
        state["selectedContracts"] = req.selectedContracts

    return state


@app.post("/run", response_model=LEAPSRunResponse)
async def run_leaps(req: LEAPSRequest):
    """
    Runs exactly ONE step (as defined by routing rules in agent.py) and returns:
    - response: the JSON envelope your UI should render
    - state: the updated shared state snapshot

    If thread_id is provided, retrieves existing state from checkpointer and merges
    with new request params to continue the workflow.
    """
    thread_id = req.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    try:
        # Build initial state from request
        initial_state = _build_initial_state(req)

        # If continuing an existing thread, merge with previous state
        if req.thread_id:
            try:
                saved_state = leaps_graph.get_state(config)
                if saved_state and saved_state.values:
                    # Merge: keep previous data (candidates, ranked, etc.), override with new intent
                    merged_state = {**saved_state.values}
                    # Update control fields from new request
                    if req.step:
                        merged_state["requestedStep"] = req.step
                    if req.userAction:
                        merged_state["lastUserAction"] = req.userAction
                        # Clear pending checkpoint when user action is provided
                        if "pendingCheckpoint" in merged_state:
                            merged_state["pendingCheckpoint"] = {**merged_state["pendingCheckpoint"], "resolved": True}
                    if req.selectedContracts is not None:
                        merged_state["selectedContracts"] = req.selectedContracts
                    # Keep the symbol, direction, budget from original
                    initial_state = merged_state
            except Exception as e:
                print(f"[LEAPS Server] Could not retrieve state for thread {thread_id}: {e}")
                # Continue with fresh state

        final_state = None
        async for event in leaps_graph.astream(initial_state, config):
            # event is {node_name: state_snapshot}
            for _, node_state in event.items():
                final_state = node_state

        state_out = final_state or initial_state
        response = state_out.get("response") or {
            "step": state_out.get("currentStep", "filter"),
            "success": False,
            "data": {"error": {"type": "unknown", "message": "No response produced by agent."}},
            "disclaimer": "This analysis is for educational purposes only and is not financial advice.",
        }

        return LEAPSRunResponse(success=bool(response.get("success", False)), thread_id=thread_id, response=response, state=state_out)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return LEAPSRunResponse(
            success=False,
            thread_id=thread_id,
            response={
                "step": req.step or "filter",
                "success": False,
                "data": {"error": {"type": "server_error", "message": str(e)}},
                "disclaimer": "This analysis is for educational purposes only and is not financial advice.",
            },
            state=_build_initial_state(req),
            error=str(e),
        )


@app.post("/stream")
async def stream_leaps(req: LEAPSRequest):
    """
    Streams state updates for exactly ONE step via SSE.

    Events:
      - state_update: {type,node,state,thread_id}
      - complete    : {type,thread_id,response}
      - error       : {type,thread_id,error}
    """
    thread_id = req.thread_id or str(uuid.uuid4())
    initial_state = _build_initial_state(req)
    config = {"configurable": {"thread_id": thread_id}}

    async def gen():
        try:
            last_state = None
            async for event in leaps_graph.astream(initial_state, config):
                for node_name, node_state in event.items():
                    last_state = node_state
                    payload = {"type": "state_update", "node": node_name, "state": node_state, "thread_id": thread_id}
                    yield f"data: {json.dumps(payload)}\n\n"

            response = (last_state or initial_state).get("response")
            yield f"data: {json.dumps({'type':'complete','thread_id':thread_id,'response':response})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type':'error','thread_id':thread_id,'error':str(e)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
