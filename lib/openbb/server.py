#!/usr/bin/env python3
"""
FastAPI server for OpenBB options data.

Runs as a persistent service to avoid Python startup overhead on each request.
OpenBB is loaded once at startup and kept in memory.

Usage:
    uvicorn lib.openbb.server:app --host 0.0.0.0 --port 8000
    # or
    python lib/openbb/server.py
"""

import logging
import sys
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger(__name__)

# Import options fetcher functions (this also initializes OpenBB)
from options_fetcher import (
    get_expiration_dates,
    get_options_chain,
    get_all_contracts,
    setup_logging as setup_fetcher_logging,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("OpenBB Options API starting up...")
    # Warmup: make a test call to ensure OpenBB is fully initialized
    try:
        logger.info("Warming up OpenBB with test query...")
        get_expiration_dates("SPY", include_first_chain=False)
        logger.info("OpenBB warmup complete - ready to serve requests")
    except Exception as e:
        logger.warning(f"Warmup query failed (non-fatal): {e}")
    yield
    logger.info("OpenBB Options API shutting down...")


app = FastAPI(
    title="OpenBB Options API",
    description="Fast options chain data API powered by OpenBB",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health_check():
    """Health check endpoint for Kubernetes probes."""
    return {"status": "healthy"}


@app.get("/options")
async def get_options(
    ticker: str = Query(..., description="Stock ticker symbol (e.g., AAPL)"),
    expiration: Optional[str] = Query(None, description="Expiration date (YYYY-MM-DD)"),
    all: Optional[bool] = Query(False, description="Get all contracts for heatmap"),
    include_first: Optional[bool] = Query(True, description="Include first expiration contracts"),
):
    """
    Get options data for a ticker.

    - Without expiration: returns expiration dates (and optionally first chain)
    - With expiration: returns options chain for that date
    - With all=true: returns ALL contracts across all expirations (for heatmap)
    """
    ticker = ticker.upper().strip()

    # Validate ticker format (1-5 letters)
    if not ticker.isalpha() or len(ticker) < 1 or len(ticker) > 5:
        raise HTTPException(
            status_code=400,
            detail="Invalid ticker format. Must be 1-5 letters (e.g., AAPL, NVDA)"
        )

    try:
        if all:
            # Batch mode: get ALL contracts for heatmap
            logger.info(f"Fetching ALL contracts for {ticker}")
            result = get_all_contracts(ticker)
            return JSONResponse(content=result.__dict__ if hasattr(result, '__dict__') else result)

        elif expiration:
            # Validate expiration format
            if len(expiration) != 10 or expiration[4] != '-' or expiration[7] != '-':
                raise HTTPException(
                    status_code=400,
                    detail="Invalid expiration date format. Expected YYYY-MM-DD"
                )

            logger.info(f"Fetching options chain for {ticker} exp={expiration}")
            result = get_options_chain(ticker, expiration)
            return JSONResponse(content=result.__dict__ if hasattr(result, '__dict__') else result)

        else:
            # Get expiration dates (optionally with first chain)
            logger.info(f"Fetching expirations for {ticker} (include_first={include_first})")
            result = get_expiration_dates(ticker, include_first_chain=include_first)
            return JSONResponse(content=result)

    except Exception as e:
        logger.error(f"Error fetching options for {ticker}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    # Suppress info logs from fetcher when running as server
    setup_fetcher_logging(logging.WARNING)

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=True,
    )
