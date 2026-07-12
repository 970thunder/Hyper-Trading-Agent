from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

import api_server
from src.api import alpha_routes


def _client() -> TestClient:
    return TestClient(api_server.app, client=("127.0.0.1", 50000))


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
