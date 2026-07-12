from __future__ import annotations

import json
from pathlib import Path

from src.runtime_jobs.backend import build_runtime_job_backend
from src.runtime_jobs.store import DurableRuntimeJobStore


def test_runtime_job_backend_defaults_to_sqlite_store(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", raising=False)
    monkeypatch.delenv("VIBE_TRADING_RUNTIME_JOB_BACKEND", raising=False)
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))

    backend = build_runtime_job_backend()
    job = backend.enqueue(
        kind="agent_run",
        source="agent",
        title="Research run",
        payload={"session_id": "sess_1"},
        metadata={"session_id": "sess_1"},
    )

    assert backend.name == "sqlite-local"
    assert backend.status()["active"] == "sqlite-local"
    assert backend.status()["available"] is True
    assert job["status"] == "queued"
    assert job["cancelable"] is True
    assert DurableRuntimeJobStore().get_job(job["job_id"])["metadata"]["payload"]["session_id"] == "sess_1"


def test_runtime_job_backend_falls_back_when_redis_postgres_config_incomplete(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))

    backend = build_runtime_job_backend()
    status = backend.status()

    assert backend.name == "sqlite-local"
    assert status["configured"] == "redis-postgres"
    assert status["active"] == "sqlite-local"
    assert status["redis_configured"] is False
    assert status["postgres_configured"] is False
    assert "redis" in str(status["fallback_reason"]).lower()
    assert "postgres" in str(status["fallback_reason"]).lower()


def test_redis_postgres_backend_enqueues_json_payload(monkeypatch) -> None:
    pushed: list[tuple[str, str]] = []

    class FakeRedisClient:
        def rpush(self, queue_name: str, payload: str) -> int:
            pushed.append((queue_name, payload))
            return 1

    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_QUEUE", "hyper:runtime:jobs")

    backend = build_runtime_job_backend(redis_client=FakeRedisClient())
    job = backend.enqueue(
        kind="web_crawl",
        source="web",
        title="Crawl macro policy URL",
        payload={"url": "https://example.com/policy"},
        metadata={"url": "https://example.com/policy"},
        job_id="job_web_1",
    )

    assert backend.name == "redis-postgres"
    assert job["job_id"] == "job_web_1"
    assert job["status"] == "queued"
    assert pushed[0][0] == "hyper:runtime:jobs"
    queued = json.loads(pushed[0][1])
    assert queued == {
        "job_id": "job_web_1",
        "kind": "web_crawl",
        "source": "web",
        "title": "Crawl macro policy URL",
        "payload": {"url": "https://example.com/policy"},
        "metadata": {"url": "https://example.com/policy"},
    }

