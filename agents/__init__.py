# ChainCopilot AI Agents
# Vertex AI Agent Builder agents for options trading

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

# LEAPS Builder Agent (requires google-adk, import conditionally)
try:
    from .leaps_agent import leaps_agent, AGENT_CONFIG as LEAPS_AGENT_CONFIG
except ImportError:
    leaps_agent = None
    LEAPS_AGENT_CONFIG = None

__all__ = [
    "tools",
    "strategy_agent",
    "STRATEGY_AGENT_CONFIG",
    "leaps_agent",
    "LEAPS_AGENT_CONFIG",
]
