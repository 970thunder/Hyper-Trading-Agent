"""LongPort (Longbridge) OpenAPI-backed loader for US and HK equity OHLCV data."""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any, List, Optional

import pandas as pd

from backtest.loaders.base import NoAvailableSourceError, loader_cache_get, loader_cache_put, validate_date_range
from backtest.loaders.registry import register
from src.trading.connectors.longbridge.credentials import LongbridgeCredentialError, resolve_longbridge_credentials

logger = logging.getLogger(__name__)

_OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]
_INTERVAL_MAP: dict[str, str] = {
    "1D": "Day", "1W": "Week", "1M": "Month", "1H": "Min_60", "1h": "Min_60",
    "1m": "Min_1", "5m": "Min_5", "15m": "Min_15", "30m": "Min_30",
}
_MAX_WINDOW_DAYS = 180
_MAX_WINDOWS = 20


class LongbridgeDependencyError(RuntimeError):
    """Raised when the optional ``longbridge`` SDK is not installed."""


def _require_longbridge():
    try:
        from longbridge import openapi  # noqa: PLC0415
    except ImportError as exc:
        raise LongbridgeDependencyError(
            "The 'longbridge' SDK is not installed. Run: pip install 'vibe-trading-ai[longbridge]'"
        ) from exc
    return openapi


def _to_longport_symbol(code: str) -> str:
    """Convert a project symbol to the LongPort convention."""
    upper = code.strip().upper()
    return upper if "." in upper else f"{upper}.US"


def _to_longport_period(interval: str):
    openapi = _require_longbridge()
    attribute = _INTERVAL_MAP.get(interval.strip())
    if attribute is None:
        raise NoAvailableSourceError(
            f"unsupported Longbridge interval: {interval!r}; supported intervals: {sorted(_INTERVAL_MAP)}"
        )
    try:
        return getattr(openapi.Period, attribute)
    except AttributeError as exc:
        raise NoAvailableSourceError(f"installed Longbridge SDK does not expose Period.{attribute}") from exc


def _date_windows(start: dt.date, end: dt.date) -> list[tuple[dt.date, dt.date]]:
    """Bound history requests so an SDK cap can never silently truncate data."""
    requested_days = (end - start).days + 1
    maximum_days = _MAX_WINDOW_DAYS * _MAX_WINDOWS
    if requested_days > maximum_days:
        raise NoAvailableSourceError(
            f"Longbridge date range spans {requested_days} days and exceeds the {maximum_days}-day window limit"
        )
    windows: list[tuple[dt.date, dt.date]] = []
    cursor = start
    while cursor <= end and len(windows) < _MAX_WINDOWS:
        window_end = min(cursor + dt.timedelta(days=_MAX_WINDOW_DAYS - 1), end)
        windows.append((cursor, window_end))
        cursor = window_end + dt.timedelta(days=1)
    return windows


def _normalize_frame(bars: list[Any]) -> pd.DataFrame:
    """Normalize LongPort candlesticks to the standard OHLCV contract."""
    if not bars:
        return pd.DataFrame(columns=_OHLCV_COLUMNS)
    rows = [{
        "open": float(getattr(bar, "open", 0) or 0),
        "high": float(getattr(bar, "high", 0) or 0),
        "low": float(getattr(bar, "low", 0) or 0),
        "close": float(getattr(bar, "close", 0) or 0),
        "volume": float(getattr(bar, "volume", 0) or 0),
        "trade_date": pd.to_datetime(getattr(bar, "timestamp", None)),
    } for bar in bars]
    result = pd.DataFrame(rows)
    result.index = result["trade_date"]
    result.index.name = "trade_date"
    result = result[_OHLCV_COLUMNS].copy()
    if isinstance(result.index, pd.DatetimeIndex) and result.index.tz is not None:
        result.index = result.index.tz_convert("UTC").tz_localize(None)
    result = result.dropna(subset=["open", "high", "low", "close"])
    result["volume"] = result["volume"].fillna(0.0)
    return result[~result.index.duplicated(keep="last")].sort_index()


@register
class LongbridgeLoader:
    """Fetch US and HK equity history using the optional Longbridge SDK."""

    name = "longbridge"
    markets = {"us_equity", "hk_equity"}
    requires_auth = True

    def __init__(self) -> None:
        try:
            resolution = resolve_longbridge_credentials()
        except LongbridgeCredentialError as exc:
            self._credential_error = exc
            self._app_key = self._app_secret = self._access_token = ""
            return
        self._credential_error: LongbridgeCredentialError | None = None
        if resolution.credentials is None:
            code = "credentials_conflict" if resolution.conflict_fields else (
                "credentials_missing" if resolution.source is None else "credentials_partial"
            )
            self._credential_error = LongbridgeCredentialError(code, resolution.conflict_fields or resolution.missing_fields)
            self._app_key = self._app_secret = self._access_token = ""
            return
        self._app_key = resolution.credentials.app_key
        self._app_secret = resolution.credentials.app_secret
        self._access_token = resolution.credentials.access_token

    def is_available(self) -> bool:
        if not (self._app_key and self._app_secret and self._access_token):
            return False
        try:
            _require_longbridge()
            return True
        except Exception:
            return False

    def fetch(
        self, codes: List[str], start_date: str, end_date: str, *, interval: str = "1D", fields: Optional[List[str]] = None,
    ) -> dict[str, pd.DataFrame]:
        del fields
        if not codes:
            return {}
        validate_date_range(start_date, end_date)
        results: dict[str, pd.DataFrame] = {}
        pending: List[str] = []
        for code in codes:
            cached = loader_cache_get(source=self.name, symbol=code, timeframe=interval, start_date=start_date, end_date=end_date, fields=None)
            if cached is not None:
                results[code] = cached.copy()
            else:
                pending.append(code)
        if not pending:
            return results
        credential_error = getattr(self, "_credential_error", None)
        if credential_error is not None or not (self._app_key and self._app_secret and self._access_token):
            fields_text = ", ".join(getattr(credential_error, "fields", []))
            diagnostic = getattr(credential_error, "code", "")
            raise NoAvailableSourceError(
                f"Longbridge {diagnostic + '; ' if diagnostic else ''}credentials are not configured; set LONGBRIDGE_APP_KEY, LONGBRIDGE_APP_SECRET, and "
                f"LONGBRIDGE_ACCESS_TOKEN{f'; affected fields: {fields_text}' if fields_text else ''}"
            )
        openapi = _require_longbridge()
        initialization_failed = False
        try:
            context = openapi.QuoteContext(openapi.Config(self._app_key, self._app_secret, self._access_token))
        except Exception:
            initialization_failed = True
            context = None
        if initialization_failed:
            raise NoAvailableSourceError("Longbridge SDK initialization failed.")
        try:
            start, end = dt.date.fromisoformat(start_date), dt.date.fromisoformat(end_date)
        except (TypeError, ValueError):
            raise NoAvailableSourceError("Invalid Longbridge date range.") from None
        period = _to_longport_period(interval)
        adjust_type = openapi.AdjustType.NoAdjust
        for code in pending:
            all_bars: list[Any] = []
            window_failed = False
            try:
                for window_start, window_end in _date_windows(start, end):
                    bars = context.history_candlesticks_by_date(
                        _to_longport_symbol(code), period, adjust_type, start=window_start, end=window_end,
                    )
                    if isinstance(bars, (list, tuple)):
                        all_bars.extend(bars)
                    elif bars is not None:
                        all_bars.append(bars)
            except Exception:
                window_failed = True
            if window_failed:
                raise NoAvailableSourceError("Longbridge history request failed.")
            if not all_bars:
                logger.warning("Longbridge returned no data for %s in [%s, %s]", code, start_date, end_date)
                continue
            frame = _normalize_frame(all_bars)
            loader_cache_put(source=self.name, symbol=code, timeframe=interval, start_date=start_date, end_date=end_date, fields=None, frame=frame)
            results[code] = frame
        return results
