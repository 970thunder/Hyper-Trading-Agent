from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import api_server


def test_feedback_api_records_and_lists_events(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    client = TestClient(api_server.app, client=("127.0.0.1", 50000))
    register = client.post(
        "/auth/register",
        json={
            "email": "feedback-owner@example.com",
            "password": "password123",
            "organization_name": "Feedback Org",
        },
    )
    assert register.status_code == 200

    created = client.post(
        "/feedback",
        json={
            "target_type": "message",
            "target_id": "msg_123",
            "session_id": "sess_1",
            "attempt_id": "att_1",
            "run_id": "run_1",
            "rating": -1,
            "comment": "The answer missed the citation.",
            "tags": ["missing_citation"],
            "metadata": {"surface": "agent"},
        },
    )

    assert created.status_code == 200
    body = created.json()
    assert body["rating"] == -1
    assert body["target_id"] == "msg_123"
    assert body["tags"] == ["missing_citation"]

    listed = client.get("/feedback", params={"target_type": "message", "target_id": "msg_123"})
    assert listed.status_code == 200
    events = listed.json()
    assert len(events) == 1
    assert events[0]["id"] == body["id"]


def test_feedback_api_rejects_invalid_rating(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    client = TestClient(api_server.app, client=("127.0.0.1", 50000))
    register = client.post(
        "/auth/register",
        json={
            "email": "feedback-invalid@example.com",
            "password": "password123",
            "organization_name": "Feedback Org",
        },
    )
    assert register.status_code == 200

    response = client.post(
        "/feedback",
        json={"target_type": "message", "target_id": "msg_123", "rating": 5},
    )

    assert response.status_code == 400
    assert "rating" in response.text
