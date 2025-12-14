"""
Pytest configuration for OpenBB tests.

Sets up paths for imports. The openbb package is mocked at the function
level in individual tests since options_fetcher uses lazy loading.
"""

import sys
import os

# Add project root to path for imports
# Go up from tests/ -> openbb/ -> lib/ -> project root
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
