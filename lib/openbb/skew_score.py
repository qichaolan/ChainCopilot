"""
Skew Score Calculator

Computes skew score per strike to identify unusual options positioning.
The score helps detect put/call imbalances and "walls" of open interest.

Usage:
    # As a module
    from lib.openbb.skew_score import compute_skew_scores, SkewConfig

    # Direct CLI usage
    python skew_score.py AAPL 2024-01-19
    python skew_score.py AAPL 2024-01-19 --preset 0dte
    python skew_score.py AAPL 2024-01-19 --preset leaps
"""

import sys
import json
import math
import argparse
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any, Literal
from enum import Enum


# ============================================================================
# Configuration Presets
# ============================================================================

class ExpirationPreset(Enum):
    """Preset configurations for different expiration types."""
    NORMAL = "normal"      # Standard equity expirations
    ZERO_DTE = "0dte"      # Same-day / daily expirations (QQQ, SPX)
    QUARTERLY = "quarterly"  # Big institutional quarterlies
    LEAPS = "leaps"        # Long-dated options (>1 year)


@dataclass
class SkewConfig:
    """
    Configuration for skew score calculation.

    Attributes:
        neighbor_window: Number of strikes on each side for local comparison
        imbalance_threshold: Minimum put/call OI ratio to qualify as skewed
        dominance_threshold: Minimum ratio vs neighbors to qualify
        activity_threshold: Minimum volume/OI ratio (None to disable)
        delta_cutoff: Minimum absolute delta to include strike (None to disable)
        moneyness_band: (low, high) multipliers of underlying price for relevance
        min_oi: Minimum total OI at strike to include
        eps: Small value to prevent divide-by-zero
        use_activity_weight: Whether to use activity in score calculation
        activity_clamp: (min, max) for activity weight clamping
    """
    neighbor_window: int = 2
    imbalance_threshold: float = 2.0
    dominance_threshold: float = 1.8
    activity_threshold: Optional[float] = 0.3
    delta_cutoff: Optional[float] = 0.10
    moneyness_band: tuple = (0.7, 1.3)
    min_oi: int = 50
    eps: float = 1.0
    use_activity_weight: bool = True
    activity_clamp: tuple = (0.5, 2.0)

    @classmethod
    def from_preset(cls, preset: ExpirationPreset) -> "SkewConfig":
        """Create config from a preset."""
        if preset == ExpirationPreset.NORMAL:
            return cls()

        elif preset == ExpirationPreset.ZERO_DTE:
            return cls(
                neighbor_window=2,
                imbalance_threshold=2.0,
                dominance_threshold=2.0,
                activity_threshold=0.2,
                delta_cutoff=0.15,
                moneyness_band=(0.9, 1.1),
                min_oi=50,
                use_activity_weight=True,
            )

        elif preset == ExpirationPreset.QUARTERLY:
            return cls(
                neighbor_window=4,
                imbalance_threshold=2.0,
                dominance_threshold=1.6,
                activity_threshold=None,  # Volume less important
                delta_cutoff=0.10,
                moneyness_band=(0.7, 1.3),
                min_oi=100,
                use_activity_weight=False,
                activity_clamp=(0.8, 1.2),
            )

        elif preset == ExpirationPreset.LEAPS:
            return cls(
                neighbor_window=4,
                imbalance_threshold=3.0,
                dominance_threshold=1.8,
                activity_threshold=None,  # Ignore activity
                delta_cutoff=0.05,
                moneyness_band=(0.6, 1.4),
                min_oi=20,
                use_activity_weight=False,
            )

        return cls()


# ============================================================================
# Data Structures
# ============================================================================

@dataclass
class StrikeData:
    """Input data for a single strike."""
    strike: float
    call_oi: int = 0
    put_oi: int = 0
    call_vol: int = 0
    put_vol: int = 0
    call_delta: Optional[float] = None
    put_delta: Optional[float] = None


@dataclass
class StrikeSkewResult:
    """Computed skew metrics for a single strike."""
    strike: float

    # Raw ratios
    r_put: float = 0.0       # put_oi / call_oi ratio
    r_call: float = 0.0      # call_oi / put_oi ratio
    r_max: float = 0.0       # max of r_put, r_call
    skew_direction: str = "neutral"  # "put", "call", or "neutral"

    # Local dominance
    oi_total: int = 0
    oi_neighbor_avg: float = 0.0
    dominance: float = 0.0   # D(K)

    # Activity
    vol_total: int = 0
    activity: float = 0.0    # A(K) = vol/oi

    # Final results
    qualifies: bool = False
    score: float = 0.0

    # Metadata
    call_oi: int = 0
    put_oi: int = 0
    call_delta: Optional[float] = None
    put_delta: Optional[float] = None


@dataclass
class SkewAnalysisResult:
    """Complete skew analysis result."""
    ticker: str
    expiration: str
    underlying_price: float
    config_preset: str

    # All strikes with their scores
    strikes: List[StrikeSkewResult] = field(default_factory=list)

    # Top skewed strikes (qualifying, sorted by score)
    top_skewed: List[StrikeSkewResult] = field(default_factory=list)

    # Recommended strike to scroll to
    recommended_strike: Optional[float] = None
    recommended_reason: str = ""

    # Summary stats
    total_strikes: int = 0
    qualifying_strikes: int = 0
    atm_strike: Optional[float] = None

    error: Optional[str] = None


# ============================================================================
# Core Computation Functions
# ============================================================================

def ln_ratio(x: float) -> float:
    """
    Natural log for ratio values where 1.0 is the baseline (no contribution).

    For ratios like imbalance (r_max) and dominance:
    - x < 1: returns 0 (no positive contribution, treat as baseline)
    - x = 1: returns 0 (baseline)
    - x > 1: returns ln(x) (positive contribution)

    This is mathematically correct for ratios where 1 means "equal/balanced".
    """
    return math.log(max(x, 1.0))


def compute_imbalance_ratios(
    strike_data: StrikeData,
    eps: float = 1.0
) -> tuple[float, float, str]:
    """
    Step 2: Compute raw imbalance ratios (OI Skew Ratio).

    Returns:
        (r_put, r_call, direction)
        direction is "put" if puts dominate, "call" if calls dominate, "neutral" otherwise
    """
    r_put = (strike_data.put_oi + eps) / (strike_data.call_oi + eps)
    r_call = (strike_data.call_oi + eps) / (strike_data.put_oi + eps)

    if r_put > r_call and r_put > 1.5:
        direction = "put"
    elif r_call > r_put and r_call > 1.5:
        direction = "call"
    else:
        direction = "neutral"

    return r_put, r_call, direction


def compute_local_dominance(
    strike_idx: int,
    all_strikes: List[StrikeData],
    skew_direction: str = "neutral",
    neighbor_window: int = 2,
    eps: float = 1.0
) -> tuple[int, float, float]:
    """
    Step 3: Compute local dominance vs neighboring strikes.

    IMPORTANT: Dominance is computed on the dominant side, not total OI.
    - If put-heavy: compare put_oi vs neighbors' put_oi
    - If call-heavy: compare call_oi vs neighbors' call_oi
    - If neutral: compare total OI

    This properly detects directional "walls" where one side dominates.

    Returns:
        (oi_for_dominance, oi_neighbor_avg, dominance)
    """
    current = all_strikes[strike_idx]

    # Select which OI to use based on skew direction
    if skew_direction == "put":
        current_oi = current.put_oi
        get_neighbor_oi = lambda s: s.put_oi
    elif skew_direction == "call":
        current_oi = current.call_oi
        get_neighbor_oi = lambda s: s.call_oi
    else:
        # Neutral: use total OI
        current_oi = current.call_oi + current.put_oi
        get_neighbor_oi = lambda s: s.call_oi + s.put_oi

    # Gather neighbor OIs (exclude current strike)
    neighbor_ois = []
    for offset in range(-neighbor_window, neighbor_window + 1):
        if offset == 0:
            continue
        neighbor_idx = strike_idx + offset
        if 0 <= neighbor_idx < len(all_strikes):
            neighbor = all_strikes[neighbor_idx]
            neighbor_ois.append(get_neighbor_oi(neighbor))

    if neighbor_ois:
        oi_neighbor_avg = sum(neighbor_ois) / len(neighbor_ois)
    else:
        oi_neighbor_avg = 0.0

    dominance = (current_oi + eps) / (oi_neighbor_avg + eps)

    return current_oi, oi_neighbor_avg, dominance


def compute_activity(
    strike_data: StrikeData,
    eps: float = 1.0
) -> tuple[int, float]:
    """
    Step 4: Compute activity confirmation (Volume/OI).

    Returns:
        (vol_total, activity_ratio)
    """
    vol_total = strike_data.call_vol + strike_data.put_vol
    oi_total = strike_data.call_oi + strike_data.put_oi

    activity = (vol_total + eps) / (oi_total + eps)

    return vol_total, activity


def is_in_relevance_band(
    strike: float,
    underlying_price: float,
    config: SkewConfig
) -> bool:
    """
    Step 5: Check if strike is within relevance band.
    Uses delta if available, otherwise falls back to moneyness.
    """
    low_mult, high_mult = config.moneyness_band
    low_bound = underlying_price * low_mult
    high_bound = underlying_price * high_mult

    return low_bound <= strike <= high_bound


def passes_delta_filter(
    strike_data: StrikeData,
    config: SkewConfig
) -> bool:
    """
    Step 5: Check if strike passes delta filter.
    Returns True if no delta cutoff is set.
    """
    if config.delta_cutoff is None:
        return True

    # If deltas are available, use them
    if strike_data.call_delta is not None:
        if abs(strike_data.call_delta) >= config.delta_cutoff:
            return True

    if strike_data.put_delta is not None:
        if abs(strike_data.put_delta) >= config.delta_cutoff:
            return True

    # If no deltas available, assume it passes (rely on moneyness band)
    if strike_data.call_delta is None and strike_data.put_delta is None:
        return True

    return False


def qualifies_as_skewed(
    r_put: float,
    r_call: float,
    dominance: float,
    activity: float,
    config: SkewConfig
) -> bool:
    """
    Step 6: Determine if strike qualifies as "skewed".
    """
    r_max = max(r_put, r_call)

    # Check imbalance threshold
    if r_max < config.imbalance_threshold:
        return False

    # Check dominance threshold
    if dominance < config.dominance_threshold:
        return False

    # Check activity threshold (if enabled)
    if config.activity_threshold is not None:
        if activity < config.activity_threshold:
            return False

    return True


def compute_skew_score(
    r_max: float,
    dominance: float,
    activity: float,
    config: SkewConfig
) -> float:
    """
    Step 7: Calculate the final Skew Score.

    Score = ln(R) × ln(D) × W

    Where:
    - R is the imbalance ratio (r_max >= 1 for any skew)
    - D is the local dominance ratio (D >= 1 means this strike dominates neighbors)
    - W is optional activity weight

    Using ln_ratio ensures:
    - Ratios at baseline (1.0) contribute 0 to the score
    - Only ratios > 1 contribute positively
    """
    # Compute log components using ln_ratio (baseline at 1.0)
    ln_r = ln_ratio(r_max)
    ln_d = ln_ratio(dominance)

    # Compute weight
    if config.use_activity_weight:
        min_clamp, max_clamp = config.activity_clamp
        w = max(min_clamp, min(max_clamp, activity))
    else:
        w = 1.0

    score = ln_r * ln_d * w

    return score


def find_atm_strike(
    strikes: List[StrikeData],
    underlying_price: float
) -> Optional[float]:
    """Find the strike closest to ATM."""
    if not strikes:
        return None

    closest = min(strikes, key=lambda s: abs(s.strike - underlying_price))
    return closest.strike


def select_recommended_strike(
    top_skewed: List[StrikeSkewResult],
    atm_strike: Optional[float],
    top_n: int = 5
) -> tuple[Optional[float], str]:
    """
    Step 8: Select the recommended strike to scroll to.

    Among top N by score, pick the one closest to ATM.
    """
    if not top_skewed:
        return None, "No qualifying skewed strikes found"

    if atm_strike is None:
        # Just return the highest scoring strike
        return top_skewed[0].strike, f"Highest skew score: {top_skewed[0].score:.2f}"

    # Take top N
    candidates = top_skewed[:top_n]

    # Find closest to ATM among candidates
    closest = min(candidates, key=lambda s: abs(s.strike - atm_strike))

    direction = "Put-heavy" if closest.skew_direction == "put" else "Call-heavy"
    reason = f"{direction} at ${closest.strike} (score: {closest.score:.2f}, dominance: {closest.dominance:.1f}x)"

    return closest.strike, reason


# ============================================================================
# Main Analysis Function
# ============================================================================

def compute_skew_scores(
    strikes: List[StrikeData],
    underlying_price: float,
    ticker: str = "",
    expiration: str = "",
    config: Optional[SkewConfig] = None,
    preset: Optional[ExpirationPreset] = None
) -> SkewAnalysisResult:
    """
    Compute skew scores for all strikes.

    Args:
        strikes: List of StrikeData objects (must be sorted by strike ascending)
        underlying_price: Current underlying price
        ticker: Ticker symbol (for metadata)
        expiration: Expiration date string (for metadata)
        config: Custom configuration (optional)
        preset: Preset configuration to use (overridden by config if provided)

    Returns:
        SkewAnalysisResult with all computed scores
    """
    # Determine config
    if config is None:
        if preset is not None:
            config = SkewConfig.from_preset(preset)
        else:
            config = SkewConfig()

    # Initialize result
    result = SkewAnalysisResult(
        ticker=ticker,
        expiration=expiration,
        underlying_price=underlying_price,
        config_preset=preset.value if preset else "custom",
        total_strikes=len(strikes),
    )

    if not strikes:
        result.error = "No strikes provided"
        return result

    if underlying_price <= 0:
        result.error = "Invalid underlying price"
        return result

    # Find ATM strike
    result.atm_strike = find_atm_strike(strikes, underlying_price)

    # Sort strikes by strike price (should already be sorted, but ensure it)
    sorted_strikes = sorted(strikes, key=lambda s: s.strike)

    # Process each strike
    all_results: List[StrikeSkewResult] = []
    qualifying_results: List[StrikeSkewResult] = []

    for idx, strike_data in enumerate(sorted_strikes):
        strike_result = StrikeSkewResult(
            strike=strike_data.strike,
            call_oi=strike_data.call_oi,
            put_oi=strike_data.put_oi,
            call_delta=strike_data.call_delta,
            put_delta=strike_data.put_delta,
        )

        # Skip if below minimum OI
        oi_total = strike_data.call_oi + strike_data.put_oi
        if oi_total < config.min_oi:
            all_results.append(strike_result)
            continue

        # Skip if outside relevance band
        if not is_in_relevance_band(strike_data.strike, underlying_price, config):
            all_results.append(strike_result)
            continue

        # Skip if fails delta filter
        if not passes_delta_filter(strike_data, config):
            all_results.append(strike_result)
            continue

        # Step 2: Compute imbalance ratios
        r_put, r_call, direction = compute_imbalance_ratios(strike_data, config.eps)
        strike_result.r_put = r_put
        strike_result.r_call = r_call
        strike_result.r_max = max(r_put, r_call)
        strike_result.skew_direction = direction

        # Step 3: Compute local dominance (using directional OI, not total)
        _, oi_neighbor_avg, dominance = compute_local_dominance(
            idx, sorted_strikes, direction, config.neighbor_window, config.eps
        )
        strike_result.oi_total = strike_data.call_oi + strike_data.put_oi
        strike_result.oi_neighbor_avg = oi_neighbor_avg
        strike_result.dominance = dominance

        # Step 4: Compute activity
        vol_total, activity = compute_activity(strike_data, config.eps)
        strike_result.vol_total = vol_total
        strike_result.activity = activity

        # Step 6: Check if qualifies
        strike_result.qualifies = qualifies_as_skewed(
            r_put, r_call, dominance, activity, config
        )

        # Step 7: Compute score (even if doesn't qualify, for ranking)
        strike_result.score = compute_skew_score(
            strike_result.r_max, dominance, activity, config
        )

        all_results.append(strike_result)

        if strike_result.qualifies:
            qualifying_results.append(strike_result)

    # Sort qualifying strikes by score descending
    qualifying_results.sort(key=lambda s: s.score, reverse=True)

    # Step 8: Select recommended strike
    recommended_strike, reason = select_recommended_strike(
        qualifying_results, result.atm_strike
    )

    # Populate result
    result.strikes = all_results
    result.top_skewed = qualifying_results
    result.qualifying_strikes = len(qualifying_results)
    result.recommended_strike = recommended_strike
    result.recommended_reason = reason

    return result


# ============================================================================
# Integration with Options Fetcher
# ============================================================================

def analyze_options_chain(
    ticker: str,
    expiration: str,
    preset: Optional[str] = None
) -> SkewAnalysisResult:
    """
    Fetch options data and compute skew scores.

    This integrates with the options_fetcher module.

    Args:
        ticker: Stock ticker symbol
        expiration: Expiration date (YYYY-MM-DD)
        preset: One of "normal", "0dte", "quarterly", "leaps"

    Returns:
        SkewAnalysisResult
    """
    # Import here to avoid circular imports
    # Handle both module import and direct script execution
    try:
        from lib.openbb.options_fetcher import get_options_chain
    except ModuleNotFoundError:
        from options_fetcher import get_options_chain

    # Determine preset
    exp_preset = None
    if preset:
        preset_map = {
            "normal": ExpirationPreset.NORMAL,
            "0dte": ExpirationPreset.ZERO_DTE,
            "quarterly": ExpirationPreset.QUARTERLY,
            "leaps": ExpirationPreset.LEAPS,
        }
        exp_preset = preset_map.get(preset.lower())

    # Fetch options data
    chain_result = get_options_chain(ticker, expiration)

    if chain_result.error:
        return SkewAnalysisResult(
            ticker=ticker,
            expiration=expiration,
            underlying_price=0,
            config_preset=preset or "normal",
            error=chain_result.error
        )

    underlying_price = chain_result.underlying_price or 0

    # Build strike data from contracts
    # Group by strike
    strikes_map: Dict[float, StrikeData] = {}

    for contract in chain_result.contracts:
        strike = contract.get("strike")
        if strike is None:
            continue

        if strike not in strikes_map:
            strikes_map[strike] = StrikeData(strike=strike)

        sd = strikes_map[strike]
        option_type = contract.get("option_type", "").lower()

        if option_type == "call":
            sd.call_oi = contract.get("open_interest") or 0
            sd.call_vol = contract.get("volume") or 0
            sd.call_delta = contract.get("delta")
        elif option_type == "put":
            sd.put_oi = contract.get("open_interest") or 0
            sd.put_vol = contract.get("volume") or 0
            sd.put_delta = contract.get("delta")

    # Convert to sorted list
    strikes_list = sorted(strikes_map.values(), key=lambda s: s.strike)

    # Compute skew scores
    return compute_skew_scores(
        strikes=strikes_list,
        underlying_price=underlying_price,
        ticker=ticker,
        expiration=expiration,
        preset=exp_preset
    )


# ============================================================================
# Output Formatting
# ============================================================================

def format_result_json(result: SkewAnalysisResult, include_all_strikes: bool = False) -> str:
    """Format result as JSON."""
    output = {
        "ticker": result.ticker,
        "expiration": result.expiration,
        "underlying_price": result.underlying_price,
        "config_preset": result.config_preset,
        "atm_strike": result.atm_strike,
        "total_strikes": result.total_strikes,
        "qualifying_strikes": result.qualifying_strikes,
        "recommended_strike": result.recommended_strike,
        "recommended_reason": result.recommended_reason,
        "error": result.error,
        "top_skewed": [
            {
                "strike": s.strike,
                "score": round(s.score, 3),
                "direction": s.skew_direction,
                "r_put": round(s.r_put, 2),
                "r_call": round(s.r_call, 2),
                "dominance": round(s.dominance, 2),
                "activity": round(s.activity, 3),
                "call_oi": s.call_oi,
                "put_oi": s.put_oi,
            }
            for s in result.top_skewed[:10]  # Limit to top 10
        ],
    }

    if include_all_strikes:
        output["all_strikes"] = [
            {
                "strike": s.strike,
                "score": round(s.score, 3),
                "qualifies": s.qualifies,
                "direction": s.skew_direction,
                "dominance": round(s.dominance, 2),
                "call_oi": s.call_oi,
                "put_oi": s.put_oi,
            }
            for s in result.strikes
        ]

    return json.dumps(output, indent=2)


def format_result_summary(result: SkewAnalysisResult) -> str:
    """Format result as human-readable summary."""
    lines = []
    lines.append(f"=== Skew Analysis: {result.ticker} ({result.expiration}) ===")
    lines.append(f"Underlying: ${result.underlying_price:.2f}")
    lines.append(f"ATM Strike: ${result.atm_strike:.2f}" if result.atm_strike else "ATM Strike: N/A")
    lines.append(f"Config: {result.config_preset}")
    lines.append("")

    if result.error:
        lines.append(f"Error: {result.error}")
        return "\n".join(lines)

    lines.append(f"Total Strikes: {result.total_strikes}")
    lines.append(f"Qualifying Skewed: {result.qualifying_strikes}")
    lines.append("")

    if result.recommended_strike:
        lines.append(f">>> Recommended: ${result.recommended_strike}")
        lines.append(f"    Reason: {result.recommended_reason}")
        lines.append("")

    if result.top_skewed:
        lines.append("Top Skewed Strikes:")
        lines.append("-" * 70)
        lines.append(f"{'Strike':>10} {'Score':>8} {'Dir':>6} {'R_put':>7} {'R_call':>7} {'Dom':>6} {'Call OI':>10} {'Put OI':>10}")
        lines.append("-" * 70)

        for s in result.top_skewed[:10]:
            lines.append(
                f"${s.strike:>8.2f} {s.score:>8.2f} {s.skew_direction:>6} "
                f"{s.r_put:>7.2f} {s.r_call:>7.2f} {s.dominance:>6.1f}x "
                f"{s.call_oi:>10,} {s.put_oi:>10,}"
            )
    else:
        lines.append("No qualifying skewed strikes found.")

    return "\n".join(lines)


# ============================================================================
# CLI Entry Point
# ============================================================================

def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Compute skew scores for options chain to identify unusual positioning.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python skew_score.py AAPL 2024-01-19              # Normal preset
  python skew_score.py SPX 2024-01-12 --preset 0dte # 0DTE preset for indices
  python skew_score.py AAPL 2025-01-17 --preset leaps # LEAPS preset
  python skew_score.py AAPL 2024-01-19 --json       # JSON output
  python skew_score.py AAPL 2024-01-19 --all        # Include all strikes in output
"""
    )
    parser.add_argument("ticker", help="Stock ticker symbol (e.g., AAPL)")
    parser.add_argument("expiration", help="Expiration date in YYYY-MM-DD format")
    parser.add_argument(
        "--preset", "-p",
        choices=["normal", "0dte", "quarterly", "leaps"],
        default="normal",
        help="Configuration preset (default: normal)"
    )
    parser.add_argument(
        "--json", "-j",
        action="store_true",
        help="Output as JSON instead of summary"
    )
    parser.add_argument(
        "--all", "-a",
        action="store_true",
        help="Include all strikes in output (with --json)"
    )

    args = parser.parse_args()

    # Run analysis
    result = analyze_options_chain(
        ticker=args.ticker.upper(),
        expiration=args.expiration,
        preset=args.preset
    )

    # Output
    if args.json:
        print(format_result_json(result, include_all_strikes=args.all))
    else:
        print(format_result_summary(result))


if __name__ == "__main__":
    main()
