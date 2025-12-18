"""
Trader Profile Configuration

Defines trader profiles with their scoring weights and strategy preferences.
Each profile has different priorities for risk, reward, and Greek sensitivities.
"""

from typing import Dict, List, Literal, TypedDict


# ============================================================================
# Profile Type Definition
# ============================================================================

TraderProfileType = Literal[
    "income",
    "momentum",
    "stock_replacement",
    "speculator",
    "hedger",
]


class GreekPreferences(TypedDict):
    """Greek sensitivity preferences for a profile."""
    delta: Literal["loves", "neutral", "hates"]
    theta: Literal["loves", "neutral", "hates", "accepts"]
    gamma: Literal["loves", "neutral", "hates"]
    vega: Literal["loves", "neutral", "hates"]


class ProfileConfig(TypedDict):
    """Full configuration for a trader profile."""
    id: TraderProfileType
    label: str
    description: str
    primaryGoal: str
    directionalBias: Literal["bullish", "bearish", "neutral", "strong_bullish", "strong_bearish", "protective"]
    riskTolerance: Literal["low", "low_medium", "medium", "medium_high", "high"]
    greekPreferences: GreekPreferences
    typicalStrategies: List[str]
    defaultStrategy: str  # Default strategy for this profile
    # Scoring weights for two-stage scoring
    rewardWeight: float  # Weight for ROI-based reward score
    riskWeight: float    # Weight for risk quality score
    # Strategy-specific adjustments
    preferHighDelta: bool
    preferLowTheta: bool
    preferHighGamma: bool


# ============================================================================
# Profile Definitions
# ============================================================================

TRADER_PROFILES: Dict[TraderProfileType, ProfileConfig] = {
    "income": {
        "id": "income",
        "label": "Income",
        "description": "Consistent cash flow from premium collection",
        "primaryGoal": "Consistent cash flow",
        "directionalBias": "neutral",
        "riskTolerance": "low_medium",
        "greekPreferences": {
            "delta": "neutral",
            "theta": "loves",
            "gamma": "hates",
            "vega": "neutral",
        },
        "typicalStrategies": [
            "credit_spread",
            "covered_call",
            "cash_secured_put",
            "iron_condor",
        ],
        "defaultStrategy": "cash_secured_put",  # Most common income entry
        "rewardWeight": 0.30,
        "riskWeight": 0.70,
        "preferHighDelta": False,
        "preferLowTheta": False,  # Wants positive theta
        "preferHighGamma": False,
    },
    "momentum": {
        "id": "momentum",
        "label": "Momentum",
        "description": "Fast capital gains, strong directional",
        "primaryGoal": "Fast capital gains",
        "directionalBias": "strong_bullish",
        "riskTolerance": "medium_high",
        "greekPreferences": {
            "delta": "loves",
            "theta": "hates",
            "gamma": "neutral",
            "vega": "neutral",
        },
        "typicalStrategies": [
            "long_call",
            "long_put",
            "credit_spread",
        ],
        "defaultStrategy": "long_call",  # Cleanest directional momentum expression
        "rewardWeight": 0.70,
        "riskWeight": 0.30,
        "preferHighDelta": True,
        "preferLowTheta": True,  # Minimize theta decay
        "preferHighGamma": False,
    },
    "stock_replacement": {
        "id": "stock_replacement",
        "label": "Stock Replacement",
        "description": "Capital efficiency vs shares",
        "primaryGoal": "Capital efficiency vs shares",
        "directionalBias": "bullish",
        "riskTolerance": "medium",
        "greekPreferences": {
            "delta": "loves",
            "theta": "accepts",
            "gamma": "neutral",
            "vega": "neutral",
        },
        "typicalStrategies": [
            "leaps",
        ],
        "defaultStrategy": "leaps",  # Core use case: LEAPS calls for delta + capital efficiency
        "rewardWeight": 0.45,
        "riskWeight": 0.55,
        "preferHighDelta": True,
        "preferLowTheta": False,  # Accepts theta for long-dated
        "preferHighGamma": False,
    },
    "speculator": {
        "id": "speculator",
        "label": "Speculator",
        "description": "Explosive upside, extreme directional",
        "primaryGoal": "Explosive upside",
        "directionalBias": "strong_bullish",
        "riskTolerance": "high",
        "greekPreferences": {
            "delta": "neutral",
            "theta": "hates",
            "gamma": "loves",
            "vega": "loves",
        },
        "typicalStrategies": [
            "long_call",
            "long_put",
        ],
        "defaultStrategy": "long_call",  # Canonical "lotto" expression; OTM for high gamma
        "rewardWeight": 0.80,
        "riskWeight": 0.20,
        "preferHighDelta": False,  # Prefers lower delta for leverage
        "preferLowTheta": True,
        "preferHighGamma": True,
    },
    "hedger": {
        "id": "hedger",
        "label": "Hedger",
        "description": "Wealth preservation, protective",
        "primaryGoal": "Wealth preservation",
        "directionalBias": "protective",
        "riskTolerance": "low",
        "greekPreferences": {
            "delta": "neutral",
            "theta": "accepts",
            "gamma": "neutral",
            "vega": "loves",
        },
        "typicalStrategies": [
            "long_put",  # Protective puts
        ],
        "defaultStrategy": "long_put",  # Purest hedge: protective puts
        "rewardWeight": 0.25,
        "riskWeight": 0.75,
        "preferHighDelta": True,  # For puts: high delta = more protection
        "preferLowTheta": False,  # Accepts as cost of insurance
        "preferHighGamma": False,
    },
}


# ============================================================================
# Helper Functions
# ============================================================================

def get_profile(profile_type: TraderProfileType) -> ProfileConfig:
    """Get profile configuration by type."""
    return TRADER_PROFILES.get(profile_type, TRADER_PROFILES["stock_replacement"])


def get_profile_weights(profile_type: TraderProfileType) -> Dict[str, float]:
    """Get reward/risk weights for a profile."""
    profile = get_profile(profile_type)
    return {
        "reward": profile["rewardWeight"],
        "risk": profile["riskWeight"],
    }


def get_all_profiles() -> List[ProfileConfig]:
    """Get all profile configurations."""
    return list(TRADER_PROFILES.values())


def get_profiles_for_strategy(strategy: str) -> List[ProfileConfig]:
    """Get profiles that typically use a given strategy."""
    return [
        p for p in TRADER_PROFILES.values()
        if strategy in p["typicalStrategies"]
    ]
