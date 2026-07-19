"""Market-data workspace HTTP routes with source provenance."""

from __future__ import annotations

import sys as _sys
import json
import threading
import time
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from src.market_data import MARKET_DATA_MAX_ROWS, MARKET_DATA_MAX_SYMBOLS, fetch_market_data_snapshot, list_market_data_sources, prewarm_market_data_cache
from src.crypto_derivatives import fetch_crypto_derivatives_snapshot

_SYMBOL_SEARCH_TTL_SECONDS = 900
_symbol_search_cache: dict[tuple[str, int], tuple[float, dict]] = {}
_symbol_search_lock = threading.Lock()
_MARKET_METADATA = {
    "cn": {"exchange": "China mainland", "timezone": "Asia/Shanghai", "session": "09:30-11:30, 13:00-15:00", "currency": "CNY", "calendar": "XSHG"},
    "hk": {"exchange": "Hong Kong Exchange", "timezone": "Asia/Hong_Kong", "session": "09:30-12:00, 13:00-16:00", "currency": "HKD", "calendar": "XHKG"},
    "us": {"exchange": "United States", "timezone": "America/New_York", "session": "09:30-16:00", "currency": "USD", "calendar": "XNYS"},
    "crypto": {"exchange": "Global crypto", "timezone": "UTC", "session": "24/7", "currency": "USD", "calendar": "CRYPTO_24_7"},
    "forex": {"exchange": "Global FX", "timezone": "UTC", "session": "24/5", "currency": "USD", "calendar": "FX_24_5"},
}


def _asset_class(candidate: dict) -> str:
    value = str(candidate.get("type") or "").lower()
    if any(token in value for token in ("crypto", "cryptocurrency")):
        return "crypto"
    if any(token in value for token in ("currency", "forex")):
        return "forex"
    if "etf" in value or "fund" in value:
        return "fund"
    if "index" in value:
        return "index"
    if "future" in value:
        return "future"
    return "equity" if str(candidate.get("market") or "").lower() in {"cn", "hk", "us"} else "other"


def _instrument_metadata(candidate: dict) -> dict:
    """Normalize authoritative market conventions without inventing events."""
    market = str(candidate.get("market") or "").lower()
    base = dict(_MARKET_METADATA.get(market, {"exchange": "Global", "timezone": "UTC", "session": "provider_defined", "currency": None, "calendar": "provider_defined"}))
    asset_class = _asset_class(candidate)
    symbol = str(candidate.get("symbol") or "").upper()
    if asset_class == "crypto" and "-" in symbol:
        base["currency"] = symbol.rsplit("-", 1)[-1]
    elif asset_class == "forex" and symbol.endswith("=X") and len(symbol) >= 7:
        base["currency"] = symbol[-3 - len("=X"):-len("=X")] or base["currency"]
    return {
        **base,
        "asset_class": asset_class,
        "metadata_authority": "exchange_convention",
        "corporate_actions": {
            "status": "not_loaded",
            "source": "sec_edgar" if candidate.get("cik") else "provider_required",
            "reason": "symbol search does not establish a complete corporate-action history",
        },
        "trading_calendar": {"id": base.pop("calendar"), "timezone": base["timezone"], "session": base["session"], "holiday_source": "exchange_official_calendar"},
    }


def _host():
    return _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")


def _symbols(raw: str) -> list[str]:
    values = list(dict.fromkeys(item.strip().upper() for item in raw.replace(";", ",").split(",") if item.strip()))
    if not values:
        raise HTTPException(status_code=400, detail="At least one symbol is required")
    if len(values) > MARKET_DATA_MAX_SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Maximum {MARKET_DATA_MAX_SYMBOLS} symbols per request")
    return values


def _audit_fetch(principal, payload: dict) -> None:
    if principal is None:
        return
    try:
        from src.commercial.store import CommercialStore

        CommercialStore().audit(
            principal,
            str(payload.get("action") or "market_data.history.fetch"),
            "market_data_query",
            ",".join(payload.get("symbols") or []),
            payload,
        )
    except Exception:
        # Query provenance must never fail because the optional audit backend is unavailable.
        return


def search_market_symbols(query: str, limit: int) -> dict:
    """Run the normalized symbol search once per shared cache key and TTL."""
    normalized_query = query.strip()
    key = (normalized_query.casefold(), limit)
    now = time.monotonic()
    with _symbol_search_lock:
        cached = _symbol_search_cache.get(key)
        if cached is not None and now - cached[0] < _SYMBOL_SEARCH_TTL_SECONDS:
            result = dict(cached[1])
            result["query_cache"] = {"status": "hit", "ttl_seconds": _SYMBOL_SEARCH_TTL_SECONDS}
            return result
    from src.tools.symbol_search_tool import SymbolSearchTool

    payload = json.loads(SymbolSearchTool().execute(query=normalized_query, limit=limit))
    if not payload.get("ok"):
        raise ValueError(str(payload.get("error") or "symbol search failed"))
    result = dict(payload.get("data") or {})
    candidates = result.get("candidates")
    if isinstance(candidates, list):
        result["candidates"] = [
            {**candidate, **_instrument_metadata(candidate)}
            for candidate in candidates
            if isinstance(candidate, dict)
        ]
    result["query_cache"] = {"status": "miss", "ttl_seconds": _SYMBOL_SEARCH_TTL_SECONDS}
    with _symbol_search_lock:
        _symbol_search_cache[key] = (now, dict(result))
    return result


def register_market_data_routes(app: FastAPI) -> None:
    """Mount user-facing historical data and source-center endpoints."""
    host = _host()
    if host is None:
        raise RuntimeError("register_market_data_routes requires api_server")
    require_user = host.require_commercial_user_or_auth
    require_writer = host.require_commercial_writer_or_auth

    @app.on_event("startup")
    async def _prewarm_shared_market_data_cache() -> None:
        # The worker is intentionally detached: slow public providers must not
        # delay API readiness or block authenticated user requests.
        import threading

        threading.Thread(target=prewarm_market_data_cache, name="market-data-prewarm", daemon=True).start()

    @app.get("/market-data/sources", dependencies=[Depends(require_user)])
    async def market_data_sources():
        return await run_in_threadpool(list_market_data_sources)

    @app.get("/market-data/history", dependencies=[Depends(require_writer)])
    async def market_data_history(
        symbols: Annotated[str, Query(min_length=1, max_length=500)],
        start: Annotated[str, Query(min_length=10, max_length=32)],
        end: Annotated[str, Query(min_length=10, max_length=32)],
        source: Annotated[str, Query(min_length=1, max_length=32)] = "auto",
        interval: Annotated[str, Query(min_length=1, max_length=16)] = "1D",
        max_rows: Annotated[int, Query(ge=1, le=MARKET_DATA_MAX_ROWS)] = 2000,
        principal=Depends(require_writer),
    ):
        code_list = _symbols(symbols)
        try:
            result = await run_in_threadpool(
                fetch_market_data_snapshot,
                codes=code_list,
                start_date=start,
                end_date=end,
                source=source,
                interval=interval,
                max_rows=max_rows,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit_fetch(principal, {
            "symbols": code_list,
            "start": start,
            "end": end,
            "source": source,
            "interval": interval,
            "series_count": len(result["series"]),
            "unresolved": result["unresolved"],
        })
        return result

    @app.get("/market-data/symbol-search", dependencies=[Depends(require_user)])
    async def market_data_symbol_search(
        q: Annotated[str, Query(min_length=1, max_length=128)],
        limit: Annotated[int, Query(ge=1, le=25)] = 8,
        principal=Depends(require_user),
    ):
        try:
            result = await run_in_threadpool(search_market_symbols, q, limit)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit_fetch(principal, {"symbols": [], "query": q.strip(), "result_count": result.get("count", 0), "action": "market_data.symbol.search"})
        return result

    @app.get("/market-data/crypto-derivatives", dependencies=[Depends(require_writer)])
    async def crypto_derivatives(
        symbol: Annotated[str, Query(min_length=3, max_length=64)],
        exchanges: Annotated[str, Query(max_length=64)] = "okx,binance",
        principal=Depends(require_writer),
    ):
        requested = [item.strip().lower() for item in exchanges.split(",") if item.strip()]
        try:
            result = await run_in_threadpool(fetch_crypto_derivatives_snapshot, symbol, requested)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        _audit_fetch(principal, {"symbols": [symbol.strip().upper()], "exchanges": requested, "action": "market_data.crypto_derivatives.fetch"})
        return result
