"""Optional FTShare-backed A-share and Hong Kong equity OHLCV loader."""

from __future__ import annotations

import logging
import re
from typing import Any, List, Optional

import pandas as pd

from backtest.loaders.base import NoAvailableSourceError, cached_loader_fetch, validate_date_range
from backtest.loaders.registry import register

logger = logging.getLogger(__name__)
_OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]
_A_SHARE_RE = re.compile(r"^(?P<code>\d{6})\.(?P<exchange>SH|XSHG|SZ|XSHE|BJ|BJSE)$", re.IGNORECASE)
_HK_RE = re.compile(r"^(?P<code>\d{1,5})\.HK$", re.IGNORECASE)
_A_SHARE_INTERVALS = {"1D": "Day", "1W": "Week", "1M": "Month"}
_HK_INTERVALS = {"1D": "day", "1M": "month"}


class FTShareDependencyError(RuntimeError):
    """Raised when the optional FTShare SDK is unavailable."""


def _require_ftshare() -> Any:
    try:
        import ftshare  # noqa: PLC0415
    except ImportError as exc:
        raise FTShareDependencyError(
            'The ftshare SDK is not installed. Run: pip install "ftshare @ git+https://github.com/FTShare-Lab/FTShare-python-sdk.git@v0.1.1"'
        ) from exc
    return ftshare


def _normalize_symbol(code: str) -> tuple[str, str] | None:
    value = code.strip().upper()
    a_share = _A_SHARE_RE.fullmatch(value)
    if a_share:
        suffix = {"SH": "XSHG", "XSHG": "XSHG", "SZ": "XSHE", "XSHE": "XSHE", "BJ": "BJSE", "BJSE": "BJSE"}[a_share.group("exchange")]
        return "a_share", f"{a_share.group('code')}.{suffix}"
    hk = _HK_RE.fullmatch(value)
    return ("hk_equity", f"{int(hk.group('code')):05d}.HK") if hk else None


def _normalize_frame(frame: pd.DataFrame, *, market: str) -> pd.DataFrame:
    if frame is None or frame.empty:
        return pd.DataFrame(columns=_OHLCV_COLUMNS)
    if market == "a_share":
        timestamp = next((name for name in ("open_ts_ms", "close_ts_ms") if name in frame), None)
        if timestamp is None:
            return pd.DataFrame(columns=_OHLCV_COLUMNS)
        dates = pd.to_datetime(frame[timestamp], unit="ms", errors="coerce", utc=True).dt.tz_convert("Asia/Shanghai").dt.tz_localize(None).dt.normalize()
    else:
        if "date" not in frame:
            return pd.DataFrame(columns=_OHLCV_COLUMNS)
        dates = pd.to_datetime(frame["date"], errors="coerce")
    missing = [column for column in _OHLCV_COLUMNS if column not in frame]
    if missing:
        logger.warning("FTShare response missing OHLCV columns: %s", missing)
        return pd.DataFrame(columns=_OHLCV_COLUMNS)
    normalized = frame[_OHLCV_COLUMNS].copy()
    for column in _OHLCV_COLUMNS:
        normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
    normalized.index = pd.DatetimeIndex(dates, name="trade_date")
    normalized = normalized[~normalized.index.isna()].dropna(subset=["open", "high", "low", "close"])
    normalized["volume"] = normalized["volume"].fillna(0.0)
    return normalized[~normalized.index.duplicated(keep="last")].sort_index()


def _a_share_interval(interval: str) -> str:
    allowed = _A_SHARE_INTERVALS
    value = allowed.get(interval.strip())
    if value is None:
        raise NoAvailableSourceError(f"unsupported FTShare A-share interval: {interval!r}; supported intervals: {sorted(allowed)}")
    return value


def _hk_interval(interval: str) -> str:
    value = _HK_INTERVALS.get(interval.strip())
    if value is None:
        raise NoAvailableSourceError(f"unsupported FTShare HK interval: {interval!r}; supported intervals: {sorted(_HK_INTERVALS)}")
    return value


@register
class DataLoader:
    """Fetch A-share and HK bars via the optional FTShare SDK."""

    name = "feitu"
    markets = {"a_share", "hk_equity"}
    requires_auth = False

    def is_available(self) -> bool:
        try:
            _require_ftshare()
            return True
        except FTShareDependencyError:
            return False

    def fetch(
        self, codes: List[str], start_date: str, end_date: str, *, interval: str = "1D", fields: Optional[List[str]] = None,
    ) -> dict[str, pd.DataFrame]:
        del fields
        if not codes:
            return {}
        validate_date_range(start_date, end_date)
        pending = [(code, _normalize_symbol(code)) for code in codes]
        pending = [(code, symbol) for code, symbol in pending if symbol is not None]
        if not pending:
            return {}
        client: Any | None = None

        def get_client() -> Any:
            nonlocal client
            if client is None:
                try:
                    client = _require_ftshare().market_api(timeout=20)
                except Exception as exc:
                    raise NoAvailableSourceError("Cannot initialise FTShare SDK client") from exc
            return client

        results: dict[str, pd.DataFrame] = {}
        try:
            for code, symbol in pending:
                assert symbol is not None
                market, sdk_symbol = symbol
                try:
                    frame = cached_loader_fetch(
                        source=self.name, symbol=code, timeframe=interval, start_date=start_date, end_date=end_date, fields=None,
                        fetch=lambda market=market, sdk_symbol=sdk_symbol: self._fetch_one(get_client(), market, sdk_symbol, start_date, end_date, interval),
                    )
                except Exception as exc:
                    logger.warning("FTShare failed for %s: %s", code, exc)
                    continue
                if frame is not None and not frame.empty:
                    results[code] = frame
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()
        return results

    @staticmethod
    def _fetch_one(client: Any, market: str, symbol: str, start_date: str, end_date: str, interval: str) -> pd.DataFrame:
        if market == "a_share":
            frame = client.stock_ohlcs(
                symbol=symbol, since=pd.Timestamp(start_date).strftime("%Y%m%d"), until=pd.Timestamp(end_date).strftime("%Y%m%d"),
                interval=_a_share_interval(interval), adjust="Forward",
            )
        else:
            frame = client.hk_candlesticks(
                trade_code=symbol, interval_unit=_hk_interval(interval), since_date=pd.Timestamp(start_date).strftime("%Y-%m-%d"),
                until_date=pd.Timestamp(end_date).strftime("%Y-%m-%d"), interval_value=1, adjust_kind="forward",
            )
        return _normalize_frame(frame, market=market)
