"""
OpenBB Options Data Module

Provides functions to fetch options chain data and Greeks using OpenBB SDK.
Uses Cboe as default provider with Yahoo Finance fallback.

Example usage:
    from lib.openbb import get_expiration_dates, get_options_chain

    # Get all expiration dates for a ticker
    dates = get_expiration_dates('AAPL')
    print(dates['expiration_dates'])

    # Get full options chain for specific expiration
    chain = get_options_chain('AAPL', '2024-01-19')
    print(f"Found {chain.total_contracts} contracts")
"""

from .options_fetcher import (
    get_expiration_dates,
    get_options_chain,
    fetch_options_data,
    OptionsChainResult,
    RawOptionsData,
    Provider,
)

__all__ = [
    'get_expiration_dates',
    'get_options_chain',
    'fetch_options_data',
    'OptionsChainResult',
    'RawOptionsData',
    'Provider',
]
