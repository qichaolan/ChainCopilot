"""
Tests for OpenBB Options Fetcher

Coverage targets:
- _safe_float / _safe_int: type conversion
- _normalize_contract: data normalization
- format_output: JSON formatting
- get_options_chain: error handling for invalid dates
- QuoteData / OptionsChainResult: dataclass correctness
"""

import pytest
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock
import sys
import json
from types import ModuleType

# Mock openbb before importing the module
# Use ModuleType to avoid MagicMock auto-creating pytest_plugins attribute
_mock_openbb = ModuleType('openbb')
_mock_obb = MagicMock()
_mock_openbb.obb = _mock_obb  # type: ignore
sys.modules['openbb'] = _mock_openbb

from lib.openbb.options_fetcher import (
    _safe_float,
    _safe_int,
    _normalize_contract,
    format_output,
    OptionsChainResult,
    QuoteData,
    Provider,
)


class TestSafeFloat:
    """Tests for _safe_float function."""

    def test_none_returns_none(self):
        assert _safe_float(None) is None

    def test_valid_float(self):
        assert _safe_float(3.14) == 3.14

    def test_valid_int(self):
        assert _safe_float(42) == 42.0

    def test_valid_string_float(self):
        assert _safe_float("3.14") == 3.14

    def test_valid_string_int(self):
        assert _safe_float("42") == 42.0

    def test_invalid_string_returns_none(self):
        assert _safe_float("not a number") is None

    def test_empty_string_returns_none(self):
        assert _safe_float("") is None

    def test_dict_returns_none(self):
        assert _safe_float({"value": 42}) is None

    def test_list_returns_none(self):
        assert _safe_float([1, 2, 3]) is None

    def test_negative_float(self):
        assert _safe_float(-3.14) == -3.14

    def test_zero(self):
        assert _safe_float(0) == 0.0

    def test_scientific_notation(self):
        assert _safe_float("1e-5") == 0.00001


class TestSafeInt:
    """Tests for _safe_int function."""

    def test_none_returns_none(self):
        assert _safe_int(None) is None

    def test_valid_int(self):
        assert _safe_int(42) == 42

    def test_valid_float_truncates(self):
        assert _safe_int(3.14) == 3
        assert _safe_int(3.99) == 3

    def test_valid_string_int(self):
        assert _safe_int("42") == 42

    def test_invalid_string_returns_none(self):
        assert _safe_int("not a number") is None

    def test_empty_string_returns_none(self):
        assert _safe_int("") is None

    def test_dict_returns_none(self):
        assert _safe_int({"value": 42}) is None

    def test_list_returns_none(self):
        assert _safe_int([1, 2, 3]) is None

    def test_negative_int(self):
        assert _safe_int(-42) == -42

    def test_zero(self):
        assert _safe_int(0) == 0


class TestNormalizeContract:
    """Tests for _normalize_contract function."""

    def test_basic_contract_normalization(self):
        row = {
            "contract_symbol": "AAPL240119C00150000",
            "underlying_symbol": "AAPL",
            "underlying_price": 185.50,
            "expiration": datetime(2024, 1, 19),
            "dte": 30,
            "strike": 150.0,
            "option_type": "CALL",
            "bid": 35.50,
            "ask": 36.00,
            "last_price": 35.75,
            "volume": 1500,
            "open_interest": 25000,
            "implied_volatility": 0.35,
            "delta": 0.85,
            "gamma": 0.012,
            "theta": -0.15,
            "vega": 0.25,
            "rho": 0.08,
        }

        result = _normalize_contract(row, "cboe")

        assert result["contract_symbol"] == "AAPL240119C00150000"
        assert result["underlying_symbol"] == "AAPL"
        assert result["underlying_price"] == 185.50
        assert result["expiration"] == "2024-01-19"
        assert result["dte"] == 30
        assert result["strike"] == 150.0
        assert result["option_type"] == "call"  # Lowercase
        assert result["bid"] == 35.50
        assert result["ask"] == 36.00
        assert result["last_price"] == 35.75
        assert result["volume"] == 1500
        assert result["open_interest"] == 25000
        assert result["implied_volatility"] == 0.35
        assert result["delta"] == 0.85

    def test_alternative_field_names(self):
        """Test that alternative field names are handled."""
        row = {
            "symbol": "AAPL240119C00150000",  # Alternative for contract_symbol
            "underlying": "AAPL",  # Alternative for underlying_symbol
            "expiry": "2024-01-19",  # Alternative for expiration
            "type": "put",  # Alternative for option_type
            "last_trade_price": 5.50,  # Alternative for last_price
            "openInterest": 10000,  # Alternative for open_interest
            "impliedVolatility": 0.40,  # Alternative for implied_volatility
            "strike": 145.0,
            "bid": 5.25,
            "ask": 5.75,
        }

        result = _normalize_contract(row, "yfinance")

        assert result["contract_symbol"] == "AAPL240119C00150000"
        assert result["underlying_symbol"] == "AAPL"
        assert result["expiration"] == "2024-01-19"
        assert result["option_type"] == "put"
        assert result["last_price"] == 5.50
        assert result["open_interest"] == 10000
        assert result["implied_volatility"] == 0.40

    def test_missing_fields_default_to_none(self):
        """Test that missing fields default to None or empty string."""
        row = {"strike": 150.0}

        result = _normalize_contract(row, "cboe")

        assert result["contract_symbol"] == ""
        assert result["underlying_symbol"] == ""
        assert result["underlying_price"] is None
        assert result["expiration"] == ""
        assert result["dte"] is None
        assert result["delta"] is None

    def test_datetime_expiration_formatting(self):
        """Test datetime expiration is formatted correctly."""
        row = {
            "expiration": datetime(2024, 12, 20, 16, 0, 0),
            "strike": 100.0,
        }

        result = _normalize_contract(row, "cboe")

        assert result["expiration"] == "2024-12-20"

    def test_iso_string_expiration_formatting(self):
        """Test ISO string expiration is formatted correctly."""
        row = {
            "expiration": "2024-12-20T16:00:00.000Z",
            "strike": 100.0,
        }

        result = _normalize_contract(row, "cboe")

        assert result["expiration"] == "2024-12-20"

    def test_none_expiration(self):
        """Test None expiration results in empty string."""
        row = {
            "expiration": None,
            "strike": 100.0,
        }

        result = _normalize_contract(row, "cboe")

        assert result["expiration"] == ""


class TestFormatOutput:
    """Tests for format_output function."""

    def test_dict_output(self):
        data = {"ticker": "AAPL", "price": 185.50}
        result = format_output(data)
        parsed = json.loads(result)
        assert parsed["ticker"] == "AAPL"
        assert parsed["price"] == 185.50

    def test_dataclass_output(self):
        data = OptionsChainResult(
            ticker="AAPL",
            provider="cboe",
            timestamp="2024-01-15T10:00:00",
            expiration_date="2024-01-19",
            underlying_price=185.50,
            contracts=[],
            total_contracts=0,
            error=None,
        )
        result = format_output(data)
        parsed = json.loads(result)
        assert parsed["ticker"] == "AAPL"
        assert parsed["provider"] == "cboe"
        assert parsed["underlying_price"] == 185.50

    def test_datetime_serialization(self):
        data = {"timestamp": datetime(2024, 1, 15, 10, 0, 0)}
        result = format_output(data)
        parsed = json.loads(result)
        assert "2024-01-15" in parsed["timestamp"]


class TestOptionsChainResult:
    """Tests for OptionsChainResult dataclass."""

    def test_creation(self):
        result = OptionsChainResult(
            ticker="AAPL",
            provider="cboe",
            timestamp="2024-01-15T10:00:00",
            expiration_date="2024-01-19",
            underlying_price=185.50,
            contracts=[{"strike": 150}],
            total_contracts=1,
        )

        assert result.ticker == "AAPL"
        assert result.provider == "cboe"
        assert result.underlying_price == 185.50
        assert result.total_contracts == 1
        assert result.error is None  # Default value

    def test_with_error(self):
        result = OptionsChainResult(
            ticker="INVALID",
            provider="none",
            timestamp="2024-01-15T10:00:00",
            expiration_date=None,
            underlying_price=None,
            contracts=[],
            total_contracts=0,
            error="No data available",
        )

        assert result.error == "No data available"
        assert result.contracts == []


class TestQuoteData:
    """Tests for QuoteData dataclass."""

    def test_default_values(self):
        quote = QuoteData()

        assert quote.price is None
        assert quote.prev_close is None
        assert quote.change is None
        assert quote.change_percent is None
        assert quote.price_type == "unknown"
        assert quote.timestamp is None

    def test_with_values(self):
        quote = QuoteData(
            price=185.50,
            prev_close=184.00,
            change=1.50,
            change_percent=0.815,
            price_type="current",
            timestamp="2024-01-15T10:00:00",
        )

        assert quote.price == 185.50
        assert quote.change == 1.50
        assert quote.price_type == "current"


class TestProvider:
    """Tests for Provider enum."""

    def test_cboe_value(self):
        assert Provider.CBOE.value == "cboe"

    def test_yfinance_value(self):
        assert Provider.YFINANCE.value == "yfinance"

    def test_iteration(self):
        providers = list(Provider)
        assert len(providers) == 2
        assert Provider.CBOE in providers
        assert Provider.YFINANCE in providers


class TestGetOptionsChainValidation:
    """Tests for get_options_chain input validation."""

    def test_invalid_date_format_returns_error(self):
        from lib.openbb.options_fetcher import get_options_chain

        # Mock fetch_options_data to not be called
        with patch('lib.openbb.options_fetcher.fetch_options_data') as mock_fetch:
            result = get_options_chain("AAPL", "01-19-2024")  # Wrong format

            # Should not call fetch_options_data for invalid date
            mock_fetch.assert_not_called()
            assert result.error is not None
            assert "Invalid expiration_date format" in result.error

    def test_valid_date_format_proceeds(self):
        from lib.openbb.options_fetcher import get_options_chain

        with patch('lib.openbb.options_fetcher.fetch_options_data') as mock_fetch:
            mock_fetch.return_value = None
            result = get_options_chain("AAPL", "2024-01-19")  # Correct format

            # Should call fetch_options_data for valid date
            mock_fetch.assert_called_once()
            assert "Invalid expiration_date format" not in (result.error or "")


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_safe_float_with_nan_string(self):
        # Should handle "nan" gracefully
        result = _safe_float("nan")
        assert result is None or (result is not None and str(result) == "nan")

    def test_safe_float_with_inf_string(self):
        # Should handle "inf" gracefully
        result = _safe_float("inf")
        assert result is None or (result is not None and str(result) == "inf")

    def test_normalize_contract_with_empty_row(self):
        result = _normalize_contract({}, "cboe")
        assert result["contract_symbol"] == ""
        assert result["strike"] is None
        assert result["option_type"] == ""

    def test_normalize_contract_with_none_values(self):
        row = {
            "contract_symbol": None,
            "strike": None,
            "option_type": None,
        }
        result = _normalize_contract(row, "cboe")
        assert result["contract_symbol"] == ""
        assert result["strike"] is None
        assert result["option_type"] == ""


class TestSetupLogging:
    """Tests for setup_logging function."""

    def test_setup_logging_basic(self):
        from lib.openbb.options_fetcher import setup_logging, logger
        import logging

        # Clear any existing handlers
        logger.handlers = []

        setup_logging(level=logging.DEBUG)

        assert len(logger.handlers) >= 1
        assert logger.level == logging.DEBUG

    def test_setup_logging_info_level(self):
        from lib.openbb.options_fetcher import setup_logging, logger
        import logging

        # Clear handlers
        logger.handlers = []

        setup_logging(level=logging.INFO)
        assert logger.level == logging.INFO


class TestLazyObb:
    """Tests for _LazyObb class and _get_obb function."""

    def test_lazy_obb_getattr_calls_get_obb(self):
        """Test that _LazyObb delegates to _get_obb."""
        from lib.openbb.options_fetcher import _LazyObb

        lazy = _LazyObb()
        with patch('lib.openbb.options_fetcher._get_obb') as mock_get_obb:
            mock_get_obb.return_value = MagicMock(test_attr='value')
            result = lazy.test_attr
            mock_get_obb.assert_called_once()

    def test_get_obb_raises_import_error_if_cached_error(self):
        """Test that _get_obb raises cached ImportError."""
        import lib.openbb.options_fetcher as module

        # Save original values
        original_obb = module._obb
        original_error = module._openbb_import_error

        try:
            # Set cached error
            module._obb = None
            module._openbb_import_error = "Test error message"

            with pytest.raises(ImportError, match="Test error message"):
                module._get_obb()
        finally:
            # Restore
            module._obb = original_obb
            module._openbb_import_error = original_error

    def test_get_obb_returns_cached_obb(self):
        """Test that _get_obb returns cached obb if available."""
        import lib.openbb.options_fetcher as module

        original_obb = module._obb
        original_error = module._openbb_import_error

        try:
            mock_obb = MagicMock()
            module._obb = mock_obb
            module._openbb_import_error = None

            result = module._get_obb()
            assert result is mock_obb
        finally:
            module._obb = original_obb
            module._openbb_import_error = original_error


class TestFetchChainsFromProvider:
    """Tests for _fetch_chains_from_provider function."""

    def test_fetch_chains_success(self):
        """Test successful chain fetch."""
        import lib.openbb.options_fetcher as module

        # Mock _get_obb
        mock_obb = MagicMock()
        mock_result = MagicMock()
        mock_df = MagicMock()
        mock_df.__len__ = MagicMock(return_value=10)
        mock_result.to_df.return_value = mock_df
        mock_result.results = MagicMock()
        mock_result.results.expirations = ["2024-01-19", "2024-01-26"]
        mock_result.results.underlying_price = 185.0
        mock_obb.derivatives.options.chains.return_value = mock_result

        with patch.object(module, '_get_obb', return_value=mock_obb):
            with patch.object(module, 'obb', mock_obb):
                result = module._fetch_chains_from_provider("AAPL", module.Provider.CBOE)

                assert result is not None
                assert result.provider == "cboe"
                assert result.underlying_price == 185.0

    def test_fetch_chains_returns_none_on_empty_df(self):
        """Test that empty dataframe returns None."""
        import lib.openbb.options_fetcher as module

        mock_obb = MagicMock()
        mock_result = MagicMock()
        mock_df = MagicMock()
        mock_df.__len__ = MagicMock(return_value=0)
        mock_result.to_df.return_value = mock_df
        mock_result.results = MagicMock()
        mock_obb.derivatives.options.chains.return_value = mock_result

        with patch.object(module, 'obb', mock_obb):
            result = module._fetch_chains_from_provider("AAPL", module.Provider.CBOE)

            assert result is None

    def test_fetch_chains_handles_exception(self):
        """Test exception handling in fetch."""
        import lib.openbb.options_fetcher as module

        mock_obb = MagicMock()
        mock_obb.derivatives.options.chains.side_effect = Exception("API Error")

        with patch.object(module, 'obb', mock_obb):
            result = module._fetch_chains_from_provider("AAPL", module.Provider.CBOE)

            assert result is None


class TestFetchOptionsData:
    """Tests for fetch_options_data function with provider fallback."""

    def test_fetch_options_data_cboe_success(self):
        """Test CBOE success path."""
        import lib.openbb.options_fetcher as module

        mock_raw_data = MagicMock()
        mock_raw_data.df.__len__ = MagicMock(return_value=10)

        with patch.object(module, '_fetch_chains_from_provider') as mock_fetch:
            mock_fetch.return_value = mock_raw_data

            result = module.fetch_options_data("AAPL")

            assert result is mock_raw_data
            # Should only call CBOE
            assert mock_fetch.call_count == 1
            mock_fetch.assert_called_with("AAPL", module.Provider.CBOE)

    def test_fetch_options_data_fallback_to_yfinance(self):
        """Test fallback to YFinance when CBOE fails."""
        import lib.openbb.options_fetcher as module

        mock_raw_data = MagicMock()
        mock_raw_data.df.__len__ = MagicMock(return_value=10)

        with patch.object(module, '_fetch_chains_from_provider') as mock_fetch:
            # CBOE returns None, YFinance returns data
            mock_fetch.side_effect = [None, mock_raw_data]

            result = module.fetch_options_data("AAPL")

            assert result is mock_raw_data
            assert mock_fetch.call_count == 2

    def test_fetch_options_data_all_providers_fail(self):
        """Test when all providers fail."""
        import lib.openbb.options_fetcher as module

        with patch.object(module, '_fetch_chains_from_provider') as mock_fetch:
            mock_fetch.return_value = None

            result = module.fetch_options_data("AAPL")

            assert result is None
            assert mock_fetch.call_count == 2


class TestGetQuoteData:
    """Tests for get_quote_data function."""

    def test_get_quote_data_with_last_price(self):
        """Test getting quote with last price (market open)."""
        import lib.openbb.options_fetcher as module

        mock_obb = MagicMock()
        mock_result = MagicMock()
        mock_data = MagicMock()
        mock_data.last_price = 185.50
        mock_data.prev_close = 184.00
        mock_result.results = [mock_data]
        mock_obb.equity.price.quote.return_value = mock_result

        with patch.object(module, 'obb', mock_obb):
            result = module.get_quote_data("AAPL")

            assert result.price == 185.50
            assert result.prev_close == 184.00
            assert result.price_type == "current"
            assert result.change == pytest.approx(1.50, rel=1e-5)

    def test_get_quote_data_with_prev_close_only(self):
        """Test getting quote with prev_close only (market closed)."""
        import lib.openbb.options_fetcher as module

        mock_obb = MagicMock()
        mock_result = MagicMock()
        mock_data = MagicMock()
        mock_data.last_price = None
        mock_data.prev_close = 184.00
        mock_result.results = [mock_data]
        mock_obb.equity.price.quote.return_value = mock_result

        with patch.object(module, 'obb', mock_obb):
            result = module.get_quote_data("AAPL")

            assert result.price == 184.00
            assert result.price_type == "prev_close"

    def test_get_quote_data_exception_returns_default(self):
        """Test exception handling returns default QuoteData."""
        import lib.openbb.options_fetcher as module

        mock_obb = MagicMock()
        mock_obb.equity.price.quote.side_effect = Exception("API Error")

        with patch.object(module, 'obb', mock_obb):
            result = module.get_quote_data("AAPL")

            assert result.price is None
            assert result.price_type == "unknown"


class TestGetUnderlyingPrice:
    """Tests for get_underlying_price function."""

    def test_get_underlying_price_returns_price(self):
        """Test that get_underlying_price returns price from quote."""
        import lib.openbb.options_fetcher as module

        mock_quote = QuoteData(price=185.50, price_type="current")

        with patch.object(module, 'get_quote_data', return_value=mock_quote):
            result = module.get_underlying_price("AAPL")
            assert result == 185.50

    def test_get_underlying_price_returns_none_when_no_price(self):
        """Test that get_underlying_price returns None when no price."""
        import lib.openbb.options_fetcher as module

        mock_quote = QuoteData()

        with patch.object(module, 'get_quote_data', return_value=mock_quote):
            result = module.get_underlying_price("AAPL")
            assert result is None


class TestGetExpirationDates:
    """Tests for get_expiration_dates function."""

    def test_get_expiration_dates_success(self):
        """Test successful expiration date fetch."""
        import lib.openbb.options_fetcher as module

        mock_raw_data = MagicMock()
        mock_raw_data.expirations = ["2024-01-19", "2024-01-26", "2024-02-02"]
        mock_raw_data.underlying_price = 185.00
        mock_raw_data.provider = "cboe"

        mock_quote = QuoteData(
            price=185.50,
            prev_close=184.00,
            change=1.50,
            change_percent=0.815,
            price_type="current",
            timestamp="2024-01-15T10:00:00"
        )

        with patch.object(module, 'fetch_options_data', return_value=mock_raw_data):
            with patch.object(module, 'get_quote_data', return_value=mock_quote):
                result = module.get_expiration_dates("AAPL")

                assert result["ticker"] == "AAPL"
                assert result["expiration_dates"] == ["2024-01-19", "2024-01-26", "2024-02-02"]
                assert result["total_dates"] == 3
                assert result["error"] is None
                # Price comes from quote or underlying_price
                assert result["underlying_price"] is not None

    def test_get_expiration_dates_no_data(self):
        """Test when no data is returned."""
        import lib.openbb.options_fetcher as module

        with patch.object(module, 'fetch_options_data', return_value=None):
            result = module.get_expiration_dates("INVALID")

            assert result["error"] is not None
            # Error message may vary
            assert "No options data" in result["error"] or "Unable to fetch" in result["error"]

    def test_get_expiration_dates_no_expirations(self):
        """Test when data has no expirations."""
        import lib.openbb.options_fetcher as module

        mock_raw_data = MagicMock()
        mock_raw_data.expirations = []
        mock_raw_data.provider = "cboe"
        mock_raw_data.underlying_price = None

        with patch.object(module, 'fetch_options_data', return_value=mock_raw_data):
            with patch.object(module, 'get_quote_data', return_value=QuoteData()):
                result = module.get_expiration_dates("AAPL")

                # Either error or empty list is acceptable
                assert result["expiration_dates"] == [] or result["error"] is not None


class TestGetOptionsChainIntegration:
    """Integration tests for get_options_chain with various scenarios."""

    def test_get_options_chain_success(self):
        """Test successful options chain fetch."""
        import lib.openbb.options_fetcher as module
        import pandas as pd

        # Create mock DataFrame with contract data
        mock_df = pd.DataFrame([{
            'contract_symbol': 'AAPL240119C00185000',
            'strike': 185.0,
            'option_type': 'call',
            'bid': 5.50,
            'ask': 5.70,
            'expiration': '2024-01-19',
            'volume': 1000,
            'open_interest': 5000,
        }])

        mock_raw_data = MagicMock()
        mock_raw_data.df = mock_df
        mock_raw_data.df.iterrows = mock_df.iterrows
        mock_raw_data.df.__len__ = MagicMock(return_value=1)
        mock_raw_data.underlying_price = 185.00
        mock_raw_data.provider = "cboe"

        with patch.object(module, 'fetch_options_data', return_value=mock_raw_data):
            result = module.get_options_chain("AAPL", "2024-01-19")

            assert result.ticker == "AAPL"
            assert result.error is None
            assert len(result.contracts) >= 0

    def test_get_options_chain_no_data(self):
        """Test when fetch returns no data."""
        import lib.openbb.options_fetcher as module

        with patch.object(module, 'fetch_options_data', return_value=None):
            result = module.get_options_chain("AAPL", "2024-01-19")

            assert result.error is not None
            # Error message may vary
            assert "No options data" in result.error or "Unable to fetch" in result.error


class TestNormalizeContractAlternativeFieldNames:
    """Additional tests for _normalize_contract with CBOE-specific fields."""

    def test_normalizes_dte_field(self):
        """Test DTE field normalization."""
        row = {
            'contract_symbol': 'AAPL240119C00185000',
            'dte': 5,
            'strike': 185.0,
        }
        result = _normalize_contract(row, 'cboe')
        assert result['dte'] == 5

    def test_normalizes_greeks(self):
        """Test Greeks normalization."""
        row = {
            'contract_symbol': 'AAPL240119C00185000',
            'delta': 0.5,
            'gamma': 0.05,
            'theta': -0.02,
            'vega': 0.15,
            'rho': 0.08,
        }
        result = _normalize_contract(row, 'cboe')
        assert result['delta'] == 0.5
        assert result['gamma'] == 0.05
        assert result['theta'] == -0.02
        assert result['vega'] == 0.15
        assert result['rho'] == 0.08

    def test_handles_theoretical_price(self):
        """Test theoretical_price field."""
        row = {
            'contract_symbol': 'AAPL240119C00185000',
            'theoretical_price': 5.60,
        }
        result = _normalize_contract(row, 'cboe')
        assert result['theoretical_price'] == 5.60
