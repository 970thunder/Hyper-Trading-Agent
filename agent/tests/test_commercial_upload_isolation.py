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
