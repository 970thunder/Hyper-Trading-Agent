"""Read-only portfolio snapshot routes.

This surface deliberately depends only on connector read operations. It never
imports order submission, mandate commits, or runner controls.
"""

from __future__ import annotations

import math
import sys as _sys
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool


def _host():
    return _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")


def _number(value: object) -> float | None:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _first_number(row: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = _number(row.get(key))
        if value is not None:
            return value
    return None


def _position_rows(payload: object) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("positions") or payload.get("data") or []
    else:
        rows = []
    return [dict(row) for row in rows if isinstance(row, dict)]


def _account_value(payload: object) -> tuple[float | None, float | None]:
    account = payload if isinstance(payload, dict) else {}
    equity = _first_number(account, "portfolio_value", "equity", "net_liquidation", "account_value")
    cash = _first_number(account, "cash", "available_cash", "buying_power")
    return equity, cash


def _risk_level(concentration: float | None, leverage: float | None) -> str:
    peak = max(concentration or 0, leverage or 0)
    if peak >= 0.50 or (leverage or 0) >= 1.50:
        return "critical"
    if peak >= 0.30 or (leverage or 0) >= 1.00:
        return "high"
    if peak >= 0.20:
        return "moderate"
    return "low"


def build_portfolio_snapshot(profile_id: str | None = None) -> dict[str, Any]:
    """Read and normalize one configured connector portfolio without mutation."""
    from src.trading.profiles import profile_by_id
    from src.trading.service import get_account, get_positions

    profile = profile_by_id(profile_id)
    account = get_account(profile.id)
    positions_payload = get_positions(profile.id)
    rows: list[dict[str, Any]] = []
    gross_exposure = 0.0
    unrealized_pnl = 0.0
    reported_pnl = False

    for raw in _position_rows(positions_payload):
        quantity = _first_number(raw, "quantity", "qty", "position", "size")
        current_price = _first_number(raw, "current_price", "market_price", "last_price", "price")
        market_value = _first_number(raw, "market_value", "marketValue", "value", "notional")
        if market_value is None and quantity is not None and current_price is not None:
            market_value = quantity * current_price
        if market_value is None:
            continue
        pnl = _first_number(raw, "unrealized_pnl", "unrealized_pl", "pnl", "upl")
        if pnl is not None:
            unrealized_pnl += pnl
            reported_pnl = True
        gross_exposure += abs(market_value)
        rows.append({
            "symbol": str(raw.get("symbol") or raw.get("instrument") or raw.get("ticker") or "-").upper(),
            "quantity": quantity,
            "market_value": market_value,
            "current_price": current_price,
            "unrealized_pnl": pnl,
            "currency": str(raw.get("currency") or "USD").upper(),
        })

    equity, cash = _account_value(account)
    if equity is None:
        equity = gross_exposure + (cash or 0.0)
    leverage = gross_exposure / equity if equity and equity > 0 else None
    for row in rows:
        row["weight"] = abs(float(row["market_value"])) / gross_exposure if gross_exposure else 0.0
    rows.sort(key=lambda row: abs(float(row["market_value"])), reverse=True)
    top_weight = float(rows[0]["weight"]) if rows else None

    return {
        "profile": {"id": profile.id, "label": profile.label, "connector": profile.connector, "environment": profile.environment},
        "as_of": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "equity": equity,
            "cash": cash,
            "gross_exposure": gross_exposure,
            "net_exposure": sum(float(row["market_value"]) for row in rows),
            "leverage": leverage,
            "unrealized_pnl": unrealized_pnl if reported_pnl else None,
            "position_count": len(rows),
            "top_concentration": top_weight,
            "risk_level": _risk_level(top_weight, leverage),
        },
        "positions": rows,
        # A point-in-time broker read cannot honestly calculate drawdown. This
        # explicit state keeps the UI transparent until snapshot history exists.
        "drawdown": {"available": False, "value": None, "reason": "snapshot_history_required"},
    }


def _audit_snapshot(principal: Any, result: dict[str, Any]) -> None:
    if principal is None:
        return
    try:
        from src.commercial.store import CommercialStore

        summary = result["summary"]
        CommercialStore().audit(principal, "portfolio.snapshot.read", "trading_profile", result["profile"]["id"], {
            "position_count": summary["position_count"],
            "gross_exposure": summary["gross_exposure"],
            "risk_level": summary["risk_level"],
        })
    except Exception:
        return


def register_portfolio_routes(app: FastAPI) -> None:
    """Mount read-only portfolio endpoints for the service-level connection owner."""
    host = _host()
    if host is None:
        raise RuntimeError("register_portfolio_routes requires api_server")
    # Connector profiles are currently service-level configuration. Restricting
    # this surface to platform operations prevents one organization from ever
    # viewing another organization's broker account before scoped connections
    # are introduced.
    require_admin = host.require_platform_admin_or_auth

    @app.get("/portfolio/profiles", dependencies=[Depends(require_admin)])
    async def portfolio_profiles() -> dict[str, Any]:
        from src.trading.profiles import list_profiles

        profiles = list_profiles()
        return {"profiles": [{"id": item.id, "label": item.label, "connector": item.connector, "environment": item.environment} for item in profiles]}

    @app.get("/portfolio/snapshot", dependencies=[Depends(require_admin)])
    async def portfolio_snapshot(
        profile_id: str | None = Query(default=None, max_length=128),
        principal=Depends(require_admin),
    ) -> dict[str, Any]:
        try:
            result = await run_in_threadpool(build_portfolio_snapshot, profile_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Portfolio data is unavailable for the selected connection") from exc
        _audit_snapshot(principal, result)
        return result
