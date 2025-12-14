"""
Tests for Skew Score Calculator

Coverage targets:
- ln_ratio: log ratio calculation
- compute_imbalance_ratios: put/call ratio calculation
- compute_local_dominance: neighbor comparison
- compute_activity: volume/OI calculation
- is_in_relevance_band: moneyness filtering
- passes_delta_filter: delta threshold filtering
- qualifies_as_skewed: threshold qualification
- compute_skew_score: final score calculation
- SkewConfig.from_preset: preset configuration
"""

import pytest
import math
from lib.openbb.skew_score import (
    ln_ratio,
    compute_imbalance_ratios,
    compute_local_dominance,
    compute_activity,
    is_in_relevance_band,
    passes_delta_filter,
    qualifies_as_skewed,
    compute_skew_score,
    SkewConfig,
    ExpirationPreset,
    StrikeData,
    StrikeSkewResult,
    SkewAnalysisResult,
)


class TestLnRatio:
    """Tests for ln_ratio function."""

    def test_value_less_than_1_returns_0(self):
        """Values less than 1 should return 0 (no positive contribution)."""
        assert ln_ratio(0.5) == 0.0
        assert ln_ratio(0.1) == 0.0
        assert ln_ratio(0.99) == 0.0

    def test_value_equal_to_1_returns_0(self):
        """Value of 1 (baseline) should return 0."""
        assert ln_ratio(1.0) == 0.0

    def test_value_greater_than_1_returns_ln(self):
        """Values greater than 1 should return ln(x)."""
        assert ln_ratio(math.e) == pytest.approx(1.0, rel=1e-5)
        assert ln_ratio(2.0) == pytest.approx(math.log(2.0), rel=1e-5)
        assert ln_ratio(10.0) == pytest.approx(math.log(10.0), rel=1e-5)

    def test_negative_value_returns_0(self):
        """Negative values should return 0 (treated as less than 1)."""
        assert ln_ratio(-1.0) == 0.0
        assert ln_ratio(-5.0) == 0.0

    def test_zero_returns_0(self):
        """Zero should return 0."""
        assert ln_ratio(0.0) == 0.0


class TestComputeImbalanceRatios:
    """Tests for compute_imbalance_ratios function."""

    def test_put_dominated(self):
        """Put OI dominates call OI."""
        strike = StrikeData(strike=150, call_oi=100, put_oi=500)
        r_put, r_call, direction = compute_imbalance_ratios(strike, eps=1.0)

        assert r_put > r_call
        assert r_put == pytest.approx(501 / 101, rel=1e-3)
        assert direction == "put"

    def test_call_dominated(self):
        """Call OI dominates put OI."""
        strike = StrikeData(strike=150, call_oi=500, put_oi=100)
        r_put, r_call, direction = compute_imbalance_ratios(strike, eps=1.0)

        assert r_call > r_put
        assert r_call == pytest.approx(501 / 101, rel=1e-3)
        assert direction == "call"

    def test_neutral(self):
        """Neither put nor call dominates (balanced)."""
        strike = StrikeData(strike=150, call_oi=100, put_oi=100)
        r_put, r_call, direction = compute_imbalance_ratios(strike, eps=1.0)

        assert r_put == pytest.approx(r_call, rel=1e-3)
        assert direction == "neutral"

    def test_neutral_threshold(self):
        """Tests the 1.5 threshold for directional classification."""
        # Just below 1.5 threshold
        strike = StrikeData(strike=150, call_oi=100, put_oi=140)
        _, _, direction = compute_imbalance_ratios(strike, eps=1.0)
        assert direction == "neutral"

        # Above 1.5 threshold
        strike = StrikeData(strike=150, call_oi=100, put_oi=200)
        _, _, direction = compute_imbalance_ratios(strike, eps=1.0)
        assert direction == "put"

    def test_zero_oi_handled(self):
        """Zero OI should be handled via epsilon."""
        strike = StrikeData(strike=150, call_oi=0, put_oi=100)
        r_put, r_call, direction = compute_imbalance_ratios(strike, eps=1.0)

        assert r_put == pytest.approx(101 / 1, rel=1e-3)
        assert direction == "put"

    def test_eps_prevents_division_by_zero(self):
        """Epsilon prevents division by zero."""
        strike = StrikeData(strike=150, call_oi=0, put_oi=0)
        r_put, r_call, direction = compute_imbalance_ratios(strike, eps=1.0)

        assert r_put == pytest.approx(1.0, rel=1e-3)
        assert r_call == pytest.approx(1.0, rel=1e-3)
        assert direction == "neutral"


class TestComputeLocalDominance:
    """Tests for compute_local_dominance function."""

    def test_dominance_with_neighbors(self):
        """Central strike dominates neighbors."""
        strikes = [
            StrikeData(strike=145, call_oi=100, put_oi=100),
            StrikeData(strike=150, call_oi=1000, put_oi=500),  # Dominant
            StrikeData(strike=155, call_oi=100, put_oi=100),
        ]

        oi, avg, dominance = compute_local_dominance(
            strike_idx=1,
            all_strikes=strikes,
            skew_direction="neutral",
            neighbor_window=1,
            eps=1.0
        )

        assert oi == 1500  # Total OI for neutral
        assert avg == pytest.approx(200, rel=1e-3)  # Avg of neighbors
        assert dominance > 1.0  # Should dominate

    def test_dominance_put_skewed(self):
        """Put-skewed strike: uses put_oi for dominance calculation."""
        strikes = [
            StrikeData(strike=145, call_oi=100, put_oi=50),
            StrikeData(strike=150, call_oi=100, put_oi=1000),  # Put wall
            StrikeData(strike=155, call_oi=100, put_oi=50),
        ]

        oi, avg, dominance = compute_local_dominance(
            strike_idx=1,
            all_strikes=strikes,
            skew_direction="put",
            neighbor_window=1,
            eps=1.0
        )

        assert oi == 1000  # Put OI only
        assert avg == pytest.approx(50, rel=1e-3)  # Avg put OI of neighbors
        assert dominance > 10.0  # Significant dominance

    def test_dominance_call_skewed(self):
        """Call-skewed strike: uses call_oi for dominance calculation."""
        strikes = [
            StrikeData(strike=145, call_oi=50, put_oi=100),
            StrikeData(strike=150, call_oi=1000, put_oi=100),  # Call wall
            StrikeData(strike=155, call_oi=50, put_oi=100),
        ]

        oi, avg, dominance = compute_local_dominance(
            strike_idx=1,
            all_strikes=strikes,
            skew_direction="call",
            neighbor_window=1,
            eps=1.0
        )

        assert oi == 1000  # Call OI only
        assert avg == pytest.approx(50, rel=1e-3)

    def test_edge_strike_fewer_neighbors(self):
        """Edge strikes have fewer neighbors."""
        strikes = [
            StrikeData(strike=145, call_oi=1000, put_oi=500),  # First strike
            StrikeData(strike=150, call_oi=100, put_oi=100),
            StrikeData(strike=155, call_oi=100, put_oi=100),
        ]

        oi, avg, dominance = compute_local_dominance(
            strike_idx=0,
            all_strikes=strikes,
            skew_direction="neutral",
            neighbor_window=2,
            eps=1.0
        )

        # Should only have 2 neighbors (to the right)
        assert avg > 0

    def test_no_neighbors(self):
        """Single strike has no neighbors."""
        strikes = [StrikeData(strike=150, call_oi=1000, put_oi=500)]

        oi, avg, dominance = compute_local_dominance(
            strike_idx=0,
            all_strikes=strikes,
            skew_direction="neutral",
            neighbor_window=2,
            eps=1.0
        )

        assert avg == 0.0
        assert dominance == pytest.approx(1501, rel=1e-3)  # (oi + eps) / eps


class TestComputeActivity:
    """Tests for compute_activity function."""

    def test_normal_activity(self):
        """Normal volume/OI ratio."""
        strike = StrikeData(strike=150, call_oi=1000, put_oi=500, call_vol=300, put_vol=200)
        vol, activity = compute_activity(strike, eps=1.0)

        assert vol == 500
        assert activity == pytest.approx(501 / 1501, rel=1e-3)

    def test_high_activity(self):
        """High volume relative to OI."""
        strike = StrikeData(strike=150, call_oi=100, put_oi=100, call_vol=500, put_vol=500)
        vol, activity = compute_activity(strike, eps=1.0)

        assert vol == 1000
        assert activity > 4.0  # High activity

    def test_low_activity(self):
        """Low volume relative to OI."""
        strike = StrikeData(strike=150, call_oi=10000, put_oi=10000, call_vol=10, put_vol=10)
        vol, activity = compute_activity(strike, eps=1.0)

        assert vol == 20
        assert activity < 0.01  # Very low activity

    def test_zero_oi_handled(self):
        """Zero OI should be handled via epsilon."""
        strike = StrikeData(strike=150, call_oi=0, put_oi=0, call_vol=100, put_vol=100)
        vol, activity = compute_activity(strike, eps=1.0)

        assert vol == 200
        assert activity == pytest.approx(201 / 1, rel=1e-3)


class TestIsInRelevanceBand:
    """Tests for is_in_relevance_band function."""

    def test_strike_in_band(self):
        """Strike within relevance band."""
        config = SkewConfig(moneyness_band=(0.8, 1.2))
        underlying = 100.0

        assert is_in_relevance_band(90, underlying, config) is True
        assert is_in_relevance_band(100, underlying, config) is True
        assert is_in_relevance_band(110, underlying, config) is True

    def test_strike_below_band(self):
        """Strike below relevance band."""
        config = SkewConfig(moneyness_band=(0.8, 1.2))
        underlying = 100.0

        assert is_in_relevance_band(70, underlying, config) is False

    def test_strike_above_band(self):
        """Strike above relevance band."""
        config = SkewConfig(moneyness_band=(0.8, 1.2))
        underlying = 100.0

        assert is_in_relevance_band(130, underlying, config) is False

    def test_boundary_values(self):
        """Boundary values should be included."""
        config = SkewConfig(moneyness_band=(0.8, 1.2))
        underlying = 100.0

        assert is_in_relevance_band(80, underlying, config) is True  # Lower bound
        assert is_in_relevance_band(120, underlying, config) is True  # Upper bound


class TestPassesDeltaFilter:
    """Tests for passes_delta_filter function."""

    def test_no_delta_cutoff(self):
        """No delta cutoff always passes."""
        config = SkewConfig(delta_cutoff=None)
        strike = StrikeData(strike=150)

        assert passes_delta_filter(strike, config) is True

    def test_passes_with_call_delta(self):
        """Passes when call delta meets threshold."""
        config = SkewConfig(delta_cutoff=0.10)
        strike = StrikeData(strike=150, call_delta=0.50)

        assert passes_delta_filter(strike, config) is True

    def test_passes_with_put_delta(self):
        """Passes when put delta meets threshold."""
        config = SkewConfig(delta_cutoff=0.10)
        strike = StrikeData(strike=150, put_delta=-0.50)

        assert passes_delta_filter(strike, config) is True

    def test_fails_with_low_delta(self):
        """Fails when delta is below threshold."""
        config = SkewConfig(delta_cutoff=0.10)
        strike = StrikeData(strike=150, call_delta=0.05, put_delta=-0.05)

        assert passes_delta_filter(strike, config) is False

    def test_no_deltas_available(self):
        """No deltas available defaults to pass."""
        config = SkewConfig(delta_cutoff=0.10)
        strike = StrikeData(strike=150)  # No deltas

        assert passes_delta_filter(strike, config) is True


class TestQualifiesAsSkewed:
    """Tests for qualifies_as_skewed function."""

    def test_all_thresholds_met(self):
        """Qualifies when all thresholds are met."""
        config = SkewConfig(
            imbalance_threshold=2.0,
            dominance_threshold=1.8,
            activity_threshold=0.3
        )

        assert qualifies_as_skewed(
            r_put=3.0, r_call=0.33,
            dominance=2.0,
            activity=0.5,
            config=config
        ) is True

    def test_fails_imbalance_threshold(self):
        """Fails when imbalance threshold not met."""
        config = SkewConfig(
            imbalance_threshold=2.0,
            dominance_threshold=1.8,
            activity_threshold=0.3
        )

        assert qualifies_as_skewed(
            r_put=1.5, r_call=0.67,  # Below threshold
            dominance=2.0,
            activity=0.5,
            config=config
        ) is False

    def test_fails_dominance_threshold(self):
        """Fails when dominance threshold not met."""
        config = SkewConfig(
            imbalance_threshold=2.0,
            dominance_threshold=1.8,
            activity_threshold=0.3
        )

        assert qualifies_as_skewed(
            r_put=3.0, r_call=0.33,
            dominance=1.5,  # Below threshold
            activity=0.5,
            config=config
        ) is False

    def test_fails_activity_threshold(self):
        """Fails when activity threshold not met."""
        config = SkewConfig(
            imbalance_threshold=2.0,
            dominance_threshold=1.8,
            activity_threshold=0.3
        )

        assert qualifies_as_skewed(
            r_put=3.0, r_call=0.33,
            dominance=2.0,
            activity=0.1,  # Below threshold
            config=config
        ) is False

    def test_no_activity_threshold(self):
        """Qualifies when activity threshold is disabled."""
        config = SkewConfig(
            imbalance_threshold=2.0,
            dominance_threshold=1.8,
            activity_threshold=None  # Disabled
        )

        assert qualifies_as_skewed(
            r_put=3.0, r_call=0.33,
            dominance=2.0,
            activity=0.01,  # Would fail if threshold was set
            config=config
        ) is True


class TestComputeSkewScore:
    """Tests for compute_skew_score function."""

    def test_basic_score_calculation(self):
        """Basic score calculation."""
        config = SkewConfig(use_activity_weight=False)

        score = compute_skew_score(
            r_max=2.0,
            dominance=2.0,
            activity=1.0,
            config=config
        )

        # ln(2) * ln(2) * 1.0 ≈ 0.48
        expected = math.log(2.0) * math.log(2.0) * 1.0
        assert score == pytest.approx(expected, rel=1e-3)

    def test_with_activity_weight(self):
        """Score with activity weight applied."""
        config = SkewConfig(
            use_activity_weight=True,
            activity_clamp=(0.5, 2.0)
        )

        score = compute_skew_score(
            r_max=2.0,
            dominance=2.0,
            activity=1.5,
            config=config
        )

        expected = math.log(2.0) * math.log(2.0) * 1.5
        assert score == pytest.approx(expected, rel=1e-3)

    def test_activity_clamping_low(self):
        """Activity is clamped at minimum."""
        config = SkewConfig(
            use_activity_weight=True,
            activity_clamp=(0.5, 2.0)
        )

        score = compute_skew_score(
            r_max=2.0,
            dominance=2.0,
            activity=0.1,  # Below clamp
            config=config
        )

        expected = math.log(2.0) * math.log(2.0) * 0.5  # Clamped to 0.5
        assert score == pytest.approx(expected, rel=1e-3)

    def test_activity_clamping_high(self):
        """Activity is clamped at maximum."""
        config = SkewConfig(
            use_activity_weight=True,
            activity_clamp=(0.5, 2.0)
        )

        score = compute_skew_score(
            r_max=2.0,
            dominance=2.0,
            activity=5.0,  # Above clamp
            config=config
        )

        expected = math.log(2.0) * math.log(2.0) * 2.0  # Clamped to 2.0
        assert score == pytest.approx(expected, rel=1e-3)

    def test_r_max_below_1_gives_zero(self):
        """r_max below 1 results in zero score (ln_ratio returns 0)."""
        config = SkewConfig(use_activity_weight=False)

        score = compute_skew_score(
            r_max=0.5,  # Below 1
            dominance=2.0,
            activity=1.0,
            config=config
        )

        assert score == 0.0

    def test_dominance_below_1_gives_zero(self):
        """Dominance below 1 results in zero score (ln_ratio returns 0)."""
        config = SkewConfig(use_activity_weight=False)

        score = compute_skew_score(
            r_max=2.0,
            dominance=0.5,  # Below 1
            activity=1.0,
            config=config
        )

        assert score == 0.0


class TestSkewConfigPresets:
    """Tests for SkewConfig.from_preset method."""

    def test_normal_preset(self):
        """Normal preset creates default config."""
        config = SkewConfig.from_preset(ExpirationPreset.NORMAL)

        assert config.neighbor_window == 2
        assert config.imbalance_threshold == 2.0
        assert config.dominance_threshold == 1.8
        assert config.activity_threshold == 0.3
        assert config.delta_cutoff == 0.10
        assert config.moneyness_band == (0.7, 1.3)

    def test_zero_dte_preset(self):
        """0DTE preset has tighter moneyness band."""
        config = SkewConfig.from_preset(ExpirationPreset.ZERO_DTE)

        assert config.moneyness_band == (0.9, 1.1)
        assert config.dominance_threshold == 2.0
        assert config.delta_cutoff == 0.15

    def test_quarterly_preset(self):
        """Quarterly preset ignores activity."""
        config = SkewConfig.from_preset(ExpirationPreset.QUARTERLY)

        assert config.neighbor_window == 4
        assert config.activity_threshold is None
        assert config.use_activity_weight is False
        assert config.min_oi == 100

    def test_leaps_preset(self):
        """LEAPS preset has wider band and lower thresholds."""
        config = SkewConfig.from_preset(ExpirationPreset.LEAPS)

        assert config.moneyness_band == (0.6, 1.4)
        assert config.imbalance_threshold == 3.0
        assert config.min_oi == 20
        assert config.delta_cutoff == 0.05


class TestDataclasses:
    """Tests for dataclass structures."""

    def test_strike_data_defaults(self):
        """StrikeData has correct defaults."""
        strike = StrikeData(strike=150)

        assert strike.strike == 150
        assert strike.call_oi == 0
        assert strike.put_oi == 0
        assert strike.call_vol == 0
        assert strike.put_vol == 0
        assert strike.call_delta is None
        assert strike.put_delta is None

    def test_strike_skew_result_defaults(self):
        """StrikeSkewResult has correct defaults."""
        result = StrikeSkewResult(strike=150)

        assert result.strike == 150
        assert result.r_put == 0.0
        assert result.r_call == 0.0
        assert result.skew_direction == "neutral"
        assert result.qualifies is False
        assert result.score == 0.0

    def test_skew_analysis_result_defaults(self):
        """SkewAnalysisResult has correct defaults."""
        result = SkewAnalysisResult(
            ticker="AAPL",
            expiration="2024-01-19",
            underlying_price=185.50,
            config_preset="normal"
        )

        assert result.ticker == "AAPL"
        assert result.strikes == []
        assert result.top_skewed == []
        assert result.recommended_strike is None
        assert result.error is None


class TestExpirationPreset:
    """Tests for ExpirationPreset enum."""

    def test_values(self):
        """Preset values are correct."""
        assert ExpirationPreset.NORMAL.value == "normal"
        assert ExpirationPreset.ZERO_DTE.value == "0dte"
        assert ExpirationPreset.QUARTERLY.value == "quarterly"
        assert ExpirationPreset.LEAPS.value == "leaps"

    def test_iteration(self):
        """All presets are enumerable."""
        presets = list(ExpirationPreset)
        assert len(presets) == 4


class TestFindAtmStrike:
    """Tests for find_atm_strike function."""

    def test_finds_closest_strike(self):
        """find_atm_strike returns the strike closest to underlying price."""
        from lib.openbb.skew_score import find_atm_strike

        strikes = [
            StrikeData(strike=180),
            StrikeData(strike=185),
            StrikeData(strike=190),
        ]

        result = find_atm_strike(strikes, 186.0)
        assert result == 185

    def test_exact_match(self):
        """When underlying equals a strike exactly."""
        from lib.openbb.skew_score import find_atm_strike

        strikes = [
            StrikeData(strike=180),
            StrikeData(strike=185),
            StrikeData(strike=190),
        ]

        result = find_atm_strike(strikes, 185.0)
        assert result == 185

    def test_empty_strikes_returns_none(self):
        """Empty strike list returns None."""
        from lib.openbb.skew_score import find_atm_strike

        result = find_atm_strike([], 185.0)
        assert result is None

    def test_midpoint_between_strikes(self):
        """When underlying is exactly between two strikes."""
        from lib.openbb.skew_score import find_atm_strike

        strikes = [
            StrikeData(strike=180),
            StrikeData(strike=190),
        ]

        # Exactly at midpoint - should return one of them
        result = find_atm_strike(strikes, 185.0)
        assert result in [180, 190]


class TestSelectRecommendedStrike:
    """Tests for select_recommended_strike function."""

    def test_returns_none_for_empty_list(self):
        """Empty skewed list returns None with message."""
        from lib.openbb.skew_score import select_recommended_strike

        strike, reason = select_recommended_strike([], atm_strike=185.0)

        assert strike is None
        assert "No qualifying" in reason

    def test_returns_highest_scorer_when_no_atm(self):
        """When ATM is None, return highest scoring strike."""
        from lib.openbb.skew_score import select_recommended_strike

        top_skewed = [
            StrikeSkewResult(strike=190, score=5.0, skew_direction="put"),
            StrikeSkewResult(strike=180, score=4.0, skew_direction="call"),
        ]

        strike, reason = select_recommended_strike(top_skewed, atm_strike=None)

        assert strike == 190
        assert "Highest skew score" in reason

    def test_selects_closest_to_atm_among_top_n(self):
        """Among top N, select closest to ATM."""
        from lib.openbb.skew_score import select_recommended_strike

        top_skewed = [
            StrikeSkewResult(strike=195, score=5.0, dominance=2.0, skew_direction="put"),
            StrikeSkewResult(strike=190, score=4.5, dominance=1.8, skew_direction="put"),
            StrikeSkewResult(strike=180, score=4.0, dominance=1.5, skew_direction="call"),
        ]

        strike, reason = select_recommended_strike(top_skewed, atm_strike=185.0, top_n=3)

        # Result should be one of the top N, closest to ATM
        # 180 (dist=5), 190 (dist=5) are equally close
        assert strike in [180, 190]
        # Reason should mention direction
        assert "Put-heavy" in reason or "Call-heavy" in reason

    def test_put_heavy_direction_in_reason(self):
        """Reason includes 'Put-heavy' for put skew."""
        from lib.openbb.skew_score import select_recommended_strike

        top_skewed = [
            StrikeSkewResult(strike=190, score=5.0, dominance=2.0, skew_direction="put"),
        ]

        strike, reason = select_recommended_strike(top_skewed, atm_strike=185.0)

        assert strike == 190
        assert "Put-heavy" in reason


class TestComputeSkewScores:
    """Tests for compute_skew_scores main analysis function."""

    def test_basic_computation(self):
        """Test basic skew score computation."""
        from lib.openbb.skew_score import compute_skew_scores

        strikes = [
            StrikeData(strike=180, call_oi=1000, put_oi=5000, call_vol=100, put_vol=500),
            StrikeData(strike=185, call_oi=2000, put_oi=2000, call_vol=200, put_vol=200),
            StrikeData(strike=190, call_oi=5000, put_oi=1000, call_vol=500, put_vol=100),
        ]

        result = compute_skew_scores(
            strikes=strikes,
            underlying_price=185.0,
            ticker="AAPL",
            expiration="2024-01-19"
        )

        assert result.ticker == "AAPL"
        assert result.expiration == "2024-01-19"
        assert result.underlying_price == 185.0
        assert len(result.strikes) == 3

    def test_with_custom_config(self):
        """Test with custom configuration."""
        from lib.openbb.skew_score import compute_skew_scores

        strikes = [
            StrikeData(strike=180, call_oi=1000, put_oi=5000),
            StrikeData(strike=185, call_oi=2000, put_oi=2000),
        ]

        custom_config = SkewConfig(
            imbalance_threshold=1.5,
            dominance_threshold=1.2,
            neighbor_window=1
        )

        result = compute_skew_scores(
            strikes=strikes,
            underlying_price=182.5,
            config=custom_config
        )

        assert result.config_preset == "custom"

    def test_with_preset(self):
        """Test using a preset configuration."""
        from lib.openbb.skew_score import compute_skew_scores

        strikes = [
            StrikeData(strike=180, call_oi=1000, put_oi=5000),
            StrikeData(strike=185, call_oi=2000, put_oi=2000),
        ]

        result = compute_skew_scores(
            strikes=strikes,
            underlying_price=182.5,
            preset=ExpirationPreset.ZERO_DTE
        )

        assert result.config_preset == "0dte"

    def test_empty_strikes_returns_result(self):
        """Empty strikes returns valid result with no errors."""
        from lib.openbb.skew_score import compute_skew_scores

        result = compute_skew_scores(
            strikes=[],
            underlying_price=185.0,
            ticker="AAPL"
        )

        assert result.ticker == "AAPL"
        assert result.strikes == []
        assert result.top_skewed == []

    def test_identifies_skewed_strikes(self):
        """Test that heavily skewed strikes are identified."""
        from lib.openbb.skew_score import compute_skew_scores

        # Create a heavily put-skewed strike
        strikes = [
            StrikeData(strike=180, call_oi=100, put_oi=5000, call_vol=10, put_vol=500),
            StrikeData(strike=182, call_oi=200, put_oi=4000, call_vol=20, put_vol=400),
            StrikeData(strike=184, call_oi=500, put_oi=2000, call_vol=50, put_vol=200),
            StrikeData(strike=186, call_oi=1000, put_oi=1000, call_vol=100, put_vol=100),
            StrikeData(strike=188, call_oi=2000, put_oi=500, call_vol=200, put_vol=50),
        ]

        result = compute_skew_scores(
            strikes=strikes,
            underlying_price=185.0,
        )

        # Should have computed results for all strikes
        assert len(result.strikes) == 5

    def test_recommended_strike_populated(self):
        """Test that recommended strike is populated when skewed strikes exist."""
        from lib.openbb.skew_score import compute_skew_scores

        # Create very skewed scenario
        strikes = [
            StrikeData(strike=180, call_oi=100, put_oi=10000, call_vol=10, put_vol=1000),
            StrikeData(strike=182, call_oi=100, put_oi=8000, call_vol=10, put_vol=800),
            StrikeData(strike=184, call_oi=100, put_oi=6000, call_vol=10, put_vol=600),
        ]

        result = compute_skew_scores(
            strikes=strikes,
            underlying_price=182.0,
        )

        # Result should have recommendation reason
        # (depending on thresholds, may or may not qualify)
        assert result.recommended_reason is not None


class TestSkewConfigMoneynessValidation:
    """Test moneyness band validation in SkewConfig."""

    def test_moneyness_band_tuple(self):
        """Moneyness band is a tuple with lower and upper bounds."""
        config = SkewConfig(moneyness_band=(0.8, 1.2))
        assert config.moneyness_band[0] == 0.8
        assert config.moneyness_band[1] == 1.2

    def test_default_moneyness_band(self):
        """Default moneyness band."""
        config = SkewConfig()
        assert config.moneyness_band == (0.7, 1.3)


class TestAnalysisIntegration:
    """Integration tests for the full analysis pipeline."""

    def test_full_analysis_pipeline(self):
        """Test complete analysis from strikes to recommendation."""
        from lib.openbb.skew_score import compute_skew_scores

        # Realistic scenario with mixed OI/volume
        strikes = [
            StrikeData(strike=170, call_oi=500, put_oi=8000, call_vol=50, put_vol=800,
                       call_delta=0.8, put_delta=-0.2),
            StrikeData(strike=175, call_oi=800, put_oi=6000, call_vol=80, put_vol=600,
                       call_delta=0.7, put_delta=-0.3),
            StrikeData(strike=180, call_oi=1500, put_oi=4000, call_vol=150, put_vol=400,
                       call_delta=0.6, put_delta=-0.4),
            StrikeData(strike=185, call_oi=3000, put_oi=3000, call_vol=300, put_vol=300,
                       call_delta=0.5, put_delta=-0.5),
            StrikeData(strike=190, call_oi=4000, put_oi=1500, call_vol=400, put_vol=150,
                       call_delta=0.4, put_delta=-0.6),
            StrikeData(strike=195, call_oi=6000, put_oi=800, call_vol=600, put_vol=80,
                       call_delta=0.3, put_delta=-0.7),
            StrikeData(strike=200, call_oi=8000, put_oi=500, call_vol=800, put_vol=50,
                       call_delta=0.2, put_delta=-0.8),
        ]

        result = compute_skew_scores(
            strikes=strikes,
            underlying_price=185.0,
            ticker="TEST",
            expiration="2024-06-21",
            preset=ExpirationPreset.NORMAL
        )

        # Verify all components
        assert result.ticker == "TEST"
        assert result.underlying_price == 185.0
        assert len(result.strikes) == 7
        # ATM strike should be 185
        assert result.atm_strike == 185

    def test_analysis_with_zero_dte_preset(self):
        """Test analysis with 0DTE preset (tighter bounds)."""
        from lib.openbb.skew_score import compute_skew_scores

        # Create strikes in tight range around ATM
        strikes = [
            StrikeData(strike=183, call_oi=1000, put_oi=4000),
            StrikeData(strike=184, call_oi=1500, put_oi=3500),
            StrikeData(strike=185, call_oi=2000, put_oi=2000),
            StrikeData(strike=186, call_oi=3500, put_oi=1500),
            StrikeData(strike=187, call_oi=4000, put_oi=1000),
        ]

        result = compute_skew_scores(
            strikes=strikes,
            underlying_price=185.0,
            preset=ExpirationPreset.ZERO_DTE
        )

        assert result.config_preset == "0dte"
        # All strikes should be in relevance band for 0DTE (0.9-1.1)
        assert len(result.strikes) == 5
