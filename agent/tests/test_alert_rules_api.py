from fastapi.testclient import TestClient

import api_server
from src.commercial.store import CommercialStore


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


def test_alert_events_are_deduplicated_acknowledgeable_and_resolved(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    owner = TestClient(api_server.app)
    assert owner.post("/auth/register", json={"email": "owner@example.com", "password": "password123", "organization_name": "Alerts"}).status_code == 200
    rule = owner.post(
        "/alerts/rules",
        json={"name": "AAPL floor", "alert_type": "price", "target": "AAPL.US", "condition": {"operator": "lt", "value": 180}},
    )
    assert rule.status_code == 201

    first = owner.post("/alerts/evaluate", json={"observations": [{"alert_type": "price", "target": "AAPL.US", "value": 175}]})
    assert first.status_code == 200
    result = first.json()["results"][0]
    assert result["triggered"] is True
    assert result["created"] is True
    event_id = result["event"]["id"]

    duplicate = owner.post("/alerts/evaluate", json={"observations": [{"alert_type": "price", "target": "AAPL.US", "value": 170}]})
    assert duplicate.json()["results"][0]["created"] is False
    assert duplicate.json()["results"][0]["event"]["id"] == event_id
    assert owner.post(f"/alerts/events/{event_id}/acknowledge").json()["status"] == "acknowledged"

    recovered = owner.post("/alerts/evaluate", json={"observations": [{"alert_type": "price", "target": "AAPL.US", "value": 190}]})
    assert recovered.json()["results"][0] == {"rule_id": rule.json()["id"], "triggered": False, "resolved": 1}
    assert owner.get("/alerts/events").json()["events"][0]["status"] == "resolved"

    retriggered = owner.post("/alerts/evaluate", json={"observations": [{"alert_type": "price", "target": "AAPL.US", "value": 175}]})
    assert retriggered.json()["results"][0]["created"] is True
    assert retriggered.json()["results"][0]["event"]["id"] != event_id

    owner.post("/organizations/current/members", json={"email": "member@example.com", "password": "password123", "role": "member"})
    member = TestClient(api_server.app)
    assert member.post("/auth/login", json={"email": "member@example.com", "password": "password123"}).status_code == 200
    assert member.post("/alerts/evaluate", json={"observations": [{"alert_type": "price", "target": "AAPL.US", "value": 175}]}).status_code == 403

    quality_rule = owner.post(
        "/alerts/rules",
        json={"name": "Stale price feed", "alert_type": "data_quality", "condition": {"operator": "eq", "value": False}},
    )
    quality = owner.post("/alerts/evaluate", json={"observations": [{"alert_type": "data_quality", "target": "us-feed", "value": False}]})
    quality_event = quality.json()["results"][0]["event"]
    assert quality_event["rule_id"] == quality_rule.json()["id"]
    assert owner.post(f"/alerts/events/{quality_event['id']}/resolve").json()["status"] == "resolved"

    store = CommercialStore()
    principal, _ = store.login(email="owner@example.com", password="password123")
    actions = [row["action"] for row in store.list_audit_logs(principal, limit=30)]
    assert "alert_event.trigger" in actions
    assert "alert_event.acknowledge" in actions
    assert "alert_event.resolve" in actions
