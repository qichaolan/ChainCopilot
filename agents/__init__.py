# ChainCopilot AI Agents
# Vertex AI Agent Builder agents for options trading and fundamental analysis

# Shared tools (available to all agents)
from . import tools

# Strategy Agent (requires google-adk, import conditionally)
try:
    from .strategy_agent import strategy_agent, AGENT_CONFIG as STRATEGY_AGENT_CONFIG
    _HAS_ADK = True
except ImportError:
    strategy_agent = None
    STRATEGY_AGENT_CONFIG = None
    _HAS_ADK = False

# Fundamental Agent (SEC filing analysis)
try:
    from .fundamental_agent.agent import fundamental_graph
    from .fundamental_agent.server import app as fundamental_app
    _HAS_FUNDAMENTAL = True
except ImportError:
    fundamental_graph = None
    fundamental_app = None
    _HAS_FUNDAMENTAL = False

__all__ = [
    "tools",
    "strategy_agent",
    "STRATEGY_AGENT_CONFIG",
    "fundamental_graph",
    "fundamental_app",
]
