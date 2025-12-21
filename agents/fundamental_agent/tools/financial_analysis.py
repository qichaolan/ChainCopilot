"""
Financial Analysis Tools for Fundamental Agent.

Implements ratio calculations and financial statement analysis
following the framework in fundamental.md.
"""

from __future__ import annotations

from typing import Optional, Dict, Any, List
from dataclasses import dataclass
import re


@dataclass
class FinancialMetrics:
    """Extracted financial metrics from filing."""
    # Income Statement
    revenue: Optional[float] = None
    revenue_prev: Optional[float] = None
    gross_profit: Optional[float] = None
    gross_profit_prev: Optional[float] = None
    operating_income: Optional[float] = None
    operating_income_prev: Optional[float] = None
    net_income: Optional[float] = None
    net_income_prev: Optional[float] = None
    eps_diluted: Optional[float] = None
    eps_prev: Optional[float] = None
    ebitda: Optional[float] = None

    # Cash Flow Statement
    cfo: Optional[float] = None  # Cash from operations
    cfo_prev: Optional[float] = None
    capex: Optional[float] = None
    capex_prev: Optional[float] = None

    # Balance Sheet
    cash: Optional[float] = None
    receivables: Optional[float] = None
    inventory: Optional[float] = None
    current_assets: Optional[float] = None
    total_assets: Optional[float] = None
    current_liabilities: Optional[float] = None
    total_debt: Optional[float] = None
    interest_expense: Optional[float] = None
    cogs: Optional[float] = None

    # Segment Data
    segments: Optional[List[Dict[str, Any]]] = None

    # Metadata
    unit: str = "millions"  # "millions" or "thousands"
    period: str = ""
    period_prev: str = ""


def calculate_profitability_ratios(metrics: FinancialMetrics) -> Dict[str, Any]:
    """
    Calculate profitability ratios.

    Returns dict with ratio values and interpretations.
    """
    ratios = {}

    # Gross Margin
    if metrics.revenue and metrics.gross_profit:
        gm = metrics.gross_profit / metrics.revenue * 100
        ratios["gross_margin"] = {
            "value": round(gm, 2),
            "display": f"{gm:.1f}%",
            "interpretation": _interpret_margin(gm, "gross")
        }

        # YoY change if prior data available
        if metrics.revenue_prev and metrics.gross_profit_prev:
            gm_prev = metrics.gross_profit_prev / metrics.revenue_prev * 100
            ratios["gross_margin"]["change_pp"] = round(gm - gm_prev, 2)

    # Operating Margin
    if metrics.revenue and metrics.operating_income:
        om = metrics.operating_income / metrics.revenue * 100
        ratios["operating_margin"] = {
            "value": round(om, 2),
            "display": f"{om:.1f}%",
            "interpretation": _interpret_margin(om, "operating")
        }

        if metrics.revenue_prev and metrics.operating_income_prev:
            om_prev = metrics.operating_income_prev / metrics.revenue_prev * 100
            ratios["operating_margin"]["change_pp"] = round(om - om_prev, 2)

    # Net Margin
    if metrics.revenue and metrics.net_income:
        nm = metrics.net_income / metrics.revenue * 100
        ratios["net_margin"] = {
            "value": round(nm, 2),
            "display": f"{nm:.1f}%",
            "interpretation": _interpret_margin(nm, "net")
        }

        if metrics.revenue_prev and metrics.net_income_prev:
            nm_prev = metrics.net_income_prev / metrics.revenue_prev * 100
            ratios["net_margin"]["change_pp"] = round(nm - nm_prev, 2)

    # EBITDA Margin
    if metrics.revenue and metrics.ebitda:
        em = metrics.ebitda / metrics.revenue * 100
        ratios["ebitda_margin"] = {
            "value": round(em, 2),
            "display": f"{em:.1f}%",
        }

    # EPS Growth
    if metrics.eps_diluted and metrics.eps_prev and metrics.eps_prev != 0:
        eps_growth = (metrics.eps_diluted - metrics.eps_prev) / abs(metrics.eps_prev) * 100
        ratios["eps_growth"] = {
            "value": round(eps_growth, 2),
            "display": f"{eps_growth:+.1f}%",
        }

    # Operating Leverage
    if (metrics.revenue and metrics.revenue_prev and metrics.revenue_prev != 0 and
        metrics.operating_income and metrics.operating_income_prev and metrics.operating_income_prev != 0):
        rev_growth = (metrics.revenue - metrics.revenue_prev) / metrics.revenue_prev
        oi_growth = (metrics.operating_income - metrics.operating_income_prev) / abs(metrics.operating_income_prev)
        if rev_growth != 0:
            op_leverage = oi_growth / rev_growth
            ratios["operating_leverage"] = {
                "value": round(op_leverage, 2),
                "display": f"{op_leverage:.2f}x",
            }

    return ratios


def calculate_cash_flow_ratios(metrics: FinancialMetrics) -> Dict[str, Any]:
    """Calculate cash flow quality ratios."""
    ratios = {}

    fcf = None
    if metrics.cfo is not None and metrics.capex is not None:
        fcf = metrics.cfo - abs(metrics.capex)

    # FCF Margin
    if metrics.revenue and fcf is not None:
        fcf_margin = fcf / metrics.revenue * 100
        ratios["fcf_margin"] = {
            "value": round(fcf_margin, 2),
            "display": f"{fcf_margin:.1f}%",
        }

    # Cash Conversion Ratio
    if metrics.cfo and metrics.net_income and metrics.net_income != 0:
        ccr = metrics.cfo / metrics.net_income
        ratios["cash_conversion"] = {
            "value": round(ccr, 2),
            "display": f"{ccr:.2f}x",
            "interpretation": "Good" if ccr >= 1.0 else "Earnings quality concern" if ccr < 0.8 else "Moderate"
        }

    # CapEx Ratio
    if metrics.cfo and metrics.capex:
        capex_ratio = abs(metrics.capex) / metrics.cfo * 100
        ratios["capex_ratio"] = {
            "value": round(capex_ratio, 2),
            "display": f"{capex_ratio:.1f}%",
        }

    # FCF Growth
    if (metrics.cfo and metrics.capex and metrics.cfo_prev and metrics.capex_prev):
        fcf_prev = metrics.cfo_prev - abs(metrics.capex_prev)
        if fcf_prev != 0:
            fcf_growth = (fcf - fcf_prev) / abs(fcf_prev) * 100
            ratios["fcf_growth"] = {
                "value": round(fcf_growth, 2),
                "display": f"{fcf_growth:+.1f}%",
            }

    # Cash Flow Coverage
    if metrics.cfo and metrics.total_debt and metrics.total_debt > 0:
        cfc = metrics.cfo / metrics.total_debt
        ratios["cash_flow_coverage"] = {
            "value": round(cfc, 2),
            "display": f"{cfc:.2f}x",
        }

    return ratios


def calculate_balance_sheet_ratios(metrics: FinancialMetrics) -> Dict[str, Any]:
    """Calculate liquidity and balance sheet ratios."""
    ratios = {}

    # Current Ratio
    if metrics.current_assets and metrics.current_liabilities:
        cr = metrics.current_assets / metrics.current_liabilities
        ratios["current_ratio"] = {
            "value": round(cr, 2),
            "display": f"{cr:.2f}x",
            "interpretation": "Strong" if cr >= 2.0 else "Adequate" if cr >= 1.0 else "Liquidity risk"
        }

    # Quick Ratio
    if metrics.cash and metrics.receivables and metrics.current_liabilities:
        qr = (metrics.cash + metrics.receivables) / metrics.current_liabilities
        ratios["quick_ratio"] = {
            "value": round(qr, 2),
            "display": f"{qr:.2f}x",
        }

    # Debt-to-Equity
    if metrics.total_debt and metrics.total_assets:
        equity = metrics.total_assets - metrics.total_debt
        if equity > 0:
            dte = metrics.total_debt / equity
            ratios["debt_to_equity"] = {
                "value": round(dte, 2),
                "display": f"{dte:.2f}x",
                "interpretation": "Conservative" if dte < 0.5 else "Moderate" if dte < 1.0 else "Elevated"
            }

    # Net Debt / EBITDA
    if metrics.total_debt and metrics.cash and metrics.ebitda and metrics.ebitda > 0:
        net_debt = metrics.total_debt - metrics.cash
        nd_ebitda = net_debt / metrics.ebitda
        ratios["net_debt_ebitda"] = {
            "value": round(nd_ebitda, 2),
            "display": f"{nd_ebitda:.2f}x",
            "interpretation": "Conservative" if nd_ebitda < 2.0 else "Moderate" if nd_ebitda < 3.5 else "Elevated"
        }

    # Interest Coverage
    if metrics.operating_income and metrics.interest_expense and metrics.interest_expense > 0:
        ic = metrics.operating_income / metrics.interest_expense
        ratios["interest_coverage"] = {
            "value": round(ic, 2),
            "display": f"{ic:.2f}x",
            "interpretation": "Strong" if ic >= 5.0 else "Adequate" if ic >= 2.0 else "Weak"
        }

    # Net Cash / (Debt)
    if metrics.cash and metrics.total_debt is not None:
        net_cash = metrics.cash - (metrics.total_debt or 0)
        ratios["net_cash_position"] = {
            "value": round(net_cash, 2),
            "display": f"${net_cash:,.0f}M" if net_cash >= 0 else f"(${abs(net_cash):,.0f}M)",
            "is_net_cash": net_cash >= 0
        }

    return ratios


def calculate_growth_ratios(metrics: FinancialMetrics) -> Dict[str, Any]:
    """Calculate growth and efficiency ratios."""
    ratios = {}

    # Revenue Growth
    if metrics.revenue and metrics.revenue_prev and metrics.revenue_prev != 0:
        rev_growth = (metrics.revenue - metrics.revenue_prev) / metrics.revenue_prev * 100
        ratios["revenue_growth"] = {
            "value": round(rev_growth, 2),
            "display": f"{rev_growth:+.1f}%",
        }

    # Operating Income Growth
    if metrics.operating_income and metrics.operating_income_prev and metrics.operating_income_prev != 0:
        oi_growth = (metrics.operating_income - metrics.operating_income_prev) / abs(metrics.operating_income_prev) * 100
        ratios["operating_income_growth"] = {
            "value": round(oi_growth, 2),
            "display": f"{oi_growth:+.1f}%",
        }

    # Asset Turnover
    if metrics.revenue and metrics.total_assets and metrics.total_assets > 0:
        at = metrics.revenue / metrics.total_assets
        ratios["asset_turnover"] = {
            "value": round(at, 2),
            "display": f"{at:.2f}x",
        }

    # Inventory Turnover
    if metrics.cogs and metrics.inventory and metrics.inventory > 0:
        it = metrics.cogs / metrics.inventory
        ratios["inventory_turnover"] = {
            "value": round(it, 2),
            "display": f"{it:.2f}x",
        }

    # Receivables Turnover
    if metrics.revenue and metrics.receivables and metrics.receivables > 0:
        rt = metrics.revenue / metrics.receivables
        ratios["receivables_turnover"] = {
            "value": round(rt, 2),
            "display": f"{rt:.2f}x",
        }

    return ratios


def detect_anomalies(metrics: FinancialMetrics, ratios: Dict[str, Dict]) -> List[Dict[str, Any]]:
    """
    Detect financial anomalies and red flags.

    Returns list of anomaly dictionaries with severity and explanation.
    """
    anomalies = []

    # Rising debt or leverage
    if "debt_to_equity" in ratios and ratios["debt_to_equity"]["value"] > 1.5:
        anomalies.append({
            "type": "high_leverage",
            "severity": "warning",
            "message": f"Elevated debt-to-equity ratio ({ratios['debt_to_equity']['display']})",
            "section": "item_8"
        })

    # Negative CFO but positive NI (earnings quality)
    if metrics.cfo and metrics.net_income:
        if metrics.cfo < 0 and metrics.net_income > 0:
            anomalies.append({
                "type": "earnings_quality",
                "severity": "alert",
                "message": "Negative operating cash flow despite positive net income - earnings quality concern",
                "section": "item_8"
            })

    # Cash conversion below threshold
    if "cash_conversion" in ratios and ratios["cash_conversion"]["value"] < 0.8:
        anomalies.append({
            "type": "cash_conversion",
            "severity": "warning",
            "message": f"Low cash conversion ratio ({ratios['cash_conversion']['display']}) - earnings may not be translating to cash",
            "section": "item_8"
        })

    # Inventory growth > revenue growth
    if metrics.inventory and metrics.revenue and metrics.revenue_prev:
        if "revenue_growth" in ratios:
            rev_growth = ratios["revenue_growth"]["value"]
            # Would need inventory_prev for this check
            pass

    # Margin compression
    profitability = ratios.get("profitability", {})
    if "gross_margin" in profitability:
        gm = profitability["gross_margin"]
        if gm.get("change_pp") and gm["change_pp"] < -2:
            anomalies.append({
                "type": "margin_compression",
                "severity": "warning",
                "message": f"Gross margin compression ({gm['change_pp']:+.1f} pp YoY)",
                "section": "item_8"
            })

    if "operating_margin" in profitability:
        om = profitability["operating_margin"]
        if om.get("change_pp") and om["change_pp"] < -2:
            anomalies.append({
                "type": "margin_compression",
                "severity": "warning",
                "message": f"Operating margin compression ({om['change_pp']:+.1f} pp YoY)",
                "section": "item_7"
            })

    # Interest coverage concern
    if "interest_coverage" in ratios and ratios["interest_coverage"]["value"] < 2.0:
        anomalies.append({
            "type": "coverage_risk",
            "severity": "alert",
            "message": f"Low interest coverage ({ratios['interest_coverage']['display']}) - debt servicing risk",
            "section": "item_8"
        })

    return anomalies


def _interpret_margin(value: float, margin_type: str) -> str:
    """Generate interpretation for margin value."""
    if margin_type == "gross":
        if value >= 50:
            return "Strong pricing power"
        elif value >= 30:
            return "Healthy gross margin"
        else:
            return "Competitive or commodity business"
    elif margin_type == "operating":
        if value >= 25:
            return "Excellent operational efficiency"
        elif value >= 15:
            return "Good operating leverage"
        elif value >= 5:
            return "Moderate profitability"
        else:
            return "Tight margins"
    elif margin_type == "net":
        if value >= 20:
            return "Highly profitable"
        elif value >= 10:
            return "Solid profitability"
        elif value >= 5:
            return "Adequate margins"
        else:
            return "Low profitability"
    return ""


def analyze_financials(metrics: FinancialMetrics) -> Dict[str, Any]:
    """
    Perform comprehensive financial analysis.

    Returns structured analysis with all ratio categories and anomalies.
    """
    profitability = calculate_profitability_ratios(metrics)
    cash_flow = calculate_cash_flow_ratios(metrics)
    balance_sheet = calculate_balance_sheet_ratios(metrics)
    growth = calculate_growth_ratios(metrics)

    all_ratios = {
        "profitability": profitability,
        "cash_flow": cash_flow,
        "balance_sheet": balance_sheet,
        "growth": growth,
    }

    anomalies = detect_anomalies(metrics, all_ratios)

    # Calculate FCF
    fcf = None
    if metrics.cfo is not None and metrics.capex is not None:
        fcf = metrics.cfo - abs(metrics.capex)

    return {
        "summary": {
            "revenue": metrics.revenue,
            "gross_profit": metrics.gross_profit,
            "operating_income": metrics.operating_income,
            "net_income": metrics.net_income,
            "eps_diluted": metrics.eps_diluted,
            "cfo": metrics.cfo,
            "fcf": fcf,
            "period": metrics.period,
            "unit": metrics.unit,
        },
        "ratios": all_ratios,
        "anomalies": anomalies,
        "anomaly_count": len(anomalies),
    }


def format_analysis_response(analysis: Dict[str, Any], ticker: str = "") -> str:
    """
    Format analysis results as markdown for chat response.
    """
    summary = analysis["summary"]
    ratios = analysis["ratios"]
    anomalies = analysis["anomalies"]

    lines = []
    lines.append(f"## Financial Summary: {ticker} {summary.get('period', '')}")
    lines.append("")

    # Key metrics table
    lines.append(f"### Key Metrics (USD {summary.get('unit', 'millions')})")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|--------|-------|")

    if summary.get("revenue"):
        lines.append(f"| Revenue | ${summary['revenue']:,.0f} |")
    if summary.get("gross_profit"):
        lines.append(f"| Gross Profit | ${summary['gross_profit']:,.0f} |")
    if summary.get("operating_income"):
        lines.append(f"| Operating Income | ${summary['operating_income']:,.0f} |")
    if summary.get("net_income"):
        lines.append(f"| Net Income | ${summary['net_income']:,.0f} |")
    if summary.get("eps_diluted"):
        lines.append(f"| EPS (diluted) | ${summary['eps_diluted']:.2f} |")
    if summary.get("cfo"):
        lines.append(f"| CFO | ${summary['cfo']:,.0f} |")
    if summary.get("fcf"):
        lines.append(f"| FCF | ${summary['fcf']:,.0f} |")

    lines.append("")

    # Profitability ratios
    prof = ratios.get("profitability", {})
    if prof:
        lines.append("### Profitability Ratios")
        lines.append("")
        lines.append("| Ratio | Value | Interpretation |")
        lines.append("|-------|-------|----------------|")
        for key in ["gross_margin", "operating_margin", "net_margin"]:
            if key in prof:
                r = prof[key]
                interp = r.get("interpretation", "")
                change = f" ({r['change_pp']:+.1f} pp)" if r.get("change_pp") else ""
                lines.append(f"| {key.replace('_', ' ').title()} | {r['display']}{change} | {interp} |")
        lines.append("")

    # Cash flow ratios
    cf = ratios.get("cash_flow", {})
    if cf:
        lines.append("### Cash Flow Quality")
        lines.append("")
        lines.append("| Ratio | Value | Note |")
        lines.append("|-------|-------|------|")
        for key in ["fcf_margin", "cash_conversion", "capex_ratio"]:
            if key in cf:
                r = cf[key]
                note = r.get("interpretation", "")
                lines.append(f"| {key.replace('_', ' ').title()} | {r['display']} | {note} |")
        lines.append("")

    # Balance sheet ratios
    bs = ratios.get("balance_sheet", {})
    if bs:
        lines.append("### Balance Sheet Health")
        lines.append("")
        lines.append("| Ratio | Value | Interpretation |")
        lines.append("|-------|-------|----------------|")
        for key in ["current_ratio", "debt_to_equity", "net_debt_ebitda", "interest_coverage"]:
            if key in bs:
                r = bs[key]
                interp = r.get("interpretation", "")
                lines.append(f"| {key.replace('_', ' ').title()} | {r['display']} | {interp} |")
        lines.append("")

    # Anomalies
    if anomalies:
        lines.append("### ⚠️ Anomalies & Concerns")
        lines.append("")
        for a in anomalies:
            severity_icon = "🔴" if a["severity"] == "alert" else "🟡"
            lines.append(f"- {severity_icon} **{a['message']}** *[{a['section']}]*")
        lines.append("")

    lines.append("*Sources: [Item 8 - Financial Statements](item_8), [Item 7 - MD&A](item_7)*")

    return "\n".join(lines)
