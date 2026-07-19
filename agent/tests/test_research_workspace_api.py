from fastapi.testclient import TestClient

import api_server
from src.commercial.store import CommercialStore


def _register(client: TestClient, email: str, organization_name: str) -> None:
    response = client.post(
        "/auth/register",
        json={"email": email, "password": "password123", "organization_name": organization_name},
    )
    assert response.status_code == 200


def test_research_workspace_is_scoped_and_preserves_citations_and_event_sources(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "1")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    alpha = TestClient(api_server.app, client=("127.0.0.1", 56101))
    beta = TestClient(api_server.app, client=("127.0.0.1", 56102))
    _register(alpha, "alpha@example.com", "Alpha")
    _register(beta, "beta@example.com", "Beta")

    watchlist = alpha.post("/research/watchlists", json={"name": "Core equities", "description": "Long-term coverage"})
    assert watchlist.status_code == 201
    watchlist_id = watchlist.json()["id"]
    item = alpha.post(f"/research/watchlists/{watchlist_id}/items", json={"symbol": "aapl.us", "note": "Watch earnings"})
    assert item.status_code == 201
    assert item.json()["symbol"] == "AAPL.US"
    assert beta.get(f"/research/watchlists/{watchlist_id}/items").status_code == 404

    note = alpha.post(
        "/research/notes",
        json={
            "symbol": "AAPL.US", "title": "Margin review", "content": "Track service margin against filings.",
            "citations": [{"title": "10-Q", "url": "https://www.sec.gov/ixviewer/documents/aapl-10q"}],
        },
    )
    assert note.status_code == 201
    assert alpha.get("/research/notes").json()["notes"][0]["citations"][0]["title"] == "10-Q"
    assert beta.get("/research/notes").json()["notes"] == []

    event = alpha.post(
        "/research/events",
        json={
            "event_type": "earnings", "symbol": "AAPL.US", "title": "FY earnings release",
            "occurs_at": "2026-10-29T20:00:00+00:00", "source_name": "Investor relations",
            "source_url": "https://investor.apple.com/earnings",
        },
    )
    assert event.status_code == 201
    assert alpha.get("/research/events?event_type=earnings").json()["events"][0]["source_name"] == "Investor relations"

    store = CommercialStore()
    principal, _ = store.login(email="alpha@example.com", password="password123")
    actions = [row["action"] for row in store.list_audit_logs(principal, limit=20)]
    assert "research.watchlist.create" in actions
    assert "research.note.create" in actions
    assert "research.event.create" in actions
