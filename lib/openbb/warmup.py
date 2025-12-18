#!/usr/bin/env python3
"""
Warmup script to pre-initialize OpenBB on container startup.
This avoids the ~60 second delay on the first user request.
"""

import sys
import io

print("Warming up OpenBB...", flush=True)

# Suppress OpenBB's stdout messages during import
old_stdout = sys.stdout
sys.stdout = io.StringIO()
try:
    from openbb import obb
    # Make a simple API call to fully initialize
    sys.stdout = old_stdout
    print("OpenBB initialized successfully", flush=True)
except Exception as e:
    sys.stdout = old_stdout
    print(f"OpenBB warmup failed: {e}", flush=True)
    sys.exit(1)
