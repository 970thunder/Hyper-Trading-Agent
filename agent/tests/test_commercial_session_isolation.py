from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import api_server


def _register(client: TestClient, email: str) -> None:
    response = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "password123",
            "organization_name": f"{email} Org",
        },
    )
    assert response.status_code == 200


def test_commercial_sessions_are_hidden_across_organizations(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setattr(api_server, "SESSIONS_DIR", tmp_path / "sessions")
    monkeypatch.setattr(api_server, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(api_server, "_session_service", None)

    first = TestClient(api_server.app, client=("127.0.0.1", 52001))
    second = TestClient(api_server.app, client=("127.0.0.1", 52002))
    _register(first, "first@example.com")
    _register(second, "second@example.com")

    created = first.post("/sessions", json={"title": "Private research"})
    assert created.status_code == 201
    session_id = created.json()["session_id"]

    assert [item["session_id"] for item in first.get("/sessions").json()] == [session_id]
    assert second.get("/sessions").json() == []
    assert second.get(f"/sessions/{session_id}").status_code == 404
    assert second.get(f"/sessions/{session_id}/messages").status_code == 404
    assert second.post(f"/sessions/{session_id}/messages", json={"content": "hello"}).status_code == 404
    assert first.get(f"/sessions/{session_id}").status_code == 200
