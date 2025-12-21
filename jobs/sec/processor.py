"""
Filing processor for SEC Filings Watcher.

Handles:
- Downloading filing documents (HTML, JSON)
- Parsing to extract sections and generate AI/UI derivatives:
  - manifest.json (small, for UI + Copilot context)
  - section_index.json (per-section details)
  - chunks.jsonl (RAG-ready text chunks)
- Converting HTML to PDF (optional, requires wkhtmltopdf or sec-api.io)
- Processing discovered filings
- Concurrent download with rate limiting
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from models import Filing, FilingStatus
from provider import SECProvider, SECFiling
from state import StateStore
from storage import FileStorage
from parser import parse_filing, write_derivatives


logger = logging.getLogger(__name__)


@dataclass
class ProcessingResult:
    """Result of processing a single filing."""
    filing: Filing
    success: bool
    error: Optional[str] = None
    json_downloaded: bool = False
    html_downloaded: bool = False
    pdf_downloaded: bool = False
    derivatives_generated: bool = False
    section_count: int = 0
    chunk_count: int = 0


@dataclass
class ProcessingSummary:
    """Summary of a processing batch."""
    total: int
    succeeded: int
    failed: int
    skipped: int
    errors: List[str]


class PDFRenderer:
    """
    Renders filing HTML to PDF.

    Can use:
    1. sec-api.io Render API (paid, high quality)
    2. wkhtmltopdf (local, free)
    3. Skip PDF (just download HTML)
    """

    def __init__(
        self,
        method: str = "skip",  # "sec-api", "wkhtmltopdf", "skip"
        sec_api_key: Optional[str] = None,
        user_agent: str = "SECWatcher/1.0",
    ):
        self.method = method
        self.sec_api_key = sec_api_key
        self.user_agent = user_agent

        if method == "sec-api" and not sec_api_key:
            raise ValueError("sec_api_key required for sec-api rendering")

        if method == "sec-api":
            self.session = self._create_session()

    def _create_session(self) -> requests.Session:
        """Create session for sec-api.io requests."""
        session = requests.Session()
        retry = Retry(total=3, backoff_factor=1.0, status_forcelist=[429, 500, 502, 503, 504])
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        session.headers.update({
            "User-Agent": self.user_agent,
            "Authorization": self.sec_api_key,
        })
        return session

    def render(self, filing_url: str) -> Optional[bytes]:
        """
        Render filing URL to PDF.

        Args:
            filing_url: URL to the filing document

        Returns:
            PDF bytes or None if rendering is disabled/failed
        """
        if self.method == "skip":
            return None

        if self.method == "sec-api":
            return self._render_sec_api(filing_url)

        if self.method == "wkhtmltopdf":
            return self._render_wkhtmltopdf(filing_url)

        return None

    def _render_sec_api(self, filing_url: str) -> Optional[bytes]:
        """Render using sec-api.io Render API."""
        try:
            url = "https://api.sec-api.io/filing-reader"
            params = {
                "url": filing_url,
                "token": self.sec_api_key,
                "type": "pdf",
            }
            response = self.session.get(url, params=params, timeout=60)
            response.raise_for_status()

            content = response.content
            if len(content) < 100 or not content.startswith(b"%PDF"):
                logger.warning("Invalid PDF response from sec-api.io")
                return None

            return content
        except Exception as e:
            logger.error(f"sec-api.io PDF render failed: {e}")
            return None

    def _render_wkhtmltopdf(self, filing_url: str) -> Optional[bytes]:
        """Render using local wkhtmltopdf."""
        try:
            import subprocess
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
                tmp_path = f.name

            cmd = [
                "wkhtmltopdf",
                "--quiet",
                "--no-stop-slow-scripts",
                "--javascript-delay", "5000",
                filing_url,
                tmp_path,
            ]

            result = subprocess.run(cmd, capture_output=True, timeout=120)
            if result.returncode != 0:
                logger.warning(f"wkhtmltopdf failed: {result.stderr.decode()}")
                return None

            with open(tmp_path, "rb") as f:
                return f.read()

        except FileNotFoundError:
            logger.warning("wkhtmltopdf not installed")
            return None
        except Exception as e:
            logger.error(f"wkhtmltopdf render failed: {e}")
            return None


class FilingProcessor:
    """
    Processes discovered filings.

    Workflow:
    1. Claim filing (set status to DOWNLOADING)
    2. Download JSON metadata
    3. Download HTML content
    4. Parse and generate AI/UI derivatives (manifest, sections, chunks)
    5. Optionally render to PDF
    6. Update status to READY or FAILED
    """

    def __init__(
        self,
        state: StateStore,
        storage: FileStorage,
        provider: SECProvider,
        pdf_renderer: Optional[PDFRenderer] = None,
        max_workers: int = 4,
        max_retries: int = 3,
        generate_derivatives: bool = True,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
    ):
        self.state = state
        self.storage = storage
        self.provider = provider
        self.pdf_renderer = pdf_renderer or PDFRenderer(method="skip")
        self.max_workers = max_workers
        self.max_retries = max_retries
        self.generate_derivatives = generate_derivatives
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def process_filing(self, filing: Filing) -> ProcessingResult:
        """
        Process a single filing.

        Args:
            filing: Filing to process

        Returns:
            ProcessingResult with success/failure details
        """
        result = ProcessingResult(filing=filing, success=False)

        try:
            # Download JSON metadata
            json_data = self.provider.download_filing_json(
                SECFiling(
                    cik=filing.cik,
                    accession_number=filing.accession_number,
                    form_type=filing.form_type,
                    filed_at=filing.filed_at,
                    accepted_at=filing.accepted_at,
                    company_name=filing.company_name,
                    primary_document="",
                    filing_url=filing.filing_url or "",
                    index_url=filing.index_url or "",
                )
            )

            if json_data:
                filing.json_path = self.storage.save_json(filing, json_data)
                result.json_downloaded = True
                logger.debug(f"Downloaded JSON for {filing.key}")

            # Download HTML content
            html_content = self.provider.download_filing_html(
                SECFiling(
                    cik=filing.cik,
                    accession_number=filing.accession_number,
                    form_type=filing.form_type,
                    filed_at=filing.filed_at,
                    accepted_at=filing.accepted_at,
                    company_name=filing.company_name,
                    primary_document="",
                    filing_url=filing.filing_url or "",
                    index_url=filing.index_url or "",
                )
            )

            if html_content:
                filing.html_path = self.storage.save_html(filing, html_content)
                result.html_downloaded = True
                logger.debug(f"Downloaded HTML for {filing.key}")

                # Parse and generate AI/UI derivatives
                if self.generate_derivatives:
                    try:
                        parsed = parse_filing(
                            html_content=html_content,
                            filing_id=filing.accession_number,
                            cik=filing.cik,
                            ticker=filing.ticker or "",
                            company_name=filing.company_name,
                            form_type=filing.form_type,
                            filed_at=filing.filed_at.strftime("%Y-%m-%d") if filing.filed_at else "",
                            report_period=filing.period_of_report,
                            chunk_size=self.chunk_size,
                            chunk_overlap=self.chunk_overlap,
                        )

                        # Write derivative files
                        output_dir = self.storage.get_filing_dir(filing)
                        base_name = self.storage.get_filing_basename(filing)
                        derivative_paths = write_derivatives(parsed, output_dir, base_name)

                        # Update filing with derivative paths
                        filing.manifest_path = str(derivative_paths.get("manifest", ""))
                        filing.sections_path = str(derivative_paths.get("section_index", ""))
                        filing.chunks_path = str(derivative_paths.get("chunks", ""))

                        result.derivatives_generated = True
                        result.section_count = len(parsed.sections)
                        result.chunk_count = len(parsed.chunks)
                        logger.debug(
                            f"Generated derivatives for {filing.key}: "
                            f"{result.section_count} sections, {result.chunk_count} chunks"
                        )
                    except Exception as e:
                        logger.warning(f"Failed to generate derivatives for {filing.key}: {e}")
                        # Don't fail the whole processing for derivative errors

            # Render PDF if enabled
            if self.pdf_renderer.method != "skip" and filing.filing_url:
                pdf_content = self.pdf_renderer.render(filing.filing_url)
                if pdf_content:
                    filing.pdf_path = self.storage.save_pdf(filing, pdf_content)
                    result.pdf_downloaded = True
                    logger.debug(f"Rendered PDF for {filing.key}")

            # Mark as ready if we got at least the HTML
            if result.html_downloaded or result.json_downloaded:
                filing.status = FilingStatus.READY
                filing.processed_at = datetime.utcnow()
                result.success = True
                logger.info(f"✓ Processed {filing.key} ({filing.form_type})")
            else:
                filing.status = FilingStatus.FAILED
                filing.error_message = "No content downloaded"
                result.error = "No content downloaded"
                logger.warning(f"✗ No content for {filing.key}")

        except Exception as e:
            filing.status = FilingStatus.FAILED
            filing.error_message = str(e)
            filing.retry_count += 1
            result.error = str(e)
            logger.error(f"✗ Failed to process {filing.key}: {e}")

        # Save updated filing state
        self.state.upsert_filing(filing)

        return result

    def process_discovered(
        self,
        limit: Optional[int] = None,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> ProcessingSummary:
        """
        Process all discovered filings.

        Args:
            limit: Maximum number of filings to process
            progress_callback: Called with (completed, total) after each filing

        Returns:
            ProcessingSummary with statistics
        """
        discovered = self.state.get_filings_by_status(FilingStatus.DISCOVERED)

        if limit:
            discovered = discovered[:limit]

        if not discovered:
            logger.info("No discovered filings to process")
            return ProcessingSummary(
                total=0, succeeded=0, failed=0, skipped=0, errors=[]
            )

        logger.info(f"Processing {len(discovered)} discovered filings")

        results: List[ProcessingResult] = []
        completed = 0

        # Process with thread pool
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Claim and submit filings
            futures = {}
            for filing in discovered:
                # Try to claim the filing
                if hasattr(self.state, 'claim_filing'):
                    if not self.state.claim_filing(filing):
                        logger.debug(f"Filing {filing.key} already claimed")
                        continue
                else:
                    filing.status = FilingStatus.DOWNLOADING
                    self.state.upsert_filing(filing)

                future = executor.submit(self.process_filing, filing)
                futures[future] = filing

            # Process results as they complete
            for future in as_completed(futures):
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    filing = futures[future]
                    logger.error(f"Unexpected error processing {filing.key}: {e}")
                    results.append(ProcessingResult(
                        filing=filing, success=False, error=str(e)
                    ))

                completed += 1
                if progress_callback:
                    progress_callback(completed, len(discovered))

        # Build summary
        succeeded = sum(1 for r in results if r.success)
        failed = sum(1 for r in results if not r.success)
        errors = [r.error for r in results if r.error]

        summary = ProcessingSummary(
            total=len(discovered),
            succeeded=succeeded,
            failed=failed,
            skipped=len(discovered) - len(results),
            errors=errors[:10],  # Limit error messages
        )

        logger.info(
            f"Processing complete: {succeeded} succeeded, {failed} failed, "
            f"{summary.skipped} skipped"
        )

        return summary


def create_processor(
    state: StateStore,
    storage: FileStorage,
    provider: SECProvider,
    config: Dict[str, Any],
) -> FilingProcessor:
    """Create filing processor from config."""
    # Configure PDF renderer
    pdf_method = config.get("pdf_renderer", "skip")
    sec_api_key = config.get("SEC_API_KEY")

    if pdf_method == "sec-api" and not sec_api_key:
        logger.warning("SEC_API_KEY not provided, disabling PDF rendering")
        pdf_method = "skip"

    pdf_renderer = PDFRenderer(
        method=pdf_method,
        sec_api_key=sec_api_key,
        user_agent=config.get("user_agent", "SECWatcher/1.0"),
    )

    return FilingProcessor(
        state=state,
        storage=storage,
        provider=provider,
        pdf_renderer=pdf_renderer,
        max_workers=config.get("concurrency", 4),
        max_retries=config.get("retries", 3),
        generate_derivatives=config.get("generate_derivatives", True),
        chunk_size=config.get("chunk_size", 1000),
        chunk_overlap=config.get("chunk_overlap", 200),
    )
