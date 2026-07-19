"""Shared market data helpers for MCP and local agent tools."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import threading
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from src.market_quality import quality_contract

logger = logging.getLogger(__name__)

DEFAULT_MAX_ROWS = 250
MARKET_DATA_MAX_SYMBOLS = 12
MARKET_DATA_MAX_ROWS = 5_000
MARKET_DATA_CACHE_ENV = "VIBE_TRADING_MARKET_CACHE"
MARKET_DATA_CACHE_ROOT_ENV = "VIBE_TRADING_MARKET_CACHE_ROOT"
MARKET_DATA_CACHE_TTL_ENV = "VIBE_TRADING_MARKET_CACHE_LIVE_TTL_SECONDS"
_CACHE_ENABLED_VALUES = {"1", "true", "yes", "on"}
_snapshot_locks: dict[str, threading.Lock] = {}
_snapshot_locks_guard = threading.Lock()

SOURCE_LABELS = {
    "akshare": "AkShare",
    "alphavantage": "Alpha Vantage",
    "baostock": "BaoStock",
    "ccxt": "CCXT",
    "eastmoney": "Eastmoney",
    "feitu": "FTShare",
    "finnhub": "Finnhub",
    "fmp": "Financial Modeling Prep",
    "futu": "Futu",
    "local": "Local Data Bridge",
    "longbridge": "Longbridge",
    "mootdx": "MoTDX",
    "okx": "OKX",
    "sina": "Sina Finance",
    "stooq": "Stooq",
    "tencent": "Tencent Finance",
    "tiingo": "Tiingo",
    "tushare": "Tushare",
    "yahoo": "Yahoo Finance",
    "yfinance": "yfinance",
}

# Symbol -> preferred source. The matched source is the head of its market's
# fallback chain (registry.FALLBACK_CHAINS), so an unavailable preferred source
# still degrades gracefully to the rest of the chain. US/HK equities route to
# the throttle-tolerant Yahoo public endpoint first (lower IP-ban risk than the
# yfinance SDK), A-shares to the Tencent quote endpoint.
_SOURCE_PATTERNS = [
    (re.compile(r"^local:", re.I), "local"),
    (re.compile(r"^\d{6}\.(SZ|SH|BJ)$", re.I), "tencent"),
    (re.compile(r"^[A-Z]+\.US$", re.I), "yahoo"),
    (re.compile(r"^\d{3,5}\.HK$", re.I), "yahoo"),
    (re.compile(r"^[A-Z]+-USDT$", re.I), "okx"),
    (re.compile(r"^[A-Z]+/USDT$", re.I), "ccxt"),
]


def detect_source(code: str) -> str:
    """Infer the best loader source for a normalized symbol."""
    for pattern, source in _SOURCE_PATTERNS:
        if pattern.match(code):
            return source
    return "tushare"


def get_loader(source: str):
    """Get loader class via registry with fallback support."""
    from backtest.loaders.registry import get_loader_cls_with_fallback

    return get_loader_cls_with_fallback(source)


def cap_rows(records: list, max_rows: int) -> list | dict[str, object]:
    """Bound a per-symbol row list to keep tool payloads within budget."""
    n = len(records)
    if max_rows < 0:
        max_rows = DEFAULT_MAX_ROWS
    if max_rows == 0 or n <= max_rows:
        return records
    step = math.ceil(n / max_rows)
    sampled = records[::step]
    if sampled[-1] is not records[-1]:
        sampled = sampled + [records[-1]]
    return {
        "rows": n,
        "returned": len(sampled),
        "truncated": True,
        "policy": f"every-{step}th-row (even stride; last bar pinned)",
        "hint": "narrow the date range, coarsen interval, or set max_rows=0 for all rows",
        "data": sampled,
    }


def _json_safe(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def fetch_market_data(
    *,
    codes: list[str],
    start_date: str,
    end_date: str,
    source: str = "auto",
    interval: str = "1D",
    max_rows: int = DEFAULT_MAX_ROWS,
    loader_resolver: Callable[[str], type] = get_loader,
) -> dict[str, Any]:
    """Fetch normalized OHLCV data through the repository loader layer."""
    results: dict[str, Any] = {}

    if source == "auto":
        groups: dict[str, list[str]] = {}
        for code in codes:
            src = detect_source(code)
            groups.setdefault(src, []).append(code)
    else:
        groups = {source: list(codes)}

    for src, src_codes in groups.items():
        loader_cls = loader_resolver(src)
        loader = loader_cls()
        try:
            data_map = loader.fetch(src_codes, start_date, end_date, interval=interval)
        except Exception:
            logger.exception(
                "market-data loader %r failed for %s; codes fall through to _unresolved",
                src,
                src_codes,
            )
            data_map = {}
        for symbol, df in data_map.items():
            records = df.reset_index().to_dict(orient="records")
            for row in records:
                for key, value in row.items():
                    row[key] = _json_safe(value)
            results[symbol] = cap_rows(records, max_rows)

    unresolved = [code for code in codes if code not in results]
    if unresolved:
        results["_unresolved"] = unresolved

    return results


def fetch_market_data_json(**kwargs: Any) -> str:
    """Fetch market data and return strict JSON."""
    return json.dumps(fetch_market_data(**kwargs), ensure_ascii=False, indent=2, allow_nan=False)


def list_market_data_sources() -> dict[str, Any]:
    """Return the registered provider catalog with runtime availability.

    Availability is intentionally evaluated per provider, rather than inferred
    from a fallback result.  The UI can therefore distinguish a configured
    source from the provider that would currently serve a request.
    """
    from backtest.loaders.base import loader_cache_enabled, loader_cache_root
    from backtest.loaders.registry import FALLBACK_CHAINS, LOADER_REGISTRY, _ensure_registered

    _ensure_registered()
    fallback_markets: dict[str, list[str]] = {}
    for market, chain in FALLBACK_CHAINS.items():
        for source in chain:
            fallback_markets.setdefault(source, []).append(market)

    sources: list[dict[str, Any]] = []
    for name, loader_cls in sorted(LOADER_REGISTRY.items()):
        available = False
        error = ""
        try:
            available = bool(loader_cls().is_available())
        except Exception as exc:  # Optional integrations commonly fail on missing credentials.
            error = str(exc)
        sources.append({
            "id": name,
            "label": SOURCE_LABELS.get(name, name),
            "available": available,
            "requires_auth": bool(getattr(loader_cls, "requires_auth", False)),
            "markets": sorted(getattr(loader_cls, "markets", set())),
            "fallback_markets": sorted(fallback_markets.get(name, [])),
            "error": error,
        })

    return {
        "sources": sources,
        "fallback_chains": FALLBACK_CHAINS,
        "cache": {
            "enabled": loader_cache_enabled(),
            "root": str(loader_cache_root()),
            "policy": "Only completed daily ranges are cached; ranges ending today are always refreshed.",
        },
    }


def _fetch_market_data_snapshot_uncached(
    *,
    codes: list[str],
    start_date: str,
    end_date: str,
    source: str = "auto",
    interval: str = "1D",
    adjustment: str = "raw",
    max_rows: int = MARKET_DATA_MAX_ROWS,
    loader_resolver: Callable[[str], type] = get_loader,
) -> dict[str, Any]:
    """Fetch chart-ready series plus provenance and completeness metadata.

    This is the HTTP-facing counterpart of :func:`fetch_market_data`.  The
    original helper remains compact for agent tool calls; this richer response
    is deliberately explicit about cache usage and loader fallback so a visual
    chart never hides where its bars actually came from.
    """
    if not codes:
        raise ValueError("At least one symbol is required")
    normalized_codes = list(dict.fromkeys(code.strip().upper() for code in codes if code.strip()))
    if len(normalized_codes) > MARKET_DATA_MAX_SYMBOLS:
        raise ValueError(f"Maximum {MARKET_DATA_MAX_SYMBOLS} symbols per request")
    if max_rows < 1 or max_rows > MARKET_DATA_MAX_ROWS:
        raise ValueError(f"max_rows must be between 1 and {MARKET_DATA_MAX_ROWS}")
    if adjustment not in {"raw", "forward", "backward"}:
        raise ValueError("adjustment must be raw, forward, or backward")

    from backtest.loaders.base import loader_cache_enabled, loader_cache_get, validate_date_range

    validate_date_range(start_date, end_date)
    groups: dict[str, list[str]] = {}
    if source == "auto":
        for code in normalized_codes:
            groups.setdefault(detect_source(code), []).append(code)
    else:
        groups[source] = normalized_codes

    series: list[dict[str, Any]] = []
    unresolved: list[str] = []
    generated_at = datetime.now(timezone.utc).isoformat()
    for requested_source, group_codes in groups.items():
        try:
            loader_cls = loader_resolver(requested_source)
            loader = loader_cls()
            actual_source = str(getattr(loader_cls, "name", requested_source))
        except Exception as exc:
            logger.warning("market-data source resolution failed for %s: %s", requested_source, exc)
            unresolved.extend(group_codes)
            continue

        cache_hits = {
            code: bool(loader_cache_enabled() and loader_cache_get(
                source=actual_source,
                symbol=code,
                timeframe=interval,
                start_date=start_date,
                end_date=end_date,
                fields=None,
            ) is not None)
            for code in group_codes
        }
        try:
            frames = loader.fetch(group_codes, start_date, end_date, interval=interval)
        except Exception as exc:
            logger.warning("market-data loader %r failed for %s: %s", actual_source, group_codes, exc)
            frames = {}

        for code in group_codes:
            frame = frames.get(code)
            if frame is None or frame.empty:
                unresolved.append(code)
                continue
            records = _frame_records(frame)
            source_bars = len(records)
            capped = cap_rows(records, max_rows)
            if isinstance(capped, dict):
                records = capped["data"]
                truncated = True
            else:
                truncated = False
            timestamps = [row.get("trade_date") for row in records if row.get("trade_date")]
            series.append({
                "symbol": code,
                "requested_source": requested_source,
                "source": actual_source,
                "interval": interval,
                "cache_hit": cache_hits[code],
                "bars": records,
                "quality": quality_contract(
                    symbol=code,
                    timestamps=timestamps,
                    source_bars=source_bars,
                    returned_bars=len(records),
                    start_date=start_date,
                    end_date=end_date,
                    truncated=truncated,
                    adjustment=adjustment,
                    generated_at=generated_at,
                ),
            })

    return {
        "query": {
            "symbols": normalized_codes,
            "start_date": start_date,
            "end_date": end_date,
            "source": source,
            "interval": interval,
            "adjustment": adjustment,
        },
        "series": series,
        "unresolved": list(dict.fromkeys(unresolved)),
        "generated_at": generated_at,
        "cache": list_market_data_sources()["cache"],
    }


def market_data_cache_root() -> Path:
    """Return the process-shared cache root used by every workspace user."""
    configured = os.getenv(MARKET_DATA_CACHE_ROOT_ENV, "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".hyper-trading-agent" / "cache" / "market-data"


def market_data_cache_enabled() -> bool:
    """Snapshots are on by default; deployments can explicitly disable them."""
    raw = os.getenv(MARKET_DATA_CACHE_ENV, "true").strip().lower()
    return raw in _CACHE_ENABLED_VALUES


def market_data_live_ttl_seconds() -> int:
    try:
        return max(30, int(os.getenv(MARKET_DATA_CACHE_TTL_ENV, "300")))
    except ValueError:
        return 300


def _snapshot_cache_key(*, codes: list[str], start_date: str, end_date: str, source: str, interval: str, adjustment: str, max_rows: int) -> str:
    payload = {"codes": codes, "start": start_date, "end": end_date, "source": source, "interval": interval, "adjustment": adjustment, "max_rows": max_rows, "version": 2}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _snapshot_cache_path(key: str) -> Path:
    return market_data_cache_root() / f"{key}.json"


def _snapshot_ttl(end_date: str) -> int | None:
    """Final historical ranges can be reused indefinitely; live ranges expire."""
    try:
        return None if datetime.fromisoformat(end_date).date() < datetime.now(timezone.utc).date() else market_data_live_ttl_seconds()
    except ValueError:
        return market_data_live_ttl_seconds()


def _read_snapshot_cache(key: str, ttl_seconds: int | None) -> dict[str, Any] | None:
    if not market_data_cache_enabled():
        return None
    path = _snapshot_cache_path(key)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        saved_at = float(payload["saved_at"])
        if ttl_seconds is not None and datetime.now(timezone.utc).timestamp() - saved_at > ttl_seconds:
            return None
        result = payload["result"]
        result["query_cache"] = {"status": "hit", "saved_at": datetime.fromtimestamp(saved_at, timezone.utc).isoformat(), "ttl_seconds": ttl_seconds, "origin": str(payload.get("origin") or "query")}
        return result
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def _write_snapshot_cache(key: str, result: dict[str, Any], *, origin: str) -> None:
    if not market_data_cache_enabled():
        return
    path = _snapshot_cache_path(key)
    temp = path.with_suffix(f".{threading.get_ident()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp.write_text(json.dumps({"saved_at": datetime.now(timezone.utc).timestamp(), "origin": origin, "result": result}, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        os.replace(temp, path)
    except OSError:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass


def fetch_market_data_snapshot(
    *,
    codes: list[str],
    start_date: str,
    end_date: str,
    source: str = "auto",
    interval: str = "1D",
    adjustment: str = "raw",
    max_rows: int = MARKET_DATA_MAX_ROWS,
    loader_resolver: Callable[[str], type] = get_loader,
    cache_origin: str = "query",
) -> dict[str, Any]:
    """Return a shared cached market-data snapshot, fetching only on a miss."""
    normalized_codes = list(dict.fromkeys(code.strip().upper() for code in codes if code.strip()))
    key = _snapshot_cache_key(codes=normalized_codes, start_date=start_date, end_date=end_date, source=source, interval=interval, adjustment=adjustment, max_rows=max_rows)
    ttl_seconds = _snapshot_ttl(end_date)
    # Injected resolvers are used by tests and callers with ephemeral data;
    # they must not read or write the production-wide snapshot store.
    cache_allowed = loader_resolver is get_loader
    cached = _read_snapshot_cache(key, ttl_seconds) if cache_allowed else None
    if cached is not None:
        return cached
    with _snapshot_locks_guard:
        lock = _snapshot_locks.setdefault(key, threading.Lock())
    with lock:
        cached = _read_snapshot_cache(key, ttl_seconds) if cache_allowed else None
        if cached is not None:
            return cached
        result = _fetch_market_data_snapshot_uncached(codes=normalized_codes, start_date=start_date, end_date=end_date, source=source, interval=interval, adjustment=adjustment, max_rows=max_rows, loader_resolver=loader_resolver)
        result["query_cache"] = {"status": "miss", "saved_at": result["generated_at"], "ttl_seconds": ttl_seconds, "origin": cache_origin}
        if cache_allowed:
            _write_snapshot_cache(key, result, origin=cache_origin)
        return result


def prewarm_market_data_cache() -> dict[str, Any]:
    """Populate common daily snapshots in a background worker after startup."""
    if os.getenv("VIBE_TRADING_MARKET_PREWARM", "true").strip().lower() not in _CACHE_ENABLED_VALUES:
        return {"status": "disabled", "symbols": []}
    symbols = [value.strip().upper() for value in os.getenv("VIBE_TRADING_MARKET_PREWARM_SYMBOLS", "BTC-USDT,ETH-USDT,600519.SH,AAPL.US").split(",") if value.strip()]
    try:
        days = max(30, min(3650, int(os.getenv("VIBE_TRADING_MARKET_PREWARM_DAYS", "365"))))
    except ValueError:
        days = 365
    end_date = datetime.now(timezone.utc).date() - timedelta(days=1)
    start_date = end_date - timedelta(days=days)
    warmed: list[str] = []
    for symbol in symbols[:MARKET_DATA_MAX_SYMBOLS]:
        try:
            result = fetch_market_data_snapshot(codes=[symbol], start_date=start_date.isoformat(), end_date=end_date.isoformat(), cache_origin="prewarm")
            if result["series"]:
                warmed.append(symbol)
        except Exception:
            logger.exception("market-data prewarm failed for %s", symbol)
    return {"status": "complete", "symbols": warmed, "start_date": start_date.isoformat(), "end_date": end_date.isoformat()}


def _frame_records(frame: Any) -> list[dict[str, Any]]:
    records = frame.reset_index().to_dict(orient="records")
    for row in records:
        for key, value in row.items():
            row[key] = _json_safe(value)
        # Every loader indexes bars differently, but chart consumers need one
        # stable timestamp key.
        if "trade_date" not in row:
            for candidate in ("date", "datetime", "timestamp", "index"):
                if candidate in row:
                    row["trade_date"] = row[candidate]
                    break
    return records


def _quality_summary(
    *,
    timestamps: list[Any],
    source_bars: int,
    returned_bars: int,
    start_date: str,
    end_date: str,
    truncated: bool,
) -> dict[str, Any]:
    parsed = sorted({str(value) for value in timestamps})
    max_gap_days = 0
    if len(parsed) > 1:
        try:
            dates = [datetime.fromisoformat(value.replace("Z", "+00:00")) for value in parsed]
            max_gap_days = max((right - left).days for left, right in zip(dates, dates[1:]))
        except ValueError:
            max_gap_days = 0
    return {
        "requested_start": start_date,
        "requested_end": end_date,
        "first_bar": parsed[0] if parsed else None,
        "last_bar": parsed[-1] if parsed else None,
        "source_bars": source_bars,
        "returned_bars": returned_bars,
        "truncated": truncated,
        "max_gap_days": max_gap_days,
        "status": "partial" if truncated or not parsed else "complete",
    }
