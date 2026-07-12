"""Commercial runtime worker.

The worker consumes durable Runtime job envelopes from the configured queue and
updates the shared Runtime job store. The first executable job kind is ``noop``
so deployment health and queue wiring can be verified before moving Agent runs,
web crawling, and long backtests onto this path.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from src.runtime_jobs.backend import _queue_name, _redis_client_from_url, _redis_url
from src.runtime_jobs.store import DurableRuntimeJobStore

logger = logging.getLogger(__name__)


def _decode_queue_payload(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        loaded = json.loads(raw)
        return loaded if isinstance(loaded, dict) else {}
    return raw if isinstance(raw, dict) else {}


def _execute_runtime_job(job: dict[str, Any]) -> dict[str, Any]:
    kind = str(job.get("kind") or "")
    payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
    if kind == "noop":
        return {"status": "completed", "message": str(payload.get("message") or "ok")}
    raise ValueError(f"unsupported runtime job kind: {kind or 'unknown'}")


def run_once(*, redis_client: Any | None = None, queue_name: str | None = None) -> dict[str, Any]:
    """Consume and execute one queued Runtime job.

    Returns a compact status envelope suitable for tests, logs, and future
    worker metrics. Empty queues return ``{"status": "idle"}``.
    """
    client = redis_client
    if client is None:
        redis_url = _redis_url()
        client = _redis_client_from_url(redis_url) if redis_url else None
    if client is None:
        return {"status": "unavailable", "error": "Redis client is not configured"}

    active_queue = queue_name or _queue_name()
    raw = client.lpop(active_queue)
    if raw is None:
        return {"status": "idle", "queue": active_queue}

    payload = _decode_queue_payload(raw)
    job_id = str(payload.get("job_id") or "")
    kind = str(payload.get("kind") or "")
    store = DurableRuntimeJobStore()
    if not job_id:
        return {"status": "failed", "job_id": "", "kind": kind, "error": "queue payload missing job_id"}

    try:
        store.update_job(job_id, status="running", progress=5, cancelable=True)
        result = _execute_runtime_job(payload)
        store.update_job(
            job_id,
            status="completed",
            progress=100,
            metadata={"worker_result": result},
            cancelable=False,
        )
        return {"status": "completed", "job_id": job_id, "kind": kind}
    except Exception as exc:  # noqa: BLE001 - worker must persist failure and keep polling
        message = str(exc)
        logger.exception("runtime worker failed job %s (%s): %s", job_id, kind, message)
        try:
            store.update_job(job_id, status="failed", error=message, cancelable=False)
        except Exception:  # noqa: BLE001 - preserve original worker error envelope
            logger.exception("runtime worker could not persist failure for job %s", job_id)
        return {"status": "failed", "job_id": job_id, "kind": kind, "error": message}


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    while True:
        result = run_once()
        if result.get("status") == "unavailable":
            logger.warning("runtime worker unavailable: %s", result.get("error"))
            time.sleep(30)
            continue
        if result.get("status") == "idle":
            time.sleep(2)
            continue
        logger.info("runtime worker processed job: %s", result)


if __name__ == "__main__":
    raise SystemExit(main())
