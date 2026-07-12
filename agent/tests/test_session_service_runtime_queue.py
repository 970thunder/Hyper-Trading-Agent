from __future__ import annotations

import asyncio
from pathlib import Path

from src.session.events import EventBus
from src.session.service import SessionService
from src.session.store import SessionStore


class _DummyIndex:
    def index_session(self, session_id: str, title: str) -> None:
        del session_id, title

    def index_message(self, session_id: str, role: str, content: str) -> None:
        del session_id, role, content


def _service(tmp_path: Path, monkeypatch) -> SessionService:
    monkeypatch.setattr("src.session.service.get_shared_index", lambda: _DummyIndex())
    return SessionService(
        store=SessionStore(tmp_path / "sessions"),
        event_bus=EventBus(),
        runs_dir=tmp_path / "runs",
    )


def test_send_message_can_create_attempt_without_scheduling_background_run(
    tmp_path: Path,
    monkeypatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    session = service.create_session()
    scheduled: list[object] = []

    def fake_create_task(coro: object) -> None:
        scheduled.append(coro)

    monkeypatch.setattr(asyncio, "create_task", fake_create_task)

    result = asyncio.run(service.send_message(session.session_id, "research NVDA", schedule=False))

    assert result["message_id"]
    assert result["attempt_id"]
    assert scheduled == []
    attempt = service.store.get_attempt(session.session_id, result["attempt_id"])
    assert attempt is not None
    assert attempt.status.value == "queued"


def test_run_queued_attempt_executes_persisted_attempt(
    tmp_path: Path,
    monkeypatch,
) -> None:
    service = _service(tmp_path, monkeypatch)
    session = service.create_session()
    result = asyncio.run(service.send_message(session.session_id, "research NVDA", schedule=False))

    async def fake_run_attempt(session_arg, attempt_arg, **kwargs) -> None:
        del session_arg, kwargs
        attempt_arg.mark_completed("queued attempt completed")
        service.store.update_attempt(attempt_arg)

    monkeypatch.setattr(service, "_run_attempt", fake_run_attempt)

    worker_result = service.run_queued_attempt(session.session_id, result["attempt_id"])

    assert worker_result["attempt_status"] == "completed"
    assert worker_result["status"] == "completed"
    attempt = service.store.get_attempt(session.session_id, result["attempt_id"])
    assert attempt is not None
    assert attempt.summary == "queued attempt completed"
