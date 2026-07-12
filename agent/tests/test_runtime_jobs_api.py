from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

import api_server
from src.api import alpha_routes
from src.commercial.store import CommercialStore
from src.runtime_jobs.store import DurableRuntimeJobStore


def _client() -> TestClient:
    return TestClient(api_server.app, client=("127.0.0.1", 50000))


@pytest.fixture(autouse=True)
def _isolate_runtime_jobs_db(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))


def setup_function() -> None:
    alpha_routes.ALPHA_BENCH_JOBS.clear()
    alpha_routes.ALPHA_COMPARE_JOBS.clear()
    alpha_routes._RUNNING_TASKS.clear()


def teardown_function() -> None:
    alpha_routes.ALPHA_BENCH_JOBS.clear()
    alpha_routes.ALPHA_COMPARE_JOBS.clear()
    alpha_routes._RUNNING_TASKS.clear()


def test_runtime_jobs_lists_alpha_background_jobs() -> None:
    alpha_routes.ALPHA_BENCH_JOBS["bench-1"] = {
        "job_id": "bench-1",
        "status": "running",
        "zoo": "alpha101",
        "universe": "csi300",
        "period": "2020-2025",
        "top": 20,
        "created_at": "2026-07-12T00:00:00+00:00",
        "updated_at": "2026-07-12T00:01:00+00:00",
        "progress": {"n_done": 4, "n_total": 10, "current_alpha_id": "alpha101_4"},
        "result": None,
        "error": None,
    }
    alpha_routes.ALPHA_COMPARE_JOBS["compare-1"] = {
        "job_id": "compare-1",
        "status": "error",
        "alpha_ids": ["alpha101_1", "alpha101_2"],
        "universe": "csi300",
        "period": "2020-2025",
        "sort": "ir",
        "created_at": "2026-07-12T00:00:00+00:00",
        "updated_at": "2026-07-12T00:02:00+00:00",
        "progress": {"n_done": 2, "n_total": 2, "current_alpha_id": "alpha101_2"},
        "result": None,
        "error": "factor load failed",
    }

    response = _client().get("/runtime/jobs")

    assert response.status_code == 200
    rows = response.json()
    assert rows[0]["job_id"] == "compare-1"
    assert rows[0]["kind"] == "alpha_compare"
    assert rows[0]["title"] == "Alpha compare csi300"
    assert rows[0]["progress"] == 100
    assert rows[0]["error"] == "factor load failed"
    assert rows[1]["job_id"] == "bench-1"
    assert rows[1]["kind"] == "alpha_bench"
    assert rows[1]["progress"] == 40


def test_alpha_bench_progress_and_completion_sync_to_durable_store(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    alpha_routes.ALPHA_BENCH_JOBS["bench-1"] = {
        "job_id": "bench-1",
        "status": "queued",
        "zoo": "alpha101",
        "universe": "csi300",
        "period": "2020-2025",
        "top": 20,
        "created_at": "2026-07-12T00:00:00+00:00",
        "updated_at": "2026-07-12T00:00:00+00:00",
        "progress": {"n_done": 0, "n_total": 10, "current_alpha_id": None},
        "result": None,
        "error": None,
    }

    alpha_routes._sync_alpha_job_to_durable("alpha_bench", dict(alpha_routes.ALPHA_BENCH_JOBS["bench-1"]))
    alpha_routes._make_progress_cb("bench-1")(4, 10, "alpha101_4")
    alpha_routes.ALPHA_BENCH_JOBS["bench-1"]["status"] = "done"
    alpha_routes.ALPHA_BENCH_JOBS["bench-1"]["result"] = {"status": "ok"}
    alpha_routes._sync_alpha_job_to_durable("alpha_bench", dict(alpha_routes.ALPHA_BENCH_JOBS["bench-1"]))

    job = DurableRuntimeJobStore().get_job("bench-1")

    assert job["kind"] == "alpha_bench"
    assert job["source"] == "backtest"
    assert job["status"] == "done"
    assert job["progress"] == 100
    assert job["metadata"]["zoo"] == "alpha101"
    assert job["metadata"]["current_alpha_id"] == "alpha101_4"


def test_runtime_jobs_dedupes_alpha_jobs_mirrored_to_durable_store(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    alpha_routes.ALPHA_BENCH_JOBS["bench-1"] = {
        "job_id": "bench-1",
        "status": "running",
        "zoo": "alpha101",
        "universe": "csi300",
        "period": "2020-2025",
        "top": 20,
        "created_at": "2026-07-12T00:00:00+00:00",
        "updated_at": "2026-07-12T00:01:00+00:00",
        "progress": {"n_done": 5, "n_total": 10, "current_alpha_id": "alpha101_5"},
        "result": None,
        "error": None,
    }
    alpha_routes._sync_alpha_job_to_durable("alpha_bench", dict(alpha_routes.ALPHA_BENCH_JOBS["bench-1"]))

    response = _client().get("/runtime/jobs")

    assert response.status_code == 200
    rows = response.json()
    bench_rows = [row for row in rows if row["job_id"] == "bench-1"]
    assert len(bench_rows) == 1
    assert bench_rows[0]["metadata"]["current_alpha_id"] == "alpha101_5"


def test_runtime_jobs_cancel_and_retry_alpha_jobs_sync_durable_store(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyTask:
        def add_done_callback(self, _callback: object) -> None:
            return None

    def fake_create_task(coro: object) -> DummyTask:
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        return DummyTask()

    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    monkeypatch.setattr(alpha_routes.asyncio, "create_task", fake_create_task)
    alpha_routes.ALPHA_BENCH_JOBS["bench-cancel"] = {
        "job_id": "bench-cancel",
        "status": "running",
        "zoo": "alpha101",
        "universe": "csi300",
        "period": "2020-2025",
        "top": 20,
        "created_at": "2026-07-12T00:00:00+00:00",
        "progress": {"n_done": 1, "n_total": 10, "current_alpha_id": "alpha101_1"},
        "result": None,
        "error": None,
    }
    alpha_routes._sync_alpha_job_to_durable("alpha_bench", dict(alpha_routes.ALPHA_BENCH_JOBS["bench-cancel"]))
    alpha_routes.ALPHA_BENCH_JOBS["bench-retry"] = {
        "job_id": "bench-retry",
        "status": "error",
        "zoo": "alpha101",
        "universe": "csi300",
        "period": "2020-2025",
        "top": 20,
        "created_at": "2026-07-12T00:00:00+00:00",
        "progress": {"n_done": 3, "n_total": 10, "current_alpha_id": "alpha101_3"},
        "result": None,
        "error": "factor load failed",
    }
    alpha_routes._sync_alpha_job_to_durable("alpha_bench", dict(alpha_routes.ALPHA_BENCH_JOBS["bench-retry"]))

    cancel_response = _client().post("/runtime/jobs/bench-cancel/cancel")
    retry_response = _client().post("/runtime/jobs/bench-retry/retry")

    assert cancel_response.status_code == 200
    assert retry_response.status_code == 200
    store = DurableRuntimeJobStore()
    assert store.get_job("bench-cancel")["status"] == "cancelled"
    assert store.get_job("bench-retry")["status"] == "queued"


def test_runtime_jobs_lists_generic_durable_jobs(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    store = DurableRuntimeJobStore()
    store.create_job(
        job_id="agent-run-1",
        kind="agent_run",
        source="agent",
        title="Portfolio research agent run",
        status="running",
        progress=42,
        metadata={"session_id": "sess_1"},
        retryable=False,
        cancelable=True,
    )
    store.create_job(
        job_id="web-crawl-1",
        kind="web_crawl",
        source="web",
        title="Crawl macro policy URL",
        status="failed",
        progress=100,
        error="timeout",
        metadata={"url": "https://example.com"},
        retryable=True,
        cancelable=False,
    )

    response = _client().get("/runtime/jobs")

    assert response.status_code == 200
    rows = response.json()
    assert rows[0]["job_id"] == "web-crawl-1"
    assert rows[0]["kind"] == "web_crawl"
    assert rows[0]["source"] == "web"
    assert rows[0]["error"] == "timeout"
    assert rows[1]["job_id"] == "agent-run-1"
    assert rows[1]["progress"] == 42


def test_runtime_jobs_cancel_and_retry_generic_durable_jobs(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_RUNTIME_JOBS_DB", str(tmp_path / "runtime_jobs.db"))
    store = DurableRuntimeJobStore()
    store.create_job(
        job_id="long-backtest-1",
        kind="long_backtest",
        source="backtest",
        title="Long backtest",
        status="running",
        progress=25,
        retryable=True,
        cancelable=True,
    )
    store.create_job(
        job_id="web-crawl-1",
        kind="web_crawl",
        source="web",
        title="Crawl macro policy URL",
        status="failed",
        progress=100,
        error="timeout",
        retryable=True,
        cancelable=False,
    )

    cancel_response = _client().post("/runtime/jobs/long-backtest-1/cancel")
    retry_response = _client().post("/runtime/jobs/web-crawl-1/retry")

    assert cancel_response.status_code == 200
    assert cancel_response.json() == {"status": "cancelled", "job_id": "long-backtest-1", "kind": "long_backtest"}
    assert retry_response.status_code == 200
    assert retry_response.json() == {"status": "queued", "job_id": "web-crawl-1", "kind": "web_crawl"}
    assert DurableRuntimeJobStore().get_job("long-backtest-1")["status"] == "cancelled"
    assert DurableRuntimeJobStore().get_job("web-crawl-1")["status"] == "queued"


def test_runtime_jobs_includes_commercial_rag_ingestion_jobs(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "true")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    store = CommercialStore()
    principal, token = store.register_owner(
        email="runtime-owner@example.com",
        password="password123",
        organization_name="Runtime Org",
    )
    kb = store.create_knowledge_base(principal, name="Research KB", description="")
    document = store.add_knowledge_document(
        principal,
        str(kb["id"]),
        title="Annual report",
        source_uri="file:///annual-report.pdf",
        source_type="file",
        text="Operating margin and revenue trend analysis.",
        metadata={},
    )

    client = _client()
    client.cookies.set("vibe_session", token)
    response = client.get("/runtime/jobs")

    assert response.status_code == 200
    rows = response.json()
    rag_rows = [row for row in rows if row["kind"] == "rag_ingestion"]
    assert len(rag_rows) == 1
    assert rag_rows[0]["job_id"] == document["ingestion_job_id"]
    assert rag_rows[0]["title"] == "RAG ingestion Annual report"
    assert rag_rows[0]["progress"] == 100
    assert rag_rows[0]["metadata"]["knowledge_base_id"] == kb["id"]


def test_runtime_jobs_retry_commercial_rag_ingestion_job(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "true")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    store = CommercialStore()
    principal, token = store.register_owner(
        email="retry-owner@example.com",
        password="password123",
        organization_name="Retry Org",
    )
    kb = store.create_knowledge_base(principal, name="Research KB", description="")
    document = store.add_knowledge_document(
        principal,
        str(kb["id"]),
        title="Failed report",
        source_uri="file:///failed-report.pdf",
        source_type="file",
        text="Revenue growth",
        metadata={"text": "Revenue growth"},
    )
    job_id = document["ingestion_job_id"]
    with store._connect() as conn:
        conn.execute(
            "UPDATE knowledge_ingestion_jobs SET status = 'failed', error = 'embedding failed' WHERE id = ?",
            (job_id,),
        )

    client = _client()
    client.cookies.set("vibe_session", token)
    response = client.post(f"/runtime/jobs/{job_id}/retry")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["kind"] == "rag_ingestion"
    rows = client.get("/runtime/jobs").json()
    assert any(row["kind"] == "rag_ingestion" and row["status"] == "completed" for row in rows)


def test_runtime_jobs_cancel_commercial_rag_ingestion_job(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_MODE", "true")
    monkeypatch.setenv("VIBE_TRADING_COMMERCIAL_DB", str(tmp_path / "commercial.db"))
    store = CommercialStore()
    principal, token = store.register_owner(
        email="cancel-owner@example.com",
        password="password123",
        organization_name="Cancel Org",
    )
    kb = store.create_knowledge_base(principal, name="Research KB", description="")
    document = store.add_knowledge_document(
        principal,
        str(kb["id"]),
        title="Running report",
        source_uri="file:///running-report.pdf",
        source_type="file",
        text="Operating cash flow",
        metadata={},
    )
    job_id = document["ingestion_job_id"]
    with store._connect() as conn:
        conn.execute("UPDATE knowledge_ingestion_jobs SET status = 'running', progress = 25 WHERE id = ?", (job_id,))

    client = _client()
    client.cookies.set("vibe_session", token)
    response = client.post(f"/runtime/jobs/{job_id}/cancel")

    assert response.status_code == 200
    assert response.json() == {"status": "cancelled", "job_id": job_id, "kind": "rag_ingestion"}
    assert store.get_ingestion_job(principal, str(kb["id"]), job_id)["status"] == "cancelled"


def test_runtime_jobs_cancel_marks_running_job_cancelled() -> None:
    alpha_routes.ALPHA_BENCH_JOBS["bench-1"] = {
        "job_id": "bench-1",
        "status": "running",
        "zoo": "alpha101",
        "universe": "csi300",
        "period": "2020-2025",
        "top": 20,
        "created_at": "2026-07-12T00:00:00+00:00",
        "progress": {"n_done": 1, "n_total": 10, "current_alpha_id": "alpha101_1"},
        "result": None,
        "error": None,
    }

    response = _client().post("/runtime/jobs/bench-1/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert alpha_routes.ALPHA_BENCH_JOBS["bench-1"]["status"] == "cancelled"


def test_runtime_jobs_retry_resets_failed_job_and_schedules_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    class DummyTask:
        def add_done_callback(self, _callback: object) -> None:
            return None

    def fake_create_task(coro: object) -> DummyTask:
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        return DummyTask()

    monkeypatch.setattr(alpha_routes.asyncio, "create_task", fake_create_task)
    alpha_routes.ALPHA_BENCH_JOBS["bench-1"] = {
        "job_id": "bench-1",
        "status": "error",
        "zoo": "alpha101",
        "universe": "csi300",
        "period": "2020-2025",
        "top": 20,
        "created_at": "2026-07-12T00:00:00+00:00",
        "progress": {"n_done": 3, "n_total": 10, "current_alpha_id": "alpha101_3"},
        "result": {"status": "error"},
        "error": "factor load failed",
        "_finished_at": 123.0,
    }

    response = _client().post("/runtime/jobs/bench-1/retry")

    assert response.status_code == 200
    assert response.json() == {"status": "queued", "job_id": "bench-1"}
    job = alpha_routes.ALPHA_BENCH_JOBS["bench-1"]
    assert job["status"] == "queued"
    assert job["progress"] == {"n_done": 0, "n_total": 0, "current_alpha_id": None}
    assert job["result"] is None
    assert job["error"] is None
    assert "_finished_at" not in job


def test_runtime_jobs_cancelled_bench_is_not_overwritten_by_worker_completion(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run_bench(**_: object) -> dict[str, object]:
        return {"status": "ok", "rows": [{"alpha_id": "alpha101_1"}], "skipped": [], "n_skipped": 0}

    import src.factors.bench_runner as bench_runner

    monkeypatch.setattr(bench_runner, "run_bench", fake_run_bench)
    alpha_routes.ALPHA_BENCH_JOBS["bench-1"] = {
        "job_id": "bench-1",
        "status": "cancelled",
        "zoo": "alpha101",
        "universe": "csi300",
        "period": "2020-2025",
        "top": 20,
        "created_at": "2026-07-12T00:00:00+00:00",
        "progress": {"n_done": 1, "n_total": 10, "current_alpha_id": "alpha101_1"},
        "result": None,
        "error": None,
    }

    alpha_routes._run_bench_blocking("bench-1", "alpha101", "csi300", "2020-2025", 20)

    job = alpha_routes.ALPHA_BENCH_JOBS["bench-1"]
    assert job["status"] == "cancelled"
    assert job["result"] is None


def test_runtime_jobs_cancelled_compare_is_not_overwritten_by_worker_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_compare_alphas(*_: object, **__: object) -> dict[str, object]:
        raise RuntimeError("late failure")

    import src.factors.compare_runner as compare_runner

    monkeypatch.setattr(compare_runner, "compare_alphas", fake_compare_alphas)
    alpha_routes.ALPHA_COMPARE_JOBS["compare-1"] = {
        "job_id": "compare-1",
        "status": "cancelled",
        "alpha_ids": ["alpha101_1"],
        "universe": "csi300",
        "period": "2020-2025",
        "sort": "ir",
        "created_at": "2026-07-12T00:00:00+00:00",
        "progress": {"n_done": 1, "n_total": 1, "current_alpha_id": "alpha101_1"},
        "result": None,
        "error": None,
    }

    alpha_routes._run_compare_blocking("compare-1", ["alpha101_1"], "csi300", "2020-2025", "ir")

    job = alpha_routes.ALPHA_COMPARE_JOBS["compare-1"]
    assert job["status"] == "cancelled"
    assert job["error"] is None
