from __future__ import annotations

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


def test_commercial_upload_handle_cannot_be_imported_by_another_organization(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setattr(api_server, "UPLOADS_DIR", tmp_path / "uploads")

    first = TestClient(api_server.app, client=("127.0.0.1", 53001))
    second = TestClient(api_server.app, client=("127.0.0.1", 53002))
    _register(first, "first-upload@example.com")
    _register(second, "second-upload@example.com")

    uploaded = first.post("/upload", files={"file": ("research.txt", b"risk limits and portfolio review", "text/plain")})
    assert uploaded.status_code == 200
    foreign_handle = uploaded.json()["file_path"]
    assert foreign_handle.startswith("uploads/org_")

    knowledge_base = second.post("/knowledge-bases", json={"name": "Second organization research"})
    assert knowledge_base.status_code == 200
    rejected = second.post(
        f"/knowledge-bases/{knowledge_base.json()['id']}/documents",
        json={"path": foreign_handle, "title": "Foreign file"},
    )
    assert rejected.status_code == 404
    assert rejected.json()["detail"] == "file not found"


def test_commercial_shadow_report_cannot_be_read_by_another_organization(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setattr("src.api.uploads_routes.Path.home", lambda: tmp_path)

    first = TestClient(api_server.app, client=("127.0.0.1", 53011))
    second = TestClient(api_server.app, client=("127.0.0.1", 53012))
    _register(first, "first-report@example.com")
    _register(second, "second-report@example.com")

    store = CommercialStore()
    first_principal, _ = store.login(email="first-report@example.com", password="password123")
    shadow_id = "shadow_abc123de"
    report_dir = tmp_path / ".hyper-trading-agent" / "shadow_reports"
    report_dir.mkdir(parents=True)
    (report_dir / f"{shadow_id}.html").write_text("<html>private report</html>", encoding="utf-8")
    store.bind_workspace_artifact(
        first_principal,
        "shadow_report",
        shadow_id,
        storage_path=str(report_dir / f"{shadow_id}.html"),
    )

    assert first.get(f"/shadow-reports/{shadow_id}").status_code == 200
    denied = second.get(f"/shadow-reports/{shadow_id}")
    assert denied.status_code == 404
    assert denied.json()["detail"] == "Shadow report not found"
