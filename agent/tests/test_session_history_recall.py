from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from src.api.sessions_routes import register_sessions_routes
from src.session.events import EventBus
from src.session.service import SessionService
from src.session.store import SessionStore


class _EphemeralIndex:
    def __init__(self, db_path: Path) -> None:
        from src.session.search import SessionSearchIndex

        self._index = SessionSearchIndex(db_path)

    def index_session(self, session_id: str, title: str, ts: float | None = None) -> None:
        self._index.index_session(session_id, title, ts=ts)

    def index_message(self, session_id: str, role: str, content: str) -> None:
        self._index.index_message(session_id, role, content)

    def search(self, query: str, max_sessions: int = 3):
        return self._index.search(query, max_sessions=max_sessions)

    def close(self) -> None:
        self._index.close()


def build_service(tmp_path: Path, monkeypatch) -> SessionService:
    index = _EphemeralIndex(tmp_path / "search.db")
    monkeypatch.setattr("src.session.service.get_shared_index", lambda: index)
    return SessionService(
        store=SessionStore(tmp_path / "sessions"),
        event_bus=EventBus(),
        runs_dir=tmp_path / "runs",
    )


def test_conversation_history_recall_excludes_current_session(tmp_path: Path, monkeypatch) -> None:
    service = build_service(tmp_path, monkeypatch)
    old = service.create_session("NVDA thesis")
    current = service.create_session("Current work")

    service._search_index.index_message(old.session_id, "assistant", "NVDA margin expansion thesis from prior research")
    service._search_index.index_message(current.session_id, "user", "NVDA margin expansion current question")

    recall = service.recall_conversation_history(
        "NVDA margin expansion",
        current_session_id=current.session_id,
        limit=3,
    )

    assert len(recall) == 1
    assert recall[0]["session_id"] == old.session_id
    assert recall[0]["citation"] == f"conversation:{old.session_id}"
    service._search_index.close()


def test_conversation_history_recall_builds_system_context(tmp_path: Path, monkeypatch) -> None:
    service = build_service(tmp_path, monkeypatch)
    old = service.create_session("Pairs research")
    current = service.create_session("Follow-up")
    service._search_index.index_message(old.session_id, "assistant", "Pairs strategy used zscore entry threshold 2.1")

    messages = service._conversation_history_recall_messages(
        "What was the zscore threshold?",
        current_session_id=current.session_id,
    )

    assert len(messages) == 1
    assert messages[0]["role"] == "system"
    assert "<conversation-history-recall>" in messages[0]["content"]
    assert "conversation:" in messages[0]["content"]
    assert "zscore" in messages[0]["content"].lower()
    service._search_index.close()


def test_session_history_search_api_returns_citations(tmp_path: Path, monkeypatch) -> None:
    service = build_service(tmp_path, monkeypatch)
    session = service.create_session("Volatility note")
    service._search_index.index_message(session.session_id, "assistant", "VIX futures curve was in contango")

    app = FastAPI()

    async def _allow_auth() -> None:
        return None

    def _validate_path(value: str, kind: str) -> None:
        del value, kind

    import sys
    import types

    host = types.SimpleNamespace(
        require_auth=_allow_auth,
        require_event_stream_auth=_allow_auth,
        _get_session_service=lambda: service,
        _validate_path_param=_validate_path,
        _shell_tools_enabled_for_request=lambda request: False,
    )
    monkeypatch.setitem(sys.modules, "api_server", host)
    register_sessions_routes(app)

    response = TestClient(app).get("/session-history/search", params={"q": "VIX contango"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["results"][0]["citation"] == f"conversation:{session.session_id}"
    service._search_index.close()
