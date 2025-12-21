"""
Type definitions for Fundamental Analysis Agent.
"""

from __future__ import annotations

from typing import TypedDict, Literal, Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ============================================================================
# State Machine Types
# ============================================================================

Stage = Literal["idle", "analyzing", "searching", "answering"]

# Analysis actions (handled by Analysis Agent - pure reasoning)
AnalysisActionType = Literal[
    "ask_question",        # Ask analytical question about filing
    "summarize",           # Summarize current section
    "analyze_financials",  # Full financial statement analysis with ratios
]

# Data actions (fetch data, no reasoning)
DataActionType = Literal[
    "get_section",         # Fetch a specific section's content
    "search_filing",       # Search for keywords in filing
]

# UI actions (handled by Orchestrator - no analysis)
UIActionType = Literal[
    "navigate",            # Navigate UI to a section
]

# Combined action type for API compatibility
ActionType = Literal[
    "get_section",         # Data: Fetch a specific section's content
    "search_filing",       # Data: Search for keywords in filing
    "ask_question",        # Analysis: Ask analytical question about filing
    "navigate",            # UI: Navigate UI to a section (orchestrator only)
    "summarize",           # Analysis: Summarize current section
    "analyze_financials",  # Analysis: Full financial statement analysis
]

FormType = Literal["10-K", "10-Q", "8-K", "S-1", "DEF 14A"]


# ============================================================================
# Filing Data Types
# ============================================================================

class FilingSection(TypedDict):
    """A section from an SEC filing."""
    id: str
    label: str
    text: str
    char_start: int
    char_end: int
    html: Optional[str]


class FilingMetadata(TypedDict):
    """Metadata about the loaded filing."""
    filingId: str
    ticker: str
    cik: str
    companyName: str
    formType: FormType
    filedAt: str
    reportPeriod: Optional[str]
    sections: List[Dict[str, Any]]  # TOC entries


class SearchMatch(TypedDict):
    """A search match result."""
    sectionId: str
    sectionLabel: str
    snippet: str
    score: float
    charPosition: int


class SearchResult(TypedDict):
    """Search results from filing."""
    query: str
    matches: List[SearchMatch]
    totalMatches: int


class Citation(TypedDict):
    """Citation to a section in the filing."""
    sectionId: str
    sectionLabel: str
    quote: Optional[str]


class AnalysisAnswer(TypedDict):
    """Answer from AI analysis."""
    answer: str
    citations: List[Citation]
    confidence: float
    suggestedFollowups: List[str]


# ============================================================================
# Agent State (LangGraph TypedDict)
# ============================================================================

class AgentState(TypedDict, total=False):
    """State for the Fundamental Analysis Agent."""
    # Routing
    action: Optional[ActionType]

    # Current stage
    stage: Stage
    isProcessing: bool
    error: Optional[str]

    # Filing context
    filingId: Optional[str]
    filing: Optional[FilingMetadata]
    currentSectionId: Optional[str]
    currentSectionContent: Optional[str]

    # Analysis context
    query: Optional[str]  # User's question or search query
    targetSectionId: Optional[str]  # Section to fetch/navigate to
    searchResults: Optional[SearchResult]
    analysisResult: Optional[AnalysisAnswer]

    # Conversation history for context
    conversationHistory: List[Dict[str, str]]

    # Response envelope
    response: Optional[Dict[str, Any]]


# ============================================================================
# API Request/Response Models (Pydantic)
# ============================================================================

class FundamentalRequest(BaseModel):
    """Request to the Fundamental Analysis API."""
    # Filing identification
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
        description="Target section ID (e.g., 'item_1a')"
    )
    topK: int = Field(
        default=5,
        description="Max search results to return"
    )

    # Current context (from UI)
    currentSectionId: Optional[str] = Field(
        default=None,
        description="Currently viewed section ID"
    )
    currentSectionContent: Optional[str] = Field(
        default=None,
        description="Currently viewed section text"
    )

    # Control
    action: ActionType = Field(
        default="ask_question",
        description="Action: get_section, search_filing, ask_question, navigate, summarize"
    )
    thread_id: Optional[str] = None

    model_config = {"populate_by_name": True}


class FundamentalResponse(BaseModel):
    """Response from Fundamental Analysis API."""
    success: bool
    thread_id: str
    action: ActionType
    data: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
