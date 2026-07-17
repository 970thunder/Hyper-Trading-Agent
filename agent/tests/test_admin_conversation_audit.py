from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient

import api_server
from src.commercial.store import CommercialStore


def test_admin_conversation_audit_returns_messages_usage_and_events(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))

    session = SimpleNamespace(
        session_id="ses_audit",
        title="Quarterly review",
        status=SimpleNamespace(value="completed"),
        created_at="2026-07-17T00:00:00Z",
        updated_at="2026-07-17T00:02:00Z",
        last_attempt_id="att_1",
    )
    message = SimpleNamespace(
        message_id="msg_1",
        session_id="ses_audit",
        role="user",
        content="Review the quarter",
        created_at="2026-07-17T00:01:00Z",
        linked_attempt_id="att_1",
        metadata={"channel": "web"},
    )
    service = SimpleNamespace(
        get_session=lambda session_id: session if session_id == session.session_id else None,
        get_messages=lambda session_id, limit: [message] if session_id == session.session_id else [],
    )
    monkeypatch.setattr(api_server, "_get_session_service", lambda: service)

    owner = TestClient(api_server.app, client=("127.0.0.1", 55001))
    assert owner.post("/auth/register", json={"email": "owner@example.com", "password": "password123", "organization_name": "Audit Org"}).status_code == 200
    assert owner.post("/organizations/current/members", json={"email": "member@example.com", "password": "password123", "role": "member"}).status_code == 200

    store = CommercialStore()
    principal, _ = store.login(email="owner@example.com", password="password123")
    store.bind_workspace_session(principal, "ses_audit")
    store.record_model_usage(
        principal,
        provider="openai",
        model="gpt-5",
        prompt_tokens=120,
        completion_tokens=80,
        total_tokens=200,
        session_id="ses_audit",
        metadata={"usage": {"input_tokens_details": {"cached_tokens": 30}}},
    )
    store.audit(principal, "tool.call", "tool", "web_search", {"session_id": "ses_audit", "status": "succeeded"})

    response = owner.get("/admin/audit/conversations")
    assert response.status_code == 200
    conversation = response.json()["conversations"][0]
    assert conversation["actor"]["email"] == "owner@example.com"
    assert conversation["messages"][0]["content"] == "Review the quarter"
    assert conversation["metrics"] == {
        "input_tokens": 120,
        "output_tokens": 80,
        "total_tokens": 200,
        "cache_tokens": 30,
        "estimated_cost": 0.0,
    }
    assert conversation["events"][0]["action"] == "tool.call"

    member = TestClient(api_server.app, client=("127.0.0.1", 55002))
    assert member.post("/auth/login", json={"email": "member@example.com", "password": "password123"}).status_code == 200
    assert member.get("/admin/audit/conversations").status_code == 403
