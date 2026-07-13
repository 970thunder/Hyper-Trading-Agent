"""Commercial runtime worker.

The worker consumes durable Runtime job envelopes from the configured queue and
updates the shared Runtime job store. The first executable job kind is ``noop``
so deployment health and queue wiring can be verified before moving Agent runs,
web crawling, and long backtests onto this path.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from src.commercial.store import CommercialStore, Principal
from src.runtime_jobs.backend import _queue_name, _redis_client_from_url, _redis_url
from src.runtime_jobs.store import DurableRuntimeJobStore
from src.tools.doc_reader_tool import read_document
from src.tools.path_utils import safe_document_path
from src.tools.web_reader_tool import WebReaderTool

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
    if kind == "knowledge_url_ingest":
        return _execute_knowledge_url_ingest(payload)
    if kind == "knowledge_file_ingest":
        return _execute_knowledge_file_ingest(payload)
    if kind == "alpha_bench":
        return _execute_alpha_bench(payload)
    if kind == "alpha_compare":
        return _execute_alpha_compare(payload)
    if kind == "agent_run":
        return _execute_agent_run(payload)
    raise ValueError(f"unsupported runtime job kind: {kind or 'unknown'}")


def _principal_from_payload(payload: dict[str, Any]) -> Principal:
    raw = payload.get("principal")
    if not isinstance(raw, dict):
        raise ValueError("knowledge_url_ingest payload missing principal")
    return Principal(
        user_id=str(raw.get("user_id") or ""),
        organization_id=str(raw.get("organization_id") or ""),
        email=str(raw.get("email") or ""),
        role=str(raw.get("role") or ""),
    )


def _execute_knowledge_url_ingest(payload: dict[str, Any]) -> dict[str, Any]:
    principal = _principal_from_payload(payload)
    kb_id = str(payload.get("knowledge_base_id") or "")
    url = str(payload.get("url") or "")
    title = str(payload.get("title") or "")
    chunk_size = payload.get("chunk_size")
    chunk_overlap = payload.get("chunk_overlap")
    ingestion_job_id = str(payload.get("ingestion_job_id") or "")
    if not kb_id or not url:
        raise ValueError("knowledge_url_ingest payload missing knowledge_base_id or url")

    store = CommercialStore()
    try:
        if ingestion_job_id:
            store.start_ingestion_job(principal, kb_id, ingestion_job_id, stage="fetching", progress=5)
        raw = WebReaderTool().execute(url=url)
        parsed = json.loads(raw)
        if parsed.get("status") != "ok":
            raise ValueError(str(parsed.get("error") or "failed to read URL"))
        document = store.add_knowledge_document(
            principal,
            kb_id,
            title=title or str(parsed.get("title") or url),
            source_uri=url,
            source_type="url",
            text=str(parsed.get("content") or parsed.get("text") or ""),
            metadata={"url": url, "runtime_worker": True},
            chunk_size=int(chunk_size) if chunk_size is not None else None,
            chunk_overlap=int(chunk_overlap) if chunk_overlap is not None else None,
            ingestion_job_id=ingestion_job_id,
        )
    except Exception as exc:
        if ingestion_job_id:
            try:
                store.fail_ingestion_job(principal, kb_id, ingestion_job_id, str(exc))
            except Exception:  # noqa: BLE001 - preserve the ingestion failure
                logger.exception("could not persist failed ingestion job %s", ingestion_job_id)
        raise
    return {
        "status": "completed",
        "knowledge_base_id": kb_id,
        "document_id": document["id"],
        "ingestion_job_id": document["ingestion_job_id"],
        "title": document["title"],
    }


def _execute_knowledge_file_ingest(payload: dict[str, Any]) -> dict[str, Any]:
    principal = _principal_from_payload(payload)
    kb_id = str(payload.get("knowledge_base_id") or "")
    path_value = str(payload.get("path") or "")
    title = str(payload.get("title") or "")
    ingestion_job_id = str(payload.get("ingestion_job_id") or "")
    chunk_size = payload.get("chunk_size")
    chunk_overlap = payload.get("chunk_overlap")
    if not kb_id or not path_value:
        raise ValueError("knowledge_file_ingest payload missing knowledge_base_id or path")

    store = CommercialStore()
    try:
        if ingestion_job_id:
            store.start_ingestion_job(principal, kb_id, ingestion_job_id, stage="parsing", progress=5)
        path = safe_document_path(path_value)
        if not path.exists() or not path.is_file():
            raise ValueError(f"file not found: {path_value}")
        parsed = json.loads(read_document(str(path)))
        if parsed.get("status") != "ok":
            raise ValueError(str(parsed.get("error") or "failed to read document"))
        text = str(parsed.get("text") or "").strip()
        if not text:
            raise ValueError("document produced no readable text")
        metadata = {key: value for key, value in parsed.items() if key not in {"status", "text"}}
        document = store.add_knowledge_document(
            principal,
            kb_id,
            title=title or path.name,
            source_uri=str(path),
            source_type="file",
            text=text,
            metadata={"path": str(path), "runtime_worker": True, **metadata},
            chunk_size=int(chunk_size) if chunk_size is not None else None,
            chunk_overlap=int(chunk_overlap) if chunk_overlap is not None else None,
            ingestion_job_id=ingestion_job_id,
        )
    except Exception as exc:
        if ingestion_job_id:
            try:
                store.fail_ingestion_job(principal, kb_id, ingestion_job_id, str(exc))
            except Exception:  # noqa: BLE001 - preserve the ingestion failure
                logger.exception("could not persist failed ingestion job %s", ingestion_job_id)
        raise
    return {
        "status": "completed",
        "knowledge_base_id": kb_id,
        "document_id": document["id"],
        "ingestion_job_id": document["ingestion_job_id"],
        "title": document["title"],
    }


def _execute_alpha_bench(payload: dict[str, Any]) -> dict[str, Any]:
    from src.api import alpha_routes

    job_id = str(payload.get("job_id") or "")
    zoo = str(payload.get("zoo") or "")
    universe = str(payload.get("universe") or "")
    period = str(payload.get("period") or "")
    top = int(payload.get("top") or 20)
    if not job_id or not zoo or not universe or not period:
        raise ValueError("alpha_bench payload missing job_id, zoo, universe, or period")
    with alpha_routes._JOBS_LOCK:
        alpha_routes.ALPHA_BENCH_JOBS.setdefault(
            job_id,
            {
                "job_id": job_id,
                "status": "queued",
                "zoo": zoo,
                "universe": universe,
                "period": period,
                "top": top,
                "created_at": alpha_routes._now_iso(),
                "progress": {"n_done": 0, "n_total": 0, "current_alpha_id": None},
                "result": None,
                "error": None,
            },
        )
    alpha_routes._run_bench_blocking(job_id, zoo, universe, period, top)
    job = alpha_routes.ALPHA_BENCH_JOBS.get(job_id, {})
    if str(job.get("status")) in {"error", "failed"}:
        raise ValueError(str(job.get("error") or "alpha bench failed"))
    return {"status": "completed", "alpha_status": str(job.get("status") or ""), "result": job.get("result")}


def _execute_alpha_compare(payload: dict[str, Any]) -> dict[str, Any]:
    from src.api import alpha_routes

    job_id = str(payload.get("job_id") or "")
    alpha_ids = [str(item) for item in (payload.get("alpha_ids") or []) if str(item)]
    universe = str(payload.get("universe") or "")
    period = str(payload.get("period") or "")
    sort = str(payload.get("sort") or "ir")
    if not job_id or not alpha_ids or not universe or not period:
        raise ValueError("alpha_compare payload missing job_id, alpha_ids, universe, or period")
    with alpha_routes._JOBS_LOCK:
        alpha_routes.ALPHA_COMPARE_JOBS.setdefault(
            job_id,
            {
                "job_id": job_id,
                "status": "queued",
                "alpha_ids": alpha_ids,
                "universe": universe,
                "period": period,
                "sort": sort,
                "created_at": alpha_routes._now_iso(),
                "progress": {"n_done": 0, "n_total": len(alpha_ids), "current_alpha_id": None},
                "result": None,
                "error": None,
            },
        )
    alpha_routes._run_compare_blocking(job_id, alpha_ids, universe, period, sort)
    job = alpha_routes.ALPHA_COMPARE_JOBS.get(job_id, {})
    if str(job.get("status")) in {"error", "failed"}:
        raise ValueError(str(job.get("error") or "alpha compare failed"))
    return {"status": "completed", "alpha_status": str(job.get("status") or ""), "result": job.get("result")}


def _build_session_service():
    from src.session.events import EventBus
    from src.session.service import SessionService
    from src.session.store import SessionStore

    agent_dir = Path(__file__).resolve().parents[2]
    sessions_dir = Path(os.getenv("HYPER_TRADING_SESSIONS_DIR", "") or os.getenv("VIBE_TRADING_SESSIONS_DIR", "") or agent_dir / "sessions")
    runs_dir = Path(os.getenv("HYPER_TRADING_RUNS_DIR", "") or os.getenv("VIBE_TRADING_RUNS_DIR", "") or agent_dir / "runs")
    return SessionService(
        store=SessionStore(sessions_dir),
        event_bus=EventBus(),
        runs_dir=runs_dir,
    )


def _execute_agent_run(payload: dict[str, Any]) -> dict[str, Any]:
    session_id = str(payload.get("session_id") or "")
    attempt_id = str(payload.get("attempt_id") or "")
    if not session_id or not attempt_id:
        raise ValueError("agent_run payload missing session_id or attempt_id")
    result = _build_session_service().run_queued_attempt(session_id, attempt_id)
    if str(result.get("attempt_status") or result.get("status") or "") in {"failed", "cancelled", "blocked"}:
        raise ValueError(str(result.get("error") or f"agent attempt {result.get('attempt_status')}"))
    return result


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
