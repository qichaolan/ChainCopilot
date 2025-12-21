#!/usr/bin/env python3
"""
Migrate existing SEC filings to parser_v2 dual-output format.

Usage:
    # Test on a single filing
    python migrate_to_v2.py --test AAPL-10-K-2024-11-01

    # Migrate all filings
    python migrate_to_v2.py --all

    # Migrate specific ticker
    python migrate_to_v2.py --ticker AAPL
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

from parser_v2 import (
    FilingParserV2,
    write_display_artifacts,
    write_rag_artifacts,
    write_all_artifacts,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"


def get_filing_metadata(filing_dir: Path, filing_id: str) -> dict:
    """Extract metadata from JSON or infer from filename."""
    json_path = filing_dir / f"{filing_id}.json"

    # Parse filing ID: TICKER-FORM-DATE
    parts = filing_id.split("-")
    ticker = parts[0]

    # Handle different form types (10-K, 10-Q)
    if len(parts) >= 4:
        form_type = f"{parts[1]}-{parts[2]}"  # e.g., "10-K"
        # Date parts: year, month, day
        date_parts = parts[3:]
        filed_at = "-".join(date_parts)
    else:
        form_type = parts[1] if len(parts) > 1 else "10-K"
        filed_at = parts[2] if len(parts) > 2 else datetime.now().strftime("%Y-%m-%d")

    metadata = {
        "ticker": ticker,
        "form_type": form_type,
        "filed_at": filed_at,
        "cik": "",
        "company_name": ticker,  # Default to ticker
    }

    # Try to get better metadata from JSON
    if json_path.exists():
        try:
            with open(json_path) as f:
                data = json.load(f)
                # Extract CIK from directory path
                dir_name = data.get("directory", {}).get("name", "")
                if "/data/" in dir_name:
                    cik_part = dir_name.split("/data/")[1].split("/")[0]
                    metadata["cik"] = cik_part
        except Exception as e:
            logger.warning(f"Could not parse JSON metadata: {e}")

    return metadata


def migrate_filing(filing_dir: Path, filing_id: str, dry_run: bool = False) -> bool:
    """Migrate a single filing to v2 format."""
    html_path = filing_dir / f"{filing_id}.html"

    if not html_path.exists():
        logger.warning(f"HTML not found: {html_path}")
        return False

    logger.info(f"Processing {filing_id}...")

    # Get metadata
    metadata = get_filing_metadata(filing_dir, filing_id)

    # Read HTML
    with open(html_path, "r", encoding="utf-8", errors="replace") as f:
        html_content = f.read()

    logger.info(f"  HTML size: {len(html_content):,} bytes")

    if dry_run:
        logger.info(f"  [DRY RUN] Would parse with metadata: {metadata}")
        return True

    # Parse with v2 parser
    parser = FilingParserV2()
    try:
        parsed = parser.parse(
            html_content=html_content,
            filing_id=filing_id,
            cik=metadata["cik"],
            ticker=metadata["ticker"],
            company_name=metadata["company_name"],
            form_type=metadata["form_type"],
            filed_at=metadata["filed_at"],
        )

        logger.info(f"  Sections: {len(parsed.sections)}")
        logger.info(f"  Chunks: {len(parsed.chunks)}")
        logger.info(f"  Tables: {len(parsed.tables)}")
        logger.info(f"  Word count: {parsed.word_count:,}")

        # Show section details
        for section in parsed.sections:
            logger.info(f"    - {section.id}: {section.label} ({section.word_count:,} words)")

        # Write artifacts to per-filing directory
        # Structure: {ticker}/{filing-id}/display/ and {ticker}/{filing-id}/rag/
        output_dir = filing_dir / filing_id
        paths = write_all_artifacts(parsed, output_dir)
        logger.info(f"  Written to: {output_dir}/display/ and {output_dir}/rag/")

        return True

    except Exception as e:
        logger.error(f"  Error parsing {filing_id}: {e}")
        import traceback
        traceback.print_exc()
        return False


def migrate_ticker(ticker: str, dry_run: bool = False) -> tuple[int, int]:
    """Migrate all filings for a ticker."""
    ticker_dir = DATA_DIR / ticker.upper()

    if not ticker_dir.exists():
        logger.error(f"Ticker directory not found: {ticker_dir}")
        return 0, 0

    # Find all HTML files
    html_files = list(ticker_dir.glob("*.html"))
    logger.info(f"Found {len(html_files)} HTML files for {ticker}")

    succeeded = 0
    failed = 0

    for html_file in html_files:
        filing_id = html_file.stem
        if migrate_filing(ticker_dir, filing_id, dry_run):
            succeeded += 1
        else:
            failed += 1

    return succeeded, failed


def migrate_all(dry_run: bool = False) -> tuple[int, int]:
    """Migrate all filings across all tickers."""
    if not DATA_DIR.exists():
        logger.error(f"Data directory not found: {DATA_DIR}")
        return 0, 0

    # Find all ticker directories
    ticker_dirs = [d for d in DATA_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
    logger.info(f"Found {len(ticker_dirs)} ticker directories")

    total_succeeded = 0
    total_failed = 0

    for ticker_dir in sorted(ticker_dirs):
        ticker = ticker_dir.name
        succeeded, failed = migrate_ticker(ticker, dry_run)
        total_succeeded += succeeded
        total_failed += failed

    return total_succeeded, total_failed


def main():
    parser = argparse.ArgumentParser(description="Migrate SEC filings to v2 format")

    parser.add_argument(
        "--test",
        type=str,
        help="Test on a single filing ID (e.g., AAPL-10-K-2024-11-01)",
    )
    parser.add_argument(
        "--ticker",
        type=str,
        help="Migrate all filings for a specific ticker",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Migrate all filings",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only show what would be done",
    )

    args = parser.parse_args()

    if args.test:
        # Test single filing
        filing_id = args.test
        parts = filing_id.split("-")
        ticker = parts[0]
        ticker_dir = DATA_DIR / ticker.upper()

        success = migrate_filing(ticker_dir, filing_id, args.dry_run)
        sys.exit(0 if success else 1)

    elif args.ticker:
        succeeded, failed = migrate_ticker(args.ticker, args.dry_run)
        logger.info(f"Complete: {succeeded} succeeded, {failed} failed")
        sys.exit(0 if failed == 0 else 1)

    elif args.all:
        succeeded, failed = migrate_all(args.dry_run)
        logger.info(f"Complete: {succeeded} succeeded, {failed} failed")
        sys.exit(0 if failed == 0 else 1)

    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
