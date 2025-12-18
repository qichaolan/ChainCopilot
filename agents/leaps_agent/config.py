"""
LEAPS Builder Agent Configuration
"""

from pathlib import Path

# Load system prompt from markdown file
SYSTEM_PROMPT_PATH = Path(__file__).parent / "system.md"
with open(SYSTEM_PROMPT_PATH, "r") as f:
    SYSTEM_PROMPT = f.read()

# Agent configuration
AGENT_CONFIG = {
    "agent_name": "leaps_builder",
    "model": "gemini-2.0-flash",  # Fast model for iterative workflow
    "description": "LEAPS options builder with 4-step HITL workflow",
    "version": "1.0.0",
}

# Default LEAPS parameters
LEAPS_DEFAULTS = {
    "dte_range": {
        "min": 180,  # 6 months minimum
        "max": 730,  # ~2 years maximum
    },
    "delta_range": {
        "bullish": {"min": 0.50, "max": 0.80},
        "bearish": {"min": 0.50, "max": 0.80},  # Absolute value
        "neutral": {"min": 0.40, "max": 0.60},
    },
    "liquidity_threshold": {
        "min_oi": 100,
        "max_spread_pct": 5.0,
    },
}

# Scoring weights (can be customized per user)
DEFAULT_SCORING_WEIGHTS = {
    "thetaEfficiency": 0.25,
    "deltaProbability": 0.25,
    "liquidity": 0.25,
    "riskReward": 0.25,
}

# Price scenarios for payoff simulation
DEFAULT_SCENARIOS = [-20, -10, -5, 0, 5, 10, 20, 30]

# Risk thresholds
RISK_THRESHOLDS = {
    "iv_rank_high": 80,     # IV rank above this is considered high
    "iv_rank_low": 20,      # IV rank below this is considered low
    "theta_decay_high": 0.5,  # Daily decay > 0.5% of position is high
    "high_impact_events": 2,  # More than 2 high-impact events = elevated risk
}
