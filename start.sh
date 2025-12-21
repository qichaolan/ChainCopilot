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

# Start Node.js server
exec node server.js
