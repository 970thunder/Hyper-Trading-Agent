from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import api_server


PASSWORD = "password123"


def _register_owner(client: TestClient, *, email: str = "owner@example.com") -> dict:
    response = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": PASSWORD,
            "organization_name": "RBAC Org",
        },
    )
    assert response.status_code == 200
    return response.json()


def _create_member(owner_client: TestClient, *, email: str, role: str) -> dict:
    response = owner_client.post(
        "/organizations/current/members",
        json={
            "email": email,
            "password": PASSWORD,
            "display_name": role.title(),
            "role": role,
        },
    )
    assert response.status_code == 200
    return response.json()


def _login(email: str, port: int) -> TestClient:
    client = TestClient(api_server.app, client=("127.0.0.1", port))
    response = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    return client


def test_owner_can_manage_members_and_viewer_cannot_escalate(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    owner_client = TestClient(api_server.app, client=("127.0.0.1", 50000))

    _register_owner(owner_client, email="rbac-owner@example.com")

    member = _create_member(owner_client, email="viewer@example.com", role="viewer")
    assert member["email"] == "viewer@example.com"
    assert member["role"] == "viewer"
    assert "password" not in str(member).lower()

    listed = owner_client.get("/organizations/current/members")
    assert listed.status_code == 200
    roles_by_email = {item["email"]: item["role"] for item in listed.json()}
    assert roles_by_email["rbac-owner@example.com"] == "owner"
    assert roles_by_email["viewer@example.com"] == "viewer"

    viewer_client = _login("viewer@example.com", 50001)

    denied = viewer_client.post(
        "/organizations/current/members",
        json={
            "email": "intruder@example.com",
            "password": PASSWORD,
            "role": "admin",
        },
    )
    assert denied.status_code == 403

    updated = owner_client.patch(
        f"/organizations/current/members/{member['user_id']}",
        json={"role": "member"},
    )
    assert updated.status_code == 200
    assert updated.json()["role"] == "member"

    deleted = owner_client.delete(f"/organizations/current/members/{member['user_id']}")
    assert deleted.status_code == 200
    assert deleted.json()["status"] == "deleted"


def test_commercial_role_matrix_for_governance_and_knowledge(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    owner_client = TestClient(api_server.app, client=("127.0.0.1", 50100))
    _register_owner(owner_client, email="matrix-owner@example.com")
    _create_member(owner_client, email="matrix-admin@example.com", role="admin")
    _create_member(owner_client, email="matrix-member@example.com", role="member")
    _create_member(owner_client, email="matrix-viewer@example.com", role="viewer")

    admin_client = _login("matrix-admin@example.com", 50101)
    member_client = _login("matrix-member@example.com", 50102)
    viewer_client = _login("matrix-viewer@example.com", 50103)
    anonymous_client = TestClient(api_server.app, client=("127.0.0.1", 50104))

    provider_payload = {
        "provider": "siliconflow",
        "model": "deepseek-ai/DeepSeek-V3.2",
        "base_url": "https://api.siliconflow.cn/v1",
        "api_key": "sk-test",
    }

    assert anonymous_client.get("/models/providers").status_code == 401
    assert owner_client.post("/models/providers", json=provider_payload).status_code == 200
    assert admin_client.post("/models/providers", json=provider_payload).status_code == 200
    assert member_client.post("/models/providers", json=provider_payload).status_code == 403
    assert viewer_client.post("/models/providers", json=provider_payload).status_code == 403

    assert owner_client.get("/organizations/current/members").status_code == 200
    assert admin_client.get("/organizations/current/members").status_code == 200
    assert member_client.get("/organizations/current/members").status_code == 403
    assert viewer_client.get("/organizations/current/members").status_code == 403

    assert owner_client.post("/knowledge-bases", json={"name": "Owner KB"}).status_code == 200
    assert admin_client.post("/knowledge-bases", json={"name": "Admin KB"}).status_code == 200
    assert member_client.post("/knowledge-bases", json={"name": "Member KB"}).status_code == 200
    assert viewer_client.post("/knowledge-bases", json={"name": "Viewer KB"}).status_code == 403
    assert viewer_client.get("/knowledge-bases").status_code == 200

    assert owner_client.get("/tools/policies").status_code == 200
    assert admin_client.get("/tools/policies").status_code == 200
    assert member_client.get("/tools/policies").status_code == 403
    assert viewer_client.get("/tools/policies").status_code == 403

    assert owner_client.get("/audit-logs").status_code == 200
    assert admin_client.get("/audit-logs").status_code == 200
    assert member_client.get("/audit-logs").status_code == 403
    assert viewer_client.get("/audit-logs").status_code == 403

    assert owner_client.get("/usage/model-calls").status_code == 200
    assert admin_client.get("/usage/model-calls").status_code == 200
    assert member_client.get("/usage/model-calls").status_code == 403
    assert viewer_client.get("/usage/model-calls").status_code == 403


def test_knowledge_url_ingestion_queues_runtime_job_when_worker_backend_enabled(tmp_path: Path, monkeypatch) -> None:
    pushed: list[tuple[str, str]] = []

    class FakeRedisClient:
        def rpush(self, queue_name: str, payload: str) -> int:
            pushed.append((queue_name, payload))
            return 1

    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_QUEUE", "hyper:runtime:jobs")
    monkeypatch.setattr("src.api.commercial_routes._runtime_redis_client", lambda: FakeRedisClient())

    client = TestClient(api_server.app, client=("127.0.0.1", 50200))
    _register_owner(client, email="url-owner@example.com")
    kb_response = client.post("/knowledge-bases", json={"name": "URL KB"})
    assert kb_response.status_code == 200

    response = client.post(
        f"/knowledge-bases/{kb_response.json()['id']}/urls",
        json={"url": "https://example.com/research", "title": "Research URL"},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "pending"
    assert payload["metadata"]["url"] == "https://example.com/research"
    assert payload["metadata"]["runtime_job_id"].startswith("job_")
    assert pushed[0][0] == "hyper:runtime:jobs"
