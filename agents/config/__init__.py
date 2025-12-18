# Shared configuration module for ChainCopilot agents
import os
import yaml
from pathlib import Path

CONFIG_DIR = Path(__file__).parent


def load_gcp_config() -> dict:
    """Load GCP configuration from YAML file."""
    config_path = CONFIG_DIR / "gcp_config.yaml"
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def get_agent_config(agent_name: str) -> dict:
    """
    Get configuration for a specific agent.

    Args:
        agent_name: Agent identifier (e.g., "strategy_builder")

    Returns:
        Dict with agent config merged with GCP settings
    """
    config = load_gcp_config()
    gcp = config.get("gcp", {})
    agent = config.get("agents", {}).get(agent_name, {})

    return {
        "model": agent.get("model", "gemini-2.0-flash"),
        "project_id": gcp.get("project_id"),
        "location": gcp.get("location"),
        "staging_bucket": gcp.get("staging_bucket"),
        "agent_name": agent.get("name"),
        "agent_display_name": agent.get("display_name"),
        "description": agent.get("description", ""),
    }


# Export commonly used configs
GCP_CONFIG = None
try:
    GCP_CONFIG = load_gcp_config()
except Exception:
    pass  # Config will be loaded on demand

__all__ = ["load_gcp_config", "get_agent_config", "GCP_CONFIG"]
