from __future__ import annotations

from fastapi.testclient import TestClient

import api_server


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
