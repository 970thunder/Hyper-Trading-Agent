"""Regression coverage for optional Longbridge and FTShare data fallbacks."""

from __future__ import annotations

import datetime as dt
from types import SimpleNamespace

import pandas as pd
import pytest

from backtest.loaders import feitu_loader, longbridge
from backtest.loaders.base import NoAvailableSourceError
from backtest.loaders.registry import FALLBACK_CHAINS, VALID_SOURCES


def test_registry_exposes_optional_data_source_fallbacks() -> None:
    assert {"longbridge", "feitu"} <= VALID_SOURCES
    assert "longbridge" in FALLBACK_CHAINS["us_equity"]
    assert "feitu" in FALLBACK_CHAINS["a_share"]


def test_longbridge_wide_history_fails_without_silent_truncation() -> None:
    start = dt.date(2000, 1, 1)
    end = start + dt.timedelta(days=longbridge._MAX_WINDOW_DAYS * longbridge._MAX_WINDOWS)
    with pytest.raises(NoAvailableSourceError, match="exceeds.*window limit"):
        longbridge._date_windows(start, end)


def test_longbridge_normalizes_aware_time_to_naive_utc() -> None:
    frame = longbridge._normalize_frame([SimpleNamespace(
        timestamp=pd.Timestamp("2026-07-14 09:30:00", tz="Asia/Hong_Kong"), open=10, high=11, low=9, close=10.5, volume=100,
    )])
    assert frame.index.tz is None
    assert frame.index[0] == pd.Timestamp("2026-07-14 01:30:00")


def test_longbridge_rejects_unavailable_credentials_before_sdk() -> None:
    loader = longbridge.LongbridgeLoader.__new__(longbridge.LongbridgeLoader)
    loader._credential_error = None
    loader._app_key = loader._app_secret = loader._access_token = ""
    with pytest.raises(NoAvailableSourceError, match="credentials are not configured"):
        loader.fetch(["AAPL"], "2026-01-01", "2026-01-02")


def test_feitu_symbol_and_interval_contracts() -> None:
    assert feitu_loader._normalize_symbol("600000.SH") == ("a_share", "600000.XSHG")
    assert feitu_loader._normalize_symbol("700.HK") == ("hk_equity", "00700.HK")
    with pytest.raises(NoAvailableSourceError, match="unsupported FTShare A-share interval"):
        feitu_loader._a_share_interval("1H")
    with pytest.raises(NoAvailableSourceError, match="unsupported FTShare HK interval"):
        feitu_loader._hk_interval("1W")


def test_feitu_normalizes_shanghai_trade_date() -> None:
    frame = feitu_loader._normalize_frame(pd.DataFrame([{
        "open_ts_ms": 1782869400000, "open": "8.58", "high": "8.75", "low": "8.54", "close": "8.65", "volume": 1,
    }]), market="a_share")
    assert frame.index.name == "trade_date"
    assert frame.index[0] == pd.Timestamp("2026-07-01")
    assert frame.loc[pd.Timestamp("2026-07-01"), "close"] == pytest.approx(8.65)
