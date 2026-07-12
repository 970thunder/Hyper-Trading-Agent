"""Alpha Zoo HTTP routes for the Web UI.

Mounted by ``agent/api_server.py`` via ``register_alpha_routes(app, ...)``. Pulled
into its own module because ``api_server.py`` is already ~1800 lines.

Routes (auth via the caller-supplied ``require_auth`` /
``require_event_stream_auth`` dependencies):

- ``GET  /alpha/list``                — list alphas with optional filters
- ``GET  /alpha/{alpha_id}``          — single alpha meta + source
- ``POST /alpha/bench``               — kick off a background bench (returns job_id)
- ``GET  /alpha/bench/{job_id}/stream`` — SSE: progress / result / done / error
- ``POST /alpha/compare``             — kick off a head-to-head of >= 2 alphas (job_id)
- ``GET  /alpha/compare/{job_id}/stream`` — SSE: progress / result / done / error

Job state lives in the module-level ``ALPHA_BENCH_JOBS`` dict, guarded by
``_JOBS_LOCK``. No persistence — process restart wipes job state, which is
acceptable for v1 (a bench takes 5-10 min; users re-trigger).

Concurrency: at most ``MAX_CONCURRENT_BENCHES`` bench workers run at the same
time across the process. POST returns 429 when the cap is reached. Workers run
in a thread (``asyncio.to_thread``) and we hold task references in a module
set so the loop's garbage collector cannot cancel them mid-run.

Error surface: typed errors (``ValueError`` on bad period, ``KeyError`` on
unknown alpha_id) bubble out with their original message. Anything else is
logged with full traceback and reported to clients as ``"internal error; see
server logs"`` to avoid leaking stack frames / paths.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Job store (in-memory, process-local)
# ---------------------------------------------------------------------------

ALPHA_BENCH_JOBS: dict[str, dict[str, Any]] = {}
ALPHA_COMPARE_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()

# Live background bench tasks. Holding strong refs prevents the asyncio GC from
# cancelling fire-and-forget tasks; ``add`` on create, ``discard`` on done.
_RUNNING_TASKS: set[asyncio.Task[Any]] = set()

_JOB_TTL_SECONDS = 60 * 60  # prune jobs older than 1 hour on each new POST
_POLL_INTERVAL_SECONDS = 0.5
_SSE_HEARTBEAT_SECONDS = 15.0

# Cap on simultaneous bench workers. A bench is pandas-heavy (5-10 min wall) so
# unbounded concurrency would DoS the server with two or three clicks. The
# semaphore is created lazily on the first request so we bind to the running
# event loop, not the import-time one.
MAX_CONCURRENT_BENCHES = 2
_BENCH_SEMAPHORE: asyncio.Semaphore | None = None
_BENCH_SEMAPHORE_LOCK = threading.Lock()

# Compare is lighter than a full zoo bench (a handful of named alphas) but still
# loads the universe panel, so it gets its own modest concurrency cap.
MAX_CONCURRENT_COMPARES = 2
_COMPARE_SEMAPHORE: asyncio.Semaphore | None = None
_COMPARE_SEMAPHORE_LOCK = threading.Lock()


def _get_bench_semaphore() -> asyncio.Semaphore:
    """Return the process-wide bench semaphore, building it on first call."""
    global _BENCH_SEMAPHORE
    with _BENCH_SEMAPHORE_LOCK:
        if _BENCH_SEMAPHORE is None:
            _BENCH_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_BENCHES)
        return _BENCH_SEMAPHORE


def _get_compare_semaphore() -> asyncio.Semaphore:
    """Return the process-wide compare semaphore, building it on first call."""
    global _COMPARE_SEMAPHORE
    with _COMPARE_SEMAPHORE_LOCK:
        if _COMPARE_SEMAPHORE is None:
            _COMPARE_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_COMPARES)
        return _COMPARE_SEMAPHORE


# Tighter alpha_id pattern: ``<zoo>_<short>``. Zoo prefix is short (a-z + a-z0-9),
# short id is 1-64 of [a-z0-9_]. Caps avoid pathological lookups.
_ALPHA_ID_RE = re.compile(r"^[a-z][a-z0-9]+_[a-z0-9_]{1,64}$")
_JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Filter enums — keep in sync with src.factors.registry.Theme / Universe.
_VALID_ZOOS = {"alpha101", "gtja191", "qlib158", "academic"}
_VALID_THEMES = {
    "momentum", "reversal", "volume", "volatility", "quality", "value",
    "liquidity", "microstructure", "sentiment", "growth", "leverage",
}
_VALID_UNIVERSES = {"equity_us", "equity_cn", "equity_hk", "crypto", "futures"}
# Ranking metrics for /alpha/compare — keep in sync with
# ``src.factors.compare_runner.SORT_KEYS`` (kept local to avoid a heavy import).
_VALID_SORTS = {"ir", "ic_mean", "ic_positive_ratio", "ic_count"}
_BENCH_UNIVERSES = {"csi300", "sp500", "btc-usdt"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe_error(exc: BaseException) -> str:
    """Sanitised user-facing error string for unexpected exceptions.

    Always returns a fixed phrase — never echoes the exception message or
    type, both of which can include filesystem paths, credentials, or stack
    frame snippets. Callers should ``logger.exception`` BEFORE invoking this.
    """
    return "internal error; see server logs"


def _prune_old_jobs() -> None:
    """Drop completed/errored bench + compare jobs older than ``_JOB_TTL_SECONDS``."""
    cutoff = time.time() - _JOB_TTL_SECONDS
    with _JOBS_LOCK:
        for store in (ALPHA_BENCH_JOBS, ALPHA_COMPARE_JOBS):
            stale = [
                jid for jid, job in store.items()
                if job.get("status") in ("done", "error")
                and job.get("_finished_at", 0) < cutoff
            ]
            for jid in stale:
                store.pop(jid, None)


# ---------------------------------------------------------------------------
# Request/response schemas
# ---------------------------------------------------------------------------


class BenchRequest(BaseModel):
    """POST /alpha/bench body."""

    zoo: str = Field(..., min_length=1, max_length=64)
    universe: str = Field(..., min_length=1, max_length=64)
    period: str = Field(..., min_length=4, max_length=32)
    top: int = Field(20, ge=1, le=500)

    @field_validator("zoo")
    @classmethod
    def _zoo_known(cls, v: str) -> str:
        if v not in _VALID_ZOOS:
            raise ValueError(
                f"unknown zoo {v!r}; expected one of {sorted(_VALID_ZOOS)}"
            )
        return v

    @field_validator("universe")
    @classmethod
    def _universe_known(cls, v: str) -> str:
        if v not in _BENCH_UNIVERSES:
            raise ValueError(
                f"unknown universe {v!r}; expected one of {sorted(_BENCH_UNIVERSES)}"
            )
        return v


class CompareRequest(BaseModel):
    """POST /alpha/compare body — a head-to-head of >= 2 named alphas."""

    alpha_ids: list[str] = Field(..., min_length=2, max_length=50)
    universe: str = Field(..., min_length=1, max_length=64)
    period: str = Field(..., min_length=4, max_length=32)
    sort: str = Field("ir", min_length=1, max_length=32)

    @field_validator("alpha_ids")
    @classmethod
    def _ids_well_formed(cls, v: list[str]) -> list[str]:
        # De-duplicate (preserve order) and validate each id shape.
        seen: set[str] = set()
        out: list[str] = []
        for aid in v:
            if not _ALPHA_ID_RE.fullmatch(aid or ""):
                raise ValueError(f"invalid alpha_id {aid!r}")
            if aid not in seen:
                seen.add(aid)
                out.append(aid)
        if len(out) < 2:
            raise ValueError("need at least 2 distinct alpha_ids to compare")
        return out

    @field_validator("universe")
    @classmethod
    def _universe_known(cls, v: str) -> str:
        if v not in _BENCH_UNIVERSES:
            raise ValueError(
                f"unknown universe {v!r}; expected one of {sorted(_BENCH_UNIVERSES)}"
            )
        return v

    @field_validator("sort")
    @classmethod
    def _sort_known(cls, v: str) -> str:
        if v not in _VALID_SORTS:
            raise ValueError(f"unknown sort {v!r}; expected one of {sorted(_VALID_SORTS)}")
        return v


# ---------------------------------------------------------------------------
# Bench worker (runs in a thread; LLM-free, pandas-heavy)
# ---------------------------------------------------------------------------


def _make_progress_cb(
    job_id: str, jobs: dict[str, dict[str, Any]] = ALPHA_BENCH_JOBS
) -> Callable[[int, int, str], None]:
    """Return an on_progress closure that updates the job entry in-place."""

    def _cb(n_done: int, n_total: int, alpha_id: str) -> None:
        with _JOBS_LOCK:
            job = jobs.get(job_id)
            if job is None:
                return
            if job.get("status") == "cancelled":
                return
            job["progress"] = {
                "n_done": int(n_done),
                "n_total": int(n_total),
                "current_alpha_id": alpha_id,
            }
            job["updated_at"] = _now_iso()
            if job["status"] == "queued":
                job["status"] = "running"
            snapshot = dict(job)
        kind = "alpha_compare" if jobs is ALPHA_COMPARE_JOBS else "alpha_bench"
        _sync_alpha_job_to_durable(kind, snapshot)

    return _cb


def _run_bench_blocking(job_id: str, zoo: str, universe: str, period: str, top: int) -> None:
    """Synchronous bench worker (called via ``asyncio.to_thread``)."""
    from src.factors.bench_runner import run_bench  # local import: heavy deps

    with _JOBS_LOCK:
        job = ALPHA_BENCH_JOBS.get(job_id)
        snapshot = None
        if job is not None:
            if job.get("status") == "cancelled":
                return
            job["status"] = "running"
            job["updated_at"] = _now_iso()
            snapshot = dict(job)
    if snapshot is not None:
        _sync_alpha_job_to_durable("alpha_bench", snapshot)

    try:
        result = run_bench(
            zoo=zoo,
            universe=universe,
            period=period,
            top=top,
            on_progress=_make_progress_cb(job_id),
        )
    except Exception as exc:  # noqa: BLE001 — worker must never crash the loop
        logger.exception("alpha bench worker crashed (job=%s)", job_id)
        with _JOBS_LOCK:
            job = ALPHA_BENCH_JOBS.get(job_id)
            if job is not None:
                if job.get("status") == "cancelled":
                    return
                job["status"] = "error"
                job["error"] = _safe_error(exc)
                job["updated_at"] = _now_iso()
                job["_finished_at"] = time.time()
                snapshot = dict(job)
            else:
                snapshot = None
        if snapshot is not None:
            _sync_alpha_job_to_durable("alpha_bench", snapshot)
        return

    with _JOBS_LOCK:
        job = ALPHA_BENCH_JOBS.get(job_id)
        if job is None:
            return
        if job.get("status") == "cancelled":
            return
        if result.get("status") != "ok":
            job["status"] = "error"
            # bench_runner's own error string is curated (universe load failed,
            # forward returns failed, etc.) — safe to surface.
            job["error"] = result.get("error", "unknown")
        else:
            # Strip the bulky per-alpha lists — the API contract returns
            # summary-only on the result event. We keep ``n_skipped`` (the
            # count) which ``_result_for_wire`` reshapes into ``skipped``.
            slim = {
                k: v for k, v in result.items() if k not in ("rows", "skipped")
            }
            job["status"] = "done"
            job["result"] = slim
        job["updated_at"] = _now_iso()
        job["_finished_at"] = time.time()
        snapshot = dict(job)
    _sync_alpha_job_to_durable("alpha_bench", snapshot)


def _run_compare_blocking(
    job_id: str, alpha_ids: list[str], universe: str, period: str, sort: str
) -> None:
    """Synchronous compare worker (called via ``asyncio.to_thread``).

    Unlike bench, the comparison's product IS the per-alpha ranking, so the full
    (already-slim) envelope is stored as the job result.
    """
    from src.factors.compare_runner import compare_alphas  # local import: heavy deps

    with _JOBS_LOCK:
        job = ALPHA_COMPARE_JOBS.get(job_id)
        snapshot = None
        if job is not None:
            if job.get("status") == "cancelled":
                return
            job["status"] = "running"
            job["updated_at"] = _now_iso()
            snapshot = dict(job)
    if snapshot is not None:
        _sync_alpha_job_to_durable("alpha_compare", snapshot)

    try:
        result = compare_alphas(
            alpha_ids,
            universe,
            period,
            sort=sort,
            on_progress=_make_progress_cb(job_id, ALPHA_COMPARE_JOBS),
        )
    except Exception as exc:  # noqa: BLE001 — worker must never crash the loop
        logger.exception("alpha compare worker crashed (job=%s)", job_id)
        with _JOBS_LOCK:
            job = ALPHA_COMPARE_JOBS.get(job_id)
            if job is not None:
                if job.get("status") == "cancelled":
                    return
                job["status"] = "error"
                job["error"] = _safe_error(exc)
                job["updated_at"] = _now_iso()
                job["_finished_at"] = time.time()
                snapshot = dict(job)
            else:
                snapshot = None
        if snapshot is not None:
            _sync_alpha_job_to_durable("alpha_compare", snapshot)
        return

    with _JOBS_LOCK:
        job = ALPHA_COMPARE_JOBS.get(job_id)
        if job is None:
            return
        if job.get("status") == "cancelled":
            return
        if result.get("status") != "ok":
            job["status"] = "error"
            # compare_alphas' error string is curated (too few ids, nothing
            # evaluable, bubbled bench error) — safe to surface.
            job["error"] = result.get("error", "unknown")
        else:
            job["status"] = "done"
            job["result"] = result
        job["updated_at"] = _now_iso()
        job["_finished_at"] = time.time()
        snapshot = dict(job)
    _sync_alpha_job_to_durable("alpha_compare", snapshot)


def _progress_percent(job: dict[str, Any]) -> int:
    progress = job.get("progress") or {}
    if isinstance(progress, dict):
        done = progress.get("n_done")
        total = progress.get("n_total")
        if isinstance(done, (int, float)) and isinstance(total, (int, float)) and total > 0:
            return max(0, min(100, round((done / total) * 100)))
    if job.get("status") in ("done", "completed", "error", "failed", "cancelled"):
        return 100
    return 0


def _runtime_job_row(kind: str, job: dict[str, Any]) -> dict[str, Any]:
    created_at = str(job.get("created_at") or "")
    updated_at = str(job.get("updated_at") or created_at)
    if kind == "alpha_bench":
        title = f"Alpha bench {job.get('universe') or ''}".strip()
    else:
        title = f"Alpha compare {job.get('universe') or ''}".strip()
    status = str(job.get("status") or "unknown")
    if status == "error":
        status = "failed"
    return {
        "job_id": str(job.get("job_id") or ""),
        "kind": kind,
        "title": title,
        "status": status,
        "progress": _progress_percent(job),
        "error": job.get("error") or "",
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _sync_alpha_job_to_durable(kind: str, job: dict[str, Any]) -> None:
    """Mirror alpha bench/compare jobs into the durable Runtime job store."""
    job_id = str(job.get("job_id") or "")
    if not job_id:
        return
    try:
        from src.runtime_jobs.store import DurableRuntimeJobStore

        progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
        status = str(job.get("status") or "unknown")
        normalized_status = "failed" if status == "error" else status
        metadata = {
            "zoo": job.get("zoo"),
            "universe": job.get("universe"),
            "period": job.get("period"),
            "top": job.get("top"),
            "sort": job.get("sort"),
            "alpha_ids": job.get("alpha_ids"),
            "current_alpha_id": progress.get("current_alpha_id") if isinstance(progress, dict) else None,
        }
        metadata = {key: value for key, value in metadata.items() if value not in (None, "", [])}
        store = DurableRuntimeJobStore()
        title = _runtime_job_row(kind, job).get("title") or job_id
        source = "backtest"
        if kind not in {"alpha_bench", "alpha_compare"}:
            source = "other"
        try:
            store.get_job(job_id)
        except KeyError:
            store.create_job(
                job_id=job_id,
                kind=kind,
                source=source,
                title=str(title),
                status=normalized_status if normalized_status in {"queued", "pending", "running", "completed", "done", "failed", "cancelled"} else "queued",
                progress=_progress_percent(job),
                error=str(job.get("error") or ""),
                metadata=metadata,
                retryable=True,
                cancelable=normalized_status in {"queued", "pending", "running"},
            )
            return
        store.update_job(
            job_id,
            status=normalized_status if normalized_status in {"queued", "pending", "running", "completed", "done", "failed", "cancelled"} else None,
            progress=_progress_percent(job),
            error=str(job.get("error") or ""),
            metadata=metadata,
            retryable=True,
            cancelable=normalized_status in {"queued", "pending", "running"},
        )
    except Exception as exc:  # noqa: BLE001 - durable mirror must not break alpha execution
        logger.debug("Failed to sync alpha job to durable runtime store: %s", exc)


def _runtime_job_rows(extra_rows: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    with _JOBS_LOCK:
        rows = [
            *(_runtime_job_row("alpha_bench", dict(job)) for job in ALPHA_BENCH_JOBS.values()),
            *(_runtime_job_row("alpha_compare", dict(job)) for job in ALPHA_COMPARE_JOBS.values()),
        ]
    rows.extend(_durable_runtime_job_rows())
    if extra_rows:
        rows.extend(extra_rows)
    deduped: dict[str, dict[str, Any]] = {}
    for row in rows:
        job_id = str(row.get("job_id") or "")
        if not job_id:
            continue
        deduped[job_id] = row
    return sorted(deduped.values(), key=lambda row: row.get("updated_at") or row.get("created_at") or "", reverse=True)


def _durable_runtime_job_rows() -> list[dict[str, Any]]:
    try:
        from src.runtime_jobs.store import DurableRuntimeJobStore

        return [_runtime_row_from_durable_job(row) for row in DurableRuntimeJobStore().list_jobs(limit=500)]
    except Exception as exc:  # noqa: BLE001 - Runtime monitor should degrade to process-local jobs
        logger.debug("Failed to load durable runtime jobs: %s", exc)
        return []


def _runtime_row_from_durable_job(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "job_id": str(job.get("job_id") or ""),
        "kind": str(job.get("kind") or ""),
        "source": str(job.get("source") or "other"),
        "title": str(job.get("title") or job.get("job_id") or ""),
        "status": str(job.get("status") or "unknown"),
        "progress": int(job.get("progress") or 0),
        "error": str(job.get("error") or ""),
        "created_at": str(job.get("created_at") or ""),
        "updated_at": str(job.get("updated_at") or job.get("created_at") or ""),
        "metadata": dict(job.get("metadata") or {}),
        "retryable": bool(job.get("retryable")),
        "cancelable": bool(job.get("cancelable")),
    }


def _commercial_runtime_job_rows(request: Request) -> list[dict[str, Any]]:
    """Return commercial durable jobs visible to the request's organization."""
    import sys as _sys

    host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
    if host is None or not hasattr(host, "_commercial_principal_from_request"):
        return []
    principal = host._commercial_principal_from_request(request)
    if principal is None:
        return []

    try:
        from src.commercial.store import CommercialStore

        return _rag_ingestion_runtime_job_rows(CommercialStore(), principal)
    except Exception as exc:  # noqa: BLE001 - runtime monitor must stay available in local mode
        logger.debug("Failed to load commercial runtime jobs: %s", exc)
        return []


def _rag_ingestion_runtime_job_rows(store: Any, principal: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for kb in store.list_knowledge_bases(principal):
        kb_id = str(kb.get("id") or "")
        kb_name = str(kb.get("name") or "")
        if not kb_id:
            continue
        for job in store.list_ingestion_jobs(principal, kb_id, limit=200):
            document = _knowledge_document_for_job(store, principal, kb_id, str(job.get("document_id") or ""))
            document_title = str((document or {}).get("title") or job.get("document_id") or job.get("id") or "")
            rows.append(
                {
                    "job_id": str(job.get("id") or ""),
                    "kind": "rag_ingestion",
                    "title": f"RAG ingestion {document_title}".strip(),
                    "status": str(job.get("status") or "unknown"),
                    "progress": int(job.get("progress") or 0),
                    "error": str(job.get("error") or ""),
                    "created_at": str(job.get("created_at") or ""),
                    "updated_at": str(job.get("updated_at") or job.get("created_at") or ""),
                    "metadata": {
                        "knowledge_base_id": kb_id,
                        "knowledge_base_name": kb_name,
                        "document_id": str(job.get("document_id") or ""),
                        "started_at": str(job.get("started_at") or ""),
                        "completed_at": str(job.get("completed_at") or ""),
                    },
                }
            )
    return rows


def _knowledge_document_for_job(store: Any, principal: Any, kb_id: str, document_id: str) -> dict[str, Any] | None:
    if not document_id:
        return None
    try:
        return store.get_knowledge_document(principal, kb_id, document_id)
    except Exception:  # noqa: BLE001 - deleted documents should not hide their job records
        return None


def _commercial_principal(request: Request) -> Any | None:
    import sys as _sys

    host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
    if host is None or not hasattr(host, "_commercial_principal_from_request"):
        return None
    return host._commercial_principal_from_request(request)


def _find_rag_ingestion_job(request: Request, job_id: str) -> tuple[Any, Any, str, dict[str, Any]] | None:
    if not _JOB_ID_RE.fullmatch(job_id or ""):
        raise HTTPException(status_code=400, detail="invalid job_id")
    principal = _commercial_principal(request)
    if principal is None:
        return None
    try:
        from src.commercial.store import CommercialStore

        store = CommercialStore()
        for kb in store.list_knowledge_bases(principal):
            kb_id = str(kb.get("id") or "")
            if not kb_id:
                continue
            try:
                job = store.get_ingestion_job(principal, kb_id, job_id)
            except KeyError:
                continue
            return store, principal, kb_id, job
    except Exception as exc:  # noqa: BLE001 - alpha job routes should keep their normal 404 semantics
        logger.debug("Failed to resolve commercial RAG ingestion job: %s", exc)
    return None


def _find_durable_runtime_job(job_id: str) -> tuple[Any, dict[str, Any]] | None:
    if not _JOB_ID_RE.fullmatch(job_id or ""):
        raise HTTPException(status_code=400, detail="invalid job_id")
    try:
        from src.runtime_jobs.store import DurableRuntimeJobStore

        store = DurableRuntimeJobStore()
        return store, store.get_job(job_id)
    except KeyError:
        return None
    except Exception as exc:  # noqa: BLE001 - keep normal 404 semantics when durable adapter is unavailable
        logger.debug("Failed to resolve durable runtime job: %s", exc)
        return None


def _find_runtime_job(job_id: str) -> tuple[str, dict[str, dict[str, Any]], dict[str, Any]]:
    if not _JOB_ID_RE.fullmatch(job_id or ""):
        raise HTTPException(status_code=400, detail="invalid job_id")
    with _JOBS_LOCK:
        if job_id in ALPHA_BENCH_JOBS:
            return "alpha_bench", ALPHA_BENCH_JOBS, ALPHA_BENCH_JOBS[job_id]
        if job_id in ALPHA_COMPARE_JOBS:
            return "alpha_compare", ALPHA_COMPARE_JOBS, ALPHA_COMPARE_JOBS[job_id]
    raise HTTPException(status_code=404, detail=f"job {job_id} not found")


def _reset_job_for_retry(job: dict[str, Any]) -> None:
    job["status"] = "queued"
    job["progress"] = {"n_done": 0, "n_total": 0, "current_alpha_id": None}
    job["result"] = None
    job["error"] = None
    job["updated_at"] = _now_iso()
    job.pop("_finished_at", None)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

AuthDep = Callable[..., Awaitable[Any] | Any]


def register_alpha_routes(
    app: FastAPI,
    require_auth: AuthDep | None = None,
    require_event_stream_auth: AuthDep | None = None,
) -> None:
    """Mount the alpha routes onto ``app``.

    Args:
        app: The host FastAPI app.
        require_auth: Header-auth dependency for JSON endpoints.
        require_event_stream_auth: Query-param-auth dependency for SSE endpoints.

    For backwards compatibility, when the dependency callables are not passed
    explicitly we resolve them from the host ``api_server`` module via
    ``sys.modules``. Prefer the explicit form in new call sites.
    """
    if require_auth is None or require_event_stream_auth is None:
        import sys as _sys

        host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
        if host is None:  # pragma: no cover — only triggers on weird import setups
            raise RuntimeError(
                "register_alpha_routes: api_server module not in sys.modules; "
                "pass require_auth/require_event_stream_auth explicitly"
            )
        if require_auth is None:
            require_auth = host.require_auth
        if require_event_stream_auth is None:
            require_event_stream_auth = host.require_event_stream_auth

    @app.get("/runtime/jobs", dependencies=[Depends(require_auth)])
    async def list_runtime_jobs(request: Request) -> list[dict[str, Any]]:
        """Return a unified read-only snapshot of process-local background jobs."""
        return _runtime_job_rows(_commercial_runtime_job_rows(request))

    @app.post("/runtime/jobs/{job_id}/cancel", dependencies=[Depends(require_auth)])
    async def cancel_runtime_job(job_id: str, request: Request) -> dict[str, Any]:
        """Mark a queued/running process-local background job as cancelled."""
        try:
            _kind, store, job = _find_runtime_job(job_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            durable_job = _find_durable_runtime_job(job_id)
            if durable_job is not None:
                durable_store, job = durable_job
                if str(job.get("status")) not in ("queued", "pending", "running"):
                    raise HTTPException(status_code=400, detail="only queued or running jobs can be cancelled")
                cancelled = durable_store.cancel_job(job_id)
                return {"status": "cancelled", "job_id": job_id, "kind": cancelled["kind"]}
            rag_job = _find_rag_ingestion_job(request, job_id)
            if rag_job is None:
                raise
            commercial_store, principal, kb_id, job = rag_job
            if str(job.get("status")) not in ("queued", "pending", "running"):
                raise HTTPException(status_code=400, detail="only queued or running jobs can be cancelled")
            commercial_store.cancel_ingestion_job(principal, kb_id, job_id)
            return {"status": "cancelled", "job_id": job_id, "kind": "rag_ingestion"}
        if job.get("status") not in ("queued", "pending", "running"):
            raise HTTPException(status_code=400, detail="only queued or running jobs can be cancelled")
        with _JOBS_LOCK:
            store[job_id]["status"] = "cancelled"
            store[job_id]["updated_at"] = _now_iso()
            store[job_id]["_finished_at"] = time.time()
            snapshot = dict(store[job_id])
        _sync_alpha_job_to_durable(_kind, snapshot)
        return {"status": "cancelled", "job_id": job_id}

    @app.post("/runtime/jobs/{job_id}/retry", dependencies=[Depends(require_auth)])
    async def retry_runtime_job(job_id: str, request: Request) -> dict[str, Any]:
        """Retry a failed alpha bench/compare job with its original parameters."""
        try:
            kind, store, job = _find_runtime_job(job_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            durable_job = _find_durable_runtime_job(job_id)
            if durable_job is not None:
                durable_store, job = durable_job
                if str(job.get("status")) not in ("failed", "error"):
                    raise HTTPException(status_code=400, detail="only failed jobs can be retried")
                retried = durable_store.mark_retry_requested(job_id)
                return {"status": "queued", "job_id": job_id, "kind": retried["kind"]}
            rag_job = _find_rag_ingestion_job(request, job_id)
            if rag_job is None:
                raise
            commercial_store, principal, kb_id, job = rag_job
            if str(job.get("status")) not in ("failed", "error"):
                raise HTTPException(status_code=400, detail="only failed jobs can be retried")
            commercial_store.retry_ingestion_job(principal, kb_id, job_id)
            return {"status": "queued", "job_id": job_id, "kind": "rag_ingestion"}
        if job.get("status") not in ("failed", "error"):
            raise HTTPException(status_code=400, detail="only failed jobs can be retried")

        if kind == "alpha_bench":
            sem = _get_bench_semaphore()
            if sem.locked() or getattr(sem, "_value", MAX_CONCURRENT_BENCHES) <= 0:
                raise HTTPException(status_code=429, detail="too many running benches; wait for one to finish")
            zoo = str(job.get("zoo") or "")
            universe = str(job.get("universe") or "")
            period = str(job.get("period") or "")
            top = int(job.get("top") or 20)
            with _JOBS_LOCK:
                _reset_job_for_retry(store[job_id])
                snapshot = dict(store[job_id])
            _sync_alpha_job_to_durable(kind, snapshot)

            async def _bench_retry() -> None:
                async with sem:
                    await asyncio.to_thread(_run_bench_blocking, job_id, zoo, universe, period, top)

            task = asyncio.create_task(_bench_retry())
        else:
            sem = _get_compare_semaphore()
            if sem.locked() or getattr(sem, "_value", MAX_CONCURRENT_COMPARES) <= 0:
                raise HTTPException(status_code=429, detail="too many running comparisons; wait for one to finish")
            alpha_ids = list(job.get("alpha_ids") or [])
            universe = str(job.get("universe") or "")
            period = str(job.get("period") or "")
            sort = str(job.get("sort") or "ir")
            with _JOBS_LOCK:
                _reset_job_for_retry(store[job_id])
                snapshot = dict(store[job_id])
            _sync_alpha_job_to_durable(kind, snapshot)

            async def _compare_retry() -> None:
                async with sem:
                    await asyncio.to_thread(_run_compare_blocking, job_id, alpha_ids, universe, period, sort)

            task = asyncio.create_task(_compare_retry())

        _RUNNING_TASKS.add(task)
        task.add_done_callback(_RUNNING_TASKS.discard)
        return {"status": "queued", "job_id": job_id}

    # -----------------------------------------------------------------------
    # GET /alpha/list
    # -----------------------------------------------------------------------

    @app.get("/alpha/list", dependencies=[Depends(require_auth)])
    async def list_alphas(
        zoo: str | None = Query(None, max_length=64),
        theme: str | None = Query(None, max_length=64),
        universe: str | None = Query(None, max_length=64),
        limit: int = Query(100, ge=1, le=1000),
    ) -> dict[str, Any]:
        """List alphas, optionally filtered by zoo / theme / universe."""
        if zoo is not None and zoo not in _VALID_ZOOS:
            raise HTTPException(
                status_code=400,
                detail=f"unknown zoo {zoo!r}; expected one of {sorted(_VALID_ZOOS)}",
            )
        if theme is not None and theme not in _VALID_THEMES:
            raise HTTPException(
                status_code=400,
                detail=f"unknown theme {theme!r}; expected one of {sorted(_VALID_THEMES)}",
            )
        if universe is not None:
            _ALIAS = {"csi300": "equity_cn", "sp500": "equity_us", "btc-usdt": "crypto"}
            universe = _ALIAS.get(universe, universe)
        if universe is not None and universe not in _VALID_UNIVERSES:
            raise HTTPException(
                status_code=400,
                detail=f"unknown universe {universe!r}; expected one of {sorted(_VALID_UNIVERSES)}",
            )

        from src.factors.registry import get_default_registry

        registry = get_default_registry()
        try:
            ids = registry.list(zoo=zoo, theme=theme, universe=universe)
        except Exception as exc:  # noqa: BLE001
            logger.exception("registry.list failed")
            raise HTTPException(status_code=500, detail=_safe_error(exc))

        total = len(ids)
        sliced = ids[:limit]
        alphas: list[dict[str, Any]] = []
        for aid in sliced:
            try:
                a = registry.get(aid)
            except KeyError:
                continue
            meta = a.meta or {}
            alphas.append(
                {
                    "id": a.id,
                    "zoo": a.zoo,
                    "theme": meta.get("theme", []),
                    "universe": meta.get("universe", []),
                    "nickname": meta.get("nickname"),
                    "decay_horizon": meta.get("decay_horizon"),
                    "min_warmup_bars": meta.get("min_warmup_bars"),
                    "requires_sector": bool(meta.get("requires_sector", False)),
                }
            )
        return {
            "status": "ok",
            "alphas": alphas,
            "total": total,
            "returned": len(alphas),
            "truncated": total > len(alphas),
        }

    # -----------------------------------------------------------------------
    # GET /alpha/{alpha_id}
    # -----------------------------------------------------------------------

    @app.get("/alpha/{alpha_id}", dependencies=[Depends(require_auth)])
    async def get_alpha(alpha_id: str) -> dict[str, Any]:
        """Return alpha metadata + the source code of its zoo .py file."""
        if not _ALPHA_ID_RE.fullmatch(alpha_id or ""):
            raise HTTPException(status_code=400, detail="invalid alpha_id")

        from src.factors.registry import RegistryError, get_default_registry

        registry = get_default_registry()
        try:
            alpha = registry.get(alpha_id)
        except KeyError:
            raise HTTPException(
                status_code=404,
                detail={"status": "error", "error": "alpha_id not found"},
            )

        try:
            source_code = registry.get_source(alpha_id)
        except RegistryError as exc:
            # Source-read failure is a degraded but recoverable case — log and
            # surface a short placeholder. The reason here is a typed registry
            # error (size cap or OS error from a known path), safe to expose.
            logger.warning("failed to read source for %s: %s", alpha_id, exc)
            source_code = f"# <source unavailable: {exc}>"

        return {
            "status": "ok",
            "alpha": {
                "id": alpha.id,
                "zoo": alpha.zoo,
                "module_path": alpha.module_path,
                "meta": alpha.meta,
            },
            "source_code": source_code,
        }

    # -----------------------------------------------------------------------
    # POST /alpha/bench
    # -----------------------------------------------------------------------

    @app.post(
        "/alpha/bench",
        status_code=202,
        dependencies=[Depends(require_auth)],
    )
    async def kick_off_bench(payload: BenchRequest) -> dict[str, Any]:
        """Queue a background bench job and return a job_id."""
        # Cheap period parse pre-check so we 400 here instead of letting the
        # worker fail asynchronously.
        from src.tools.alpha_bench_tool import _parse_period

        try:
            _parse_period(payload.period)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"invalid period: {exc}")

        # Concurrency cap. We peek at the semaphore counter rather than
        # ``acquire(block=False)`` so the actual acquire happens inside the
        # worker (after the 202 is returned). _value is a CPython
        # implementation detail but it's been stable since 3.0 and asyncio's
        # own ``locked()`` uses it.
        sem = _get_bench_semaphore()
        # ``locked()`` returns True iff the counter is 0; defensive check.
        if sem.locked() or getattr(sem, "_value", MAX_CONCURRENT_BENCHES) <= 0:
            raise HTTPException(
                status_code=429,
                detail="too many running benches; wait for one to finish",
            )

        _prune_old_jobs()

        job_id = uuid.uuid4().hex
        with _JOBS_LOCK:
            ALPHA_BENCH_JOBS[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "zoo": payload.zoo,
                "universe": payload.universe,
                "period": payload.period,
                "top": payload.top,
                "created_at": _now_iso(),
                "progress": {"n_done": 0, "n_total": 0, "current_alpha_id": None},
                "result": None,
                "error": None,
            }
            snapshot = dict(ALPHA_BENCH_JOBS[job_id])
        _sync_alpha_job_to_durable("alpha_bench", snapshot)

        async def _runner() -> None:
            async with sem:
                try:
                    await asyncio.to_thread(
                        _run_bench_blocking,
                        job_id,
                        payload.zoo,
                        payload.universe,
                        payload.period,
                        payload.top,
                    )
                except Exception:  # noqa: BLE001 — never escape the loop
                    logger.exception("bench runner outer task crashed (job=%s)", job_id)
                    with _JOBS_LOCK:
                        job = ALPHA_BENCH_JOBS.get(job_id)
                        if job is not None and job["status"] not in ("done", "error", "failed", "cancelled"):
                            job["status"] = "error"
                            job["error"] = "internal error; see server logs"
                            job["updated_at"] = _now_iso()
                            job["_finished_at"] = time.time()
                            snapshot = dict(job)
                        else:
                            snapshot = None
                    if snapshot is not None:
                        _sync_alpha_job_to_durable("alpha_bench", snapshot)

        task = asyncio.create_task(_runner())
        _RUNNING_TASKS.add(task)
        task.add_done_callback(_RUNNING_TASKS.discard)
        return {"status": "ok", "job_id": job_id}

    # -----------------------------------------------------------------------
    # GET /alpha/bench/{job_id}/stream
    # -----------------------------------------------------------------------

    @app.get(
        "/alpha/bench/{job_id}/stream",
        dependencies=[Depends(require_event_stream_auth)],
    )
    async def stream_bench(job_id: str, request: Request) -> StreamingResponse:
        """SSE: progress / result / done / error until the job terminates."""
        if not _JOB_ID_RE.fullmatch(job_id or ""):
            raise HTTPException(status_code=400, detail="invalid job_id")
        with _JOBS_LOCK:
            if job_id not in ALPHA_BENCH_JOBS:
                raise HTTPException(status_code=404, detail=f"job {job_id} not found")
        return _job_event_stream(ALPHA_BENCH_JOBS, job_id, request, _result_for_wire)

    # -----------------------------------------------------------------------
    # POST /alpha/compare
    # -----------------------------------------------------------------------

    @app.post(
        "/alpha/compare",
        status_code=202,
        dependencies=[Depends(require_auth)],
    )
    async def kick_off_compare(payload: CompareRequest) -> dict[str, Any]:
        """Queue a background head-to-head comparison and return a job_id."""
        from src.tools.alpha_bench_tool import _parse_period

        try:
            _parse_period(payload.period)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"invalid period: {exc}")

        sem = _get_compare_semaphore()
        if sem.locked() or getattr(sem, "_value", MAX_CONCURRENT_COMPARES) <= 0:
            raise HTTPException(
                status_code=429,
                detail="too many running comparisons; wait for one to finish",
            )

        _prune_old_jobs()

        job_id = uuid.uuid4().hex
        with _JOBS_LOCK:
            ALPHA_COMPARE_JOBS[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "alpha_ids": payload.alpha_ids,
                "universe": payload.universe,
                "period": payload.period,
                "sort": payload.sort,
                "created_at": _now_iso(),
                "progress": {"n_done": 0, "n_total": len(payload.alpha_ids), "current_alpha_id": None},
                "result": None,
                "error": None,
            }
            snapshot = dict(ALPHA_COMPARE_JOBS[job_id])
        _sync_alpha_job_to_durable("alpha_compare", snapshot)

        async def _runner() -> None:
            async with sem:
                try:
                    await asyncio.to_thread(
                        _run_compare_blocking,
                        job_id,
                        payload.alpha_ids,
                        payload.universe,
                        payload.period,
                        payload.sort,
                    )
                except Exception:  # noqa: BLE001 — never escape the loop
                    logger.exception("compare runner outer task crashed (job=%s)", job_id)
                    with _JOBS_LOCK:
                        job = ALPHA_COMPARE_JOBS.get(job_id)
                        if job is not None and job["status"] not in ("done", "error", "failed", "cancelled"):
                            job["status"] = "error"
                            job["error"] = "internal error; see server logs"
                            job["updated_at"] = _now_iso()
                            job["_finished_at"] = time.time()
                            snapshot = dict(job)
                        else:
                            snapshot = None
                    if snapshot is not None:
                        _sync_alpha_job_to_durable("alpha_compare", snapshot)

        task = asyncio.create_task(_runner())
        _RUNNING_TASKS.add(task)
        task.add_done_callback(_RUNNING_TASKS.discard)
        return {"status": "ok", "job_id": job_id}

    # -----------------------------------------------------------------------
    # GET /alpha/compare/{job_id}/stream
    # -----------------------------------------------------------------------

    @app.get(
        "/alpha/compare/{job_id}/stream",
        dependencies=[Depends(require_event_stream_auth)],
    )
    async def stream_compare(job_id: str, request: Request) -> StreamingResponse:
        """SSE: progress / result / done / error until the comparison terminates."""
        if not _JOB_ID_RE.fullmatch(job_id or ""):
            raise HTTPException(status_code=400, detail="invalid job_id")
        with _JOBS_LOCK:
            if job_id not in ALPHA_COMPARE_JOBS:
                raise HTTPException(status_code=404, detail=f"job {job_id} not found")
        return _job_event_stream(ALPHA_COMPARE_JOBS, job_id, request, _compare_result_for_wire)


# ---------------------------------------------------------------------------
# Streaming helpers (shared bench + compare SSE loop)
# ---------------------------------------------------------------------------


def _job_event_stream(
    jobs: dict[str, dict[str, Any]],
    job_id: str,
    request: Request,
    project_result: Callable[[dict[str, Any]], dict[str, Any]],
) -> StreamingResponse:
    """Shared SSE loop for bench + compare jobs.

    Emits ``progress`` whenever ``n_done`` advances, then a single ``result``
    (projected onto the wire contract via ``project_result``) followed by
    ``done`` on success, or ``error`` + ``done`` on failure. A heartbeat comment
    frame every ~15s keeps idle proxies from dropping the connection.
    """

    async def event_stream():
        last_n_done = -1
        last_emit = time.monotonic()
        while True:
            if await request.is_disconnected():
                return

            with _JOBS_LOCK:
                job = jobs.get(job_id)
                if job is None:
                    yield _sse("error", {"message": "job vanished"})
                    yield _sse("done", {"job_id": job_id})
                    return
                status = job["status"]
                progress = dict(job.get("progress") or {})
                result = job.get("result")
                error = job.get("error")

            n_done = int(progress.get("n_done") or 0)
            if n_done != last_n_done:
                yield _sse("progress", progress)
                last_n_done = n_done
                last_emit = time.monotonic()

            if status == "done":
                if result is not None:
                    yield _sse("result", project_result(result))
                yield _sse(
                    "done",
                    {"job_id": job_id, "wall_seconds": (result or {}).get("wall_seconds")},
                )
                return
            if status == "error":
                yield _sse("error", {"message": error or "unknown error"})
                yield _sse("done", {"job_id": job_id})
                return

            if time.monotonic() - last_emit >= _SSE_HEARTBEAT_SECONDS:
                yield ": ping\n\n"
                last_emit = time.monotonic()

            await asyncio.sleep(_POLL_INTERVAL_SECONDS)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _compare_result_for_wire(result: dict[str, Any]) -> dict[str, Any]:
    """Project the compare envelope onto the `result` event.

    The comparison envelope is already slim (a small ranking of user-selected
    alphas + skipped list), so we forward it whole minus the redundant top-level
    ``status`` (the SSE event type already conveys success).
    """
    return {k: v for k, v in result.items() if k != "status"}


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------


def _sse(event: str, data: dict[str, Any]) -> str:
    """Format a single SSE frame."""
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


def _result_for_wire(result: dict[str, Any]) -> dict[str, Any]:
    """Project the bench-runner result onto the API contract's `result` event.

    Keeps: alive / reversed / dead / skipped / n_alphas_tested / top5_by_ir /
    dead_examples / by_theme / meta. The frontend renders skipped count and
    surfaces universe meta (e.g. survivorship_bias) so users see degraded
    runs clearly.

    Drops anything internal (wall_seconds is reported on the `done` event;
    rows / per-alpha skipped[] are stripped server-side to keep payloads small).
    """
    wire: dict[str, Any] = {}
    keep = (
        "alive",
        "reversed",
        "dead",
        "top5_by_ir",
        "dead_examples",
        "by_theme",
        "n_alphas_tested",
        "meta",
    )
    for k in keep:
        if k in result:
            wire[k] = result[k]
    # bench_runner reports the skip count as ``n_skipped``; the wire contract
    # exposes it as ``skipped``. Surface both keys to stay backward-compatible
    # with any client that started reading ``n_skipped`` early.
    if "n_skipped" in result:
        wire["skipped"] = result["n_skipped"]
        wire["n_skipped"] = result["n_skipped"]
    return wire
