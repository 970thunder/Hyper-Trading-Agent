"""Runtime job backend selection and queue contract.

This module is the boundary between the API-facing durable job table and the
future production worker queue. SQLite remains the local default; the
Redis/Postgres backend exposes the queue payload contract without forcing tests
or local mode to install external services.
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from src.runtime_jobs.store import DurableRuntimeJobStore

SQLITE_RUNTIME_BACKEND = "sqlite-local"
REDIS_POSTGRES_RUNTIME_BACKEND = "redis-postgres"
DEFAULT_RUNTIME_QUEUE = "hyper:runtime:jobs"


class RuntimeJobBackend(Protocol):
    name: str

    def status(self) -> dict[str, object]:
        """Return user-safe backend status for Runtime diagnostics."""

    def enqueue(
        self,
        *,
        kind: str,
        source: str,
        title: str,
        payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        """Create a queued durable job and return its row envelope."""


def _configured_backend() -> str:
    return (
        os.getenv("HYPER_TRADING_RUNTIME_JOB_BACKEND", "")
        or os.getenv("VIBE_TRADING_RUNTIME_JOB_BACKEND", "")
        or SQLITE_RUNTIME_BACKEND
    ).strip() or SQLITE_RUNTIME_BACKEND


def _redis_url() -> str:
    return (
        os.getenv("HYPER_TRADING_REDIS_URL", "")
        or os.getenv("REDIS_URL", "")
    ).strip()


def _postgres_dsn() -> str:
    return (
        os.getenv("HYPER_TRADING_RUNTIME_POSTGRES_DSN", "")
        or os.getenv("DATABASE_URL", "")
    ).strip()


def _queue_name() -> str:
    return (
        os.getenv("HYPER_TRADING_RUNTIME_JOB_QUEUE", "")
        or os.getenv("VIBE_TRADING_RUNTIME_JOB_QUEUE", "")
        or DEFAULT_RUNTIME_QUEUE
    ).strip() or DEFAULT_RUNTIME_QUEUE


def _job_id() -> str:
    return f"job_{uuid.uuid4().hex}"


def _queue_payload(
    *,
    job_id: str,
    kind: str,
    source: str,
    title: str,
    payload: dict[str, Any],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "kind": kind,
        "source": source,
        "title": title,
        "payload": payload,
        "metadata": metadata,
    }


@dataclass
class SQLiteRuntimeJobBackend:
    configured: str = SQLITE_RUNTIME_BACKEND
    fallback_reason: str = ""
    store: DurableRuntimeJobStore | None = None
    name: str = SQLITE_RUNTIME_BACKEND

    def _store(self) -> DurableRuntimeJobStore:
        if self.store is None:
            self.store = DurableRuntimeJobStore()
        return self.store

    def status(self) -> dict[str, object]:
        return {
            "active": self.name,
            "configured": self.configured,
            "available": True,
            "redis_configured": bool(_redis_url()),
            "postgres_configured": bool(_postgres_dsn()),
            "queue_name": _queue_name(),
            "fallback_reason": self.fallback_reason,
        }

    def enqueue(
        self,
        *,
        kind: str,
        source: str,
        title: str,
        payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        row_metadata = dict(metadata or {})
        row_metadata["payload"] = payload
        return self._store().create_job(
            job_id=job_id or _job_id(),
            kind=kind,
            source=source,
            title=title,
            status="queued",
            progress=0,
            metadata=row_metadata,
            retryable=True,
            cancelable=True,
        )


@dataclass
class RedisPostgresRuntimeJobBackend:
    redis_url: str
    postgres_dsn: str
    queue_name: str = DEFAULT_RUNTIME_QUEUE
    redis_client: Any | None = None
    store: DurableRuntimeJobStore | None = None
    name: str = REDIS_POSTGRES_RUNTIME_BACKEND

    def _store(self) -> DurableRuntimeJobStore:
        if self.store is None:
            self.store = DurableRuntimeJobStore()
        return self.store

    def status(self) -> dict[str, object]:
        return {
            "active": self.name,
            "configured": REDIS_POSTGRES_RUNTIME_BACKEND,
            "available": True,
            "redis_configured": bool(self.redis_url),
            "postgres_configured": bool(self.postgres_dsn),
            "queue_name": self.queue_name,
            "fallback_reason": "",
        }

    def enqueue(
        self,
        *,
        kind: str,
        source: str,
        title: str,
        payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        durable_id = job_id or _job_id()
        clean_metadata = dict(metadata or {})
        queued = _queue_payload(
            job_id=durable_id,
            kind=kind,
            source=source,
            title=title,
            payload=payload,
            metadata=clean_metadata,
        )
        row_metadata = dict(clean_metadata)
        row_metadata["payload"] = payload
        row_metadata["queue_name"] = self.queue_name
        row = self._store().create_job(
            job_id=durable_id,
            kind=kind,
            source=source,
            title=title,
            status="queued",
            progress=0,
            metadata=row_metadata,
            retryable=True,
            cancelable=True,
        )
        if self.redis_client is None:
            raise RuntimeError("Redis client is not configured")
        self.redis_client.rpush(self.queue_name, json.dumps(queued, ensure_ascii=False, sort_keys=True))
        return row


def _redis_client_from_url(redis_url: str) -> Any | None:
    try:
        import redis  # type: ignore[import-not-found]
    except Exception:
        return None
    return redis.Redis.from_url(redis_url, decode_responses=True)


def build_runtime_job_backend(
    *,
    redis_client: Any | None = None,
    store: DurableRuntimeJobStore | None = None,
) -> RuntimeJobBackend:
    configured = _configured_backend()
    if configured == REDIS_POSTGRES_RUNTIME_BACKEND:
        redis_url = _redis_url()
        postgres_dsn = _postgres_dsn()
        missing: list[str] = []
        if not redis_url:
            missing.append("Redis URL")
        if not postgres_dsn:
            missing.append("Postgres DSN")
        if missing:
            return SQLiteRuntimeJobBackend(
                configured=configured,
                fallback_reason=f"{' and '.join(missing)} is not configured",
                store=store,
            )
        client = redis_client if redis_client is not None else _redis_client_from_url(redis_url)
        if client is None:
            return SQLiteRuntimeJobBackend(
                configured=configured,
                fallback_reason="Redis client package is not installed",
                store=store,
            )
        return RedisPostgresRuntimeJobBackend(
            redis_url=redis_url,
            postgres_dsn=postgres_dsn,
            queue_name=_queue_name(),
            redis_client=client,
            store=store,
        )
    return SQLiteRuntimeJobBackend(configured=configured, store=store)

