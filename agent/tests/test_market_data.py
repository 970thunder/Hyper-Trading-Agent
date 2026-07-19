"""Tests for the shared market-data helper layer.

``src.market_data`` is the source-resolution + normalization layer shared by
the MCP server and the agent ``get_market_data`` tool. It shipped (with the
#270 global data layer) without dedicated tests. These cover the
network-free logic: source detection, row capping, JSON-safety, and the
``fetch_market_data`` orchestration via an injected stub loader.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

import src.market_data as market_data
from src.market_data import (
    DEFAULT_MAX_ROWS,
    _json_safe,
    cap_rows,
    detect_source,
    fetch_market_data,
    fetch_market_data_json,
    fetch_market_data_snapshot,
    get_loader,
)
from src.market_quality import quality_contract


# --------------------------------------------------------------------------
# detect_source
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "code,expected",
    [
        ("600519.SH", "tencent"),
        ("000001.SZ", "tencent"),
        ("430139.BJ", "tencent"),
        ("AAPL.US", "yahoo"),
        ("700.HK", "yahoo"),
        ("00700.HK", "yahoo"),
        ("BTC-USDT", "okx"),
        ("ETH/USDT", "ccxt"),
        ("local:my_file", "local"),
        ("something_weird", "tushare"),  # documented fallback
    ],
)
def test_detect_source(code: str, expected: str) -> None:
    assert detect_source(code) == expected


# --------------------------------------------------------------------------
# cap_rows
# --------------------------------------------------------------------------


def test_cap_rows_passthrough_when_under_limit() -> None:
    rows = [{"a": i} for i in range(3)]
    assert cap_rows(rows, 250) is rows


def test_cap_rows_zero_means_no_cap() -> None:
    rows = [{"a": i} for i in range(1000)]
    assert cap_rows(rows, 0) is rows


def test_cap_rows_negative_falls_back_to_default() -> None:
    rows = [{"a": i} for i in range(DEFAULT_MAX_ROWS + 10)]
    out = cap_rows(rows, -5)
    # Negative max_rows is treated as DEFAULT_MAX_ROWS -> truncated payload.
    assert isinstance(out, dict)
    assert out["truncated"] is True


def test_cap_rows_samples_with_stride_and_pins_last() -> None:
    rows = [{"a": i} for i in range(10)]
    out = cap_rows(rows, 4)
    assert isinstance(out, dict)
    assert out["rows"] == 10
    assert out["truncated"] is True
    # Even stride of ceil(10/4)=3 plus the pinned final bar.
    assert out["data"][0] == {"a": 0}
    assert out["data"][-1] == {"a": 9}  # last bar always pinned
    assert out["returned"] == len(out["data"])


# --------------------------------------------------------------------------
# _json_safe
# --------------------------------------------------------------------------


def test_json_safe_non_finite_becomes_none() -> None:
    assert _json_safe(float("nan")) is None
    assert _json_safe(float("inf")) is None
    assert _json_safe(float("-inf")) is None


def test_json_safe_timestamp_isoformat() -> None:
    assert _json_safe(pd.Timestamp("2026-01-01")) == "2026-01-01T00:00:00"


def test_json_safe_numpy_scalar_unwrapped() -> None:
    out = _json_safe(np.int64(5))
    assert out == 5
    assert not isinstance(out, np.integer)


def test_json_safe_plain_value_passthrough() -> None:
    assert _json_safe("hello") == "hello"
    assert _json_safe(3.5) == 3.5


# --------------------------------------------------------------------------
# fetch_market_data (stub loader — no network)
# --------------------------------------------------------------------------


class _StubLoader:
    """Returns a fixed 2-row OHLCV frame for every requested code."""

    def __init__(self) -> None:
        pass

    def fetch(self, codes, start_date, end_date, interval="1D"):
        idx = pd.to_datetime(["2026-01-01", "2026-01-02"])
        idx.name = "trade_date"
        return {
            code: pd.DataFrame({"close": [1.0, 2.0], "volume": [100, 200]}, index=idx)
            for code in codes
        }


class _BadLoader:
    def __init__(self) -> None:
        pass

    def fetch(self, *args, **kwargs):
        raise RuntimeError("loader exploded")


class _PartialLoader:
    """Returns data for only the first requested code."""

    def __init__(self) -> None:
        pass

    def fetch(self, codes, start_date, end_date, interval="1D"):
        idx = pd.to_datetime(["2026-01-01"])
        idx.name = "trade_date"
        return {codes[0]: pd.DataFrame({"close": [1.0]}, index=idx)}


def test_fetch_explicit_source_normalizes_rows() -> None:
    out = fetch_market_data(
        codes=["AAPL.US"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="yahoo",
        loader_resolver=lambda src: _StubLoader,
    )
    assert "AAPL.US" in out
    rows = out["AAPL.US"]
    assert rows[0]["trade_date"] == "2026-01-01T00:00:00"  # index reset + isoformat
    assert rows[0]["close"] == 1.0


def test_fetch_auto_groups_by_detected_source() -> None:
    seen: dict[str, list[str]] = {}

    def resolver(src: str):
        seen[src] = []
        return _StubLoader

    out = fetch_market_data(
        codes=["AAPL.US", "BTC-USDT"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="auto",
        loader_resolver=resolver,
    )
    # AAPL.US -> yahoo, BTC-USDT -> okx: two distinct loader groups resolved.
    assert set(seen) == {"yahoo", "okx"}
    assert "AAPL.US" in out and "BTC-USDT" in out


def test_fetch_loader_error_falls_through_to_unresolved() -> None:
    out = fetch_market_data(
        codes=["X.US"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="yahoo",
        loader_resolver=lambda src: _BadLoader,
    )
    assert out["_unresolved"] == ["X.US"]


def test_fetch_missing_symbol_listed_as_unresolved() -> None:
    out = fetch_market_data(
        codes=["A.US", "B.US"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="yahoo",
        loader_resolver=lambda src: _PartialLoader,
    )
    assert "A.US" in out
    assert out["_unresolved"] == ["B.US"]


# --------------------------------------------------------------------------
# fetch_market_data_json
# --------------------------------------------------------------------------


def test_fetch_json_is_strict_and_parseable() -> None:
    payload = fetch_market_data_json(
        codes=["AAPL.US"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="yahoo",
        loader_resolver=lambda src: _StubLoader,
    )
    parsed = json.loads(payload)  # must be valid JSON
    assert "AAPL.US" in parsed


def test_fetch_json_rejects_nan_via_allow_nan_false() -> None:
    class _NanLoader:
        def __init__(self) -> None:
            pass

        def fetch(self, codes, start_date, end_date, interval="1D"):
            idx = pd.to_datetime(["2026-01-01"])
            idx.name = "trade_date"
            # A NaN close must be sanitized to null by _json_safe, so strict
            # JSON (allow_nan=False) still succeeds.
            return {codes[0]: pd.DataFrame({"close": [float("nan")]}, index=idx)}

    payload = fetch_market_data_json(
        codes=["A.US"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="yahoo",
        loader_resolver=lambda src: _NanLoader,
    )
    parsed = json.loads(payload)
    assert parsed["A.US"][0]["close"] is None


# --------------------------------------------------------------------------
# fetch_market_data_snapshot (HTTP-facing provenance contract)
# --------------------------------------------------------------------------


def test_snapshot_exposes_provenance_and_quality_metadata() -> None:
    class _SnapshotLoader(_StubLoader):
        name = "resolved-yahoo"

    snapshot = fetch_market_data_snapshot(
        codes=["AAPL.US"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="yahoo",
        loader_resolver=lambda _source: _SnapshotLoader,
    )

    assert snapshot["unresolved"] == []
    assert snapshot["query"]["symbols"] == ["AAPL.US"]
    assert len(snapshot["series"]) == 1
    series = snapshot["series"][0]
    assert series["requested_source"] == "yahoo"
    assert series["source"] == "resolved-yahoo"
    assert series["quality"]["source_bars"] == 2
    assert series["quality"]["first_bar"] == "2026-01-01T00:00:00"
    assert series["quality"]["last_bar"] == "2026-01-02T00:00:00"
    assert series["quality"]["status"] == "complete"
    assert series["quality"]["trading_calendar"]["id"] == "XNYS"
    assert series["quality"]["adjustment"] == {
        "requested": "raw", "applied": "raw", "status": "applied",
    }


def test_quality_contract_annotates_sessions_gaps_freshness_and_adjustment() -> None:
    equity = quality_contract(
        symbol="AAPL.US",
        timestamps=["2026-01-02T00:00:00", "2026-01-05T00:00:00"],
        source_bars=2,
        returned_bars=2,
        start_date="2026-01-02",
        end_date="2026-01-05",
        truncated=False,
        adjustment="forward",
        generated_at="2026-01-05T00:01:00+00:00",
    )
    assert equity["gap_annotations"] == {
        "expected_sessions": 2, "missing_count": 0, "sample": [], "calendar_precision": "weekday_convention",
    }
    assert equity["freshness"] == {
        "observed_at": "2026-01-05T00:00:00", "evaluated_at": "2026-01-05T00:01:00+00:00",
        "age_seconds": 60, "sla_seconds": None, "status": "historical",
    }
    assert equity["adjustment"]["status"] == "not_supported_by_normalized_loader"

    crypto = quality_contract(
        symbol="BTC-USDT",
        timestamps=["2026-01-01T00:00:00", "2026-01-03T00:00:00"],
        source_bars=2,
        returned_bars=2,
        start_date="2026-01-01",
        end_date="2026-01-03",
        truncated=False,
        adjustment="raw",
        generated_at="2026-01-03T00:01:00+00:00",
    )
    assert crypto["gap_annotations"]["sample"] == ["2026-01-02"]
    assert crypto["gap_annotations"]["calendar_precision"] == "continuous"


def test_snapshot_marks_unresolved_symbols_when_loader_returns_no_frames() -> None:
    snapshot = fetch_market_data_snapshot(
        codes=["AAPL.US"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="yahoo",
        loader_resolver=lambda _source: _PartialLoader,
    )

    # _PartialLoader returns its first requested symbol, so one-symbol input is resolved.
    assert snapshot["unresolved"] == []

    class _EmptyLoader:
        name = "empty"

        def fetch(self, *args, **kwargs):
            return {}

    empty_snapshot = fetch_market_data_snapshot(
        codes=["AAPL.US"],
        start_date="2026-01-01",
        end_date="2026-01-02",
        source="yahoo",
        loader_resolver=lambda _source: _EmptyLoader,
    )
    assert empty_snapshot["series"] == []
    assert empty_snapshot["unresolved"] == ["AAPL.US"]


def test_snapshot_cache_reuses_first_completed_result(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_MARKET_CACHE", "true")
    monkeypatch.setenv("VIBE_TRADING_MARKET_CACHE_ROOT", str(tmp_path))
    calls = 0

    def fake_uncached(**kwargs):
        nonlocal calls
        calls += 1
        return {
            "query": {"symbols": kwargs["codes"]},
            "series": [],
            "unresolved": [],
            "generated_at": "2025-01-02T00:00:00+00:00",
            "cache": {},
        }

    monkeypatch.setattr(market_data, "_fetch_market_data_snapshot_uncached", fake_uncached)
    first = fetch_market_data_snapshot(
        codes=["BTC-USDT"], start_date="2025-01-01", end_date="2025-01-02", loader_resolver=get_loader
    )
    second = fetch_market_data_snapshot(
        codes=["BTC-USDT"], start_date="2025-01-01", end_date="2025-01-02", loader_resolver=get_loader
    )

    assert calls == 1
    assert first["query_cache"]["status"] == "miss"
    assert second["query_cache"]["status"] == "hit"
    assert second["query_cache"]["origin"] == "query"


def test_symbol_search_cache_reuses_shared_result(monkeypatch) -> None:
    import json

    from src.api import market_data_routes
    from src.tools.symbol_search_tool import SymbolSearchTool

    calls = []

    def fake_execute(self, **kwargs):
        calls.append(kwargs)
        return json.dumps({"ok": True, "data": {"query": kwargs["query"], "count": 1, "candidates": [{"symbol": "AAPL.US", "name": "Apple", "market": "us"}], "sources": {"fake": "ok"}}})

    monkeypatch.setattr(SymbolSearchTool, "execute", fake_execute)
    market_data_routes._symbol_search_cache.clear()

    first = market_data_routes.search_market_symbols("apple", 8)
    second = market_data_routes.search_market_symbols("apple", 8)

    assert len(calls) == 1
    assert first["query_cache"]["status"] == "miss"
    assert second["query_cache"]["status"] == "hit"
    assert first["candidates"][0]["timezone"] == "America/New_York"
    candidate = first["candidates"][0]
    assert candidate["asset_class"] == "equity"
    assert candidate["currency"] == "USD"
    assert candidate["trading_calendar"] == {
        "id": "XNYS", "timezone": "America/New_York", "session": "09:30-16:00",
        "holiday_source": "exchange_official_calendar",
    }
    assert candidate["corporate_actions"]["status"] == "available_on_demand"


def test_yahoo_corporate_action_parser_normalizes_dividends_and_splits() -> None:
    from backtest.loaders.yahoo_client import _parse_corporate_actions

    actions = _parse_corporate_actions({
        "chart": {"result": [{"events": {
            "dividends": {"1767225600": {"date": 1767225600, "amount": 0.25}},
            "splits": {"1764547200": {"date": 1764547200, "numerator": 4, "denominator": 1}},
        }}]},
    }, "AAPL")
    assert actions[0] == {"type": "dividend", "occurred_at": "2026-01-01T00:00:00+00:00", "amount": 0.25}
    assert actions[1]["ratio"] == "4:1"


def test_instrument_metadata_loads_provider_events_and_discloses_unsupported_markets(monkeypatch) -> None:
    from src.api import market_data_routes
    from backtest.loaders import yahoo_client

    monkeypatch.setattr(yahoo_client, "get_corporate_actions", lambda *_args, **_kwargs: [{"type": "split", "ratio": "4:1"}])
    us = market_data_routes.instrument_metadata("AAPL.US", "2026-01-01", "2026-01-02")
    assert us["trading_calendar"]["id"] == "XNYS"
    assert us["corporate_actions"] == {
        "status": "loaded", "source": "yahoo_finance_events", "authority": "market_data_provider",
        "start": "2026-01-01", "end": "2026-01-02", "events": [{"type": "split", "ratio": "4:1"}],
    }
    crypto = market_data_routes.instrument_metadata("BTC-USDT")
    assert crypto["corporate_actions"]["status"] == "not_supported"
