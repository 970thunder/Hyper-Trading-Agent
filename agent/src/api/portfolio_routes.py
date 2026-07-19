"""Organization portfolio connections and read-only risk snapshots.

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
from pydantic import BaseModel, Field

from src.api.commercial_routes import _principal_from_cookie, _require_role
from src.commercial.store import CommercialStore, Principal


class PortfolioConnectionCreateRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=160)
    connector: str = Field(..., min_length=1, max_length=64)
    profile_id: str = Field("", max_length=128)
    environment: str = Field("paper", max_length=16)
    credential_reference: str = Field("", max_length=512)


class PortfolioSnapshotIngestRequest(BaseModel):
    account: dict[str, Any] = Field(default_factory=dict)
    positions: list[dict[str, Any]] = Field(default_factory=list, max_length=5000)
    as_of: str | None = Field(None, max_length=64)


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


def build_portfolio_snapshot_from_payload(account: dict[str, Any], positions: list[dict[str, Any]]) -> dict[str, Any]:
    """Normalize externally collected read-only account data for snapshot storage."""
    rows: list[dict[str, Any]] = []
    gross_exposure = 0.0
    unrealized_pnl = 0.0
    reported_pnl = False
    for raw in _position_rows(positions):
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
            "quantity": quantity, "market_value": market_value, "current_price": current_price,
            "unrealized_pnl": pnl, "currency": str(raw.get("currency") or "USD").upper(),
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
        "summary": {
            "equity": equity, "cash": cash, "gross_exposure": gross_exposure,
            "net_exposure": sum(float(row["market_value"]) for row in rows), "leverage": leverage,
            "unrealized_pnl": unrealized_pnl if reported_pnl else None, "position_count": len(rows),
            "top_concentration": top_weight, "risk_level": _risk_level(top_weight, leverage),
        },
        "positions": rows,
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
    """Mount isolated organization connections and the legacy operations view."""
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

    organization_admin = _require_role("owner", "admin")

    @app.get("/portfolio/connections")
    async def list_organization_connections(principal: Principal = Depends(_principal_from_cookie)) -> dict[str, Any]:
        return {"connections": CommercialStore().list_portfolio_connections(principal)}

    @app.post("/portfolio/connections", status_code=201)
    async def create_organization_connection(
        payload: PortfolioConnectionCreateRequest,
        principal: Principal = Depends(organization_admin),
    ) -> dict[str, Any]:
        try:
            return CommercialStore().create_portfolio_connection(principal, payload.model_dump())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    def _connection_or_404(store: CommercialStore, principal: Principal, connection_id: str) -> dict[str, Any]:
        try:
            return store.get_portfolio_connection(principal, connection_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="portfolio connection not found") from exc

    def _capture(
        store: CommercialStore,
        principal: Principal,
        connection_id: str,
        normalized: dict[str, Any],
        as_of: str | None = None,
    ) -> dict[str, Any]:
        timestamp = as_of or datetime.now(timezone.utc).isoformat()
        try:
            snapshot = store.record_portfolio_snapshot(
                principal, connection_id, as_of=timestamp,
                summary=normalized["summary"], positions=normalized["positions"],
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        snapshot["drawdown"] = store.portfolio_drawdown(principal, connection_id)
        return snapshot

    @app.post("/portfolio/connections/{connection_id}/snapshots", status_code=201)
    async def ingest_organization_snapshot(
        connection_id: str,
        payload: PortfolioSnapshotIngestRequest,
        principal: Principal = Depends(organization_admin),
    ) -> dict[str, Any]:
        store = CommercialStore()
        _connection_or_404(store, principal, connection_id)
        return _capture(
            store, principal, connection_id,
            build_portfolio_snapshot_from_payload(payload.account, payload.positions), payload.as_of,
        )

    @app.post("/portfolio/connections/{connection_id}/refresh", status_code=201)
    async def refresh_organization_snapshot(
        connection_id: str,
        principal: Principal = Depends(organization_admin),
    ) -> dict[str, Any]:
        store = CommercialStore()
        connection = _connection_or_404(store, principal, connection_id)
        profile_id = str(connection.get("profile_id") or "")
        if not profile_id:
            raise HTTPException(status_code=409, detail="connection has no read-only connector profile")
        try:
            live = await run_in_threadpool(build_portfolio_snapshot, profile_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Portfolio data is unavailable for this connection") from exc
        return _capture(store, principal, connection_id, {"summary": live["summary"], "positions": live["positions"]}, live["as_of"])

    @app.get("/portfolio/connections/{connection_id}/snapshots")
    async def organization_snapshot_history(
        connection_id: str,
        limit: int = Query(default=100, ge=1, le=1000),
        principal: Principal = Depends(_principal_from_cookie),
    ) -> dict[str, Any]:
        store = CommercialStore()
        _connection_or_404(store, principal, connection_id)
        return {"snapshots": store.list_portfolio_snapshots(principal, connection_id, limit)}

    @app.get("/portfolio/connections/{connection_id}/drawdown")
    async def organization_drawdown(
        connection_id: str,
        principal: Principal = Depends(_principal_from_cookie),
    ) -> dict[str, Any]:
        store = CommercialStore()
        _connection_or_404(store, principal, connection_id)
        return store.portfolio_drawdown(principal, connection_id)

    @app.get("/portfolio/connections/{connection_id}/snapshot")
    async def latest_organization_snapshot(
        connection_id: str,
        principal: Principal = Depends(_principal_from_cookie),
    ) -> dict[str, Any]:
        store = CommercialStore()
        connection = _connection_or_404(store, principal, connection_id)
        try:
            snapshot = store.get_portfolio_snapshot(principal, connection_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="portfolio snapshot not found") from exc
        snapshot["connection"] = CommercialStore._portfolio_connection_payload(connection)
        snapshot["drawdown"] = store.portfolio_drawdown(principal, connection_id)
        store.audit(principal, "portfolio.snapshot.read", "portfolio_connection", connection_id, {
            "snapshot_id": snapshot["id"], "position_count": snapshot["summary"].get("position_count", 0),
        })
        return snapshot
