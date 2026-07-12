from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

import api_server
import src.api.sessions_routes as sessions_routes
from src.runtime_jobs.store import DurableRuntimeJobStore


class FakeRedisClient:
    def __init__(self) -> None:
        self.items: list[str] = []

    def rpush(self, _queue_name: str, payload: str) -> int:
        self.items.append(payload)
        return len(self.items)


def test_session_message_queues_agent_run_in_redis_postgres_backend(
    tmp_path: Path,
    monkeypatch,
) -> None:
    redis_client = FakeRedisClient()
    captured: dict[str, object] = {}

    class FakeSessionService:
        async def send_message(self, session_id: str, content: str, **kwargs):
            captured["session_id"] = session_id
            captured["content"] = content
            captured["schedule"] = kwargs.get("schedule")
            return {
                "message_id": "msg-agent-1",
                "attempt_id": "attempt-agent-1",
                "execution_mode": kwargs.get("execution_mode") or "react",
            }

    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://hyper:secret@postgres:5432/hyper_trading")
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_QUEUE", "hyper:runtime:jobs")
    monkeypatch.setattr(api_server, "_get_session_service", lambda: FakeSessionService())
    monkeypatch.setattr(sessions_routes, "_runtime_redis_client", lambda: redis_client)

    response = TestClient(api_server.app, client=("127.0.0.1", 50000)).post(
        "/sessions/session123/messages",
        json={"content": "Run a factor research plan", "execution_mode": "plan_execute"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["message_id"] == "msg-agent-1"
    assert payload["attempt_id"] == "attempt-agent-1"
    assert payload["runtime_job_id"] == "agent_run_attempt-agent-1"
    assert captured["schedule"] is False

    queued = json.loads(redis_client.items[0])
    assert queued["kind"] == "agent_run"
    assert queued["job_id"] == "agent_run_attempt-agent-1"
    assert queued["payload"] == {
        "session_id": "session123",
        "message_id": "msg-agent-1",
        "attempt_id": "attempt-agent-1",
    }

    durable = DurableRuntimeJobStore().get_job("agent_run_attempt-agent-1")
    assert durable["kind"] == "agent_run"
    assert durable["source"] == "agent"
    assert durable["status"] == "queued"
    assert durable["metadata"]["session_id"] == "session123"
    assert durable["metadata"]["attempt_id"] == "attempt-agent-1"
