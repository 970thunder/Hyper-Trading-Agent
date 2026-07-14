"""Shared fixtures and sys.path setup for all tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure agent/ is on sys.path so imports like `backtest.*` and `src.*` work.
AGENT_DIR = Path(__file__).resolve().parent.parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))


@pytest.fixture(autouse=True)
def _allow_test_self_registration(monkeypatch: pytest.MonkeyPatch):
    """Keep endpoint-based fixtures focused on their target behavior.

    Production commercial deployments disable anonymous provisioning. Existing
    API tests use ``/auth/register`` solely to create isolated test tenants.
    """
    monkeypatch.setenv("HYPER_TRADING_ALLOW_SELF_REGISTRATION", "1")
