"""Durable job store for Runtime operations.

The first production step uses SQLite as a local durable adapter while keeping
the row shape compatible with a future Postgres/Redis-backed worker queue.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.config.paths import get_data_dir

RUNTIME_JOB_STATUSES = {"queued", "pending", "running", "completed", "done", "failed", "error", "cancelled"}
RUNTIME_JOB_SOURCES = {"agent", "rag", "web", "backtest", "other"}


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_runtime_jobs_path() -> Path:
    raw = os.getenv("VIBE_TRADING_RUNTIME_JOBS_DB", "").strip()
    if raw:
        return Path(raw).expanduser()
    return get_data_dir() / "runtime_jobs.db"


def _clamp_progress(value: int | float | None) -> int:
    try:
        return max(0, min(100, int(value or 0)))
    except (TypeError, ValueError):
        return 0


def _json_dumps(value: dict[str, Any] | None) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _json_loads(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        loaded = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return loaded if isinstance(loaded, dict) else {}


class DurableRuntimeJobStore:
    """SQLite-backed durable envelope for Runtime job rows."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = (path or default_runtime_jobs_path()).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS runtime_jobs (
                    job_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    source TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    error TEXT NOT NULL DEFAULT '',
                    retryable INTEGER NOT NULL DEFAULT 0,
                    cancelable INTEGER NOT NULL DEFAULT 0,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT NOT NULL DEFAULT '',
                    completed_at TEXT NOT NULL DEFAULT ''
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_runtime_jobs_updated ON runtime_jobs(updated_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_runtime_jobs_kind ON runtime_jobs(kind)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_runtime_jobs_source ON runtime_jobs(source)")

    def create_job(
        self,
        *,
        job_id: str,
        kind: str,
        title: str,
        source: str = "other",
        status: str = "queued",
        progress: int = 0,
        error: str = "",
        metadata: dict[str, Any] | None = None,
        retryable: bool = False,
        cancelable: bool = False,
    ) -> dict[str, Any]:
        if not job_id:
            raise ValueError("job_id is required")
        if status not in RUNTIME_JOB_STATUSES:
            raise ValueError(f"invalid runtime job status {status!r}")
        if source not in RUNTIME_JOB_SOURCES:
            source = "other"
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO runtime_jobs(
                    job_id, kind, source, title, status, progress, error,
                    retryable, cancelable, metadata_json, created_at, updated_at,
                    started_at, completed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM runtime_jobs WHERE job_id = ?), ?), ?, ?, ?)
                """,
                (
                    job_id,
                    kind,
                    source,
                    title,
                    status,
                    _clamp_progress(progress),
                    error,
                    1 if retryable else 0,
                    1 if cancelable else 0,
                    _json_dumps(metadata),
                    job_id,
                    now,
                    now,
                    now if status == "running" else "",
                    now if status in {"completed", "done", "failed", "error", "cancelled"} else "",
                ),
            )
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM runtime_jobs WHERE job_id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(job_id)
        return self._row_to_dict(row)

    def list_jobs(self, *, limit: int = 200, source: str = "", kind: str = "") -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if source:
            clauses.append("source = ?")
            params.append(source)
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(max(1, min(limit, 1000)))
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM runtime_jobs {where} ORDER BY updated_at DESC, created_at DESC LIMIT ?",
                params,
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
        retryable: bool | None = None,
        cancelable: bool | None = None,
    ) -> dict[str, Any]:
        current = self.get_job(job_id)
        next_status = status or str(current["status"])
        if next_status not in RUNTIME_JOB_STATUSES:
            raise ValueError(f"invalid runtime job status {next_status!r}")
        next_progress = _clamp_progress(progress if progress is not None else int(current["progress"]))
        now = utcnow()
        started_at = str(current.get("started_at") or "")
        completed_at = str(current.get("completed_at") or "")
        if next_status == "running" and not started_at:
            started_at = now
        if next_status in {"completed", "done", "failed", "error", "cancelled"}:
            completed_at = now
            if next_status in {"completed", "done", "failed", "error", "cancelled"}:
                next_progress = 100
        merged_metadata = dict(current.get("metadata") or {})
        if metadata:
            merged_metadata.update(metadata)
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE runtime_jobs
                SET status = ?, progress = ?, error = ?, metadata_json = ?,
                    retryable = ?, cancelable = ?, updated_at = ?, started_at = ?, completed_at = ?
                WHERE job_id = ?
                """,
                (
                    next_status,
                    next_progress,
                    str(current.get("error") or "") if error is None else error,
                    _json_dumps(merged_metadata),
                    int(bool(current.get("retryable"))) if retryable is None else (1 if retryable else 0),
                    int(bool(current.get("cancelable"))) if cancelable is None else (1 if cancelable else 0),
                    now,
                    started_at,
                    completed_at,
                    job_id,
                ),
            )
        return self.get_job(job_id)

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        if str(job["status"]) not in {"queued", "pending", "running"}:
            raise ValueError("only queued or running jobs can be cancelled")
        return self.update_job(job_id, status="cancelled", progress=100, cancelable=False)

    def mark_retry_requested(self, job_id: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        if str(job["status"]) not in {"failed", "error"}:
            raise ValueError("only failed jobs can be retried")
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE runtime_jobs
                SET status = 'queued', progress = 0, error = '', retry_count = retry_count + 1,
                    cancelable = 1, updated_at = ?, started_at = '', completed_at = ''
                WHERE job_id = ?
                """,
                (now, job_id),
            )
        return self.get_job(job_id)

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "job_id": str(row["job_id"]),
            "kind": str(row["kind"]),
            "source": str(row["source"]),
            "title": str(row["title"]),
            "status": str(row["status"]),
            "progress": int(row["progress"] or 0),
            "error": str(row["error"] or ""),
            "retryable": bool(row["retryable"]),
            "cancelable": bool(row["cancelable"]),
            "retry_count": int(row["retry_count"] or 0),
            "metadata": _json_loads(row["metadata_json"]),
            "created_at": str(row["created_at"] or ""),
            "updated_at": str(row["updated_at"] or ""),
            "started_at": str(row["started_at"] or ""),
            "completed_at": str(row["completed_at"] or ""),
        }
