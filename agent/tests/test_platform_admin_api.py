from __future__ import annotations

from fastapi.testclient import TestClient

import api_server
from src.commercial.store import CommercialStore
from src.runtime_jobs.store import DurableRuntimeJobStore


def _register(client: TestClient, email: str) -> dict:
    response = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "password123",
            "organization_name": f"{email} Org",
        },
    )
    assert response.status_code == 200
    return response.json()


def test_platform_admin_is_distinct_from_organization_owner(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("HYPER_TRADING_PLATFORM_ADMIN_EMAILS", "platform@example.com")

    platform_client = TestClient(api_server.app, client=("127.0.0.1", 51001))
    standard_client = TestClient(api_server.app, client=("127.0.0.1", 51002))

    platform_principal = _register(platform_client, "platform@example.com")
    standard_principal = _register(standard_client, "owner@example.com")

    assert platform_principal["is_platform_admin"] is True
    assert standard_principal["is_platform_admin"] is False
    assert standard_client.get("/platform-admin/summary").status_code == 403

    summary = platform_client.get("/platform-admin/summary")
    assert summary.status_code == 200
    assert summary.json()["users"] == 2
    users = platform_client.get("/platform-admin/users")
    assert users.status_code == 200
    assert {item["email"] for item in users.json()} == {"platform@example.com", "owner@example.com"}


def test_platform_operations_only_expose_tenant_bound_sanitized_runtime_data(tmp_path, monkeypatch) -> None:
    commercial_db = tmp_path / "commercial.db"
    runtime_db = tmp_path / "runtime_jobs.db"
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(commercial_db))
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(runtime_db))
    monkeypatch.setenv("HYPER_TRADING_PLATFORM_ADMIN_EMAILS", "platform@example.com")

    platform_client = TestClient(api_server.app, client=("127.0.0.1", 51011))
    owner_client = TestClient(api_server.app, client=("127.0.0.1", 51012))
    _register(platform_client, "platform@example.com")
    owner = _register(owner_client, "owner@example.com")
    principal, _ = CommercialStore(commercial_db).login(email="owner@example.com", password="password123")
    CommercialStore(commercial_db).bind_workspace_artifact(
        principal,
        "runtime_job",
        "job_platform_runtime",
        metadata={"kind": "agent_run", "api_key": "must-not-leak", "label": "Research run"},
    )
    DurableRuntimeJobStore(runtime_db).create_job(
        job_id="job_platform_runtime",
        kind="agent_run",
        source="agent",
        title="Research run",
        metadata={"api_key": "must-not-leak", "label": "Research run"},
    )

    assert owner["is_platform_admin"] is False
    assert owner_client.get("/platform-admin/operations").status_code == 403
    assert owner_client.get("/platform-admin/runtime-jobs").status_code == 403

    operations = platform_client.get("/platform-admin/operations")
    assert operations.status_code == 200
    assert operations.json()["database"]["engine"] == "sqlite"

    runtime_jobs = platform_client.get("/platform-admin/runtime-jobs")
    assert runtime_jobs.status_code == 200
    job = next(item for item in runtime_jobs.json() if item["job_id"] == "job_platform_runtime")
    assert job["organization_id"] == principal.organization_id
    assert job["metadata"]["api_key"] == "[redacted]"

    artifacts = platform_client.get("/platform-admin/workspace-artifacts")
    assert artifacts.status_code == 200
    assert artifacts.json()[0]["artifact_id"] == "job_platform_runtime"
    assert artifacts.json()[0]["metadata"]["api_key"] == "[redacted]"

    rejected = platform_client.post("/platform-admin/maintenance", json={"action": "expire_sessions", "confirmed": False})
    assert rejected.status_code == 400
    completed = platform_client.post("/platform-admin/maintenance", json={"action": "expire_sessions", "confirmed": True})
    assert completed.status_code == 200
    assert completed.json()["action"] == "expire_sessions"
