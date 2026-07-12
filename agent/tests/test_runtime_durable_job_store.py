from __future__ import annotations

from pathlib import Path

import pytest

from src.runtime_jobs.store import DurableRuntimeJobStore


def test_durable_runtime_job_store_persists_and_lists_jobs(tmp_path: Path) -> None:
    store = DurableRuntimeJobStore(path=tmp_path / "runtime_jobs.db")
    store.create_job(
        job_id="job_a",
        kind="agent_run",
        title="Portfolio agent run",
        source="agent",
        status="queued",
        progress=0,
        metadata={"session_id": "sess_1"},
        retryable=False,
        cancelable=True,
    )
    store.update_job("job_a", status="running", progress=35)

    reloaded = DurableRuntimeJobStore(path=tmp_path / "runtime_jobs.db")
    rows = reloaded.list_jobs()

    assert len(rows) == 1
    assert rows[0]["job_id"] == "job_a"
    assert rows[0]["kind"] == "agent_run"
    assert rows[0]["source"] == "agent"
    assert rows[0]["status"] == "running"
    assert rows[0]["progress"] == 35
    assert rows[0]["metadata"] == {"session_id": "sess_1"}


def test_durable_runtime_job_store_cancel_and_retry_lifecycle(tmp_path: Path) -> None:
    store = DurableRuntimeJobStore(path=tmp_path / "runtime_jobs.db")
    store.create_job(
        job_id="job_failed",
        kind="web_crawl",
        title="Crawl macro URL",
        source="web",
        status="failed",
        progress=100,
        error="timeout",
        metadata={"url": "https://example.com"},
        retryable=True,
        cancelable=False,
    )

    retry = store.mark_retry_requested("job_failed")

    assert retry["status"] == "queued"
    assert retry["progress"] == 0
    assert retry["error"] == ""
    assert retry["retry_count"] == 1

    store.create_job(
        job_id="job_running",
        kind="long_backtest",
        title="Long backtest",
        source="backtest",
        status="running",
        progress=20,
        retryable=True,
        cancelable=True,
    )

    cancelled = store.cancel_job("job_running")

    assert cancelled["status"] == "cancelled"
    assert cancelled["progress"] == 100


def test_durable_runtime_job_store_rejects_invalid_transitions(tmp_path: Path) -> None:
    store = DurableRuntimeJobStore(path=tmp_path / "runtime_jobs.db")
    store.create_job(
        job_id="job_done",
        kind="agent_run",
        title="Done",
        source="agent",
        status="completed",
        progress=100,
        retryable=False,
        cancelable=False,
    )

    with pytest.raises(ValueError, match="only failed jobs"):
        store.mark_retry_requested("job_done")

    with pytest.raises(ValueError, match="only queued or running"):
        store.cancel_job("job_done")
