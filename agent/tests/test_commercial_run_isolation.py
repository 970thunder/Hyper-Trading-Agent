from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

import api_server
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


def test_commercial_runs_are_hidden_across_organizations(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setattr(api_server, "RUNS_DIR", tmp_path / "runs")
    run_id = "run_20260715_101010"
    run_dir = api_server.RUNS_DIR / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "state.json").write_text(json.dumps({"status": "success"}), encoding="utf-8")

    first = TestClient(api_server.app, client=("127.0.0.1", 54001))
    second = TestClient(api_server.app, client=("127.0.0.1", 54002))
    _register(first, "first-run@example.com")
    _register(second, "second-run@example.com")

    store = CommercialStore()
    first_principal, _ = store.login(email="first-run@example.com", password="password123")
    store.bind_workspace_run(first_principal, run_id, session_id="session_first", attempt_id="attempt_first")

    assert [item["run_id"] for item in first.get("/runs").json()] == [run_id]
    assert second.get("/runs").json() == []
    assert second.get(f"/runs/{run_id}").status_code == 404
    assert second.get(f"/runs/{run_id}/code").status_code == 404
    assert first.get(f"/runs/{run_id}").status_code == 200
