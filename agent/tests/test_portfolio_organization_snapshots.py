from __future__ import annotations

from fastapi.testclient import TestClient

import api_server
from src.commercial.store import CommercialStore


def _register(client: TestClient, email: str, organization_name: str) -> None:
    response = client.post(
        "/auth/register",
        json={"email": email, "password": "password123", "organization_name": organization_name},
    )
    assert response.status_code == 200


def test_organization_portfolio_connections_isolate_credentials_and_history(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    alpha = TestClient(api_server.app, client=("127.0.0.1", 55101))
    beta = TestClient(api_server.app, client=("127.0.0.1", 55102))
    _register(alpha, "owner-alpha@example.com", "Alpha Capital")
    _register(beta, "owner-beta@example.com", "Beta Capital")

    created = alpha.post(
        "/portfolio/connections",
        json={
            "label": "Alpha paper account",
            "connector": "demo",
            "profile_id": "demo-paper",
            "environment": "paper",
            "credential_reference": "vault://portfolio/alpha/demo",
        },
    )
    assert created.status_code == 201
    connection = created.json()
    assert connection["credentials_configured"] is True
    assert "credential_reference" not in connection

    connection_id = connection["id"]
    assert beta.get(f"/portfolio/connections/{connection_id}/snapshot").status_code == 404
    first = alpha.post(
        f"/portfolio/connections/{connection_id}/snapshots",
        json={
            "as_of": "2026-07-01T00:00:00+00:00",
            "account": {"equity": 1000, "cash": 250},
            "positions": [{"symbol": "AAPL", "quantity": 5, "current_price": 150}],
        },
    )
    assert first.status_code == 201
    assert first.json()["drawdown"]["available"] is False
    second = alpha.post(
        f"/portfolio/connections/{connection_id}/snapshots",
        json={
            "as_of": "2026-07-02T00:00:00+00:00",
            "account": {"equity": 900, "cash": 200},
            "positions": [{"symbol": "AAPL", "quantity": 5, "current_price": 140}],
        },
    )
    assert second.status_code == 201
    assert second.json()["drawdown"] == {
        "available": True,
        "value": -0.1,
        "max_drawdown": -0.1,
        "peak_equity": 1000.0,
        "sample_count": 2,
        "as_of": "2026-07-02T00:00:00+00:00",
    }

    latest = alpha.get(f"/portfolio/connections/{connection_id}/snapshot")
    assert latest.status_code == 200
    assert latest.json()["connection"]["label"] == "Alpha paper account"
    assert latest.json()["summary"]["equity"] == 900.0
    assert latest.json()["drawdown"]["max_drawdown"] == -0.1
    assert len(alpha.get(f"/portfolio/connections/{connection_id}/snapshots").json()["snapshots"]) == 2

    store = CommercialStore()
    principal, _ = store.login(email="owner-alpha@example.com", password="password123")
    actions = [row["action"] for row in store.list_audit_logs(principal, limit=20)]
    assert "portfolio.connection.create" in actions
    assert "portfolio.snapshot.capture" in actions
    assert "portfolio.snapshot.read" in actions


def test_portfolio_connection_rejects_plaintext_credentials(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    client = TestClient(api_server.app, client=("127.0.0.1", 55103))
    _register(client, "owner@example.com", "Credential Safety")

    response = client.post(
        "/portfolio/connections",
        json={"label": "Unsafe", "connector": "demo", "credential_reference": "sk-live-not-a-reference"},
    )
    assert response.status_code == 400
    assert "external secret reference" in response.json()["detail"]
