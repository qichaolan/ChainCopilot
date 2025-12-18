"""
LEAPS Builder Agent
Main ADK agent definition for Vertex AI Agent Engine.

4-Step HITL Workflow:
- Step 1 (filter): Filter chain to LEAPS candidates
- Step 2 (rank): Score and rank candidates by 4 perspectives
- Step 3 (simulate): Payoff simulation at various scenarios
- Step 4 (risk_scan): Comprehensive risk assessment
"""

from google.adk.agents import Agent
from google.adk.tools import FunctionTool

from .config import AGENT_CONFIG, SYSTEM_PROMPT
from agents.tools import (
    # LEAPS-specific tools
    filter_leaps_contracts,
    get_leaps_expirations,
    rank_leaps_candidates,
    compare_candidates,
    simulate_leaps_payoff,
    calculate_greeks_impact,
    build_payoff_table,
    scan_leaps_risks,
    generate_risk_report,
    # Shared response builder
    build_response,
)


# === Define Function Tools ===

# Step 1: Filter Chain
filter_tool = FunctionTool(func=filter_leaps_contracts)
expirations_tool = FunctionTool(func=get_leaps_expirations)

# Step 2: Rank Candidates
rank_tool = FunctionTool(func=rank_leaps_candidates)
compare_tool = FunctionTool(func=compare_candidates)

# Step 3: Simulate Payoff
payoff_sim_tool = FunctionTool(func=simulate_leaps_payoff)
greeks_tool = FunctionTool(func=calculate_greeks_impact)
table_tool = FunctionTool(func=build_payoff_table)

# Step 4: Risk Scan
risk_scan_tool = FunctionTool(func=scan_leaps_risks)
risk_report_tool = FunctionTool(func=generate_risk_report)

# Shared: Response Builder
response_tool = FunctionTool(func=build_response)


# === Define the LEAPS Builder Agent ===

leaps_agent = Agent(
    model=AGENT_CONFIG["model"],
    name=AGENT_CONFIG["agent_name"],
    description="""
    LEAPS Options Builder - 4-Step HITL Workflow

    Step 1 (filter):
      - Filter chain by DTE, delta, liquidity, budget
      - Returns: candidates[] with nextStep.action = "confirm_filter"

    Step 2 (rank):
      - Score candidates on 4 dimensions
      - Returns: rankedCandidates[] with nextStep.action = "select_candidates"

    Step 3 (simulate):
      - P&L simulation at price scenarios
      - Returns: simulations[] with nextStep.action = "proceed_risk_scan"

    Step 4 (risk_scan):
      - IV analysis, events, risk assessment
      - Returns: riskScan with nextStep.action = "finalize"
    """,
    instruction=SYSTEM_PROMPT,
    tools=[
        # Step 1: Filter
        filter_tool,          # filter_leaps_contracts
        expirations_tool,     # get_leaps_expirations

        # Step 2: Rank
        rank_tool,            # rank_leaps_candidates
        compare_tool,         # compare_candidates

        # Step 3: Simulate
        payoff_sim_tool,      # simulate_leaps_payoff
        greeks_tool,          # calculate_greeks_impact
        table_tool,           # build_payoff_table

        # Step 4: Risk Scan
        risk_scan_tool,       # scan_leaps_risks
        risk_report_tool,     # generate_risk_report

        # Response Builder
        response_tool,        # build_response (strict JSON)
    ],
)


# === Local Testing ===

def test_agent():
    """Simple test to verify agent is configured correctly."""
    print("=" * 60)
    print("LEAPS Builder Agent Configuration")
    print("=" * 60)
    print(f"\nAgent Name: {leaps_agent.name}")
    print(f"Model: {leaps_agent.model}")
    print(f"Tools: {len(leaps_agent.tools)}")

    print("\nTool List:")
    for i, tool in enumerate(leaps_agent.tools, 1):
        name = tool.name if hasattr(tool, 'name') else str(tool)
        print(f"  {i}. {name}")

    print("\n4-Step Workflow:")
    print("  Step 1: filter → candidates[]")
    print("  Step 2: rank → rankedCandidates[]")
    print("  Step 3: simulate → simulations[]")
    print("  Step 4: risk_scan → riskScan")

    return leaps_agent


if __name__ == "__main__":
    test_agent()
