# SEC Filings Watcher

Daily job for monitoring and downloading SEC filings (10-K, 10-Q) for a watchlist of companies.

## Features

- **Daily sync mode**: Downloads only the latest 10-K and 10-Q per company (fast, incremental)
- **Backfill mode**: Downloads historical filings for the past X years
- **State management**: Tracks what's been downloaded to avoid duplicates
- **Dual storage**: Works locally or with Google Cloud Storage
- **PDF support**: Optional PDF rendering via sec-api.io or wkhtmltopdf

## Quick Start

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run with example watchlist
python sec_job.py run --watchlist ./config/watchlist.json

# Or specify companies directly
python sec_job.py run --companies AAPL,MSFT,GOOGL

# Backfill 2 years of history
python sec_job.py run --companies AAPL --backfill-years 2

# Check status
python sec_job.py status
```

### GCP Deployment

```bash
# Set config
export SEC_JOB_CONFIG=./config/gcp.yaml
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Run job
python sec_job.py run --watchlist ./config/watchlist.json
```

## CLI Commands

### `run` - Execute the sync job

```bash
# Default mode: sync latest filings
sec_job run --watchlist watchlist.json

# Backfill mode: download historical filings
sec_job run --watchlist watchlist.json --backfill-years 2

# Specific companies (no watchlist needed)
sec_job run --companies AAPL,MSFT --backfill-years 2

# Dry run (discover only, no download)
sec_job run --watchlist watchlist.json --dry-run
```

### `status` - Show current state

```bash
sec_job status
```

### `add` - Add companies to watchlist

```bash
sec_job add --companies AAPL,MSFT,GOOGL
```

### `remove` - Remove companies from watchlist

```bash
sec_job remove --companies AAPL
```

## Configuration

### Local Config (`config/local.yaml`)

```yaml
storage_type: local
state_dir: ./state
data_dir: ./data
user_agent: "SECWatcher/1.0 (your-email@example.com)"
timeout_sec: 30
retries: 3
concurrency: 4
pdf_renderer: skip  # or "sec-api" / "wkhtmltopdf"
```

### GCP Config (`config/gcp.yaml`)

```yaml
storage_type: gcs
gcs_bucket: your-bucket-name
gcs_prefix: sec-state
gcs_data_prefix: sec-data
user_agent: "SECWatcher/1.0 (your-email@example.com)"
```

### Watchlist Format (`watchlist.json`)

```json
{
  "companies": [
    {"ticker": "AAPL", "name": "Apple Inc.", "enabled": true},
    {"ticker": "MSFT", "name": "Microsoft Corporation", "enabled": true}
  ]
}
```

Or simple format (just tickers):

```json
["AAPL", "MSFT", "GOOGL", "AMZN"]
```

## Behavior Spec

### Default Mode (daily sync)

For each company:
1. Query SEC for recent 10-K/10-Q filings
2. Identify newest 10-K and newest 10-Q
3. If not already in state → add as DISCOVERED and process
4. Update checkpoint: `last_seen_filed_at = max(current, newest filed_at)`

**Net effect**: At most 2 filings per company per day (usually 0).

### Backfill Mode (`--backfill-years X`)

For each company:
1. Compute start date: `today - X years`
2. Query SEC for all filings in that window
3. For each filing: upsert into state with DISCOVERED if new
4. Process all discovered filings
5. Set `backfill_completed_years = X` when done

**Net effect**: Downloads the historical set once.

## File Structure

```
jobs/sec/
├── sec_job.py          # CLI entry point
├── models.py           # Data schemas
├── state.py            # State management (local/GCS)
├── storage.py          # File storage (local/GCS)
├── provider.py         # SEC EDGAR API client
├── processor.py        # Filing download/processing
├── config/
│   ├── local.yaml      # Local dev config
│   ├── gcp.yaml        # GCP deployment config
│   └── watchlist.json  # Example watchlist
├── state/              # State files (auto-created)
│   ├── watchlist.json
│   └── filings/
└── data/               # Downloaded filings (auto-created)
    └── {cik}/
        └── {accession}/
            ├── filing.json
            ├── filing.html
            └── filing.pdf
```

## State Schema

### Filing State

```json
{
  "cik": "0000320193",
  "accession_number": "0000320193-24-000081",
  "form_type": "10-K",
  "company_name": "Apple Inc.",
  "ticker": "AAPL",
  "filed_at": "2024-11-01T00:00:00",
  "status": "ready",
  "json_path": "320193/0000320193_24_000081/filing.json",
  "pdf_path": "320193/0000320193_24_000081/filing.pdf"
}
```

### Company State

```json
{
  "ticker": "AAPL",
  "cik": "0000320193",
  "name": "Apple Inc.",
  "last_sync_at": "2024-12-18T10:30:00",
  "last_seen_filed_at": "2024-11-01T00:00:00",
  "backfill_completed_years": 2,
  "backfill_completed_at": "2024-12-15T09:00:00"
}
```

## SEC API Notes

This tool uses the **free SEC EDGAR API** - no API key required.

Rate limits:
- Max 10 requests/second to SEC
- Always include valid User-Agent with contact email

Endpoints used:
- Company lookup: `https://www.sec.gov/files/company_tickers.json`
- Filings: `https://data.sec.gov/submissions/CIK{cik}.json`
- Documents: `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/`

## PDF Rendering Options

1. **Skip** (default): Just download HTML/JSON, no PDF
2. **sec-api.io**: High-quality PDFs, requires paid API key
3. **wkhtmltopdf**: Local rendering, requires system package installation

```bash
# macOS
brew install wkhtmltopdf

# Ubuntu
apt-get install wkhtmltopdf
```

## Scheduled Execution

### Cron (local)

```bash
# Daily at 6am
0 6 * * * cd /path/to/jobs/sec && python sec_job.py run --watchlist ./config/watchlist.json
```

### Cloud Run Jobs (GCP)

```yaml
# cloudbuild-sec-job.yaml
steps:
  - name: 'python:3.11'
    entrypoint: 'python'
    args: ['sec_job.py', 'run', '--watchlist', './config/watchlist.json']
    env:
      - 'SEC_JOB_CONFIG=./config/gcp.yaml'
```

### Cloud Scheduler

```bash
gcloud scheduler jobs create http sec-daily-sync \
  --schedule="0 6 * * *" \
  --uri="https://your-cloud-run-url/run" \
  --http-method=POST
```
