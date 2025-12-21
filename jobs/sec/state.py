"""
State management for SEC Filings Watcher.

Handles persistent storage of:
- Company watchlist with sync checkpoints
- Filing registry (discovered, processing, completed)
- Job run history

Supports both local JSON files and GCS for cloud deployment.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
import uuid
import fcntl

from models import Company, Filing, FilingStatus, Watchlist, JobRun


logger = logging.getLogger(__name__)


class StateStore(ABC):
    """Abstract base class for state persistence."""

    @abstractmethod
    def load_watchlist(self) -> Watchlist:
        """Load the company watchlist."""
        pass

    @abstractmethod
    def save_watchlist(self, watchlist: Watchlist) -> None:
        """Save the company watchlist."""
        pass

    @abstractmethod
    def get_filing(self, cik: str, accession_number: str) -> Optional[Filing]:
        """Get a filing by its unique key."""
        pass

    @abstractmethod
    def upsert_filing(self, filing: Filing) -> None:
        """Insert or update a filing."""
        pass

    @abstractmethod
    def get_filings_by_status(self, status: FilingStatus) -> List[Filing]:
        """Get all filings with a specific status."""
        pass

    @abstractmethod
    def get_filings_for_company(self, cik: str) -> List[Filing]:
        """Get all filings for a company."""
        pass

    @abstractmethod
    def save_job_run(self, run: JobRun) -> None:
        """Save a job run record."""
        pass

    @abstractmethod
    def get_last_job_run(self) -> Optional[JobRun]:
        """Get the most recent job run."""
        pass


class LocalStateStore(StateStore):
    """
    JSON-based local state storage.

    Directory structure:
    state_dir/
    ├── watchlist.json          # Company watchlist
    ├── filings/
    │   ├── index.json          # Filing index (key -> minimal info + file_path)
    │   └── {ticker}/
    │       └── {ticker}-{form_type}-{filed_date}.json
    └── runs/
        └── {run_id}.json
    """

    def __init__(self, state_dir: str | Path):
        self.state_dir = Path(state_dir)
        self._ensure_dirs()
        self._filing_cache: Dict[str, Filing] = {}

    def _ensure_dirs(self) -> None:
        """Create required directories."""
        self.state_dir.mkdir(parents=True, exist_ok=True)
        (self.state_dir / "filings").mkdir(exist_ok=True)
        (self.state_dir / "runs").mkdir(exist_ok=True)

    def _watchlist_path(self) -> Path:
        return self.state_dir / "watchlist.json"

    def _filing_index_path(self) -> Path:
        return self.state_dir / "filings" / "index.json"

    def _filing_basename(self, filing: Filing) -> str:
        """
        Generate base filename for a filing state.
        Format: {TICKER}-{FORM_TYPE}-{FILED_DATE}
        Example: AAPL-10-K-2025-01-31
        """
        ticker = (filing.ticker or filing.cik).upper()
        form_type = filing.form_type.replace("/", "-")
        filed_date = filing.filed_at.strftime("%Y-%m-%d") if filing.filed_at else "unknown"
        return f"{ticker}-{form_type}-{filed_date}"

    def _ticker_dir(self, filing: Filing) -> Path:
        """Get directory for a ticker (e.g., state/filings/AAPL/)."""
        ticker = (filing.ticker or filing.cik).upper()
        dir_path = self.state_dir / "filings" / ticker
        dir_path.mkdir(parents=True, exist_ok=True)
        return dir_path

    def _filing_path_from_filing(self, filing: Filing) -> Path:
        """Build filing state file path from Filing object."""
        ticker_dir = self._ticker_dir(filing)
        basename = self._filing_basename(filing)
        return ticker_dir / f"{basename}.json"

    def _filing_path_from_index(self, cik: str, accession: str) -> Optional[Path]:
        """Look up filing path from index."""
        index = self._load_filing_index()
        key = f"{cik}:{accession}"
        if key in index and "file_path" in index[key]:
            return self.state_dir / "filings" / index[key]["file_path"]
        return None

    def _run_path(self, run_id: str) -> Path:
        return self.state_dir / "runs" / f"{run_id}.json"

    def _read_json(self, path: Path) -> Optional[Dict]:
        """Read JSON file with file locking."""
        if not path.exists():
            return None
        try:
            with open(path, "r") as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_SH)
                try:
                    return json.load(f)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in {path}: {e}")
            return None

    def _write_json(self, path: Path, data: Dict) -> None:
        """Write JSON file atomically with file locking."""
        # Use unique temp file to avoid race conditions with concurrent writes
        tmp_path = path.with_suffix(f".tmp.{uuid.uuid4().hex[:8]}")
        try:
            with open(tmp_path, "w") as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    json.dump(data, f, indent=2, default=str)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            shutil.move(str(tmp_path), str(path))
        except Exception as e:
            if tmp_path.exists():
                tmp_path.unlink()
            raise

    def load_watchlist(self) -> Watchlist:
        """Load the company watchlist."""
        data = self._read_json(self._watchlist_path())
        if data:
            return Watchlist.from_dict(data)
        return Watchlist()

    def save_watchlist(self, watchlist: Watchlist) -> None:
        """Save the company watchlist."""
        self._write_json(self._watchlist_path(), watchlist.to_dict())
        logger.debug(f"Saved watchlist with {len(watchlist.companies)} companies")

    def _load_filing_index(self) -> Dict[str, Dict[str, str]]:
        """Load the filing index (key -> {cik, accession, status})."""
        data = self._read_json(self._filing_index_path())
        return data or {}

    def _save_filing_index(self, index: Dict[str, Dict[str, str]]) -> None:
        """Save the filing index."""
        self._write_json(self._filing_index_path(), index)

    def get_filing(self, cik: str, accession_number: str) -> Optional[Filing]:
        """Get a filing by its unique key."""
        key = f"{cik}:{accession_number}"

        # Check cache first
        if key in self._filing_cache:
            return self._filing_cache[key]

        # Look up path from index
        path = self._filing_path_from_index(cik, accession_number)
        if path and path.exists():
            data = self._read_json(path)
            if data:
                filing = Filing.from_dict(data)
                self._filing_cache[key] = filing
                return filing
        return None

    def upsert_filing(self, filing: Filing) -> None:
        """Insert or update a filing."""
        key = filing.key
        path = self._filing_path_from_filing(filing)

        # Get relative path for index storage
        relative_path = path.relative_to(self.state_dir / "filings")

        # Write filing data
        self._write_json(path, filing.to_dict())

        # Update index with file_path for lookup
        index = self._load_filing_index()
        index[key] = {
            "cik": filing.cik,
            "accession": filing.accession_number,
            "ticker": filing.ticker,
            "status": filing.status.value,
            "form_type": filing.form_type,
            "filed_at": filing.filed_at.isoformat() if filing.filed_at else None,
            "file_path": str(relative_path),  # Store path for lookup
        }
        self._save_filing_index(index)

        # Update cache
        self._filing_cache[key] = filing

        logger.debug(f"Upserted filing {key} with status {filing.status.value}")

    def get_filings_by_status(self, status: FilingStatus) -> List[Filing]:
        """Get all filings with a specific status."""
        index = self._load_filing_index()
        filings = []

        for key, info in index.items():
            if info.get("status") == status.value:
                cik = info["cik"]
                accession = info["accession"]
                filing = self.get_filing(cik, accession)
                if filing:
                    filings.append(filing)

        return filings

    def get_filings_for_company(self, cik: str) -> List[Filing]:
        """Get all filings for a company."""
        index = self._load_filing_index()
        filings = []

        for key, info in index.items():
            if info.get("cik") == cik:
                filing = self.get_filing(cik, info["accession"])
                if filing:
                    filings.append(filing)

        return filings

    def filing_exists(self, cik: str, accession_number: str) -> bool:
        """Check if a filing already exists in state."""
        index = self._load_filing_index()
        key = f"{cik}:{accession_number}"
        return key in index

    def save_job_run(self, run: JobRun) -> None:
        """Save a job run record."""
        path = self._run_path(run.run_id)
        self._write_json(path, run.to_dict())
        logger.debug(f"Saved job run {run.run_id}")

    def get_last_job_run(self) -> Optional[JobRun]:
        """Get the most recent job run."""
        runs_dir = self.state_dir / "runs"
        if not runs_dir.exists():
            return None

        run_files = sorted(runs_dir.glob("*.json"), reverse=True)
        if not run_files:
            return None

        # Find most recent by started_at
        latest_run = None
        latest_time = None

        for run_file in run_files[:20]:  # Check last 20 runs
            data = self._read_json(run_file)
            if data:
                run = JobRun.from_dict(data)
                # Normalize to naive datetime for comparison
                run_time = run.started_at.replace(tzinfo=None) if run.started_at.tzinfo else run.started_at
                if latest_time is None or run_time > latest_time:
                    latest_run = run
                    latest_time = run_time

        return latest_run

    def get_discovered_filings(self) -> List[Filing]:
        """Get all filings ready to be processed."""
        return self.get_filings_by_status(FilingStatus.DISCOVERED)

    def claim_filing(self, filing: Filing) -> bool:
        """
        Atomically claim a filing for processing.

        Returns True if successfully claimed, False if already claimed.
        """
        current = self.get_filing(filing.cik, filing.accession_number)
        if current and current.status != FilingStatus.DISCOVERED:
            return False

        filing.status = FilingStatus.DOWNLOADING
        self.upsert_filing(filing)
        return True


class GCSStateStore(StateStore):
    """
    Google Cloud Storage based state storage.

    Uses the same JSON structure as LocalStateStore but stores in GCS.
    Directory structure mirrors local: filings/{ticker}/{ticker}-{form_type}-{filed_date}.json
    """

    def __init__(self, bucket_name: str, prefix: str = "sec-state"):
        try:
            from google.cloud import storage
        except ImportError:
            raise ImportError(
                "google-cloud-storage is required for GCS support. "
                "Install with: pip install google-cloud-storage"
            )

        self.bucket_name = bucket_name
        self.prefix = prefix.rstrip("/")
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket_name)
        self._filing_cache: Dict[str, Filing] = {}

    def _blob_path(self, *parts: str) -> str:
        """Build GCS blob path."""
        return f"{self.prefix}/{'/'.join(parts)}"

    def _filing_basename(self, filing: Filing) -> str:
        """Generate base filename for a filing state."""
        ticker = (filing.ticker or filing.cik).upper()
        form_type = filing.form_type.replace("/", "-")
        filed_date = filing.filed_at.strftime("%Y-%m-%d") if filing.filed_at else "unknown"
        return f"{ticker}-{form_type}-{filed_date}"

    def _filing_blob_path(self, filing: Filing) -> str:
        """Build filing blob path from Filing object."""
        ticker = (filing.ticker or filing.cik).upper()
        basename = self._filing_basename(filing)
        return self._blob_path("filings", ticker, f"{basename}.json")

    def _read_json(self, blob_path: str) -> Optional[Dict]:
        """Read JSON from GCS."""
        blob = self.bucket.blob(blob_path)
        if not blob.exists():
            return None
        try:
            content = blob.download_as_text()
            return json.loads(content)
        except Exception as e:
            logger.error(f"Error reading {blob_path}: {e}")
            return None

    def _write_json(self, blob_path: str, data: Dict) -> None:
        """Write JSON to GCS."""
        blob = self.bucket.blob(blob_path)
        content = json.dumps(data, indent=2, default=str)
        blob.upload_from_string(content, content_type="application/json")

    def load_watchlist(self) -> Watchlist:
        """Load the company watchlist."""
        data = self._read_json(self._blob_path("watchlist.json"))
        if data:
            return Watchlist.from_dict(data)
        return Watchlist()

    def save_watchlist(self, watchlist: Watchlist) -> None:
        """Save the company watchlist."""
        self._write_json(self._blob_path("watchlist.json"), watchlist.to_dict())

    def get_filing(self, cik: str, accession_number: str) -> Optional[Filing]:
        """Get a filing by its unique key."""
        key = f"{cik}:{accession_number}"
        if key in self._filing_cache:
            return self._filing_cache[key]

        # Look up path from index
        index = self._read_json(self._blob_path("filings", "index.json")) or {}
        if key in index and "file_path" in index[key]:
            blob_path = self._blob_path("filings", index[key]["file_path"])
            data = self._read_json(blob_path)
            if data:
                filing = Filing.from_dict(data)
                self._filing_cache[key] = filing
                return filing
        return None

    def upsert_filing(self, filing: Filing) -> None:
        """Insert or update a filing."""
        blob_path = self._filing_blob_path(filing)
        self._write_json(blob_path, filing.to_dict())

        # Get relative path for index storage (remove prefix)
        relative_path = blob_path.replace(f"{self.prefix}/filings/", "")

        # Update index with file_path for lookup
        index = self._read_json(self._blob_path("filings", "index.json")) or {}
        key = filing.key
        index[key] = {
            "cik": filing.cik,
            "accession": filing.accession_number,
            "ticker": filing.ticker,
            "status": filing.status.value,
            "form_type": filing.form_type,
            "filed_at": filing.filed_at.isoformat() if filing.filed_at else None,
            "file_path": relative_path,  # Store path for lookup
        }
        self._write_json(self._blob_path("filings", "index.json"), index)

        self._filing_cache[filing.key] = filing

    def get_filings_by_status(self, status: FilingStatus) -> List[Filing]:
        """Get all filings with a specific status."""
        index = self._read_json(self._blob_path("filings", "index.json")) or {}
        filings = []

        for key, info in index.items():
            if info.get("status") == status.value:
                filing = self.get_filing(info["cik"], info["accession"])
                if filing:
                    filings.append(filing)

        return filings

    def get_filings_for_company(self, cik: str) -> List[Filing]:
        """Get all filings for a company."""
        index = self._read_json(self._blob_path("filings", "index.json")) or {}
        filings = []

        for key, info in index.items():
            if info.get("cik") == cik:
                filing = self.get_filing(cik, info["accession"])
                if filing:
                    filings.append(filing)

        return filings

    def save_job_run(self, run: JobRun) -> None:
        """Save a job run record."""
        self._write_json(self._blob_path("runs", f"{run.run_id}.json"), run.to_dict())

    def get_last_job_run(self) -> Optional[JobRun]:
        """Get the most recent job run."""
        prefix = self._blob_path("runs") + "/"
        blobs = list(self.bucket.list_blobs(prefix=prefix, max_results=50))

        if not blobs:
            return None

        latest_run = None
        latest_time = None

        for blob in blobs:
            if not blob.name.endswith(".json"):
                continue
            data = self._read_json(blob.name.replace(f"{self.bucket_name}/", ""))
            if data:
                run = JobRun.from_dict(data)
                if latest_time is None or run.started_at > latest_time:
                    latest_run = run
                    latest_time = run.started_at

        return latest_run


def create_state_store(config: Dict[str, Any]) -> StateStore:
    """
    Factory function to create appropriate state store.

    Config options:
        storage_type: "local" or "gcs"
        state_dir: Path for local storage
        gcs_bucket: Bucket name for GCS
        gcs_prefix: Prefix within bucket
    """
    storage_type = config.get("storage_type", "local")

    if storage_type == "gcs":
        bucket = config.get("gcs_bucket")
        if not bucket:
            raise ValueError("gcs_bucket is required for GCS storage")
        prefix = config.get("gcs_prefix", "sec-state")
        return GCSStateStore(bucket, prefix)
    else:
        state_dir = config.get("state_dir", "./state")
        return LocalStateStore(state_dir)
