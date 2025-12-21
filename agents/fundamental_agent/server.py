"""
Fundamental Analysis Agent Server (FastAPI)

REST API for the Fundamental Analysis LangGraph agent.
Provides both REST endpoints and streaming chat for CopilotKit integration.
"""

from __future__ import annotations

import os
import sys
import uuid
import json
import asyncio
from typing import Optional, List, AsyncGenerator

# Add paths for imports when running as script
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
AGENTS_DIR = os.path.dirname(AGENT_DIR)
PROJECT_ROOT = os.path.dirname(AGENTS_DIR)
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, AGENTS_DIR)
sys.path.insert(0, AGENT_DIR)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent import fundamental_graph
from types_ import ActionType
from tools.filing_tools import analyze_filing_sync


app = FastAPI(
    title="Fundamental Analysis Agent",
    description="LangGraph agent for SEC filing analysis (HITL, step-by-step)",
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

class FundamentalRequest(BaseModel):
    """Request to run a fundamental analysis step."""
    # Filing context
    filingId: Optional[str] = Field(
        default=None,
        description="Filing ID (e.g., 'AAPL-10-K-2024-10-30')"
    )

    # Query parameters
    query: Optional[str] = Field(
        default=None,
        description="User question or search query"
    )
    sectionId: Optional[str] = Field(
        default=None,
        description="Target section ID for get_section/navigate"
    )
    topK: int = Field(
        default=5,
        description="Max search results"
    )

    # Current context (from UI)
    currentSectionId: Optional[str] = Field(
        default=None,
        description="Currently viewed section ID"
    )
    currentSectionContent: Optional[str] = Field(
        default=None,
        description="Currently viewed section text (for summarization)"
    )

    # Control
    action: ActionType = Field(
        default="ask_question",
        description="Action: get_section, search_filing, ask_question, navigate, summarize"
    )
    thread_id: Optional[str] = None

    model_config = {"populate_by_name": True}


class FundamentalResponse(BaseModel):
    """Response from fundamental analysis."""
    success: bool
    thread_id: str
    action: str
    data: dict = Field(default_factory=dict)
    state: dict = Field(default_factory=dict)
    error: Optional[str] = None


# ============================================================================
# Endpoints
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "agent": "fundamental_analysis"}


@app.post("/run", response_model=FundamentalResponse)
async def run_analysis(req: FundamentalRequest):
    """
    Run a fundamental analysis step.

    Actions:
    - get_section: Fetch a specific section's content
    - search_filing: Search for keywords in filing
    - ask_question: AI-powered Q&A with RAG
    - navigate: Navigate UI to section
    - summarize: Summarize current section
    """
    thread_id = req.thread_id or str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    try:
        # Build initial state
        initial_state = {
            "stage": "idle",
            "isProcessing": False,
            "error": None,
            "action": req.action,
            "filingId": req.filingId,
            "currentSectionId": req.currentSectionId,
            "currentSectionContent": req.currentSectionContent,
        }

        # If continuing a thread, get existing state
        if req.thread_id:
            try:
                saved = fundamental_graph.get_state(config)
                if saved and saved.values:
                    initial_state = {**saved.values}
                    initial_state["action"] = req.action
            except Exception as e:
                print(f"[Fundamental] Could not retrieve state: {e}")

        # Apply action-specific updates
        if req.action == "get_section" and req.sectionId:
            initial_state["targetSectionId"] = req.sectionId

        elif req.action == "search_filing" and req.query:
            initial_state["query"] = req.query

        elif req.action == "ask_question" and req.query:
            initial_state["query"] = req.query

        elif req.action == "summarize":
            if req.sectionId:
                initial_state["targetSectionId"] = req.sectionId

        elif req.action == "navigate" and req.sectionId:
            initial_state["targetSectionId"] = req.sectionId

        # Run the graph
        final_state = None
        async for event in fundamental_graph.astream(initial_state, config):
            for _, node_state in event.items():
                final_state = node_state

        state_out = final_state or initial_state
        response = state_out.get("response", {})

        return FundamentalResponse(
            success=response.get("success", False),
            thread_id=thread_id,
            action=response.get("action", req.action),
            data=response.get("data", {}),
            state=_build_state_response(state_out),
            error=state_out.get("error"),
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        return FundamentalResponse(
            success=False,
            thread_id=thread_id,
            action=req.action,
            data={"error": str(e)},
            error=str(e),
        )


def _build_state_response(state_out: dict) -> dict:
    """Build state response payload with essential fields."""
    return {
        "filingId": state_out.get("filingId"),
        "currentSectionId": state_out.get("currentSectionId"),
        "searchResults": state_out.get("searchResults"),
        "analysisResult": state_out.get("analysisResult"),
        "conversationHistory": state_out.get("conversationHistory", []),
    }


# ============================================================================
# Convenience endpoints for direct calls
# ============================================================================

@app.post("/ask")
async def ask_question(
    filingId: str,
    question: str,
    currentSectionId: Optional[str] = None,
    thread_id: Optional[str] = None
):
    """
    Convenience endpoint for asking questions.
    """
    req = FundamentalRequest(
        filingId=filingId,
        query=question,
        currentSectionId=currentSectionId,
        action="ask_question",
        thread_id=thread_id,
    )
    return await run_analysis(req)


@app.post("/search")
async def search(
    filingId: str,
    query: str,
    topK: int = 5,
    thread_id: Optional[str] = None
):
    """
    Convenience endpoint for searching.
    """
    req = FundamentalRequest(
        filingId=filingId,
        query=query,
        topK=topK,
        action="search_filing",
        thread_id=thread_id,
    )
    return await run_analysis(req)


@app.post("/summarize")
async def summarize(
    filingId: str,
    sectionId: str,
    sectionContent: Optional[str] = None,
    thread_id: Optional[str] = None
):
    """
    Convenience endpoint for summarization.
    """
    req = FundamentalRequest(
        filingId=filingId,
        sectionId=sectionId,
        currentSectionContent=sectionContent,
        action="summarize",
        thread_id=thread_id,
    )
    return await run_analysis(req)


# ============================================================================
# Chat endpoint for CopilotKit integration
# ============================================================================

class ChatMessage(BaseModel):
    """A single chat message."""
    role: str = Field(description="Message role: 'user' or 'assistant'")
    content: str = Field(description="Message content")


class ChatRequest(BaseModel):
    """Request for the chat endpoint - compatible with CopilotKit."""
    messages: List[ChatMessage] = Field(default_factory=list)
    filingId: Optional[str] = Field(default=None, description="Current filing ID")
    currentSectionId: Optional[str] = Field(default=None, description="Currently viewed section")
    currentSectionContent: Optional[str] = Field(default=None, description="Current section text")
    thread_id: Optional[str] = None


class ChatResponse(BaseModel):
    """Response from chat endpoint."""
    message: ChatMessage
    citations: List[dict] = Field(default_factory=list)
    ui_actions: List[dict] = Field(default_factory=list)
    thread_id: str


async def stream_chat_response(
    messages: List[ChatMessage],
    filing_id: Optional[str],
    current_section_id: Optional[str],
    current_section_content: Optional[str],
    thread_id: str,
) -> AsyncGenerator[str, None]:
    """
    Stream chat response using SSE format.

    Uses the LangGraph agent to process the query and streams the response.
    """
    # Get the last user message
    user_message = None
    for msg in reversed(messages):
        if msg.role == "user":
            user_message = msg.content
            break

    if not user_message:
        yield f"data: {json.dumps({'type': 'error', 'content': 'No user message found'})}\n\n"
        return

    try:
        # Use the analyze_filing_sync tool for RAG-based Q&A
        if filing_id:
            # Determine scope based on context
            scope = "current_section" if current_section_id else "entire_filing"
            section_ids = [current_section_id] if current_section_id else None

            # Signal that we're processing
            yield f"data: {json.dumps({'type': 'status', 'content': 'Analyzing filing...'})}\n\n"

            # Run the analysis in a thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: analyze_filing_sync(
                    filing_id=filing_id,
                    question=user_message,
                    scope=scope,
                    section_ids=section_ids
                )
            )

            answer = result.get("answer", "I couldn't generate an answer.")
            citations = result.get("citations", [])

            # Stream the response content
            yield f"data: {json.dumps({'type': 'content', 'content': answer})}\n\n"

            # Send citations if any
            if citations:
                yield f"data: {json.dumps({'type': 'citations', 'content': citations})}\n\n"

        else:
            # No filing context - just respond conversationally
            yield f"data: {json.dumps({'type': 'content', 'content': 'Please select a filing to analyze. I can help you understand SEC filings including 10-K and 10-Q reports.'})}\n\n"

        # Signal completion
        yield f"data: {json.dumps({'type': 'done', 'thread_id': thread_id})}\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"


@app.post("/v1/filings/chat")
async def chat_endpoint(req: ChatRequest):
    """
    Streaming chat endpoint for CopilotKit integration.

    This is the main entry point for the filing analysis chat.
    Returns Server-Sent Events (SSE) for streaming responses.
    """
    thread_id = req.thread_id or str(uuid.uuid4())

    return StreamingResponse(
        stream_chat_response(
            messages=req.messages,
            filing_id=req.filingId,
            current_section_id=req.currentSectionId,
            current_section_content=req.currentSectionContent,
            thread_id=thread_id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/v1/filings/chat/sync", response_model=ChatResponse)
async def chat_sync_endpoint(req: ChatRequest):
    """
    Non-streaming chat endpoint for simpler integrations.
    """
    thread_id = req.thread_id or str(uuid.uuid4())

    # Get the last user message
    user_message = None
    for msg in reversed(req.messages):
        if msg.role == "user":
            user_message = msg.content
            break

    if not user_message:
        return ChatResponse(
            message=ChatMessage(role="assistant", content="No user message found"),
            thread_id=thread_id,
        )

    try:
        if req.filingId:
            scope = "current_section" if req.currentSectionId else "entire_filing"
            section_ids = [req.currentSectionId] if req.currentSectionId else None

            result = analyze_filing_sync(
                filing_id=req.filingId,
                question=user_message,
                scope=scope,
                section_ids=section_ids
            )

            return ChatResponse(
                message=ChatMessage(role="assistant", content=result.get("answer", "")),
                citations=result.get("citations", []),
                thread_id=thread_id,
            )
        else:
            return ChatResponse(
                message=ChatMessage(
                    role="assistant",
                    content="Please select a filing to analyze."
                ),
                thread_id=thread_id,
            )

    except Exception as e:
        return ChatResponse(
            message=ChatMessage(role="assistant", content=f"Error: {str(e)}"),
            thread_id=thread_id,
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
