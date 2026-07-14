from __future__ import annotations

import json
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
    queued_envelope = json.loads(pushed[0][1])
    assert queued_envelope["payload"]["ingestion_job_id"] == payload["id"]


def test_commercial_governance_routes_require_admin_even_from_loopback(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    owner_client = TestClient(api_server.app, client=("127.0.0.1", 50300))
    _register_owner(owner_client, email="governance-owner@example.com")
    _create_member(owner_client, email="governance-admin@example.com", role="admin")
    _create_member(owner_client, email="governance-member@example.com", role="member")
    _create_member(owner_client, email="governance-viewer@example.com", role="viewer")

    admin_client = _login("governance-admin@example.com", 50301)
    member_client = _login("governance-member@example.com", 50302)
    viewer_client = _login("governance-viewer@example.com", 50303)
    anonymous_client = TestClient(api_server.app, client=("127.0.0.1", 50304))
    assert anonymous_client.get("/auth/status").json() == {"commercial_mode": True}

    for client in (member_client, viewer_client):
        assert client.post("/swarm/presets/missing/agents", json={"id": "blocked"}).status_code == 403
        assert client.get("/runtime/jobs").status_code == 403

    assert anonymous_client.post("/swarm/presets/missing/agents", json={"id": "blocked"}).status_code == 401
    assert anonymous_client.get("/runtime/jobs").status_code == 401
    assert anonymous_client.get("/sessions").status_code == 401
    assert anonymous_client.get("/settings/llm").status_code == 401
    assert member_client.get("/sessions").status_code == 200
    assert member_client.get("/settings/llm").status_code == 403
    assert member_client.put("/settings/llm", json={"provider": "siliconflow"}).status_code == 403

    # Admin requests pass the role guard and reach the underlying resource lookup.
    assert admin_client.post("/swarm/presets/missing/agents", json={"id": "allowed"}).status_code == 404
    assert admin_client.get("/runtime/jobs").status_code == 200


def test_commercial_mode_reserves_process_wide_legacy_resources_for_platform_admins(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("HYPER_TRADING_ALLOW_SELF_REGISTRATION", "1")
    monkeypatch.setenv("HYPER_TRADING_PLATFORM_ADMIN_EMAILS", "platform@example.com")
    monkeypatch.setenv("API_AUTH_KEY", "platform-operator-key")
    monkeypatch.setattr(api_server, "_API_KEY", "platform-operator-key")

    platform_client = TestClient(api_server.app, client=("127.0.0.1", 50311))
    owner_client = TestClient(api_server.app, client=("127.0.0.1", 50312))
    api_client = TestClient(api_server.app, client=("203.0.113.10", 50313))
    _register_owner(platform_client, email="platform@example.com")
    _register_owner(owner_client, email="organization-owner@example.com")

    for path in ("/settings/llm", "/settings/data-sources", "/knowledge/stats", "/knowledge/documents", "/channels/status", "/scheduled-runs", "/live/status", "/metrics"):
        assert owner_client.get(path).status_code == 403, path

    assert platform_client.get("/settings/llm").status_code == 200
    assert platform_client.get("/knowledge/stats").status_code == 200
    assert platform_client.get("/scheduled-runs").status_code == 200
    assert platform_client.get("/live/status").status_code == 200
    assert platform_client.get("/metrics").status_code == 200
    assert api_client.get("/metrics", headers={"Authorization": "Bearer platform-operator-key"}).status_code == 200


def test_commercial_mode_blocks_anonymous_self_registration(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("HYPER_TRADING_ALLOW_SELF_REGISTRATION", "0")
    client = TestClient(api_server.app, client=("127.0.0.1", 50310))

    response = client.post(
        "/auth/register",
        json={
            "email": "anonymous@example.com",
            "password": PASSWORD,
            "organization_name": "Blocked Org",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"


def test_user_can_switch_only_between_their_active_organization_memberships(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    first_client = TestClient(api_server.app, client=("127.0.0.1", 50320))
    second_client = TestClient(api_server.app, client=("127.0.0.1", 50321))
    first = _register_owner(first_client, email="multi-org@example.com")
    second = _register_owner(second_client, email="second-owner@example.com")

    added = second_client.post(
        "/organizations/current/members",
        json={"email": "multi-org@example.com", "password": PASSWORD, "role": "member"},
    )
    assert added.status_code == 200

    organizations = first_client.get("/organizations")
    assert organizations.status_code == 200
    assert {item["id"] for item in organizations.json()} == {first["organization_id"], second["organization_id"]}

    switched = first_client.post("/organizations/switch", json={"organization_id": second["organization_id"]})
    assert switched.status_code == 200
    assert switched.json()["organization_id"] == second["organization_id"]
    assert switched.json()["role"] == "member"
    assert first_client.get("/auth/me").json()["organization_id"] == second["organization_id"]

    denied = first_client.post("/organizations/switch", json={"organization_id": "org_not_a_membership"})
    assert denied.status_code == 404


def test_knowledge_file_ingestion_queues_parsing_and_vectorization_job(tmp_path: Path, monkeypatch) -> None:
    pushed: list[tuple[str, str]] = []

    class FakeRedisClient:
        def rpush(self, queue_name: str, payload: str) -> int:
            pushed.append((queue_name, payload))
            return 1

    source = tmp_path / "research.txt"
    source.write_text("Portfolio construction and risk limits.", encoding="utf-8")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")
    monkeypatch.setattr("src.api.commercial_routes._runtime_redis_client", lambda: FakeRedisClient())
    monkeypatch.setattr("src.api.commercial_routes.safe_document_path", lambda _path: source)

    client = TestClient(api_server.app, client=("127.0.0.1", 50400))
    _register_owner(client, email="file-owner@example.com")
    kb_response = client.post("/knowledge-bases", json={"name": "File KB"})

    response = client.post(
        f"/knowledge-bases/{kb_response.json()['id']}/documents",
        json={"path": "uploads/research.txt", "title": "Research", "chunk_size": 600, "chunk_overlap": 60},
    )

    assert response.status_code == 202
    job = response.json()
    assert job["status"] == "pending"
    queued_envelope = json.loads(pushed[0][1])
    assert queued_envelope["kind"] == "knowledge_file_ingest"
    assert queued_envelope["payload"]["ingestion_job_id"] == job["id"]
    assert queued_envelope["payload"]["path"] == str(source)


def test_failed_url_ingestion_can_retry_before_a_document_exists(tmp_path: Path, monkeypatch) -> None:
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
    monkeypatch.setattr("src.api.commercial_routes._runtime_redis_client", lambda: FakeRedisClient())

    client = TestClient(api_server.app, client=("127.0.0.1", 50500))
    _register_owner(client, email="retry-owner@example.com")
    kb_id = client.post("/knowledge-bases", json={"name": "Retry KB"}).json()["id"]
    from src.commercial.store import CommercialStore

    commercial_store = CommercialStore(tmp_path / "commercial.db")
    principal = commercial_store.login(email="retry-owner@example.com", password=PASSWORD)[0]
    failed = commercial_store.create_pending_url_ingestion_job(
        principal,
        kb_id,
        url="https://example.com/failing",
        title="Failing URL",
    )
    commercial_store.fail_ingestion_job(principal, kb_id, failed["id"], "temporary fetch failure")

    response = client.post(f"/knowledge-bases/{kb_id}/ingestion-jobs/{failed['id']}/retry")

    assert response.status_code == 202
    retried = response.json()
    assert retried["id"] == failed["id"]
    assert retried["status"] == "pending"
    assert retried["error"] == ""
    queued_envelope = json.loads(pushed[0][1])
    assert queued_envelope["kind"] == "knowledge_url_ingest"
    assert queued_envelope["payload"]["ingestion_job_id"] == failed["id"]


def test_swarm_agent_management_writes_commercial_audit_event(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    owner_client = TestClient(api_server.app, client=("127.0.0.1", 50600))
    _register_owner(owner_client, email="audit-owner@example.com")

    monkeypatch.setattr(
        "src.swarm.presets.save_preset_agent",
        lambda preset_name, payload, create, **_kwargs: {"preset_name": preset_name, "agent": payload, "created": create},
    )
    response = owner_client.post(
        "/swarm/presets/quant_strategy_desk/agents",
        json={"id": "portfolio_reviewer", "role": "Portfolio Reviewer"},
    )

    assert response.status_code == 200
    logs = owner_client.get("/audit-logs", params={"type": "swarm_agent.create"}).json()
    assert len(logs) == 1
    assert logs[0]["action"] == "swarm_agent.create"
    assert logs[0]["target_id"] == "quant_strategy_desk:portfolio_reviewer"
