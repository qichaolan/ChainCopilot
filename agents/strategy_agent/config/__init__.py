"""
Strategy Agent Configuration Package.

Centralizes configuration for trader profiles, scoring weights, and strategy parameters.
"""

from config.trader_profiles import (
    TraderProfileType,
    ProfileConfig,
    GreekPreferences,
    TRADER_PROFILES,
    get_profile,
    get_profile_weights,
    get_all_profiles,
    get_profiles_for_strategy,
)

__all__ = [
    "TraderProfileType",
    "ProfileConfig",
    "GreekPreferences",
    "TRADER_PROFILES",
    "get_profile",
    "get_profile_weights",
    "get_all_profiles",
    "get_profiles_for_strategy",
]
