"""
File storage abstraction for SEC Filings.

Handles storing downloaded artifacts (JSON, PDF, HTML) and AI/UI derivatives:
- Local filesystem
- Google Cloud Storage (GCS)

Directory structure:
data_dir/
├── {TICKER}/
│   ├── {TICKER}-10-K-2025-10-31.html       # Raw filing HTML
│   ├── {TICKER}-10-K-2025-10-31.json       # Filing metadata
│   ├── {TICKER}-10-K-2025-10-31.pdf        # Optional PDF render
│   ├── {TICKER}-10-K-2025-10-31.txt        # Clean text
│   ├── {TICKER}-10-K-2025-10-31-manifest.json    # UI/Copilot manifest
│   ├── {TICKER}-10-K-2025-10-31-sections.json    # Section index
│   ├── {TICKER}-10-K-2025-10-31-chunks.jsonl     # RAG chunks
│   └── ...
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, Dict, Any, BinaryIO, Union

from models import Filing


logger = logging.getLogger(__name__)


class FileStorage(ABC):
    """Abstract base class for file storage."""

    @abstractmethod
    def save_json(self, filing: Filing, data: Dict) -> str:
        """
        Save JSON data for a filing.

        Args:
            filing: Filing metadata
            data: JSON data to save

        Returns:
            Relative path where data was saved
        """
        pass

    @abstractmethod
    def save_html(self, filing: Filing, content: str) -> str:
        """
        Save HTML content for a filing.

        Args:
            filing: Filing metadata
            content: HTML content

        Returns:
            Relative path where content was saved
        """
        pass

    @abstractmethod
    def save_pdf(self, filing: Filing, content: bytes) -> str:
        """
        Save PDF content for a filing.

        Args:
            filing: Filing metadata
            content: PDF bytes

        Returns:
            Relative path where content was saved
        """
        pass

    @abstractmethod
    def load_json(self, path: str) -> Optional[Dict]:
        """Load JSON from path."""
        pass

    @abstractmethod
    def load_html(self, path: str) -> Optional[str]:
        """Load HTML from path."""
        pass

    @abstractmethod
    def load_pdf(self, path: str) -> Optional[bytes]:
        """Load PDF from path."""
        pass

    @abstractmethod
    def exists(self, path: str) -> bool:
        """Check if file exists."""
        pass

    @abstractmethod
    def delete(self, path: str) -> bool:
        """Delete a file."""
        pass

    @abstractmethod
    def get_filing_dir(self, filing: Filing) -> Path:
        """Get the directory for a filing (for writing derivatives)."""
        pass

    @abstractmethod
    def get_filing_basename(self, filing: Filing) -> str:
        """Get the base filename for a filing (without extension)."""
        pass


class LocalStorage(FileStorage):
    """Local filesystem storage."""

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _ticker_dir(self, filing: Filing) -> Path:
        """Get directory for a ticker (e.g., data/AAPL/)."""
        ticker = (filing.ticker or filing.cik).upper()
        dir_path = self.data_dir / ticker
        dir_path.mkdir(parents=True, exist_ok=True)
        return dir_path

    def _filing_basename(self, filing: Filing) -> str:
        """
        Generate base filename for a filing.

        Format: {TICKER}-{FORM_TYPE}-{FILED_DATE}
        Example: AAPL-10-K-2025-10-31
        """
        ticker = (filing.ticker or filing.cik).upper()
        form_type = filing.form_type.replace("/", "-")  # Handle 10-K/A etc.
        filed_date = filing.filed_at.strftime("%Y-%m-%d")
        return f"{ticker}-{form_type}-{filed_date}"

    def _resolve_path(self, path: str) -> Path:
        """Resolve relative path to absolute."""
        return self.data_dir / path

    def save_json(self, filing: Filing, data: Dict) -> str:
        """Save JSON data for a filing."""
        dir_path = self._ticker_dir(filing)
        basename = self._filing_basename(filing)
        file_path = dir_path / f"{basename}.json"

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)

        relative_path = str(file_path.relative_to(self.data_dir))
        logger.debug(f"Saved JSON to {relative_path}")
        return relative_path

    def save_html(self, filing: Filing, content: str) -> str:
        """Save HTML content for a filing."""
        dir_path = self._ticker_dir(filing)
        basename = self._filing_basename(filing)
        file_path = dir_path / f"{basename}.html"

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)

        relative_path = str(file_path.relative_to(self.data_dir))
        logger.debug(f"Saved HTML to {relative_path} ({len(content):,} chars)")
        return relative_path

    def save_pdf(self, filing: Filing, content: bytes) -> str:
        """Save PDF content for a filing."""
        dir_path = self._ticker_dir(filing)
        basename = self._filing_basename(filing)
        file_path = dir_path / f"{basename}.pdf"

        with open(file_path, "wb") as f:
            f.write(content)

        relative_path = str(file_path.relative_to(self.data_dir))
        logger.debug(f"Saved PDF to {relative_path} ({len(content):,} bytes)")
        return relative_path

    def load_json(self, path: str) -> Optional[Dict]:
        """Load JSON from path."""
        full_path = self._resolve_path(path)
        if not full_path.exists():
            return None
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading JSON from {path}: {e}")
            return None

    def load_html(self, path: str) -> Optional[str]:
        """Load HTML from path."""
        full_path = self._resolve_path(path)
        if not full_path.exists():
            return None
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            logger.error(f"Error loading HTML from {path}: {e}")
            return None

    def load_pdf(self, path: str) -> Optional[bytes]:
        """Load PDF from path."""
        full_path = self._resolve_path(path)
        if not full_path.exists():
            return None
        try:
            with open(full_path, "rb") as f:
                return f.read()
        except Exception as e:
            logger.error(f"Error loading PDF from {path}: {e}")
            return None

    def exists(self, path: str) -> bool:
        """Check if file exists."""
        return self._resolve_path(path).exists()

    def delete(self, path: str) -> bool:
        """Delete a file."""
        full_path = self._resolve_path(path)
        if full_path.exists():
            full_path.unlink()
            return True
        return False

    def get_filing_dir(self, filing: Filing) -> Path:
        """Get the directory for a filing."""
        return self._ticker_dir(filing)

    def get_filing_basename(self, filing: Filing) -> str:
        """Get the base filename for a filing."""
        return self._filing_basename(filing)

    def get_filing_size(self, filing: Filing) -> Dict[str, int]:
        """Get sizes of all files for a filing."""
        dir_path = self._ticker_dir(filing)
        basename = self._filing_basename(filing)
        sizes = {}

        for ext in ["json", "html", "pdf"]:
            file_path = dir_path / f"{basename}.{ext}"
            if file_path.exists():
                sizes[f"{basename}.{ext}"] = file_path.stat().st_size

        return sizes


class GCSStorage(FileStorage):
    """Google Cloud Storage backend."""

    def __init__(self, bucket_name: str, prefix: str = "sec-data"):
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

    def _filing_basename(self, filing: Filing) -> str:
        """
        Generate base filename for a filing.

        Format: {TICKER}-{FORM_TYPE}-{FILED_DATE}
        Example: AAPL-10-K-2025-10-31
        """
        ticker = (filing.ticker or filing.cik).upper()
        form_type = filing.form_type.replace("/", "-")
        filed_date = filing.filed_at.strftime("%Y-%m-%d")
        return f"{ticker}-{form_type}-{filed_date}"

    def _blob_path(self, filing: Filing, ext: str) -> str:
        """Build GCS blob path for a filing."""
        ticker = (filing.ticker or filing.cik).upper()
        basename = self._filing_basename(filing)
        return f"{self.prefix}/{ticker}/{basename}.{ext}"

    def _resolve_path(self, path: str) -> str:
        """Resolve relative path to full blob path."""
        if path.startswith(self.prefix):
            return path
        return f"{self.prefix}/{path}"

    def save_json(self, filing: Filing, data: Dict) -> str:
        """Save JSON data for a filing."""
        blob_path = self._blob_path(filing, "json")
        blob = self.bucket.blob(blob_path)

        content = json.dumps(data, indent=2, default=str)
        blob.upload_from_string(content, content_type="application/json")

        relative_path = blob_path.replace(f"{self.prefix}/", "")
        logger.debug(f"Saved JSON to gs://{self.bucket_name}/{blob_path}")
        return relative_path

    def save_html(self, filing: Filing, content: str) -> str:
        """Save HTML content for a filing."""
        blob_path = self._blob_path(filing, "html")
        blob = self.bucket.blob(blob_path)

        blob.upload_from_string(content, content_type="text/html")

        relative_path = blob_path.replace(f"{self.prefix}/", "")
        logger.debug(f"Saved HTML to gs://{self.bucket_name}/{blob_path}")
        return relative_path

    def save_pdf(self, filing: Filing, content: bytes) -> str:
        """Save PDF content for a filing."""
        blob_path = self._blob_path(filing, "pdf")
        blob = self.bucket.blob(blob_path)

        blob.upload_from_string(content, content_type="application/pdf")

        relative_path = blob_path.replace(f"{self.prefix}/", "")
        logger.debug(f"Saved PDF to gs://{self.bucket_name}/{blob_path}")
        return relative_path

    def load_json(self, path: str) -> Optional[Dict]:
        """Load JSON from path."""
        blob_path = self._resolve_path(path)
        blob = self.bucket.blob(blob_path)

        if not blob.exists():
            return None
        try:
            content = blob.download_as_text()
            return json.loads(content)
        except Exception as e:
            logger.error(f"Error loading JSON from {blob_path}: {e}")
            return None

    def load_html(self, path: str) -> Optional[str]:
        """Load HTML from path."""
        blob_path = self._resolve_path(path)
        blob = self.bucket.blob(blob_path)

        if not blob.exists():
            return None
        try:
            return blob.download_as_text()
        except Exception as e:
            logger.error(f"Error loading HTML from {blob_path}: {e}")
            return None

    def load_pdf(self, path: str) -> Optional[bytes]:
        """Load PDF from path."""
        blob_path = self._resolve_path(path)
        blob = self.bucket.blob(blob_path)

        if not blob.exists():
            return None
        try:
            return blob.download_as_bytes()
        except Exception as e:
            logger.error(f"Error loading PDF from {blob_path}: {e}")
            return None

    def exists(self, path: str) -> bool:
        """Check if file exists."""
        blob_path = self._resolve_path(path)
        blob = self.bucket.blob(blob_path)
        return blob.exists()

    def delete(self, path: str) -> bool:
        """Delete a file."""
        blob_path = self._resolve_path(path)
        blob = self.bucket.blob(blob_path)
        if blob.exists():
            blob.delete()
            return True
        return False

    def get_filing_dir(self, filing: Filing) -> Path:
        """Get the directory for a filing (returns a Path-like for GCS)."""
        ticker = (filing.ticker or filing.cik).upper()
        # For GCS, we return a local temp directory where derivatives will be written
        # then uploaded. In practice, derivatives are written inline.
        import tempfile
        temp_dir = Path(tempfile.gettempdir()) / "sec-derivatives" / ticker
        temp_dir.mkdir(parents=True, exist_ok=True)
        return temp_dir

    def get_filing_basename(self, filing: Filing) -> str:
        """Get the base filename for a filing."""
        return self._filing_basename(filing)


def create_storage(config: Dict[str, Any]) -> FileStorage:
    """
    Factory function to create appropriate storage backend.

    Config options:
        storage_type: "local" or "gcs"
        data_dir: Path for local storage
        gcs_bucket: Bucket name for GCS
        gcs_data_prefix: Prefix within bucket for data files
    """
    storage_type = config.get("storage_type", "local")

    if storage_type == "gcs":
        bucket = config.get("gcs_bucket")
        if not bucket:
            raise ValueError("gcs_bucket is required for GCS storage")
        prefix = config.get("gcs_data_prefix", "sec-data")
        return GCSStorage(bucket, prefix)
    else:
        data_dir = config.get("data_dir", "./data")
        return LocalStorage(data_dir)
