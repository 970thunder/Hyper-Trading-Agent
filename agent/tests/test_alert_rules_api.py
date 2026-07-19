from fastapi.testclient import TestClient

import api_server


def test_alert_rules_are_organization_scoped(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    owner = TestClient(api_server.app)
    assert owner.post("/auth/register", json={"email": "owner@example.com", "password": "password123", "organization_name": "Alerts"}).status_code == 200
    created = owner.post("/alerts/rules", json={"name": "AAPL floor", "alert_type": "price", "target": "AAPL.US", "condition": {"operator": "lt", "value": 180}, "channels": ["web"]})
    assert created.status_code == 201
    assert created.json()["alert_type"] == "price"
    assert owner.get("/alerts/rules").json()["rules"][0]["target"] == "AAPL.US"

    member = TestClient(api_server.app)
    assert owner.post("/organizations/current/members", json={"email": "member@example.com", "password": "password123", "role": "member"}).status_code == 200
    assert member.post("/auth/login", json={"email": "member@example.com", "password": "password123"}).status_code == 200
    assert member.post("/alerts/rules", json={"name": "Denied", "alert_type": "price"}).status_code == 403
