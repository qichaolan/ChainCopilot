"""
AI-based Expected Move Determination using Google Gemini via Vertex AI.

Uses sector ETF historical returns to estimate reasonable expected moves.
Configuration loaded from agents/config/gcp_config.yaml.
"""

from __future__ import annotations

import sys
import json
from typing import Optional, Dict, Any
from pathlib import Path

# Default expected move if AI fails or returns null
DEFAULT_EXPECTED_MOVE_PCT = 0.10  # 10% annual

# Add config path for imports
TOOLS_DIR = Path(__file__).parent
AGENT_DIR = TOOLS_DIR.parent
AGENTS_DIR = AGENT_DIR.parent
sys.path.insert(0, str(AGENTS_DIR))


def get_expected_move_from_ai(ticker: str) -> Dict[str, Any]:
    """
    Use Google Gemini to determine the expected move percentage.

    Uses sector ETF 10-year annualized returns as a baseline for expected moves.
    Tries google-genai first (API key), then Vertex AI, then fallback.

    Args:
        ticker: Stock ticker symbol (e.g., "AAPL", "MSFT")

    Returns:
        Dict with:
            - expectedMovePct: float (decimal, e.g., 0.12 = 12%)
            - sector: str | None (sector ETF like "XLK")
            - source: str ("ai" | "fallback" | "default")
            - raw: dict (raw AI response for transparency)
    """
    import os

    # Try google-genai first (uses GOOGLE_API_KEY env var)
    try:
        from google import genai

        api_key = os.environ.get("GOOGLE_API_KEY")
        if api_key:
            client = genai.Client(api_key=api_key)
            prompt = _build_sector_prompt(ticker)
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
            )
            result = _parse_ai_response(response.text)

            # If AI identified a sector, use it (with AI return or fallback return)
            if result["sector"]:
                if result["annualized_return"] is not None:
                    # AI provided both sector and return
                    expected_move = result["annualized_return"] / 100.0
                    expected_move = max(0.05, min(0.50, expected_move))
                    return {
                        "expectedMovePct": round(expected_move, 3),
                        "sector": result["sector"],
                        "source": "ai",
                        "raw": result,
                    }
                else:
                    # AI identified sector but not return - use our fallback return for that sector
                    sector = result["sector"]
                    expected_move = SECTOR_FALLBACK_RETURNS.get(sector, DEFAULT_EXPECTED_MOVE_PCT)
                    return {
                        "expectedMovePct": expected_move,
                        "sector": sector,
                        "source": "ai_sector",  # AI identified sector, fallback return
                        "raw": result,
                    }
    except Exception as e:
        print(f"[expected_move_ai] google-genai failed: {e}")

    # Fallback: use ticker-based sector mapping
    return _get_fallback_for_ticker(ticker)


def _build_sector_prompt(ticker: str) -> str:
    """Build the prompt for sector classification and return lookup."""
    return f"""Role
You are a fact-driven financial classification assistant.
You will be given a ticker symbol, which may represent:
- a single stock, or
- a market index / ETF / benchmark

Task Rules
First determine the ticker type:

If the ticker represents a market index or ETF (e.g., SPX, NDX, QQQ, XLK, etc.):
- Do NOT map it to another sector
- Set sector = "INDEX" and Annualized_Return = that instrument's latest 10 yearsannualized return

If the ticker represents an individual stock:
- Map it to exactly one of the following sector ETFs:

| Sector | ETF |
|--------|-----|
| Information Technology | XLK |
| Communication Services | XLC |
| Consumer Discretionary | XLY |
| Financials | XLF |
| Industrials | XLI |
| Healthcare | XLV |
| Utilities | XLU |
| Consumer Staples | XLP |
| Materials | XLB |
| Real Estate | XLRE |

Interpretation Notes (Internal Logic)
If input is:
- AAPL → map to XLK
- META → map to XLC
- AMZN → map to XLY
- SPX, ^GSPC, SPY, QQQ, NDX → return "sector": "INDEX"
- XLK → return "sector": "XLK"

Confidence Requirement
- If the ticker type cannot be determined with high confidence, return null.
- If the sector mapping cannot be determined with high confidence, return null.

10-Year Annualized Return
If a sector ETF or index is identified:
- Return the 10-Year Annualized Total Return for that ETF/index.
- Use your best knowledge of historical returns (as of late 2024).
- Examples: XLK ~20%, XLC ~10%, SPY ~12%, QQQ ~18%
- Only return null if you truly have no data for this instrument.

STRICT OUTPUT RULES (NON-NEGOTIABLE)
- Return JSON only
- No explanations
- No markdown
- No comments
- No additional keys
- No assumptions
- Maximum 1 decimal place

Output Schema:
If either:
- ticker type is unclear, or
- sector/index mapping confidence < 95%, or
- 10-year annualized return is uncertain

Return exactly:
{{"sector": null, "Annualized_Return": null}}

Otherwise, return:
{{"sector": "XLK | XLC | XLY | XLF | XLI | XLV | XLU | XLP | XLB | XLRE | INDEX", "Annualized_Return": number | null}}


Input
Ticker: {ticker}"""


def _parse_ai_response(response_text: str) -> Dict[str, Any]:
    """
    Parse AI response, normalizing Annualized_Return → annualized_return.

    Returns consistent shape: {sector, annualized_return, error?}
    Preserves null values - caller decides fallback logic.
    """
    if not response_text:
        return {"sector": None, "annualized_return": None, "error": "Empty response"}

    text = response_text.strip()

    # Remove markdown code blocks if present
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        text = text.strip()

    try:
        data = json.loads(text)
        # Normalize: Annualized_Return (prompt schema) → annualized_return
        # Preserve nulls - don't convert to default here
        return {
            "sector": data.get("sector"),
            "annualized_return": data.get("Annualized_Return"),
        }
    except (json.JSONDecodeError, TypeError, KeyError) as e:
        return {"sector": None, "annualized_return": None, "error": f"Parse error: {str(e)}"}


# Fallback sector returns (10-year annualized as of late 2024)
# Used when AI is unavailable or returns null
SECTOR_FALLBACK_RETURNS: Dict[str, float] = {
    "XLK": 0.203,  # Tech ~20.3%
    "XLC": 0.10,   # Comm Services ~10%
    "XLY": 0.12,   # Consumer Disc ~12%
    "XLF": 0.10,   # Financials ~10%
    "XLI": 0.11,   # Industrials ~11%
    "XLV": 0.11,   # Healthcare ~11%
    "XLU": 0.08,   # Utilities ~8%
    "XLP": 0.09,   # Consumer Staples ~9%
    "XLB": 0.09,   # Materials ~9%
    "XLRE": 0.08,  # Real Estate ~8%
    "INDEX": 0.12, # Broad market ~12%
}

# Common ticker to sector mapping for local fallback (when AI unavailable)
TICKER_SECTOR_MAP: Dict[str, str] = {
    # Tech (XLK)
    "AAPL": "XLK", "MSFT": "XLK", "NVDA": "XLK", "AVGO": "XLK", "AMD": "XLK",
    "CRM": "XLK", "ADBE": "XLK", "INTC": "XLK", "CSCO": "XLK", "ORCL": "XLK",
    # Comm Services (XLC)
    "META": "XLC", "GOOGL": "XLC", "GOOG": "XLC", "NFLX": "XLC", "DIS": "XLC",
    "CMCSA": "XLC", "VZ": "XLC", "T": "XLC", "TMUS": "XLC",
    # Consumer Disc (XLY)
    "AMZN": "XLY", "TSLA": "XLY", "HD": "XLY", "MCD": "XLY", "NKE": "XLY",
    "LOW": "XLY", "SBUX": "XLY", "TJX": "XLY", "BKNG": "XLY",
    # Financials (XLF)
    "JPM": "XLF", "BAC": "XLF", "WFC": "XLF", "GS": "XLF", "MS": "XLF",
    "BRK.B": "XLF", "V": "XLF", "MA": "XLF", "AXP": "XLF",
    # Healthcare (XLV)
    "UNH": "XLV", "JNJ": "XLV", "PFE": "XLV", "ABBV": "XLV", "MRK": "XLV",
    "LLY": "XLV", "TMO": "XLV", "ABT": "XLV", "BMY": "XLV",
    # Industrials (XLI)
    "CAT": "XLI", "BA": "XLI", "HON": "XLI", "UPS": "XLI", "RTX": "XLI",
    "GE": "XLI", "LMT": "XLI", "DE": "XLI", "MMM": "XLI",
    # Indices/ETFs
    "SPY": "INDEX", "QQQ": "INDEX", "IWM": "INDEX", "DIA": "INDEX",
    "SPX": "INDEX", "NDX": "INDEX", "RUT": "INDEX",
}


def get_sector_fallback_return(sector: Optional[str]) -> float:
    """Get fallback return for a sector ETF."""
    if sector and sector in SECTOR_FALLBACK_RETURNS:
        return SECTOR_FALLBACK_RETURNS[sector]
    return DEFAULT_EXPECTED_MOVE_PCT


def _get_fallback_for_ticker(ticker: str) -> Dict[str, Any]:
    """Get fallback expected move when AI is unavailable."""
    ticker_upper = ticker.upper()

    # Check if it's a known ticker
    if ticker_upper in TICKER_SECTOR_MAP:
        sector = TICKER_SECTOR_MAP[ticker_upper]
        expected_move = SECTOR_FALLBACK_RETURNS.get(sector, DEFAULT_EXPECTED_MOVE_PCT)
        return {
            "expectedMovePct": expected_move,
            "sector": sector,
            "source": "fallback",
            "raw": {"method": "ticker_sector_map"},
        }

    # Check if it's a sector ETF itself
    if ticker_upper in SECTOR_FALLBACK_RETURNS:
        return {
            "expectedMovePct": SECTOR_FALLBACK_RETURNS[ticker_upper],
            "sector": ticker_upper,
            "source": "fallback",
            "raw": {"method": "sector_etf"},
        }

    # Unknown ticker - use default
    return {
        "expectedMovePct": DEFAULT_EXPECTED_MOVE_PCT,
        "sector": None,
        "source": "default",
        "raw": {"method": "unknown_ticker"},
    }
