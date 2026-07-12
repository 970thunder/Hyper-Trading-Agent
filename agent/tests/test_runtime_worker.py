from __future__ import annotations

import json
from pathlib import Path

from src.commercial.worker import run_once
from src.runtime_jobs.backend import build_runtime_job_backend
from src.runtime_jobs.store import DurableRuntimeJobStore


class FakeRedisClient:
    def __init__(self) -> None:
        self.items: list[str] = []

    def rpush(self, _queue_name: str, payload: str) -> int:
        self.items.append(payload)
        return len(self.items)

    def lpop(self, _queue_name: str) -> str | None:
        if not self.items:
            return None
        return self.items.pop(0)


def test_worker_run_once_completes_known_noop_job(tmp_path: Path, monkeypatch) -> None:
    redis_client = FakeRedisClient()
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")

    backend = build_runtime_job_backend(redis_client=redis_client)
    backend.enqueue(
        kind="noop",
        source="other",
        title="Noop health job",
        payload={"message": "ok"},
        metadata={"origin": "test"},
        job_id="job_noop_1",
    )

    result = run_once(redis_client=redis_client)

    assert result == {"status": "completed", "job_id": "job_noop_1", "kind": "noop"}
    job = DurableRuntimeJobStore().get_job("job_noop_1")
    assert job["status"] == "completed"
    assert job["progress"] == 100
    assert job["metadata"]["worker_result"]["message"] == "ok"


def test_worker_run_once_marks_unknown_job_failed(tmp_path: Path, monkeypatch) -> None:
    redis_client = FakeRedisClient()
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_QUEUE", "hyper:runtime:jobs")
    DurableRuntimeJobStore().create_job(
        job_id="job_unknown_1",
        kind="unknown",
        source="other",
        title="Unknown job",
        status="queued",
        metadata={"payload": {"x": 1}},
        retryable=True,
        cancelable=True,
    )
    redis_client.rpush(
        "hyper:runtime:jobs",
        json.dumps(
            {
                "job_id": "job_unknown_1",
                "kind": "unknown",
                "source": "other",
                "title": "Unknown job",
                "payload": {"x": 1},
                "metadata": {},
            }
        ),
    )

    result = run_once(redis_client=redis_client)

    assert result["status"] == "failed"
    assert result["job_id"] == "job_unknown_1"
    job = DurableRuntimeJobStore().get_job("job_unknown_1")
    assert job["status"] == "failed"
    assert "unsupported runtime job kind" in job["error"]

