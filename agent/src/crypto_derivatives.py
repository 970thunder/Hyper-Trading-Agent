"""Normalized public crypto derivatives metrics with source disclosure."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import httpx


CryptoFetcher = Callable[[str, dict[str, str]], Any]
SUPPORTED_EXCHANGES = {"okx", "binance"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _timestamp_millis(value: Any) -> str | None:
    number = _number(value)
    if number is None:
        return None
    return datetime.fromtimestamp(number / 1000, tz=timezone.utc).isoformat()


def _fetch_json(url: str, params: dict[str, str]) -> Any:
    response = httpx.get(url, params=params, timeout=10.0, follow_redirects=False)
    response.raise_for_status()
    return response.json()


def _metric(value: float | None, *, source: str, observed_at: str | None, status: str = "available", reason: str = "") -> dict[str, Any]:
    return {
        "value": value,
        "status": status,
        "source": source,
        "observed_at": observed_at,
        "reason": reason,
    }


def _okx_symbols(symbol: str) -> tuple[str, str]:
    normalized = symbol.upper().replace("/", "-")
    base_quote = normalized.removesuffix("-SWAP")
    return base_quote, f"{base_quote}-SWAP"


def _binance_symbol(symbol: str) -> str:
    return symbol.upper().replace("/", "").replace("-SWAP", "").replace("-", "")


def _okx_snapshot(symbol: str, fetcher: CryptoFetcher) -> dict[str, Any]:
    spot, perpetual = _okx_symbols(symbol)
    funding = fetcher("https://www.okx.com/api/v5/public/funding-rate", {"instId": perpetual})
    open_interest = fetcher("https://www.okx.com/api/v5/public/open-interest", {"instType": "SWAP", "instId": perpetual})
    perp_ticker = fetcher("https://www.okx.com/api/v5/market/ticker", {"instId": perpetual})
    spot_ticker = fetcher("https://www.okx.com/api/v5/market/ticker", {"instId": spot})
    funding_row = (funding.get("data") or [{}])[0]
    oi_row = (open_interest.get("data") or [{}])[0]
    perp_row = (perp_ticker.get("data") or [{}])[0]
    spot_row = (spot_ticker.get("data") or [{}])[0]
    observed_at = _timestamp_millis(funding_row.get("fundingTime") or perp_row.get("ts"))
    perp_price, spot_price = _number(perp_row.get("last")), _number(spot_row.get("last"))
    basis = (perp_price - spot_price) / spot_price if perp_price is not None and spot_price not in (None, 0) else None
    return {
        "exchange": "okx", "provider": "okx_public_api", "fetched_at": _now(),
        "metrics": {
            "funding_rate": _metric(_number(funding_row.get("fundingRate")), source="okx_public_funding_rate", observed_at=observed_at),
            "open_interest": _metric(_number(oi_row.get("oiUsd") or oi_row.get("oi")), source="okx_public_open_interest", observed_at=_timestamp_millis(oi_row.get("ts"))),
            "basis": _metric(basis, source="okx_spot_and_swap_tickers", observed_at=_timestamp_millis(perp_row.get("ts"))),
        },
    }


def _binance_snapshot(symbol: str, fetcher: CryptoFetcher) -> dict[str, Any]:
    pair = _binance_symbol(symbol)
    funding = fetcher("https://fapi.binance.com/fapi/v1/premiumIndex", {"symbol": pair})
    open_interest = fetcher("https://fapi.binance.com/fapi/v1/openInterest", {"symbol": pair})
    perp_ticker = fetcher("https://fapi.binance.com/fapi/v1/ticker/price", {"symbol": pair})
    spot_ticker = fetcher("https://api.binance.com/api/v3/ticker/price", {"symbol": pair})
    observed_at = _timestamp_millis(funding.get("time"))
    perp_price, spot_price = _number(perp_ticker.get("price")), _number(spot_ticker.get("price"))
    basis = (perp_price - spot_price) / spot_price if perp_price is not None and spot_price not in (None, 0) else None
    return {
        "exchange": "binance", "provider": "binance_public_futures_api", "fetched_at": _now(),
        "metrics": {
            "funding_rate": _metric(_number(funding.get("lastFundingRate")), source="binance_premium_index", observed_at=observed_at),
            "open_interest": _metric(_number(open_interest.get("openInterest")), source="binance_open_interest", observed_at=_timestamp_millis(open_interest.get("time"))),
            "basis": _metric(basis, source="binance_spot_and_futures_tickers", observed_at=_timestamp_millis(perp_ticker.get("time"))),
        },
    }


def fetch_crypto_derivatives_snapshot(symbol: str, exchanges: list[str] | None = None, *, fetcher: CryptoFetcher = _fetch_json) -> dict[str, Any]:
    """Return comparable cross-exchange derivatives metrics without inferring absent data."""
    normalized_symbol = symbol.strip().upper()
    if not normalized_symbol or len(normalized_symbol) > 64:
        raise ValueError("a valid crypto symbol is required")
    requested = list(dict.fromkeys((name or "").strip().lower() for name in (exchanges or ["okx", "binance"])))
    if not requested or any(name not in SUPPORTED_EXCHANGES for name in requested):
        raise ValueError("exchanges must be selected from okx and binance")
    adapters = {"okx": _okx_snapshot, "binance": _binance_snapshot}
    snapshots: list[dict[str, Any]] = []
    for exchange in requested:
        try:
            snapshots.append(adapters[exchange](normalized_symbol, fetcher))
        except Exception as exc:  # Public providers are independently optional.
            snapshots.append({
                "exchange": exchange, "provider": f"{exchange}_public_api", "fetched_at": _now(), "error": str(exc),
                "metrics": {
                    metric: _metric(None, source=f"{exchange}_public_api", observed_at=None, status="unavailable", reason="provider_request_failed")
                    for metric in ("funding_rate", "open_interest", "basis")
                },
            })
    unavailable = {
        metric: _metric(None, source="provider_required", observed_at=None, status="not_configured", reason="no normalized public provider is configured")
        for metric in ("liquidations", "on_chain")
    }
    return {
        "symbol": normalized_symbol,
        "requested_exchanges": requested,
        "exchanges": snapshots,
        "unavailable_metrics": unavailable,
        "normalization": {"basis": "(perpetual_last - spot_last) / spot_last", "funding_rate": "decimal rate per provider funding interval"},
    }
