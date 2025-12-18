"""
OpenBB Options Data Fetcher

Fetches options chain data and Greeks using OpenBB SDK.
Uses Cboe as default provider with Yahoo Finance fallback.

Usage:
    # Get expiration dates
    python options_fetcher.py AAPL

    # Get full options chain for specific expiration
    python options_fetcher.py AAPL 2024-01-19
"""

import sys
import json
import logging
import argparse
from datetime import datetime
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from enum import Enum

# Configure module logger
logger = logging.getLogger(__name__)


def setup_logging(level: int = logging.INFO) -> None:
    """Configure logging to stderr with the specified level."""
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter('[%(levelname)s] %(message)s'))
    logger.addHandler(handler)
    logger.setLevel(level)


# OpenBB imports - lazy initialization to support testing without openbb installed
_obb = None
_openbb_import_error: Optional[str] = None


def _get_obb():
    """Lazy-load openbb to allow testing without the package installed."""
    global _obb, _openbb_import_error
    if _obb is not None:
        return _obb
    if _openbb_import_error is not None:
        raise ImportError(_openbb_import_error)

    try:
        # Suppress OpenBB's stdout messages during import (e.g., "Extensions loaded...")
        # These messages pollute JSON output and cause parsing errors
        import os
        import io
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        try:
            from openbb import obb as openbb_obb
            _obb = openbb_obb
        finally:
            sys.stdout = old_stdout
        return _obb
    except ImportError as e:
        _openbb_import_error = f"openbb package not installed. Run: pip install openbb openbb-cboe openbb-yfinance. Error: {e}"
        raise ImportError(_openbb_import_error)


# For backward compatibility, create a module-level obb alias
# This will raise ImportError on first access if openbb is not installed
class _LazyObb:
    """Lazy loader for obb that raises ImportError on access if not installed."""
    def __getattr__(self, name):
        return getattr(_get_obb(), name)

obb = _LazyObb()


class Provider(Enum):
    """Supported data providers in priority order."""
    CBOE = "cboe"
    YFINANCE = "yfinance"


@dataclass
class OptionsChainResult:
    """Result container for options chain data."""
    ticker: str
    provider: str
    timestamp: str
    expiration_date: Optional[str]
    underlying_price: Optional[float]
    contracts: List[Dict[str, Any]]
    total_contracts: int
    error: Optional[str] = None


def _safe_float(value: Any) -> Optional[float]:
    """Safely convert value to float."""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _safe_int(value: Any) -> Optional[int]:
    """Safely convert value to int."""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _normalize_contract(row: Dict[str, Any], provider: str) -> Dict[str, Any]:
    """Normalize contract data from different providers to a standard format."""
    # Normalize expiration date
    exp = row.get("expiration") or row.get("expiry")
    if exp is not None:
        if hasattr(exp, 'strftime'):
            exp_str = exp.strftime('%Y-%m-%d')
        else:
            exp_str = str(exp).split('T')[0][:10]
    else:
        exp_str = ""

    # Field mappings vary by provider
    contract = {
        "contract_symbol": row.get("contract_symbol") or row.get("symbol") or "",
        "underlying_symbol": row.get("underlying_symbol") or row.get("underlying") or "",
        "underlying_price": _safe_float(row.get("underlying_price")),
        "expiration": exp_str,
        "dte": _safe_int(row.get("dte")),  # Days to expiration
        "strike": _safe_float(row.get("strike")),
        "option_type": str(row.get("option_type") or row.get("type") or "").lower(),

        # Pricing
        "bid": _safe_float(row.get("bid")),
        "ask": _safe_float(row.get("ask")),
        "last_price": _safe_float(row.get("last_price") or row.get("last_trade_price") or row.get("lastPrice")),
        "theoretical_price": _safe_float(row.get("theoretical_price")),
        "mark": _safe_float(row.get("mark")),  # Mid price

        # Price changes
        "open": _safe_float(row.get("open")),
        "high": _safe_float(row.get("high")),
        "low": _safe_float(row.get("low")),
        "prev_close": _safe_float(row.get("prev_close")),
        "change": _safe_float(row.get("change")),
        "change_percent": _safe_float(row.get("change_percent")),

        # Volume & Interest
        "volume": _safe_int(row.get("volume")),
        "open_interest": _safe_int(row.get("open_interest") or row.get("openInterest")),

        # Greeks
        "implied_volatility": _safe_float(row.get("implied_volatility") or row.get("impliedVolatility") or row.get("iv")),
        "delta": _safe_float(row.get("delta")),
        "gamma": _safe_float(row.get("gamma")),
        "theta": _safe_float(row.get("theta")),
        "vega": _safe_float(row.get("vega")),
        "rho": _safe_float(row.get("rho")),
    }

    return contract


@dataclass
class RawOptionsData:
    """Container for raw options data from provider."""
    df: Any  # pandas DataFrame
    expirations: List[str]
    underlying_price: Optional[float]
    provider: str


def _fetch_chains_from_provider(ticker: str, provider: Provider) -> Optional[RawOptionsData]:
    """
    Fetch options chains from a specific provider.

    Returns None if the provider fails.
    """
    try:
        result = obb.derivatives.options.chains(
            symbol=ticker.upper(),
            provider=provider.value
        )

        if result is None or not hasattr(result, 'results'):
            return None

        # Get the DataFrame using to_df() method
        df = result.to_df()
        if df is None or len(df) == 0:
            return None

        # Get expirations from the results object (CBOE-specific)
        expirations = []
        if hasattr(result.results, 'expirations'):
            expirations = result.results.expirations or []

        # Get underlying price from results if available (may be None)
        underlying_price = None
        if hasattr(result.results, 'underlying_price'):
            up = result.results.underlying_price
            if up:
                if isinstance(up, list) and len(up) > 0:
                    underlying_price = _safe_float(up[0])
                else:
                    underlying_price = _safe_float(up)

        return RawOptionsData(
            df=df,
            expirations=expirations,
            underlying_price=underlying_price,
            provider=provider.value
        )

    except Exception as e:
        logger.error(f"[{provider.value}] Error fetching data for {ticker}: {e}", exc_info=logger.isEnabledFor(logging.DEBUG))
        return None


def fetch_options_data(ticker: str) -> Optional[RawOptionsData]:
    """
    Fetch full options chain data with provider fallback.

    Tries Cboe first, falls back to Yahoo Finance.

    Returns:
        RawOptionsData or None if all providers fail
    """
    providers = [Provider.CBOE, Provider.YFINANCE]

    for provider in providers:
        logger.info(f"[{provider.value}] Attempting to fetch options chain for {ticker}...")
        data = _fetch_chains_from_provider(ticker, provider)

        if data is not None and len(data.df) > 0:
            logger.info(f"[{provider.value}] Success! Retrieved {len(data.df)} contracts.")
            return data
        else:
            logger.debug(f"[{provider.value}] No data returned, trying next provider...")

    return None


@dataclass
class QuoteData:
    """Quote data for underlying asset."""
    price: Optional[float] = None
    prev_close: Optional[float] = None
    change: Optional[float] = None
    change_percent: Optional[float] = None
    price_type: str = "unknown"  # "current", "prev_close", or "unknown"
    timestamp: Optional[str] = None


def get_quote_data(ticker: str) -> QuoteData:
    """
    Get comprehensive quote data for a ticker.

    Uses CBOE quote API. Returns price type indicator (current vs prev_close).

    Args:
        ticker: Stock ticker symbol (e.g., 'AAPL')

    Returns:
        QuoteData with price, change, and metadata
    """
    quote = QuoteData()

    try:
        # Get quote from CBOE
        result = obb.equity.price.quote(symbol=ticker.upper(), provider="cboe")
        if result and hasattr(result, 'results') and result.results:
            data = result.results[0] if isinstance(result.results, list) else result.results

            # Get prev_close (always needed for change calculation)
            prev_close = _safe_float(getattr(data, 'prev_close', None))
            quote.prev_close = prev_close

            # Try last_price first (available during market hours)
            last_price = _safe_float(getattr(data, 'last_price', None))

            if last_price and last_price > 0:
                quote.price = last_price
                quote.price_type = "current"
                quote.timestamp = datetime.now().isoformat()
                logger.info(f"[cboe] Got last_price for {ticker}: {last_price}")
            elif prev_close and prev_close > 0:
                # Use prev_close when market is closed
                quote.price = prev_close
                quote.price_type = "prev_close"
                quote.timestamp = datetime.now().isoformat()
                logger.info(f"[cboe] Got prev_close for {ticker}: {prev_close}")

            # Calculate change from prev_close
            if quote.price and prev_close and prev_close > 0:
                quote.change = quote.price - prev_close
                quote.change_percent = (quote.change / prev_close) * 100

    except Exception as e:
        logger.debug(f"[cboe] Failed to get quote for {ticker}: {e}")

    return quote


def get_underlying_price(ticker: str) -> Optional[float]:
    """
    Get the current stock price for a ticker.

    Uses CBOE quote API. Falls back to prev_close when market is closed.

    Args:
        ticker: Stock ticker symbol (e.g., 'AAPL')

    Returns:
        Current stock price or None if unavailable
    """
    quote = get_quote_data(ticker)
    return quote.price


def get_expiration_dates(ticker: str, include_first_chain: bool = False) -> Dict[str, Any]:
    """
    Get all available expiration dates for a ticker.

    Args:
        ticker: Stock ticker symbol (e.g., 'AAPL')
        include_first_chain: If True, also include contracts for the first expiration
                             to avoid a second API call (performance optimization)

    Returns:
        Dict with ticker, provider, expiration_dates list, and metadata.
        If include_first_chain=True, also includes 'contracts' for first expiration.
    """
    data = fetch_options_data(ticker)

    if data is None:
        return {
            "ticker": ticker.upper(),
            "provider": "none",
            "timestamp": datetime.now().isoformat(),
            "expiration_dates": [],
            "total_dates": 0,
            "error": "No options data available for this ticker"
        }

    # Use expirations from the data if available, otherwise extract from DataFrame
    if data.expirations:
        sorted_dates = sorted(data.expirations)
    else:
        # Extract unique expiration dates from DataFrame
        expirations = set()
        if 'expiration' in data.df.columns:
            for exp in data.df['expiration'].unique():
                if exp is not None:
                    if hasattr(exp, 'strftime'):
                        exp_str = exp.strftime('%Y-%m-%d')
                    else:
                        exp_str = str(exp).split('T')[0][:10]
                    expirations.add(exp_str)
        sorted_dates = sorted(list(expirations))

    # Get quote data - prefer options data price, but fetch quote for change info
    underlying_price = data.underlying_price
    quote = get_quote_data(ticker)

    # Use options data price if available, otherwise use quote price
    if not underlying_price:
        logger.info(f"Underlying price not in options data, using quote data...")
        underlying_price = quote.price

    result = {
        "ticker": ticker.upper(),
        "provider": data.provider,
        "timestamp": datetime.now().isoformat(),
        "underlying_price": underlying_price,
        "prev_close": quote.prev_close,
        "change": quote.change,
        "change_percent": quote.change_percent,
        "price_type": quote.price_type,
        "price_timestamp": quote.timestamp,
        "expiration_dates": sorted_dates,
        "total_dates": len(sorted_dates),
        "error": None
    }

    # Performance optimization: include first expiration's contracts
    # This avoids a second API call when user searches for a ticker
    if include_first_chain and sorted_dates:
        first_exp = sorted_dates[0]

        # Normalize expiration column for comparison
        def normalize_date(exp):
            if exp is None:
                return None
            if hasattr(exp, 'strftime'):
                return exp.strftime('%Y-%m-%d')
            return str(exp).split('T')[0][:10]

        # Filter rows for first expiration
        df = data.df
        if 'expiration' in df.columns:
            mask = df['expiration'].apply(normalize_date) == first_exp
            filtered_df = df[mask]

            # Convert to normalized contracts
            contracts = []
            for _, row in filtered_df.iterrows():
                contract = _normalize_contract(row.to_dict(), data.provider)
                contracts.append(contract)

            # Sort by strike, then option type
            contracts.sort(key=lambda x: (x.get("strike") if x.get("strike") is not None else float('inf'), x.get("option_type", "")))

            result["first_expiration"] = first_exp
            result["contracts"] = contracts
            result["total_contracts"] = len(contracts)

    return result


def get_all_contracts(ticker: str) -> OptionsChainResult:
    """
    Get all options contracts for all expirations (batch mode for heatmap).

    Args:
        ticker: Stock ticker symbol (e.g., 'AAPL')

    Returns:
        OptionsChainResult with ALL contracts across all expirations
    """
    data = fetch_options_data(ticker)

    if data is None:
        return OptionsChainResult(
            ticker=ticker.upper(),
            provider="none",
            timestamp=datetime.now().isoformat(),
            expiration_date=None,
            underlying_price=None,
            contracts=[],
            total_contracts=0,
            error="No options data available for this ticker"
        )

    # Convert ALL rows to normalized contracts (no filtering)
    all_contracts = []
    for _, row in data.df.iterrows():
        contract = _normalize_contract(row.to_dict(), data.provider)
        all_contracts.append(contract)

    # Get underlying price
    underlying_price = data.underlying_price
    if not underlying_price:
        logger.info(f"Underlying price not in options data, fetching separately...")
        underlying_price = get_underlying_price(ticker)

    return OptionsChainResult(
        ticker=ticker.upper(),
        provider=data.provider,
        timestamp=datetime.now().isoformat(),
        expiration_date=None,  # All expirations
        underlying_price=underlying_price,
        contracts=all_contracts,
        total_contracts=len(all_contracts),
        error=None
    )


def get_options_chain(ticker: str, expiration_date: str) -> OptionsChainResult:
    """
    Get full options chain data for a specific expiration date.

    Args:
        ticker: Stock ticker symbol (e.g., 'AAPL')
        expiration_date: Expiration date in YYYY-MM-DD format

    Returns:
        OptionsChainResult with all contracts and Greeks
    """
    # Validate expiration_date format
    try:
        datetime.strptime(expiration_date, "%Y-%m-%d")
    except ValueError:
        return OptionsChainResult(
            ticker=ticker.upper(),
            provider="none",
            timestamp=datetime.now().isoformat(),
            expiration_date=expiration_date,
            underlying_price=None,
            contracts=[],
            total_contracts=0,
            error=f"Invalid expiration_date format: '{expiration_date}'. Expected YYYY-MM-DD (e.g., '2024-01-19')"
        )

    data = fetch_options_data(ticker)

    if data is None:
        return OptionsChainResult(
            ticker=ticker.upper(),
            provider="none",
            timestamp=datetime.now().isoformat(),
            expiration_date=expiration_date,
            underlying_price=None,
            contracts=[],
            total_contracts=0,
            error="No options data available for this ticker"
        )

    # Filter DataFrame by expiration date
    df = data.df

    # Normalize expiration column for comparison
    def normalize_date(exp):
        if exp is None:
            return None
        if hasattr(exp, 'strftime'):
            return exp.strftime('%Y-%m-%d')
        return str(exp).split('T')[0][:10]

    # Filter rows matching the expiration date
    if 'expiration' not in df.columns:
        return OptionsChainResult(
            ticker=ticker.upper(),
            provider=data.provider,
            timestamp=datetime.now().isoformat(),
            expiration_date=expiration_date,
            underlying_price=data.underlying_price,
            contracts=[],
            total_contracts=0,
            error="Provider did not include expiration column; cannot filter by expiration_date"
        )

    mask = df['expiration'].apply(normalize_date) == expiration_date
    filtered_df = df[mask]

    # Convert to list of normalized contracts
    filtered_contracts = []
    for _, row in filtered_df.iterrows():
        contract = _normalize_contract(row.to_dict(), data.provider)
        filtered_contracts.append(contract)

    # Sort by strike price, then by option type (calls first)
    # Use float('inf') for None strikes to push them to the end
    filtered_contracts.sort(key=lambda x: (x.get("strike") if x.get("strike") is not None else float('inf'), x.get("option_type", "")))

    # Get underlying price - use from options data or fetch separately
    underlying_price = data.underlying_price
    if not underlying_price:
        logger.info(f"Underlying price not in options data, fetching separately...")
        underlying_price = get_underlying_price(ticker)

    return OptionsChainResult(
        ticker=ticker.upper(),
        provider=data.provider,
        timestamp=datetime.now().isoformat(),
        expiration_date=expiration_date,
        underlying_price=underlying_price,
        contracts=filtered_contracts,
        total_contracts=len(filtered_contracts),
        error=None if filtered_contracts else f"No contracts found for expiration {expiration_date}"
    )


def format_output(data: Any) -> str:
    """Format output as pretty JSON."""
    if hasattr(data, '__dict__'):
        data = asdict(data)
    return json.dumps(data, indent=2, default=str)


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Fetch options chain data and Greeks using OpenBB SDK.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python options_fetcher.py AAPL                    # Get expiration dates
  python options_fetcher.py AAPL --include-first   # Get expirations + first chain (fast initial load)
  python options_fetcher.py AAPL 2024-01-19         # Get options chain
  python options_fetcher.py AAPL --all              # Get ALL contracts (for heatmap)
  python options_fetcher.py AAPL --quiet            # Suppress info logs
  python options_fetcher.py AAPL 2024-01-19 --debug # Show debug info
"""
    )
    parser.add_argument("ticker", help="Stock ticker symbol (e.g., AAPL)")
    parser.add_argument("expiration_date", nargs="?", default=None,
                        help="Expiration date in YYYY-MM-DD format (optional)")
    parser.add_argument("--all", "-a", action="store_true",
                        help="Get ALL contracts for all expirations (batch mode for heatmap)")
    parser.add_argument("--include-first", "-f", action="store_true",
                        help="Include first expiration's contracts with expirations (faster initial load)")
    parser.add_argument("--quiet", "-q", action="store_true",
                        help="Suppress info logs (only show warnings and errors)")
    parser.add_argument("--debug", "-d", action="store_true",
                        help="Enable debug logging with stack traces")

    args = parser.parse_args()

    # Configure logging based on flags
    if args.debug:
        setup_logging(logging.DEBUG)
    elif args.quiet:
        setup_logging(logging.WARNING)
    else:
        setup_logging(logging.INFO)

    ticker = args.ticker.upper()

    if args.all:
        # Get ALL contracts for heatmap (batch mode)
        result = get_all_contracts(ticker)
        print(format_output(result))
    elif args.expiration_date:
        # Get options chain for specific expiration
        result = get_options_chain(ticker, args.expiration_date)
        print(format_output(result))
    else:
        # Get expiration dates (optionally with first expiration's contracts)
        result = get_expiration_dates(ticker, include_first_chain=args.include_first)
        print(format_output(result))


if __name__ == "__main__":
    main()
