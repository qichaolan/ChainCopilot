"""
SEC EDGAR API Provider.

Interfaces with the SEC's free EDGAR API to discover and fetch filings.
No API key required - uses SEC's public endpoints.

Rate Limits:
- SEC requests max 10 requests/second
- Use appropriate User-Agent header

Endpoints used:
- Company CIK lookup: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={ticker}&type=10&dateb=&owner=include&count=10&output=atom
- Company submissions: https://data.sec.gov/submissions/CIK{cik}.json
- Filing index: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K&dateb=&owner=include&count=40&output=atom
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from urllib.parse import urljoin

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from models import Filing, FormType, FilingStatus


logger = logging.getLogger(__name__)


# SEC API constants
SEC_BASE_URL = "https://www.sec.gov"
SEC_DATA_URL = "https://data.sec.gov"
SEC_ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data"

# Rate limiting - SEC recommends max 10 req/sec, but be conservative
DEFAULT_REQUEST_INTERVAL = 0.5  # 500ms between requests (2 req/sec) - safer


@dataclass
class SECFiling:
    """Raw filing data from SEC."""
    cik: str
    accession_number: str
    form_type: str
    filed_at: datetime
    accepted_at: Optional[datetime]
    company_name: str
    primary_document: str
    filing_url: str
    index_url: str
    period_of_report: Optional[str] = None


class SECProvider:
    """
    SEC EDGAR API client for discovering and fetching filings.

    Uses the free SEC EDGAR APIs - no API key required.
    """

    def __init__(
        self,
        user_agent: str = "SECWatcher/1.0 (research@example.com)",
        timeout: int = 30,
        retries: int = 3,
        request_interval: float = DEFAULT_REQUEST_INTERVAL,
    ):
        """
        Initialize SEC Provider.

        Args:
            user_agent: Required User-Agent header (SEC requires valid contact info)
            timeout: Request timeout in seconds
            retries: Number of retry attempts
            request_interval: Seconds between API requests (default: 0.5s)
        """
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries
        self.request_interval = request_interval
        self.session = self._create_session()
        self._last_request_time = 0.0
        self._cik_cache: Dict[str, str] = {}

    def _create_session(self) -> requests.Session:
        """Create session with retry configuration."""
        session = requests.Session()

        retry_strategy = Retry(
            total=self.retries,
            backoff_factor=0.5,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "HEAD"],
        )

        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)

        session.headers.update({
            "User-Agent": self.user_agent,
            "Accept": "application/json, application/xml, text/html",
            "Accept-Encoding": "gzip, deflate",
        })

        return session

    def _rate_limit(self) -> None:
        """Enforce rate limiting between SEC API requests."""
        elapsed = time.time() - self._last_request_time
        if elapsed < self.request_interval:
            time.sleep(self.request_interval - elapsed)
        self._last_request_time = time.time()

    def _get(self, url: str, **kwargs) -> requests.Response:
        """Make rate-limited GET request."""
        self._rate_limit()
        kwargs.setdefault("timeout", self.timeout)
        response = self.session.get(url, **kwargs)
        response.raise_for_status()
        return response

    def lookup_cik(self, ticker: str) -> Optional[str]:
        """
        Look up CIK for a ticker symbol.

        Args:
            ticker: Stock ticker (e.g., "AAPL")

        Returns:
            CIK as zero-padded string (e.g., "0000320193") or None if not found
        """
        ticker = ticker.upper().strip()

        # Check cache
        if ticker in self._cik_cache:
            return self._cik_cache[ticker]

        # Use SEC's company tickers JSON
        try:
            url = f"{SEC_DATA_URL}/submissions/CIK0000000000.json"
            # Actually, let's use the company tickers mapping
            url = "https://www.sec.gov/files/company_tickers.json"
            response = self._get(url)
            data = response.json()

            # Search for ticker in the mapping
            for entry in data.values():
                if entry.get("ticker", "").upper() == ticker:
                    cik = str(entry["cik_str"]).zfill(10)
                    self._cik_cache[ticker] = cik
                    logger.debug(f"Resolved {ticker} -> CIK {cik}")
                    return cik

            logger.warning(f"CIK not found for ticker {ticker}")
            return None

        except Exception as e:
            logger.error(f"Error looking up CIK for {ticker}: {e}")
            return None

    def get_company_filings(
        self,
        cik: str,
        form_types: Optional[List[str]] = None,
        start_date: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[SECFiling]:
        """
        Get filings for a company.

        Args:
            cik: Company CIK (e.g., "0000320193")
            form_types: Filter by form types (default: ["10-K", "10-Q"])
            start_date: Only include filings after this date
            limit: Maximum number of filings to return

        Returns:
            List of SECFiling objects, ordered by filed_at descending
        """
        if form_types is None:
            form_types = ["10-K", "10-Q"]

        # Normalize CIK
        cik = cik.lstrip("0").zfill(10)

        try:
            # Fetch company submissions
            url = f"{SEC_DATA_URL}/submissions/CIK{cik}.json"
            logger.debug(f"Fetching filings from {url}")
            response = self._get(url)
            data = response.json()

            company_name = data.get("name", "Unknown")
            recent = data.get("filings", {}).get("recent", {})

            if not recent:
                logger.warning(f"No recent filings for CIK {cik}")
                return []

            # Parse filings
            filings = []
            accession_numbers = recent.get("accessionNumber", [])
            forms = recent.get("form", [])
            filing_dates = recent.get("filingDate", [])
            primary_docs = recent.get("primaryDocument", [])
            report_dates = recent.get("reportDate", [])
            accepted_dates = recent.get("acceptanceDateTime", [])

            # Iterate through ALL entries - companies file many form types (8-K, 4, etc.)
            # so 10-K/10-Q might be spread across hundreds of entries
            for i in range(len(accession_numbers)):
                form = forms[i] if i < len(forms) else ""
                accession = accession_numbers[i] if i < len(accession_numbers) else ""
                filed_at_str = filing_dates[i] if i < len(filing_dates) else ""
                primary_doc = primary_docs[i] if i < len(primary_docs) else ""
                report_date = report_dates[i] if i < len(report_dates) else None
                accepted_str = accepted_dates[i] if i < len(accepted_dates) else None

                # Parse dates first to check if we've gone past start_date
                try:
                    filed_at = datetime.strptime(filed_at_str, "%Y-%m-%d")
                except ValueError:
                    continue

                # Stop if we've gone past the start date (filings are in reverse chronological order)
                if start_date and filed_at < start_date:
                    break

                # Filter by form type
                if form not in form_types:
                    continue

                # Parse accepted datetime
                accepted_at = None
                if accepted_str:
                    try:
                        # Format: 2024-01-15T16:05:31.000Z
                        accepted_at = datetime.fromisoformat(
                            accepted_str.replace("Z", "+00:00").replace(".000", "")
                        )
                    except ValueError:
                        pass

                # Build URLs
                accession_nodash = accession.replace("-", "")
                filing_url = f"{SEC_ARCHIVES_URL}/{cik.lstrip('0')}/{accession_nodash}/{primary_doc}"
                index_url = f"{SEC_ARCHIVES_URL}/{cik.lstrip('0')}/{accession_nodash}/{accession}-index.html"

                filing = SECFiling(
                    cik=cik,
                    accession_number=accession,
                    form_type=form,
                    filed_at=filed_at,
                    accepted_at=accepted_at,
                    company_name=company_name,
                    primary_document=primary_doc,
                    filing_url=filing_url,
                    index_url=index_url,
                    period_of_report=report_date,
                )
                filings.append(filing)

                if len(filings) >= limit:
                    break

            # Sort by filed_at descending, then by accession number
            filings.sort(
                key=lambda f: (f.accepted_at or f.filed_at, f.accession_number),
                reverse=True,
            )

            logger.info(f"Found {len(filings)} filings for CIK {cik}")
            return filings[:limit]

        except Exception as e:
            logger.error(f"Error fetching filings for CIK {cik}: {e}")
            return []

    def get_latest_filings(
        self,
        cik: str,
        company_name: Optional[str] = None,
    ) -> Tuple[Optional[SECFiling], Optional[SECFiling]]:
        """
        Get the latest 10-K and 10-Q for a company.

        Args:
            cik: Company CIK
            company_name: Optional company name for logging

        Returns:
            Tuple of (latest_10k, latest_10q), either can be None
        """
        filings = self.get_company_filings(cik, form_types=["10-K", "10-Q"], limit=20)

        latest_10k = None
        latest_10q = None

        for filing in filings:
            if filing.form_type == "10-K" and latest_10k is None:
                latest_10k = filing
            elif filing.form_type == "10-Q" and latest_10q is None:
                latest_10q = filing

            if latest_10k and latest_10q:
                break

        name = company_name or cik
        if latest_10k:
            logger.debug(f"Latest 10-K for {name}: {latest_10k.filed_at.date()}")
        if latest_10q:
            logger.debug(f"Latest 10-Q for {name}: {latest_10q.filed_at.date()}")

        return latest_10k, latest_10q

    def get_filings_since(
        self,
        cik: str,
        since: datetime,
        form_types: Optional[List[str]] = None,
    ) -> List[SECFiling]:
        """
        Get all filings since a specific date.

        Args:
            cik: Company CIK
            since: Only return filings after this date
            form_types: Filter by form types

        Returns:
            List of filings since the given date
        """
        return self.get_company_filings(
            cik=cik,
            form_types=form_types,
            start_date=since,
            limit=50,
        )

    def get_backfill_filings(
        self,
        cik: str,
        years: int,
        form_types: Optional[List[str]] = None,
    ) -> List[SECFiling]:
        """
        Get filings for backfill (historical download).

        Args:
            cik: Company CIK
            years: Number of years to go back
            form_types: Filter by form types

        Returns:
            List of filings within the time window
        """
        start_date = datetime.now() - timedelta(days=years * 365)
        return self.get_company_filings(
            cik=cik,
            form_types=form_types,
            start_date=start_date,
            limit=years * 6,  # ~6 filings per year (1x10K + 4x10Q + buffer)
        )

    def download_filing_html(self, filing: SECFiling) -> Optional[str]:
        """
        Download the primary filing document as HTML.

        Args:
            filing: Filing to download

        Returns:
            HTML content or None on error
        """
        try:
            response = self._get(filing.filing_url)
            return response.text
        except Exception as e:
            logger.error(f"Error downloading {filing.filing_url}: {e}")
            return None

    def download_filing_json(self, filing: SECFiling) -> Optional[Dict]:
        """
        Download filing metadata as JSON.

        Args:
            filing: Filing to download

        Returns:
            Filing metadata dict or None on error
        """
        try:
            # Build the JSON URL for filing metadata
            cik = filing.cik.lstrip("0")
            accession = filing.accession_number.replace("-", "")
            url = f"{SEC_ARCHIVES_URL}/{cik}/{accession}/index.json"

            response = self._get(url)
            return response.json()
        except Exception as e:
            logger.error(f"Error downloading JSON for {filing.accession_number}: {e}")
            return None

    def to_filing_model(
        self,
        sec_filing: SECFiling,
        ticker: Optional[str] = None,
    ) -> Filing:
        """
        Convert SECFiling to our Filing model.

        Args:
            sec_filing: Raw SEC filing data
            ticker: Optional ticker to attach

        Returns:
            Filing model instance
        """
        return Filing(
            cik=sec_filing.cik,
            accession_number=sec_filing.accession_number,
            form_type=sec_filing.form_type,
            company_name=sec_filing.company_name,
            ticker=ticker,
            filed_at=sec_filing.filed_at,
            accepted_at=sec_filing.accepted_at,
            period_of_report=sec_filing.period_of_report,
            filing_url=sec_filing.filing_url,
            index_url=sec_filing.index_url,
            status=FilingStatus.DISCOVERED,
        )


def create_provider(config: Dict[str, Any]) -> SECProvider:
    """Create SEC provider from config."""
    return SECProvider(
        user_agent=config.get("user_agent", "SECWatcher/1.0 (research@example.com)"),
        timeout=config.get("timeout_sec", 30),
        retries=config.get("retries", 3),
        request_interval=config.get("request_interval", DEFAULT_REQUEST_INTERVAL),
    )
