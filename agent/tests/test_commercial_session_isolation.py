from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

import api_server
from src.api import alpha_routes
from src.commercial.store import CommercialStore


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


def test_commercial_swarm_runs_are_hidden_across_organizations(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))

    run = SimpleNamespace(
        id="swarm-tenant-run",
        preset_name="quant_strategy_desk",
        status=SimpleNamespace(value="running"),
        created_at="2026-07-15T00:00:00+00:00",
        completed_at=None,
        tasks=[],
        user_vars={},
        agents=[],
        final_report="",
    )

    class FakeStore:
        def run_dir(self, run_id: str) -> Path:
            return tmp_path / "swarm" / run_id

        def list_runs(self, limit: int = 20):
            return [run]

        def reconcile_run(self, candidate, write: bool = True):
            return candidate

        def is_run_stale(self, candidate) -> bool:
            return False

        def load_run(self, run_id: str):
            return run if run_id == run.id else None

    class FakeRuntime:
        _store = FakeStore()

        def start_run(self, *_args, **_kwargs):
            return run

        def cancel_run(self, _run_id: str) -> bool:
            return True

    monkeypatch.setattr("src.api.swarm_routes._get_swarm_runtime", lambda: FakeRuntime())

    first = TestClient(api_server.app, client=("127.0.0.1", 52011))
    second = TestClient(api_server.app, client=("127.0.0.1", 52012))
    _register(first, "first-swarm@example.com")
    _register(second, "second-swarm@example.com")

    created = first.post("/swarm/runs", json={"preset_name": "quant_strategy_desk", "user_vars": {}})
    assert created.status_code == 200
    assert [item["id"] for item in first.get("/swarm/runs").json()] == [run.id]
    assert second.get("/swarm/runs").json() == []
    assert second.get(f"/swarm/runs/{run.id}").status_code == 404
    assert second.post(f"/swarm/runs/{run.id}/cancel").status_code == 404


def test_commercial_runtime_jobs_are_hidden_across_organizations(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    job_id = "a" * 32

    first = TestClient(api_server.app, client=("127.0.0.1", 52021))
    second = TestClient(api_server.app, client=("127.0.0.1", 52022))
    _register(first, "first-runtime@example.com")
    _register(second, "second-runtime@example.com")

    store = CommercialStore()
    first_principal, _ = store.login(email="first-runtime@example.com", password="password123")
    store.bind_workspace_artifact(first_principal, "runtime_job", job_id, metadata={"kind": "alpha_bench"})
    alpha_routes.ALPHA_BENCH_JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "zoo": "alpha101",
        "universe": "equity_cn",
        "period": "2024-01-01:2024-06-01",
        "top": 10,
        "created_at": "2026-07-15T00:00:00+00:00",
        "progress": {"n_done": 0, "n_total": 1, "current_alpha_id": None},
        "result": None,
        "error": None,
    }
    try:
        assert [item["job_id"] for item in first.get("/runtime/jobs").json()] == [job_id]
        assert second.get("/runtime/jobs").json() == []
        assert second.post(f"/runtime/jobs/{job_id}/cancel").status_code == 404
    finally:
        alpha_routes.ALPHA_BENCH_JOBS.pop(job_id, None)
