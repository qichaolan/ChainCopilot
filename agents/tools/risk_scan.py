"""
Risk Scan Tool
Scans for risk factors, events, and IV conditions for LEAPS positions.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import json


def scan_leaps_risks(
    symbol: str,
    simulations_json: str,
    iv_data_json: Optional[str] = None,
    events_json: Optional[str] = None,
) -> dict:
    """
    Comprehensive risk scan for LEAPS position candidates.

    Checks:
    1. IV rank/percentile - is IV historically high or low?
    2. Upcoming events (earnings, dividends, splits)
    3. Concentration risk
    4. Time decay exposure
    5. Assignment risk

    Args:
        symbol: Underlying symbol (e.g., "AAPL")
        simulations_json: Simulation results from payoff_sim
        iv_data_json: Optional IV rank/percentile data:
            {
                "currentIV": 0.32,
                "ivRank": 45,
                "ivPercentile": 52,
                "iv52wHigh": 0.55,
                "iv52wLow": 0.22
            }
        events_json: Optional upcoming events:
            [
                {"date": "2025-01-28", "event": "earnings", "impact": "high"},
                {"date": "2025-02-14", "event": "dividend", "impact": "low"},
                ...
            ]

    Returns:
        {
            "riskScan": {
                "symbol": "AAPL",
                "overallRisk": "moderate",  // low, moderate, high, critical
                "ivAnalysis": {
                    "currentIV": 0.32,
                    "ivRank": 45,
                    "ivPercentile": 52,
                    "assessment": "IV is near historical median - neutral for LEAPS entry"
                },
                "events": [
                    {"date": "2025-01-28", "event": "Earnings", "impact": "high", "daysAway": 43}
                ],
                "concentrationRisk": "low",
                "warnings": [
                    "3 earnings reports will occur during position lifetime",
                    "Consider IV impact around events"
                ],
                "recommendations": [
                    "Consider selling covered calls against LEAPS after IV spike",
                    "Monitor position around earnings dates"
                ]
            }
        }
    """
    try:
        simulations = json.loads(simulations_json) if isinstance(simulations_json, str) else simulations_json
        iv_data = json.loads(iv_data_json) if iv_data_json else None
        events = json.loads(events_json) if events_json else []
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON input: {str(e)}"}

    warnings = []
    recommendations = []
    risk_level = "low"
    risk_factors = []

    # 1. Analyze IV data
    iv_analysis = _analyze_iv(iv_data, warnings, recommendations)
    if iv_analysis.get("ivRank", 50) > 80:
        risk_factors.append("high_iv")
    elif iv_analysis.get("ivRank", 50) < 20:
        risk_factors.append("low_iv")

    # 2. Analyze upcoming events
    events_analysis = _analyze_events(events, simulations, warnings)
    if events_analysis.get("highImpactEvents", 0) > 2:
        risk_factors.append("multiple_events")

    # 3. Concentration risk
    concentration = _assess_concentration(simulations)
    if concentration == "high":
        risk_factors.append("concentration")
        warnings.append("Large single-position exposure")

    # 4. Time decay exposure
    decay_risk = _assess_decay_risk(simulations, warnings, recommendations)
    if decay_risk == "high":
        risk_factors.append("theta_decay")

    # 5. Assignment risk (for ITM options)
    assignment_risk = _assess_assignment_risk(simulations, warnings)
    if assignment_risk:
        risk_factors.append("early_assignment")

    # Determine overall risk level
    if len(risk_factors) >= 3 or "concentration" in risk_factors:
        risk_level = "critical"
    elif len(risk_factors) >= 2:
        risk_level = "high"
    elif len(risk_factors) >= 1:
        risk_level = "moderate"

    # Add general recommendations
    if not recommendations:
        recommendations.append("Position appears suitable for LEAPS strategy")
    if "high_iv" in risk_factors:
        recommendations.append("Consider waiting for IV crush before entry")
    if "low_iv" in risk_factors:
        recommendations.append("Favorable IV environment for long options")

    return {
        "riskScan": {
            "symbol": symbol,
            "overallRisk": risk_level,
            "riskFactors": risk_factors,
            "ivAnalysis": iv_analysis,
            "events": events_analysis.get("events", []),
            "concentrationRisk": concentration,
            "warnings": warnings,
            "recommendations": recommendations,
        }
    }


def _analyze_iv(
    iv_data: Optional[dict],
    warnings: List[str],
    recommendations: List[str],
) -> dict:
    """Analyze IV rank and percentile."""
    if not iv_data:
        return {
            "currentIV": None,
            "ivRank": 50,
            "ivPercentile": 50,
            "assessment": "IV data not available - assume neutral conditions",
        }

    iv_rank = iv_data.get("ivRank", 50)
    iv_percentile = iv_data.get("ivPercentile", 50)
    current_iv = iv_data.get("currentIV", 0)

    if iv_rank > 80:
        assessment = "IV is elevated (top 20%) - consider smaller position or wait"
        warnings.append(f"IV rank {iv_rank} is historically high")
        recommendations.append("Consider selling premium instead of buying LEAPS")
    elif iv_rank > 60:
        assessment = "IV is above average - factor into position sizing"
    elif iv_rank < 20:
        assessment = "IV is depressed (bottom 20%) - favorable for buying LEAPS"
        recommendations.append("Good environment for long options")
    elif iv_rank < 40:
        assessment = "IV is below average - slightly favorable for buying"
    else:
        assessment = "IV is near historical median - neutral conditions"

    return {
        "currentIV": current_iv,
        "ivRank": iv_rank,
        "ivPercentile": iv_percentile,
        "iv52wHigh": iv_data.get("iv52wHigh"),
        "iv52wLow": iv_data.get("iv52wLow"),
        "assessment": assessment,
    }


def _analyze_events(
    events: List[dict],
    simulations: List[dict],
    warnings: List[str],
) -> dict:
    """Analyze upcoming events that could impact the position."""
    if not events:
        return {
            "events": [],
            "highImpactEvents": 0,
            "assessment": "No known upcoming events",
        }

    today = datetime.now()
    analyzed_events = []
    high_impact_count = 0

    # Get max DTE from simulations
    max_dte = 365
    if simulations:
        for sim in simulations:
            contract = sim.get("contract", {})
            dte = contract.get("dte", 365)
            if dte > max_dte:
                max_dte = dte

    for event in events:
        try:
            event_date = datetime.strptime(event.get("date", ""), "%Y-%m-%d")
            days_away = (event_date - today).days

            if 0 <= days_away <= max_dte:
                impact = event.get("impact", "medium")
                if impact == "high":
                    high_impact_count += 1

                analyzed_events.append({
                    "date": event.get("date"),
                    "event": event.get("event", "Unknown"),
                    "impact": impact,
                    "daysAway": days_away,
                })
        except (ValueError, TypeError):
            continue

    if high_impact_count > 0:
        warnings.append(f"{high_impact_count} high-impact event(s) during position lifetime")

    # Sort by date
    analyzed_events.sort(key=lambda x: x.get("daysAway", 999))

    return {
        "events": analyzed_events[:10],  # Limit to 10 events
        "highImpactEvents": high_impact_count,
        "totalEvents": len(analyzed_events),
    }


def _assess_concentration(simulations: List[dict]) -> str:
    """Assess concentration risk based on position sizing."""
    if not simulations:
        return "unknown"

    # For single LEAPS positions, concentration is generally not an issue
    # This would be more relevant for portfolio-level analysis
    total_cost = sum(
        sim.get("payoff", {}).get("costBasis", 0)
        for sim in simulations
    )

    # Simple heuristic: if looking at multiple candidates, risk is low
    if len(simulations) > 1:
        return "low"
    elif total_cost > 10000:
        return "medium"  # Larger single position
    else:
        return "low"


def _assess_decay_risk(
    simulations: List[dict],
    warnings: List[str],
    recommendations: List[str],
) -> str:
    """Assess theta decay risk."""
    if not simulations:
        return "low"

    for sim in simulations:
        theta_decay = sim.get("thetaDecay", {})
        daily = abs(theta_decay.get("daily", 0))
        cost_basis = sim.get("payoff", {}).get("costBasis", 1)

        # Daily decay as % of position
        decay_pct = (daily / cost_basis * 100) if cost_basis > 0 else 0

        if decay_pct > 0.5:  # More than 0.5% daily
            warnings.append(f"High theta decay: ${daily:.2f}/day ({decay_pct:.2f}% of position)")
            return "high"
        elif decay_pct > 0.25:
            warnings.append(f"Moderate theta decay: ${daily:.2f}/day")
            recommendations.append("Consider longer DTE to reduce decay impact")
            return "medium"

    return "low"


def _assess_assignment_risk(
    simulations: List[dict],
    warnings: List[str],
) -> bool:
    """Check for early assignment risk on ITM options."""
    has_risk = False

    for sim in simulations:
        contract = sim.get("contract", {})
        strike = contract.get("strike", 0)
        option_type = contract.get("optionType", "").lower()
        payoff = sim.get("payoff", {})
        breakeven = payoff.get("breakeven", 0)

        # Check if significantly ITM (deep in the money)
        underlying = sim.get("underlyingPrice", breakeven)
        if option_type == "call" and strike < underlying * 0.95:
            warnings.append("Deep ITM call - monitor for early assignment risk near ex-dividend")
            has_risk = True
        elif option_type == "put" and strike > underlying * 1.05:
            warnings.append("Deep ITM put - potential early assignment risk")
            has_risk = True

    return has_risk


def generate_risk_report(
    risk_scan_json: str,
    verbose: bool = False,
) -> dict:
    """
    Generate a formatted risk report from scan results.

    Args:
        risk_scan_json: Results from scan_leaps_risks
        verbose: Include detailed explanations

    Returns:
        {
            "report": {
                "title": "LEAPS Risk Assessment: AAPL",
                "riskLevel": "moderate",
                "riskBadge": "⚠️ MODERATE",
                "sections": [
                    {
                        "title": "IV Environment",
                        "content": "...",
                        "status": "neutral"
                    },
                    ...
                ]
            }
        }
    """
    try:
        scan = json.loads(risk_scan_json) if isinstance(risk_scan_json, str) else risk_scan_json
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {str(e)}"}

    risk_scan = scan.get("riskScan", scan)
    symbol = risk_scan.get("symbol", "Unknown")
    risk_level = risk_scan.get("overallRisk", "unknown")

    # Risk badge
    badges = {
        "low": "✅ LOW",
        "moderate": "⚠️ MODERATE",
        "high": "🔶 HIGH",
        "critical": "🛑 CRITICAL",
    }
    badge = badges.get(risk_level, "❓ UNKNOWN")

    sections = []

    # IV Section
    iv = risk_scan.get("ivAnalysis", {})
    sections.append({
        "title": "IV Environment",
        "content": iv.get("assessment", "No IV data available"),
        "status": "favorable" if iv.get("ivRank", 50) < 40 else "neutral" if iv.get("ivRank", 50) < 70 else "caution",
        "data": {
            "IV Rank": f"{iv.get('ivRank', 'N/A')}%",
            "Current IV": f"{iv.get('currentIV', 0) * 100:.1f}%" if iv.get("currentIV") else "N/A",
        },
    })

    # Events Section
    events = risk_scan.get("events", [])
    if events:
        event_summary = f"{len(events)} event(s) during position lifetime"
        sections.append({
            "title": "Upcoming Events",
            "content": event_summary,
            "status": "caution" if len([e for e in events if e.get("impact") == "high"]) > 0 else "neutral",
            "events": events[:5],
        })

    # Warnings Section
    warnings = risk_scan.get("warnings", [])
    if warnings:
        sections.append({
            "title": "Risk Warnings",
            "content": "\n".join(f"• {w}" for w in warnings),
            "status": "caution",
        })

    # Recommendations Section
    recommendations = risk_scan.get("recommendations", [])
    if recommendations:
        sections.append({
            "title": "Recommendations",
            "content": "\n".join(f"• {r}" for r in recommendations),
            "status": "info",
        })

    return {
        "report": {
            "title": f"LEAPS Risk Assessment: {symbol}",
            "riskLevel": risk_level,
            "riskBadge": badge,
            "sections": sections,
        }
    }
