"""
Data models for SEC Filings Watcher.

Defines the schemas for companies, filings, and state management.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
import json


class FilingStatus(str, Enum):
    """Status of a filing in the processing pipeline."""
    DISCOVERED = "discovered"      # Found but not yet processed
    DOWNLOADING = "downloading"    # Currently being downloaded
    DOWNLOADED = "downloaded"      # Files downloaded successfully
    PROCESSING = "processing"      # Being normalized/extracted
    READY = "ready"                # Fully processed and available
    FAILED = "failed"              # Processing failed


class FormType(str, Enum):
    """SEC form types we care about."""
    FORM_10K = "10-K"
    FORM_10Q = "10-Q"

    @classmethod
    def from_string(cls, value: str) -> Optional["FormType"]:
        """Parse form type from string, handling variations."""
        normalized = value.upper().strip()
        if normalized in ("10-K", "10K"):
            return cls.FORM_10K
        elif normalized in ("10-Q", "10Q"):
            return cls.FORM_10Q
        return None


@dataclass
class Filing:
    """
    Represents a single SEC filing.

    The unique identifier is (cik, accession_number).
    """
    cik: str                           # Central Index Key (e.g., "0000320193")
    accession_number: str              # Unique filing ID (e.g., "0000320193-24-000081")
    form_type: str                     # "10-K" or "10-Q"
    company_name: str                  # Company name from filing
    ticker: Optional[str]              # Stock ticker if known
    filed_at: datetime                 # Filing date
    accepted_at: Optional[datetime]    # SEC acceptance datetime
    period_of_report: Optional[str]    # Fiscal period end date

    # Processing state
    status: FilingStatus = FilingStatus.DISCOVERED
    discovered_at: datetime = field(default_factory=datetime.utcnow)
    processed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    retry_count: int = 0

    # File references
    filing_url: Optional[str] = None   # Primary filing document URL
    index_url: Optional[str] = None    # Filing index page URL

    # Artifact paths (relative to storage root)
    json_path: Optional[str] = None    # Path to downloaded JSON
    html_path: Optional[str] = None    # Path to downloaded HTML
    pdf_path: Optional[str] = None     # Path to downloaded PDF

    # AI/UI derivative paths
    manifest_path: Optional[str] = None    # Path to manifest.json
    sections_path: Optional[str] = None    # Path to section_index.json
    chunks_path: Optional[str] = None      # Path to chunks.jsonl
    text_path: Optional[str] = None        # Path to clean text file

    @property
    def key(self) -> str:
        """Unique key for this filing."""
        return f"{self.cik}:{self.accession_number}"

    @property
    def is_terminal(self) -> bool:
        """Whether this filing is in a terminal state."""
        return self.status in (FilingStatus.READY, FilingStatus.FAILED)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dictionary."""
        return {
            "cik": self.cik,
            "accession_number": self.accession_number,
            "form_type": self.form_type,
            "company_name": self.company_name,
            "ticker": self.ticker,
            "filed_at": self.filed_at.isoformat() if self.filed_at else None,
            "accepted_at": self.accepted_at.isoformat() if self.accepted_at else None,
            "period_of_report": self.period_of_report,
            "status": self.status.value,
            "discovered_at": self.discovered_at.isoformat() if self.discovered_at else None,
            "processed_at": self.processed_at.isoformat() if self.processed_at else None,
            "error_message": self.error_message,
            "retry_count": self.retry_count,
            "filing_url": self.filing_url,
            "index_url": self.index_url,
            "json_path": self.json_path,
            "html_path": self.html_path,
            "pdf_path": self.pdf_path,
            "manifest_path": self.manifest_path,
            "sections_path": self.sections_path,
            "chunks_path": self.chunks_path,
            "text_path": self.text_path,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Filing":
        """Create Filing from dictionary."""
        return cls(
            cik=data["cik"],
            accession_number=data["accession_number"],
            form_type=data["form_type"],
            company_name=data["company_name"],
            ticker=data.get("ticker"),
            filed_at=datetime.fromisoformat(data["filed_at"]) if data.get("filed_at") else datetime.utcnow(),
            accepted_at=datetime.fromisoformat(data["accepted_at"]) if data.get("accepted_at") else None,
            period_of_report=data.get("period_of_report"),
            status=FilingStatus(data.get("status", "discovered")),
            discovered_at=datetime.fromisoformat(data["discovered_at"]) if data.get("discovered_at") else datetime.utcnow(),
            processed_at=datetime.fromisoformat(data["processed_at"]) if data.get("processed_at") else None,
            error_message=data.get("error_message"),
            retry_count=data.get("retry_count", 0),
            filing_url=data.get("filing_url"),
            index_url=data.get("index_url"),
            json_path=data.get("json_path"),
            html_path=data.get("html_path"),
            pdf_path=data.get("pdf_path"),
            manifest_path=data.get("manifest_path"),
            sections_path=data.get("sections_path"),
            chunks_path=data.get("chunks_path"),
            text_path=data.get("text_path"),
        )


@dataclass
class Company:
    """
    Represents a company in the watchlist.

    Tracks the last sync state for incremental updates.
    """
    ticker: str                        # Stock ticker (primary identifier)
    cik: Optional[str] = None          # SEC Central Index Key
    name: Optional[str] = None         # Company name

    # Sync checkpoint
    last_sync_at: Optional[datetime] = None
    last_seen_filed_at: Optional[datetime] = None      # Most recent filing date seen
    last_seen_accession: Optional[str] = None          # Most recent accession number

    # Backfill tracking
    backfill_completed_years: Optional[int] = None     # Number of years backfilled
    backfill_completed_at: Optional[datetime] = None   # When backfill was completed

    # Metadata
    added_at: datetime = field(default_factory=datetime.utcnow)
    enabled: bool = True

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dictionary."""
        return {
            "ticker": self.ticker,
            "cik": self.cik,
            "name": self.name,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "last_seen_filed_at": self.last_seen_filed_at.isoformat() if self.last_seen_filed_at else None,
            "last_seen_accession": self.last_seen_accession,
            "backfill_completed_years": self.backfill_completed_years,
            "backfill_completed_at": self.backfill_completed_at.isoformat() if self.backfill_completed_at else None,
            "added_at": self.added_at.isoformat() if self.added_at else None,
            "enabled": self.enabled,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Company":
        """Create Company from dictionary."""
        return cls(
            ticker=data["ticker"],
            cik=data.get("cik"),
            name=data.get("name"),
            last_sync_at=datetime.fromisoformat(data["last_sync_at"]) if data.get("last_sync_at") else None,
            last_seen_filed_at=datetime.fromisoformat(data["last_seen_filed_at"]) if data.get("last_seen_filed_at") else None,
            last_seen_accession=data.get("last_seen_accession"),
            backfill_completed_years=data.get("backfill_completed_years"),
            backfill_completed_at=datetime.fromisoformat(data["backfill_completed_at"]) if data.get("backfill_completed_at") else None,
            added_at=datetime.fromisoformat(data["added_at"]) if data.get("added_at") else datetime.utcnow(),
            enabled=data.get("enabled", True),
        )


@dataclass
class Watchlist:
    """Collection of companies to monitor."""
    companies: List[Company] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def get_enabled(self) -> List[Company]:
        """Get all enabled companies."""
        return [c for c in self.companies if c.enabled]

    def get_by_ticker(self, ticker: str) -> Optional[Company]:
        """Find company by ticker."""
        ticker = ticker.upper()
        for c in self.companies:
            if c.ticker.upper() == ticker:
                return c
        return None

    def add_company(self, company: Company) -> None:
        """Add a company to the watchlist."""
        existing = self.get_by_ticker(company.ticker)
        if existing:
            # Update existing
            idx = self.companies.index(existing)
            self.companies[idx] = company
        else:
            self.companies.append(company)
        self.updated_at = datetime.utcnow()

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dictionary."""
        return {
            "companies": [c.to_dict() for c in self.companies],
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Watchlist":
        """Create Watchlist from dictionary."""
        return cls(
            companies=[Company.from_dict(c) for c in data.get("companies", [])],
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.utcnow(),
            updated_at=datetime.fromisoformat(data["updated_at"]) if data.get("updated_at") else datetime.utcnow(),
        )

    @classmethod
    def from_tickers(cls, tickers: List[str]) -> "Watchlist":
        """Create watchlist from list of ticker symbols."""
        return cls(
            companies=[Company(ticker=t.upper().strip()) for t in tickers if t.strip()]
        )


@dataclass
class JobRun:
    """Record of a job execution."""
    run_id: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    mode: str = "default"  # "default" or "backfill"
    backfill_years: Optional[int] = None

    # Metrics
    companies_processed: int = 0
    filings_discovered: int = 0
    filings_downloaded: int = 0
    filings_failed: int = 0

    # Status
    success: bool = False
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dictionary."""
        return {
            "run_id": self.run_id,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "mode": self.mode,
            "backfill_years": self.backfill_years,
            "companies_processed": self.companies_processed,
            "filings_discovered": self.filings_discovered,
            "filings_downloaded": self.filings_downloaded,
            "filings_failed": self.filings_failed,
            "success": self.success,
            "error_message": self.error_message,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "JobRun":
        """Create JobRun from dictionary."""
        return cls(
            run_id=data["run_id"],
            started_at=datetime.fromisoformat(data["started_at"]),
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None,
            mode=data.get("mode", "default"),
            backfill_years=data.get("backfill_years"),
            companies_processed=data.get("companies_processed", 0),
            filings_discovered=data.get("filings_discovered", 0),
            filings_downloaded=data.get("filings_downloaded", 0),
            filings_failed=data.get("filings_failed", 0),
            success=data.get("success", False),
            error_message=data.get("error_message"),
        )
