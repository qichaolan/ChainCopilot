"""
Contract Rank Tool
Scores and ranks LEAPS candidates by multiple perspectives.
"""

from typing import List, Dict, Any, Optional
import json
import math


# Default ranking weights (equal weighting)
DEFAULT_WEIGHTS = {
    "thetaEfficiency": 0.25,
    "deltaProbability": 0.25,
    "liquidity": 0.25,
    "riskReward": 0.25,
}


def rank_leaps_candidates(
    candidates_json: str,
    intent_json: str,
    underlying_price: float,
    weights_json: Optional[str] = None,
    top_n: int = 10,
) -> dict:
    """
    Rank filtered LEAPS candidates by multiple scoring perspectives.

    Scoring dimensions:
    1. Theta Efficiency: Lower theta decay relative to premium = better
    2. Delta Probability: Higher delta = higher probability of profit
    3. Liquidity: Higher OI + tighter spreads = better
    4. Risk/Reward: Better potential ROI relative to max loss

    Args:
        candidates_json: JSON string of filtered candidates from chain_filter:
            [
                {
                    "contract": {...},
                    "filterReasons": [...]
                },
                ...
            ]
        intent_json: JSON string of user intent
        underlying_price: Current price of the underlying
        weights_json: Optional custom weights (default: equal 25% each)
        top_n: Number of top candidates to return

    Returns:
        {
            "rankedCandidates": [
                {
                    "rank": 1,
                    "contract": {...},
                    "scores": {
                        "thetaEfficiency": 85,
                        "deltaProbability": 72,
                        "liquidity": 90,
                        "riskReward": 68
                    },
                    "overallScore": 78.75,
                    "explanation": "Strong theta efficiency, excellent liquidity...",
                    "why": ["Best theta/premium ratio", "Tight 1.2% spread"],
                    "riskFlags": ["Lower delta = more speculative"]
                },
                ...
            ],
            "scoringMethod": {
                "weights": {...},
                "perspectives": ["thetaEfficiency", "deltaProbability", "liquidity", "riskReward"]
            }
        }
    """
    try:
        candidates = json.loads(candidates_json) if isinstance(candidates_json, str) else candidates_json
        intent = json.loads(intent_json) if isinstance(intent_json, str) else intent_json
        weights = json.loads(weights_json) if weights_json else DEFAULT_WEIGHTS
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON input: {str(e)}"}

    if not candidates:
        return {
            "rankedCandidates": [],
            "scoringMethod": {"weights": weights, "perspectives": list(weights.keys())},
        }

    # Extract all contracts for normalization
    contracts = [c.get("contract", c) for c in candidates]

    # Compute raw values for normalization
    raw_values = {
        "thetaEfficiency": [],
        "deltaProbability": [],
        "liquidity": [],
        "riskReward": [],
    }

    for contract in contracts:
        # Theta Efficiency: -theta / mark (lower decay per $ = better)
        theta = abs(contract.get("theta", 0.01))
        mark = contract.get("mark", 1)
        theta_eff = mark / theta if theta > 0 else 0  # Higher = better
        raw_values["thetaEfficiency"].append(theta_eff)

        # Delta Probability: abs(delta) * 100
        delta = abs(contract.get("delta", 0))
        raw_values["deltaProbability"].append(delta * 100)

        # Liquidity Score: Composite of OI and spread
        oi = contract.get("openInterest", 0)
        bid = contract.get("bid", 0)
        ask = contract.get("ask", 0)
        spread_pct = ((ask - bid) / ask * 100) if ask > 0 else 100
        liq_score = _compute_liquidity_score(oi, spread_pct)
        raw_values["liquidity"].append(liq_score)

        # Risk/Reward: Potential ROI at target
        strike = contract.get("strike", underlying_price)
        direction = intent.get("direction", "bullish")
        rr_score = _compute_risk_reward(
            strike, mark, underlying_price, direction
        )
        raw_values["riskReward"].append(rr_score)

    # Normalize all scores to 0-100 scale
    normalized = {
        key: _normalize_scores(values)
        for key, values in raw_values.items()
    }

    # Score and rank each candidate
    scored_candidates = []
    for i, candidate in enumerate(candidates):
        contract = candidate.get("contract", candidate)
        scores = {
            "thetaEfficiency": round(normalized["thetaEfficiency"][i], 1),
            "deltaProbability": round(normalized["deltaProbability"][i], 1),
            "liquidity": round(normalized["liquidity"][i], 1),
            "riskReward": round(normalized["riskReward"][i], 1),
        }

        # Weighted overall score
        overall = sum(
            scores[key] * weights.get(key, 0.25)
            for key in scores
        )

        # Generate explanation
        explanation, why, risk_flags = _generate_rank_explanation(
            scores, contract, underlying_price, intent
        )

        scored_candidates.append({
            "contract": contract,
            "scores": scores,
            "overallScore": round(overall, 2),
            "explanation": explanation,
            "why": why,
            "riskFlags": risk_flags,
        })

    # Sort by overall score descending
    scored_candidates.sort(key=lambda x: x["overallScore"], reverse=True)

    # Add ranks and limit to top_n
    for i, candidate in enumerate(scored_candidates[:top_n]):
        candidate["rank"] = i + 1

    return {
        "rankedCandidates": scored_candidates[:top_n],
        "totalScored": len(scored_candidates),
        "scoringMethod": {
            "weights": weights,
            "perspectives": list(weights.keys()),
        },
    }


def _normalize_scores(values: List[float]) -> List[float]:
    """Normalize values to 0-100 scale using min-max normalization."""
    if not values:
        return []
    min_val = min(values)
    max_val = max(values)
    if max_val == min_val:
        return [50.0] * len(values)
    return [
        ((v - min_val) / (max_val - min_val)) * 100
        for v in values
    ]


def _compute_liquidity_score(oi: int, spread_pct: float) -> float:
    """
    Compute composite liquidity score.

    OI component: log scale, max at 10000+
    Spread component: inverse, tighter is better
    """
    # OI score: 0-50 points
    oi_score = min(50, math.log10(max(oi, 1)) * 15)

    # Spread score: 50 points for 0%, 0 points for 10%+
    spread_score = max(0, 50 - (spread_pct * 5))

    return oi_score + spread_score


def _compute_risk_reward(
    strike: float,
    premium: float,
    underlying: float,
    direction: str,
) -> float:
    """
    Compute risk/reward score based on potential ROI.

    For calls: profit if price > strike + premium
    For puts: profit if price < strike - premium
    """
    cost = premium * 100  # Cost per contract
    if cost <= 0:
        return 0

    # Expected move to be profitable (20% target)
    target_move = underlying * 0.20

    if direction == "bullish":
        # Potential profit at 20% up
        target_price = underlying * 1.20
        intrinsic = max(0, target_price - strike)
        profit = (intrinsic - premium) * 100
    else:
        # Potential profit at 20% down
        target_price = underlying * 0.80
        intrinsic = max(0, strike - target_price)
        profit = (intrinsic - premium) * 100

    # ROI as percentage
    roi = (profit / cost) * 100 if cost > 0 else 0
    return max(0, min(200, roi))  # Cap at 200% for scoring


def _generate_rank_explanation(
    scores: Dict[str, float],
    contract: dict,
    underlying: float,
    intent: dict,
) -> tuple:
    """Generate human-readable explanation for ranking."""
    explanation_parts = []
    why = []
    risk_flags = []

    strike = contract.get("strike", 0)
    delta = abs(contract.get("delta", 0))
    dte = contract.get("dte", 0)

    # Highlight strengths (scores > 70)
    if scores["thetaEfficiency"] > 70:
        why.append("Excellent theta efficiency - low time decay")
    elif scores["thetaEfficiency"] > 50:
        why.append("Good theta/premium balance")

    if scores["deltaProbability"] > 70:
        why.append(f"High delta ({delta:.2f}) - strong directional exposure")
    elif scores["deltaProbability"] < 40:
        risk_flags.append(f"Lower delta ({delta:.2f}) - more speculative")

    if scores["liquidity"] > 80:
        why.append("Excellent liquidity - easy entry/exit")
    elif scores["liquidity"] < 40:
        risk_flags.append("Lower liquidity - wider spreads may impact fills")

    if scores["riskReward"] > 70:
        why.append("Attractive risk/reward profile")

    # Strike position
    if strike < underlying:
        moneyness = "ITM"
        why.append(f"{moneyness} strike provides intrinsic value cushion")
    elif strike > underlying * 1.05:
        moneyness = "OTM"
        risk_flags.append(f"{moneyness} strike requires larger move to profit")
    else:
        moneyness = "ATM"
        why.append(f"{moneyness} strike offers balanced risk/reward")

    # DTE consideration
    if dte > 365:
        why.append(f"Long {dte} DTE reduces time decay pressure")

    # Build explanation
    avg_score = sum(scores.values()) / len(scores)
    if avg_score > 70:
        explanation_parts.append("Strong overall candidate")
    elif avg_score > 50:
        explanation_parts.append("Solid candidate with trade-offs")
    else:
        explanation_parts.append("Candidate with notable concerns")

    explanation = ". ".join(explanation_parts) + "."

    return explanation, why, risk_flags


def compare_candidates(
    candidate_a_json: str,
    candidate_b_json: str,
    intent_json: str,
) -> dict:
    """
    Compare two LEAPS candidates side-by-side.

    Args:
        candidate_a_json: First ranked candidate
        candidate_b_json: Second ranked candidate
        intent_json: User intent for context

    Returns:
        {
            "comparison": {
                "winner": "A",  // or "B" or "tie"
                "margin": 12.5,  // score difference
                "tradeoffs": [
                    {"dimension": "thetaEfficiency", "aScore": 85, "bScore": 72, "winner": "A"},
                    ...
                ],
                "recommendation": "Candidate A offers better theta efficiency..."
            }
        }
    """
    try:
        a = json.loads(candidate_a_json) if isinstance(candidate_a_json, str) else candidate_a_json
        b = json.loads(candidate_b_json) if isinstance(candidate_b_json, str) else candidate_b_json
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {str(e)}"}

    tradeoffs = []
    for dimension in ["thetaEfficiency", "deltaProbability", "liquidity", "riskReward"]:
        a_score = a.get("scores", {}).get(dimension, 0)
        b_score = b.get("scores", {}).get(dimension, 0)
        winner = "A" if a_score > b_score else "B" if b_score > a_score else "tie"
        tradeoffs.append({
            "dimension": dimension,
            "aScore": a_score,
            "bScore": b_score,
            "winner": winner,
        })

    a_overall = a.get("overallScore", 0)
    b_overall = b.get("overallScore", 0)
    margin = abs(a_overall - b_overall)

    if margin < 5:
        winner = "tie"
        rec = "Both candidates are closely matched. Choose based on your priority."
    elif a_overall > b_overall:
        winner = "A"
        strengths = [t["dimension"] for t in tradeoffs if t["winner"] == "A"]
        rec = f"Candidate A wins on {', '.join(strengths)}."
    else:
        winner = "B"
        strengths = [t["dimension"] for t in tradeoffs if t["winner"] == "B"]
        rec = f"Candidate B wins on {', '.join(strengths)}."

    return {
        "comparison": {
            "winner": winner,
            "margin": round(margin, 2),
            "aScore": a_overall,
            "bScore": b_overall,
            "tradeoffs": tradeoffs,
            "recommendation": rec,
        }
    }
