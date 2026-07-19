from fastapi.testclient import TestClient

import api_server
from src.commercial.store import CommercialStore


def _register(client: TestClient, email: str, organization_name: str) -> None:
    assert client.post("/auth/register", json={"email": email, "password": "password123", "organization_name": organization_name}).status_code == 200


def test_paper_orders_are_risk_checked_reproducible_and_organization_scoped(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    alpha = TestClient(api_server.app, client=("127.0.0.1", 57101))
    beta = TestClient(api_server.app, client=("127.0.0.1", 57102))
    _register(alpha, "alpha@example.com", "Alpha")
    _register(beta, "beta@example.com", "Beta")

    policy = alpha.put("/paper-trading/policy", json={"max_order_notional": 1000, "max_total_exposure": 1500, "max_trades_per_day": 2})
    assert policy.status_code == 200
    created = alpha.post("/paper-trading/orders", json={"symbol": "BTC-USDT", "side": "buy", "quantity": 0.01, "execution_price": 50000, "fee_rate": 0.001})
    assert created.status_code == 201
    order = created.json()
    assert order["notional"] == 500.0
    assert order["broker_execution"] is False
    assert beta.get("/paper-trading/orders").json()["orders"] == []
    assert beta.post(f"/paper-trading/orders/{order['id']}/replay").status_code == 404

    replay = alpha.post(f"/paper-trading/orders/{order['id']}/replay")
    assert replay.status_code == 201
    assert replay.json()["execution_price"] == order["execution_price"]
    assert replay.json()["replay_hash"] == order["replay_hash"]
    rejected = alpha.post("/paper-trading/orders", json={"symbol": "BTC-USDT", "side": "buy", "quantity": 0.1, "execution_price": 50000})
    assert rejected.status_code == 409
    assert "max_order_notional" in rejected.json()["detail"]

    store = CommercialStore()
    principal, _ = store.login(email="alpha@example.com", password="password123")
    actions = [row["action"] for row in store.list_audit_logs(principal, limit=20)]
    assert "paper_trading.order.fill" in actions
    assert "paper_trading.order.replay" in actions
