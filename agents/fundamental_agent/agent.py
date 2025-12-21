"""
Fundamental Analysis Agent (LangGraph)

State machine agent for SEC filing analysis with HITL workflow.

Actions:
- get_section: Fetch a specific section's content
- search_filing: Search for keywords
- ask_question: AI-powered Q&A with RAG
- navigate: Navigate UI to section
- summarize: Summarize current section
- analyze_financials: Full financial statement analysis with ratio calculations
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
from tools.filing_tools import (
    fetch_filing_metadata_sync,
    fetch_section_content_sync,
    search_filing_sync,
    analyze_filing_sync,
    summarize_section_sync,
)
from tools.financial_analysis import (
    FinancialMetrics,
    analyze_financials as compute_financials,
    format_analysis_response,
)


# ============================================================================
# Load System Prompt
# ============================================================================

def load_system_prompt() -> str:
    """Load the system prompt from system.md."""
    prompt_path = os.path.join(AGENT_DIR, "system.md")
    try:
        with open(prompt_path, "r") as f:
            return f.read()
    except FileNotFoundError:
        return "You are a financial analyst expert specializing in SEC filings analysis."

SYSTEM_PROMPT = load_system_prompt()


# ============================================================================
# Node Functions
# ============================================================================

def get_section_node(state: AgentState) -> AgentState:
    """
    Fetch a specific section's content.

    Validation:
    - filingId must be provided
    - targetSectionId must be provided
    """
    filing_id = state.get("filingId")
    section_id = state.get("targetSectionId")

    if not filing_id:
        return {
            **state,
            "action": None,
            "error": "No filing loaded",
            "response": {
                "action": "get_section",
                "success": False,
                "data": {"error": "No filing loaded. Please select a filing first."},
            },
        }

    if not section_id:
        return {
            **state,
            "action": None,
            "error": "No section specified",
            "response": {
                "action": "get_section",
                "success": False,
                "data": {"error": "Please specify which section to fetch."},
            },
        }

    try:
        section = fetch_section_content_sync(filing_id, section_id, format="text")

        return {
            **state,
            "currentSectionId": section_id,
            "currentSectionContent": section.get("text", ""),
            "stage": "idle",
            "action": None,
            "error": None,
            "response": {
                "action": "get_section",
                "success": True,
                "data": {
                    "section": section,
                    "sectionId": section_id,
                },
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "action": "get_section",
                "success": False,
                "data": {"error": str(e)},
            },
        }


def search_node(state: AgentState) -> AgentState:
    """
    Search for keywords within the filing.

    Validation:
    - filingId must be provided
    - query must be provided
    """
    filing_id = state.get("filingId")
    query = state.get("query")

    if not filing_id:
        return {
            **state,
            "action": None,
            "error": "No filing loaded",
            "response": {
                "action": "search_filing",
                "success": False,
                "data": {"error": "No filing loaded. Please select a filing first."},
            },
        }

    if not query:
        return {
            **state,
            "action": None,
            "error": "No search query provided",
            "response": {
                "action": "search_filing",
                "success": False,
                "data": {"error": "Please provide a search query."},
            },
        }

    try:
        results = search_filing_sync(filing_id, query, top_k=5)

        return {
            **state,
            "searchResults": results,
            "stage": "idle",
            "action": None,
            "error": None,
            "response": {
                "action": "search_filing",
                "success": True,
                "data": results,
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "action": "search_filing",
                "success": False,
                "data": {"error": str(e)},
            },
        }


def ask_question_node(state: AgentState) -> AgentState:
    """
    Answer a question about the filing using RAG.

    Validation:
    - filingId must be provided
    - query must be provided
    """
    filing_id = state.get("filingId")
    query = state.get("query")
    current_section_id = state.get("currentSectionId")

    if not filing_id:
        return {
            **state,
            "action": None,
            "error": "No filing loaded",
            "response": {
                "action": "ask_question",
                "success": False,
                "data": {"error": "No filing loaded. Please select a filing first."},
            },
        }

    if not query:
        return {
            **state,
            "action": None,
            "error": "No question provided",
            "response": {
                "action": "ask_question",
                "success": False,
                "data": {"error": "Please provide a question."},
            },
        }

    try:
        # Determine scope based on context
        scope = "entire_filing"
        section_ids = None

        if current_section_id:
            # If user is viewing a specific section, prioritize that
            scope = "current_section"
            section_ids = [current_section_id]

        result = analyze_filing_sync(
            filing_id=filing_id,
            question=query,
            scope=scope,
            section_ids=section_ids
        )

        # Add to conversation history
        history = state.get("conversationHistory", [])
        history.append({"role": "user", "content": query})
        history.append({"role": "assistant", "content": result.get("answer", "")})

        return {
            **state,
            "analysisResult": result,
            "conversationHistory": history,
            "stage": "idle",
            "action": None,
            "error": None,
            "response": {
                "action": "ask_question",
                "success": True,
                "data": result,
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "action": "ask_question",
                "success": False,
                "data": {"error": str(e)},
            },
        }


def summarize_node(state: AgentState) -> AgentState:
    """
    Summarize the current section.

    Uses current section content if available, otherwise fetches it.
    """
    filing_id = state.get("filingId")
    section_id = state.get("currentSectionId") or state.get("targetSectionId")
    section_content = state.get("currentSectionContent")

    if not filing_id:
        return {
            **state,
            "action": None,
            "error": "No filing loaded",
            "response": {
                "action": "summarize",
                "success": False,
                "data": {"error": "No filing loaded. Please select a filing first."},
            },
        }

    if not section_id:
        return {
            **state,
            "action": None,
            "error": "No section selected",
            "response": {
                "action": "summarize",
                "success": False,
                "data": {"error": "Please select a section to summarize."},
            },
        }

    try:
        result = summarize_section_sync(
            filing_id=filing_id,
            section_id=section_id,
            section_text=section_content
        )

        return {
            **state,
            "analysisResult": {
                "answer": result.get("summary", ""),
                "citations": result.get("citations", []),
                "confidence": 0.9,
                "suggestedFollowups": [
                    "What are the key risks mentioned?",
                    "How does this compare to last year?",
                    "What are the financial implications?",
                ],
            },
            "stage": "idle",
            "action": None,
            "error": None,
            "response": {
                "action": "summarize",
                "success": True,
                "data": result,
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "action": "summarize",
                "success": False,
                "data": {"error": str(e)},
            },
        }


def navigate_node(state: AgentState) -> AgentState:
    """
    Navigate the UI to a specific section.

    This is primarily a UI action - returns navigation instructions.
    """
    section_id = state.get("targetSectionId")

    if not section_id:
        return {
            **state,
            "action": None,
            "error": "No section specified",
            "response": {
                "action": "navigate",
                "success": False,
                "data": {"error": "Please specify which section to navigate to."},
            },
        }

    return {
        **state,
        "currentSectionId": section_id,
        "stage": "idle",
        "action": None,
        "error": None,
        "response": {
            "action": "navigate",
            "success": True,
            "data": {
                "navigateTo": section_id,
                "message": f"Navigate to section: {section_id}",
            },
        },
    }


def analyze_financials_node(state: AgentState) -> AgentState:
    """
    Perform comprehensive financial statement analysis with ratio calculations.

    This node:
    1. Fetches financial data from Item 8 (Financial Statements)
    2. Computes profitability, cash flow, balance sheet, and growth ratios
    3. Detects anomalies and red flags
    4. Returns formatted analysis with citations
    """
    filing_id = state.get("filingId")
    filing = state.get("filing")

    if not filing_id:
        return {
            **state,
            "action": None,
            "error": "No filing loaded",
            "response": {
                "action": "analyze_financials",
                "success": False,
                "data": {"error": "No filing loaded. Please select a filing first."},
            },
        }

    try:
        # Fetch financial statements section (Item 8)
        financial_section = fetch_section_content_sync(filing_id, "item_8", format="text")
        section_text = financial_section.get("text", "")

        # Use AI to extract financial metrics from the section
        extraction_result = analyze_filing_sync(
            filing_id=filing_id,
            question="""Extract the following financial metrics from the financial statements.
            Return as JSON with these fields (in USD millions, use null if not found):
            - revenue, revenue_prev (current and prior year)
            - gross_profit, gross_profit_prev
            - operating_income, operating_income_prev
            - net_income, net_income_prev
            - eps_diluted, eps_prev
            - cfo (cash from operations), cfo_prev
            - capex (capital expenditures), capex_prev
            - total_debt, cash
            - current_assets, current_liabilities
            - total_assets, receivables, inventory
            - interest_expense, ebitda
            - cogs (cost of goods sold)""",
            scope="current_section",
            section_ids=["item_8"]
        )

        # Parse the extracted metrics (the AI should return JSON-like content)
        # For now, we'll use the AI analysis to compute ratios contextually

        # Get comprehensive financial analysis using the prompt framework
        analysis_result = analyze_filing_sync(
            filing_id=filing_id,
            question=f"""Perform a comprehensive financial statement analysis following this framework:

1. **Key Metrics Table**: Extract and present Revenue, Gross Profit, Operating Income, Net Income, EPS, CFO, and FCF for current and prior periods with % changes.

2. **Profitability Ratios**: Calculate Gross Margin, Operating Margin, Net Margin, EBITDA Margin with interpretations.

3. **Cash Flow Quality**: Calculate FCF Margin, Cash Conversion Ratio, CapEx Ratio.

4. **Balance Sheet Health**: Calculate Current Ratio, Quick Ratio, Debt-to-Equity, Net Debt/EBITDA, Interest Coverage.

5. **Growth Ratios**: Calculate Revenue Growth %, Operating Income Growth %, EPS Growth %.

6. **Anomalies & Red Flags**: Flag any concerning patterns like:
   - Rising debt or leverage
   - Negative CFO but positive Net Income
   - Inventory growth exceeding revenue growth
   - Margin compression
   - Unusual one-time items

Format the response as a structured financial summary with tables.

{SYSTEM_PROMPT}""",
            scope="entire_filing",
            section_ids=["item_8", "item_7"]  # Financial Statements + MD&A
        )

        ticker = filing.get("ticker", "Company") if filing else "Company"

        # Add to conversation history
        history = state.get("conversationHistory", [])
        history.append({"role": "user", "content": "Analyze the financial statements"})
        history.append({"role": "assistant", "content": analysis_result.get("answer", "")})

        return {
            **state,
            "analysisResult": {
                "answer": analysis_result.get("answer", ""),
                "citations": analysis_result.get("citations", []),
                "confidence": analysis_result.get("confidence", 0.85),
                "suggestedFollowups": [
                    "What are the key risks mentioned in the filing?",
                    "How does the cash flow quality compare to earnings?",
                    "What's driving the margin changes?",
                    "Are there any concerning debt trends?",
                ],
            },
            "conversationHistory": history,
            "stage": "idle",
            "action": None,
            "error": None,
            "response": {
                "action": "analyze_financials",
                "success": True,
                "data": {
                    "analysis": analysis_result.get("answer", ""),
                    "citations": analysis_result.get("citations", []),
                    "ticker": ticker,
                },
            },
        }

    except Exception as e:
        return {
            **state,
            "action": None,
            "error": str(e),
            "response": {
                "action": "analyze_financials",
                "success": False,
                "data": {"error": str(e)},
            },
        }


# ============================================================================
# Router
# ============================================================================

ACTION_TO_NODE = {
    "get_section": "get_section_node",
    "search_filing": "search_node",
    "ask_question": "ask_question_node",
    "summarize": "summarize_node",
    "navigate": "navigate_node",
    "analyze_financials": "analyze_financials_node",
}


def route_action(state: AgentState) -> str:
    """
    Route based on the action requested.
    """
    action = state.get("action")

    if action and action in ACTION_TO_NODE:
        return ACTION_TO_NODE[action]

    # Default to ask_question if query provided
    if state.get("query"):
        return "ask_question_node"

    return END


# ============================================================================
# Build Graph
# ============================================================================

def build_fundamental_graph():
    """Build the LangGraph state machine."""
    workflow = StateGraph(AgentState)

    # Add nodes
    workflow.add_node("get_section_node", get_section_node)
    workflow.add_node("search_node", search_node)
    workflow.add_node("ask_question_node", ask_question_node)
    workflow.add_node("summarize_node", summarize_node)
    workflow.add_node("navigate_node", navigate_node)
    workflow.add_node("analyze_financials_node", analyze_financials_node)

    # Set entry point with conditional routing
    workflow.set_conditional_entry_point(route_action)

    # All nodes end after processing (HITL - wait for user input)
    workflow.add_edge("get_section_node", END)
    workflow.add_edge("search_node", END)
    workflow.add_edge("ask_question_node", END)
    workflow.add_edge("summarize_node", END)
    workflow.add_edge("navigate_node", END)
    workflow.add_edge("analyze_financials_node", END)

    # Compile with checkpointer for state persistence
    checkpointer = MemorySaver()
    return workflow.compile(checkpointer=checkpointer)


# Create the graph instance
fundamental_graph = build_fundamental_graph()
