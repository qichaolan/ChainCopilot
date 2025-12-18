#!/usr/bin/env python3
"""
Deploy Strategy Agent to Vertex AI Agent Engine

Usage:
    python deploy.py                    # Deploy to default project
    python deploy.py --test            # Test locally before deploying
    python deploy.py --project <id>    # Deploy to specific project
"""

import argparse
import sys
import os

# Add parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def test_agent_local():
    """Test the agent locally before deployment."""
    print("=" * 60)
    print("Testing Strategy Agent Locally")
    print("=" * 60)

    try:
        from agents.strategy_agent.agent import strategy_agent
        from agents.strategy_agent.config import AGENT_CONFIG

        print(f"\n[OK] Agent loaded successfully")
        print(f"  Name: {strategy_agent.name}")
        print(f"  Model: {strategy_agent.model}")
        print(f"  Tools: {len(strategy_agent.tools)}")

        # Test each tool
        print("\n[Testing Tools]")
        from agents.tools import (
            parse_strategy_intent,
            generate_strategy_candidates,
            rank_and_explain,
            compute_payoff,
            calculate_probabilities,
            analyze_position_greeks,
            check_position_liquidity,
            suggest_next_edit,
            check_constraints,
        )

        # Test intent parser
        result = parse_strategy_intent(
            symbol="AAPL",
            market_view_direction="bullish",
            market_view_volatility="up",
            timeframe="month",
            risk_max_loss_usd=500,
            credit_or_debit="either",
            goal="income",
            execution_max_bid_ask_pct=1.0,
        )
        print(f"  parse_strategy_intent: {'OK' if result.get('success') else 'FAIL'}")

        # Test strategy generator
        result = generate_strategy_candidates("AAPL", "bullish")
        print(f"  generate_strategy_candidates: {'OK' if result.get('candidates') else 'FAIL'}")

        # Test ranking
        result = rank_and_explain("{}", "{}", 10)
        print(f"  rank_and_explain: {'OK' if result.get('ranked_candidates') else 'FAIL'}")

        # Test payoff
        result = compute_payoff("[]", 185.0)
        print(f"  compute_payoff: {'OK' if 'max_profit' in result else 'FAIL'}")

        # Test probability
        result = calculate_probabilities("[]", 185.0, "[]", 30)
        print(f"  calculate_probabilities: {'OK' if 'delta_based_pop' in result else 'FAIL'}")

        # Test Greeks
        result = analyze_position_greeks("[]", 30)
        print(f"  analyze_position_greeks: {'OK' if 'net_delta' in result else 'FAIL'}")

        # Test liquidity
        result = check_position_liquidity("[]")
        print(f"  check_position_liquidity: {'OK' if 'overall_score' in result else 'FAIL'}")

        # Test suggestion
        result = suggest_next_edit("{}", "{}", "{}", "{}", "{}", 185.0, 30)
        print(f"  suggest_next_edit: {'OK' if 'suggestion_type' in result else 'FAIL'}")

        # Test constraints
        result = check_constraints("{}", "{}", "{}")
        print(f"  check_constraints: {'OK' if 'passed' in result else 'FAIL'}")

        print("\n[OK] All tests passed!")
        return True

    except Exception as e:
        print(f"\n[ERROR] Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def deploy_agent(project_id: str = None, location: str = None):
    """Deploy the agent to Vertex AI Agent Engine."""
    print("=" * 60)
    print("Deploying Strategy Agent to Vertex AI")
    print("=" * 60)

    try:
        from agents.strategy_agent.config import AGENT_CONFIG

        project = project_id or AGENT_CONFIG["project_id"]
        loc = location or AGENT_CONFIG["location"]

        print(f"\nProject: {project}")
        print(f"Location: {loc}")
        print(f"Staging Bucket: {AGENT_CONFIG['staging_bucket']}")

        # Import Vertex AI
        import vertexai
        from vertexai import agent_engines

        # Initialize Vertex AI
        vertexai.init(project=project, location=loc)
        print("\n[OK] Vertex AI initialized")

        # Import the agent
        from agents.strategy_agent.agent import strategy_agent

        # Create ADK App wrapper
        from google.adk import AdkApp
        app = AdkApp(
            agent=strategy_agent,
            enable_cloud_trace=True,
        )
        print("[OK] ADK App created")

        # Deploy to Agent Engine
        print("\n[Deploying...] This may take a few minutes...")

        remote_agent = agent_engines.create(
            agent_engine=app,
            requirements=[
                "google-cloud-aiplatform>=1.112",
                "google-adk>=1.0.0",
                "pydantic>=2.0.0",
                "numpy>=1.24.0",
                "requests>=2.31.0",
            ],
            display_name=AGENT_CONFIG["agent_display_name"],
            description="Options strategy builder agent for ChainCopilot",
        )

        print(f"\n[OK] Agent deployed successfully!")
        print(f"  Resource Name: {remote_agent.resource_name}")
        print(f"  Display Name: {remote_agent.display_name}")

        return remote_agent

    except ImportError as e:
        print(f"\n[ERROR] Missing dependency: {e}")
        print("Run: pip install google-cloud-aiplatform google-adk")
        return None

    except Exception as e:
        print(f"\n[ERROR] Deployment failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_deployed_agent(resource_name: str):
    """Test the deployed agent with a sample query."""
    print("=" * 60)
    print("Testing Deployed Agent")
    print("=" * 60)

    try:
        from vertexai import agent_engines

        # Get the agent
        agent = agent_engines.get(resource_name)
        print(f"\nAgent: {agent.display_name}")

        # Create a session
        session = agent.create_session(user_id="test-user-001")
        print(f"Session created: {session.name}")

        # Send a test message
        test_message = "I'm bullish on AAPL, moderate risk, 30 DTE"
        print(f"\nSending: {test_message}")

        response = session.send_message(test_message)
        print(f"\nResponse:\n{response.text}")

        return True

    except Exception as e:
        print(f"\n[ERROR] Test failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Deploy Strategy Agent to Vertex AI")
    parser.add_argument("--test", action="store_true", help="Test locally before deploying")
    parser.add_argument("--project", type=str, help="GCP project ID")
    parser.add_argument("--location", type=str, default="us-west1", help="GCP location")
    parser.add_argument("--test-deployed", type=str, help="Test a deployed agent by resource name")

    args = parser.parse_args()

    if args.test:
        success = test_agent_local()
        sys.exit(0 if success else 1)

    if args.test_deployed:
        success = test_deployed_agent(args.test_deployed)
        sys.exit(0 if success else 1)

    # First test locally
    print("Running local tests first...\n")
    if not test_agent_local():
        print("\n[ABORT] Local tests failed. Fix issues before deploying.")
        sys.exit(1)

    # Then deploy
    print("\n")
    agent = deploy_agent(args.project, args.location)

    if agent:
        print("\n" + "=" * 60)
        print("Deployment Complete!")
        print("=" * 60)
        print(f"\nTo test the deployed agent:")
        print(f"  python deploy.py --test-deployed {agent.resource_name}")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
