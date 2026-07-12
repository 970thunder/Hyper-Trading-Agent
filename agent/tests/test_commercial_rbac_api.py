from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import api_server


def test_owner_can_manage_members_and_viewer_cannot_escalate(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    owner_client = TestClient(api_server.app, client=("127.0.0.1", 50000))

    register = owner_client.post(
        "/auth/register",
        json={
            "email": "rbac-owner@example.com",
            "password": "password123",
            "organization_name": "RBAC Org",
        },
    )
    assert register.status_code == 200

    created = owner_client.post(
        "/organizations/current/members",
        json={
            "email": "viewer@example.com",
            "password": "password123",
            "display_name": "Viewer User",
            "role": "viewer",
        },
    )
    assert created.status_code == 200
    member = created.json()
    assert member["email"] == "viewer@example.com"
    assert member["role"] == "viewer"
    assert "password" not in str(member).lower()

    listed = owner_client.get("/organizations/current/members")
    assert listed.status_code == 200
    roles_by_email = {item["email"]: item["role"] for item in listed.json()}
    assert roles_by_email["rbac-owner@example.com"] == "owner"
    assert roles_by_email["viewer@example.com"] == "viewer"

    viewer_client = TestClient(api_server.app, client=("127.0.0.1", 50001))
    login = viewer_client.post(
        "/auth/login",
        json={"email": "viewer@example.com", "password": "password123"},
    )
    assert login.status_code == 200
    assert login.json()["role"] == "viewer"

    denied = viewer_client.post(
        "/organizations/current/members",
        json={
            "email": "intruder@example.com",
            "password": "password123",
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
