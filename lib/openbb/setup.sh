#!/bin/bash
# Setup script for OpenBB options fetcher

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VENV_DIR="$PROJECT_ROOT/.venv"

echo "=== OpenBB Options Fetcher Setup ==="
echo "Project root: $PROJECT_ROOT"

# Check if Python 3.10+ is available
PYTHON_VERSION=$(python3 --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)

if [ "$MAJOR" -lt 3 ] || ([ "$MAJOR" -eq 3 ] && [ "$MINOR" -lt 10 ]); then
    echo "Error: Python 3.10+ is required (found $PYTHON_VERSION)"
    exit 1
fi

echo "Python version: $PYTHON_VERSION"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate and install dependencies
echo "Installing dependencies..."
source "$VENV_DIR/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$SCRIPT_DIR/requirements.txt"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To use the options fetcher:"
echo "  1. Activate the virtual environment:"
echo "     source .venv/bin/activate"
echo ""
echo "  2. Run the script:"
echo "     python lib/openbb/options_fetcher.py AAPL"
echo "     python lib/openbb/options_fetcher.py AAPL 2024-01-19"
echo ""
echo "  3. Or import in Python:"
echo "     from lib.openbb import get_expiration_dates, get_options_chain"
