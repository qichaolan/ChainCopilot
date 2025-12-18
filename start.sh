#!/bin/sh
# Startup script for ChainCopilot

echo "Starting ChainCopilot..."

# Only warmup OpenBB if running without the Python sidecar
# (PYTHON_SERVICE_URL is set when sidecar is available)
if [ -z "$PYTHON_SERVICE_URL" ]; then
    echo "No Python sidecar detected, warming up local OpenBB..."
    python3 /app/lib/openbb/warmup.py &
else
    echo "Python sidecar detected at $PYTHON_SERVICE_URL, skipping local warmup"
fi

# Start LEAPS CoAgent server (unless LEAPS_COAGENT_URL is set externally)
if [ -z "$LEAPS_COAGENT_URL" ]; then
    echo "Starting LEAPS CoAgent server on port 8000..."
    python3 -m uvicorn agents.leaps_coagent.server:app --host 0.0.0.0 --port 8000 &
    export LEAPS_COAGENT_URL="http://localhost:8000"
else
    echo "Using external LEAPS CoAgent at $LEAPS_COAGENT_URL"
fi

# Start Node.js server
exec node server.js
