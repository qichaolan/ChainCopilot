#!/usr/bin/env python3
"""
SEC Filings Watcher - Daily job for monitoring and downloading SEC filings.

Usage:
    # Default daily sync (latest 10-K/10-Q per company)
    sec_job run --watchlist watchlist.json

    # Backfill historical filings (2 years)
    sec_job run --watchlist watchlist.json --backfill-years 2

    # Backfill specific companies
    sec_job run --backfill-years 2 --companies AAPL,MSFT

    # Check status
    sec_job status

    # Add companies to watchlist
    sec_job add --companies AAPL,MSFT,GOOGL

Examples:
    # Local development
    SEC_JOB_CONFIG=./config/local.yaml sec_job run --watchlist ./config/watchlist.json

    # GCP deployment
    SEC_JOB_CONFIG=./config/gcp.yaml sec_job run --watchlist gs://bucket/watchlist.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

import yaml

# Add the sec module to path
SEC_DIR = Path(__file__).parent
sys.path.insert(0, str(SEC_DIR))

from models import Company, Filing, FilingStatus, Watchlist, JobRun
from state import StateStore, LocalStateStore, create_state_store
from storage import FileStorage, create_storage
from provider import SECProvider, SECFiling, create_provider
from processor import FilingProcessor, create_processor


logger = logging.getLogger(__name__)


def setup_logging(verbose: bool = False) -> None:
    """Configure logging."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # Quiet noisy libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("google").setLevel(logging.WARNING)


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration from YAML file.

    Priority:
    1. Explicit config_path argument
    2. SEC_JOB_CONFIG environment variable
    3. ./config/config.yaml
    4. Default values
    """
    if config_path is None:
        config_path = os.environ.get("SEC_JOB_CONFIG")

    if config_path is None:
        default_paths = [
            SEC_DIR / "config" / "config.yaml",
            SEC_DIR / "config.yaml",
            Path("./config.yaml"),
        ]
        for path in default_paths:
            if path.exists():
                config_path = str(path)
                break

    config = {
        # Default values
        "storage_type": "local",
        "state_dir": str(SEC_DIR / "state"),
        "data_dir": str(SEC_DIR / "data"),
        "user_agent": "SECWatcher/1.0 (research@example.com)",
        "timeout_sec": 30,
        "retries": 3,
        "concurrency": 4,
        "pdf_renderer": "skip",  # "skip", "sec-api", "wkhtmltopdf"
    }

    if config_path:
        path = Path(config_path)
        if path.exists():
            logger.info(f"Loading config from {config_path}")
            with open(path) as f:
                file_config = yaml.safe_load(f)
                if file_config:
                    config.update(file_config)

    return config


def load_watchlist(
    watchlist_path: Optional[str],
    companies: Optional[str],
    state: StateStore,
) -> Watchlist:
    """
    Load watchlist from file or create from company list.

    Args:
        watchlist_path: Path to watchlist JSON file
        companies: Comma-separated list of tickers
        state: State store for persistent watchlist

    Returns:
        Watchlist object
    """
    # If companies specified, create from list
    if companies:
        tickers = [t.strip().upper() for t in companies.split(",") if t.strip()]
        return Watchlist.from_tickers(tickers)

    # If watchlist path specified, load from file
    if watchlist_path:
        path = Path(watchlist_path)
        if path.exists():
            logger.info(f"Loading watchlist from {watchlist_path}")
            with open(path) as f:
                data = json.load(f)
                if isinstance(data, list):
                    # Simple list of tickers
                    return Watchlist.from_tickers(data)
                else:
                    return Watchlist.from_dict(data)

    # Load from state store
    watchlist = state.load_watchlist()
    if watchlist.companies:
        logger.info(f"Loaded watchlist with {len(watchlist.companies)} companies")
        return watchlist

    logger.warning("No watchlist found. Use --watchlist or --companies to specify.")
    return Watchlist()


def discover_filings(
    company: Company,
    provider: SECProvider,
    state: StateStore,
    mode: str = "default",
    backfill_years: int = 0,
) -> List[Filing]:
    """
    Discover new filings for a company.

    Args:
        company: Company to check
        provider: SEC API provider
        state: State store
        mode: "default" or "backfill"
        backfill_years: Years to backfill (only in backfill mode)

    Returns:
        List of newly discovered filings
    """
    # Resolve CIK if needed
    cik = company.cik
    if not cik:
        cik = provider.lookup_cik(company.ticker)
        if not cik:
            logger.warning(f"Could not resolve CIK for {company.ticker}")
            return []
        company.cik = cik

    discovered = []

    if mode == "backfill":
        # Backfill mode: get all filings in time window
        logger.info(f"Backfilling {backfill_years} years for {company.ticker}")
        sec_filings = provider.get_backfill_filings(
            cik=cik,
            years=backfill_years,
            form_types=["10-K", "10-Q"],
        )
    else:
        # Default mode: only get latest 10-K and 10-Q
        latest_10k, latest_10q = provider.get_latest_filings(
            cik=cik,
            company_name=company.name or company.ticker,
        )
        sec_filings = [f for f in [latest_10k, latest_10q] if f]

    # Check which filings are new
    for sec_filing in sec_filings:
        # Check if already in state
        existing = state.get_filing(sec_filing.cik, sec_filing.accession_number)
        if existing:
            logger.debug(f"Filing {sec_filing.accession_number} already exists")
            continue

        # Check if newer than last seen
        if mode == "default" and company.last_seen_filed_at:
            if sec_filing.filed_at <= company.last_seen_filed_at:
                logger.debug(f"Filing {sec_filing.accession_number} is not new")
                continue

        # Create new filing record
        filing = provider.to_filing_model(sec_filing, ticker=company.ticker)
        state.upsert_filing(filing)
        discovered.append(filing)

        logger.info(
            f"Discovered: {company.ticker} {filing.form_type} "
            f"filed {filing.filed_at.date()} ({filing.accession_number})"
        )

    # Update company checkpoint
    if sec_filings:
        newest = max(sec_filings, key=lambda f: (f.accepted_at or f.filed_at, f.accession_number))
        company.last_seen_filed_at = max(
            company.last_seen_filed_at or datetime.min,
            newest.filed_at,
        )
        company.last_seen_accession = newest.accession_number
        company.last_sync_at = datetime.now(timezone.utc)

    return discovered


def run_job(
    config: Dict[str, Any],
    watchlist: Watchlist,
    mode: str = "default",
    backfill_years: int = 0,
    dry_run: bool = False,
) -> JobRun:
    """
    Run the SEC filing discovery and download job.

    Args:
        config: Configuration dict
        watchlist: Companies to process
        mode: "default" or "backfill"
        backfill_years: Years to backfill
        dry_run: If True, only discover, don't download

    Returns:
        JobRun record with results
    """
    # Initialize components
    state = create_state_store(config)
    storage = create_storage(config)
    provider = create_provider(config)
    processor = create_processor(state, storage, provider, config)

    # Create job run record
    now = datetime.now(timezone.utc)
    run = JobRun(
        run_id=f"run-{now.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}",
        started_at=now,
        mode=mode,
        backfill_years=backfill_years if mode == "backfill" else None,
    )

    logger.info("=" * 70)
    logger.info(f"SEC Filings Watcher - {mode.upper()} mode")
    logger.info(f"Run ID: {run.run_id}")
    logger.info("=" * 70)

    try:
        enabled_companies = watchlist.get_enabled()
        logger.info(f"Processing {len(enabled_companies)} companies")

        all_discovered: List[Filing] = []

        # Phase 1: Discover filings
        for company in enabled_companies:
            try:
                discovered = discover_filings(
                    company=company,
                    provider=provider,
                    state=state,
                    mode=mode,
                    backfill_years=backfill_years,
                )
                all_discovered.extend(discovered)
                run.companies_processed += 1

                # Update backfill status if in backfill mode
                if mode == "backfill":
                    company.backfill_completed_years = backfill_years
                    company.backfill_completed_at = datetime.now(timezone.utc)

            except Exception as e:
                logger.error(f"Error discovering filings for {company.ticker}: {e}")

        run.filings_discovered = len(all_discovered)
        logger.info(f"Discovered {len(all_discovered)} new filings")

        # Save updated watchlist
        state.save_watchlist(watchlist)

        # Phase 2: Process discovered filings
        if not dry_run and all_discovered:
            logger.info("=" * 70)
            logger.info("Processing discovered filings...")

            summary = processor.process_discovered()

            run.filings_downloaded = summary.succeeded
            run.filings_failed = summary.failed
        else:
            if dry_run:
                logger.info("Dry run - skipping download phase")

        run.success = True

    except Exception as e:
        logger.error(f"Job failed: {e}")
        run.success = False
        run.error_message = str(e)

    finally:
        run.completed_at = datetime.now(timezone.utc)
        state.save_job_run(run)

    # Print summary
    logger.info("=" * 70)
    logger.info("Job Summary")
    logger.info("=" * 70)
    logger.info(f"Companies processed: {run.companies_processed}")
    logger.info(f"Filings discovered:  {run.filings_discovered}")
    logger.info(f"Filings downloaded:  {run.filings_downloaded}")
    logger.info(f"Filings failed:      {run.filings_failed}")
    logger.info(f"Success:             {run.success}")
    logger.info("=" * 70)

    return run


def cmd_run(args: argparse.Namespace) -> int:
    """Run the SEC filing job."""
    config = load_config(args.config)

    # Override config with CLI args
    if args.verbose:
        config["verbose"] = True

    state = create_state_store(config)
    watchlist = load_watchlist(args.watchlist, args.companies, state)

    if not watchlist.companies:
        logger.error("No companies to process")
        return 1

    mode = "backfill" if args.backfill_years else "default"

    run = run_job(
        config=config,
        watchlist=watchlist,
        mode=mode,
        backfill_years=args.backfill_years or 0,
        dry_run=args.dry_run,
    )

    return 0 if run.success else 1


def cmd_status(args: argparse.Namespace) -> int:
    """Show status of filings and last run."""
    config = load_config(args.config)
    state = create_state_store(config)

    # Show last run
    last_run = state.get_last_job_run()
    if last_run:
        print("\nLast Job Run:")
        print(f"  ID:         {last_run.run_id}")
        print(f"  Started:    {last_run.started_at}")
        print(f"  Mode:       {last_run.mode}")
        print(f"  Companies:  {last_run.companies_processed}")
        print(f"  Discovered: {last_run.filings_discovered}")
        print(f"  Downloaded: {last_run.filings_downloaded}")
        print(f"  Failed:     {last_run.filings_failed}")
        print(f"  Success:    {last_run.success}")
    else:
        print("\nNo previous job runs found.")

    # Show watchlist
    watchlist = state.load_watchlist()
    print(f"\nWatchlist: {len(watchlist.companies)} companies")
    for company in watchlist.companies[:10]:
        status = "enabled" if company.enabled else "disabled"
        last_sync = company.last_sync_at.date() if company.last_sync_at else "never"
        print(f"  {company.ticker}: {status}, last sync: {last_sync}")
    if len(watchlist.companies) > 10:
        print(f"  ... and {len(watchlist.companies) - 10} more")

    # Show filing counts by status
    print("\nFilings by Status:")
    for status in FilingStatus:
        filings = state.get_filings_by_status(status)
        if filings:
            print(f"  {status.value}: {len(filings)}")

    return 0


def cmd_add(args: argparse.Namespace) -> int:
    """Add companies to watchlist."""
    config = load_config(args.config)
    state = create_state_store(config)

    watchlist = state.load_watchlist()

    if not args.companies:
        print("No companies specified. Use --companies AAPL,MSFT,GOOGL")
        return 1

    tickers = [t.strip().upper() for t in args.companies.split(",") if t.strip()]

    for ticker in tickers:
        existing = watchlist.get_by_ticker(ticker)
        if existing:
            print(f"  {ticker}: already in watchlist")
        else:
            watchlist.add_company(Company(ticker=ticker))
            print(f"  {ticker}: added")

    state.save_watchlist(watchlist)
    print(f"\nWatchlist now has {len(watchlist.companies)} companies")

    return 0


def cmd_remove(args: argparse.Namespace) -> int:
    """Remove companies from watchlist."""
    config = load_config(args.config)
    state = create_state_store(config)

    watchlist = state.load_watchlist()

    if not args.companies:
        print("No companies specified. Use --companies AAPL,MSFT")
        return 1

    tickers = [t.strip().upper() for t in args.companies.split(",")]

    for ticker in tickers:
        existing = watchlist.get_by_ticker(ticker)
        if existing:
            watchlist.companies.remove(existing)
            print(f"  {ticker}: removed")
        else:
            print(f"  {ticker}: not in watchlist")

    state.save_watchlist(watchlist)
    print(f"\nWatchlist now has {len(watchlist.companies)} companies")

    return 0


def main() -> int:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="SEC Filings Watcher - Monitor and download SEC filings",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--config",
        type=str,
        help="Path to config file (default: SEC_JOB_CONFIG env or ./config/config.yaml)",
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Run command
    run_parser = subparsers.add_parser("run", help="Run the filing sync job")
    run_parser.add_argument(
        "--watchlist",
        type=str,
        help="Path to watchlist JSON file",
    )
    run_parser.add_argument(
        "--companies",
        type=str,
        help="Comma-separated list of tickers (overrides watchlist)",
    )
    run_parser.add_argument(
        "--backfill-years",
        type=int,
        help="Number of years to backfill (enables backfill mode)",
    )
    run_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only discover filings, don't download",
    )

    # Status command
    status_parser = subparsers.add_parser("status", help="Show job status")

    # Add command
    add_parser = subparsers.add_parser("add", help="Add companies to watchlist")
    add_parser.add_argument(
        "--companies",
        type=str,
        required=True,
        help="Comma-separated list of tickers to add",
    )

    # Remove command
    remove_parser = subparsers.add_parser("remove", help="Remove companies from watchlist")
    remove_parser.add_argument(
        "--companies",
        type=str,
        required=True,
        help="Comma-separated list of tickers to remove",
    )

    args = parser.parse_args()

    # Setup logging
    setup_logging(args.verbose)

    # Dispatch to command
    if args.command == "run":
        return cmd_run(args)
    elif args.command == "status":
        return cmd_status(args)
    elif args.command == "add":
        return cmd_add(args)
    elif args.command == "remove":
        return cmd_remove(args)
    else:
        parser.print_help()
        return 0


if __name__ == "__main__":
    sys.exit(main())
