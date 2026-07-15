from __future__ import annotations

import json
from pathlib import Path

from src.commercial.worker import run_once
from src.commercial.store import CommercialStore
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


def test_worker_skips_a_cancelled_durable_job(tmp_path: Path, monkeypatch) -> None:
    redis_client = FakeRedisClient()
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")

    backend = build_runtime_job_backend(redis_client=redis_client)
    backend.enqueue(
        kind="noop",
        source="other",
        title="Cancelled job",
        payload={"message": "should not run"},
        job_id="job_cancelled_1",
    )
    DurableRuntimeJobStore().cancel_job("job_cancelled_1")

    result = run_once(redis_client=redis_client)

    assert result == {"status": "cancelled", "job_id": "job_cancelled_1", "kind": "noop"}
    assert DurableRuntimeJobStore().get_job("job_cancelled_1")["status"] == "cancelled"


def test_worker_run_once_ingests_knowledge_url(tmp_path: Path, monkeypatch) -> None:
    redis_client = FakeRedisClient()
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")

    store = CommercialStore()
    principal, _ = store.register_owner(
        email="owner@example.com",
        password="password123",
        organization_name="Worker Org",
    )
    kb = store.create_knowledge_base(principal, "URL KB")

    class FakeWebReader:
        def execute(self, *, url: str) -> str:
            assert url == "https://example.com/research"
            return json.dumps(
                {
                    "status": "ok",
                    "title": "Fetched Research",
                    "content": "Revenue quality and drawdown controls should be cited in research notes.",
                }
            )

    monkeypatch.setattr("src.commercial.worker.WebReaderTool", FakeWebReader)

    backend = build_runtime_job_backend(redis_client=redis_client)
    runtime_job = backend.enqueue(
        kind="knowledge_url_ingest",
        source="rag",
        title="Ingest URL",
        payload={
            "principal": principal.__dict__,
            "knowledge_base_id": kb["id"],
            "url": "https://example.com/research",
            "title": "",
        },
        metadata={"knowledge_base_id": kb["id"], "url": "https://example.com/research"},
        job_id="job_url_1",
    )
    pending = store.create_pending_url_ingestion_job(
        principal,
        kb["id"],
        url="https://example.com/research",
        title="",
        runtime_job_id=runtime_job["job_id"],
    )

    result = run_once(redis_client=redis_client)

    assert result == {"status": "completed", "job_id": "job_url_1", "kind": "knowledge_url_ingest"}
    runtime = DurableRuntimeJobStore().get_job("job_url_1")
    assert runtime["status"] == "completed"
    assert runtime["metadata"]["worker_result"]["ingestion_job_id"] != pending["id"]
    documents = store.list_knowledge_documents(principal, kb["id"])
    assert len(documents) == 1
    assert documents[0]["title"] == "Fetched Research"
    assert documents[0]["status"] == "ready"
    search = store.search_knowledge(principal, kb["id"], "drawdown controls", limit=5)
    assert search[0]["source_uri"] == "https://example.com/research"


def test_worker_run_once_executes_alpha_bench_job(tmp_path: Path, monkeypatch) -> None:
    redis_client = FakeRedisClient()
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")

    from src.api import alpha_routes
    import src.factors.bench_runner as bench_runner

    alpha_routes.ALPHA_BENCH_JOBS.clear()

    def fake_run_bench(**kwargs):
        kwargs["on_progress"](1, 2, "alpha101_1")
        kwargs["on_progress"](2, 2, "alpha101_2")
        return {"status": "ok", "rows": [{"alpha_id": "alpha101_1"}], "skipped": [], "n_skipped": 0, "summary": "ok"}

    monkeypatch.setattr(bench_runner, "run_bench", fake_run_bench)
    backend = build_runtime_job_backend(redis_client=redis_client)
    backend.enqueue(
        kind="alpha_bench",
        source="backtest",
        title="Alpha bench csi300",
        payload={"job_id": "bench-worker-1", "zoo": "alpha101", "universe": "csi300", "period": "2020-2025", "top": 20},
        metadata={"universe": "csi300"},
        job_id="bench-worker-1",
    )

    result = run_once(redis_client=redis_client)

    assert result == {"status": "completed", "job_id": "bench-worker-1", "kind": "alpha_bench"}
    durable = DurableRuntimeJobStore().get_job("bench-worker-1")
    assert durable["status"] == "completed"
    assert durable["metadata"]["worker_result"]["alpha_status"] == "done"
    assert alpha_routes.ALPHA_BENCH_JOBS["bench-worker-1"]["status"] == "done"


def test_worker_run_once_executes_alpha_compare_job(tmp_path: Path, monkeypatch) -> None:
    redis_client = FakeRedisClient()
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")

    from src.api import alpha_routes
    import src.factors.compare_runner as compare_runner

    alpha_routes.ALPHA_COMPARE_JOBS.clear()

    def fake_compare_alphas(alpha_ids, universe, period, *, sort, on_progress):
        on_progress(1, 1, alpha_ids[0])
        return {"status": "ok", "rows": [{"alpha_id": alpha_ids[0], "ir": 1.2}], "universe": universe, "period": period, "sort": sort}

    monkeypatch.setattr(compare_runner, "compare_alphas", fake_compare_alphas)
    backend = build_runtime_job_backend(redis_client=redis_client)
    backend.enqueue(
        kind="alpha_compare",
        source="backtest",
        title="Alpha compare csi300",
        payload={"job_id": "compare-worker-1", "alpha_ids": ["alpha101_1"], "universe": "csi300", "period": "2020-2025", "sort": "ir"},
        metadata={"universe": "csi300"},
        job_id="compare-worker-1",
    )

    result = run_once(redis_client=redis_client)

    assert result == {"status": "completed", "job_id": "compare-worker-1", "kind": "alpha_compare"}
    durable = DurableRuntimeJobStore().get_job("compare-worker-1")
    assert durable["status"] == "completed"
    assert durable["metadata"]["worker_result"]["alpha_status"] == "done"
    assert alpha_routes.ALPHA_COMPARE_JOBS["compare-worker-1"]["status"] == "done"


def test_worker_run_once_executes_agent_run_job(tmp_path: Path, monkeypatch) -> None:
    redis_client = FakeRedisClient()
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "redis-postgres")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://vibe:secret@postgres:5432/vibe_trading")

    calls: list[dict[str, str]] = []

    class FakeSessionService:
        def run_queued_attempt(self, session_id: str, attempt_id: str) -> dict[str, str]:
            calls.append({"session_id": session_id, "attempt_id": attempt_id})
            return {"status": "completed", "attempt_status": "completed"}

    monkeypatch.setattr("src.commercial.worker._build_session_service", lambda: FakeSessionService())

    backend = build_runtime_job_backend(redis_client=redis_client)
    backend.enqueue(
        kind="agent_run",
        source="agent",
        title="Agent run",
        payload={"session_id": "sess-worker-1", "attempt_id": "attempt-worker-1", "message_id": "msg-worker-1"},
        metadata={"session_id": "sess-worker-1", "attempt_id": "attempt-worker-1"},
        job_id="agent_run_attempt-worker-1",
    )

    result = run_once(redis_client=redis_client)

    assert result == {"status": "completed", "job_id": "agent_run_attempt-worker-1", "kind": "agent_run"}
    assert calls == [{"session_id": "sess-worker-1", "attempt_id": "attempt-worker-1"}]
    durable = DurableRuntimeJobStore().get_job("agent_run_attempt-worker-1")
    assert durable["status"] == "completed"
    assert durable["metadata"]["worker_result"]["attempt_status"] == "completed"
