"""System and utility HTTP routes.

Mounted by ``agent/api_server.py`` via ``register_system_routes(app, ...)``.
"""

from __future__ import annotations

import os
import signal
import time
from datetime import datetime
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request, Security, status
from fastapi.responses import PlainTextResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Pydantic models (defined locally -- NO shared modules, per maintainer rule)
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    """Health check payload."""
    status: str = Field(..., description="Service status")
    service: str = Field(..., description="Service name")
    timestamp: str = Field(..., description="Server timestamp")


# ---------------------------------------------------------------------------
# Process termination
# ---------------------------------------------------------------------------


def _terminate_current_process() -> None:
    """Stop the current API process after the response has been sent."""
    time.sleep(0.25)
    os.kill(os.getpid(), signal.SIGTERM)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_system_routes(
    app: FastAPI,
    app_version: str | None = None,
) -> None:
    """Mount the system routes onto ``app``.

    Resolves ``_security``, ``_require_shutdown_authorization``, and
    ``APP_VERSION`` from the host ``api_server`` module via ``sys.modules``
    when not passed explicitly.
    """
    # Resolve host dependencies via sys.modules fallback
    import sys as _sys

    host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")

    if host is None:
        raise RuntimeError(
            "register_system_routes: api_server module not in sys.modules; "
            "ensure api_server is imported before calling this function"
        )

    _security = host._security
    _require_shutdown_authorization = host._require_shutdown_authorization
    _require_commercial_writer_or_auth = host.require_commercial_writer_or_auth
    _require_platform_admin_or_auth = host.require_platform_admin_or_auth
    _app_version = app_version if app_version is not None else host.APP_VERSION

    def _get_terminate_process():
        """Late-access _terminate_current_process for test monkeypatch compat."""
        h = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
        if h is not None:
            fn = getattr(h, "_terminate_current_process", None)
            if fn is not None:
                return fn
        return _terminate_current_process

    # --- Routes ---

    @app.get("/health", response_model=HealthResponse)
    async def health_check():
        """Liveness probe."""
        return HealthResponse(
            status="healthy",
            service="Hyper Trading Agent API",
            timestamp=datetime.now().isoformat()
        )

    @app.get("/metrics", response_class=PlainTextResponse, dependencies=[Depends(_require_platform_admin_or_auth)])
    async def metrics():
        """Minimal Prometheus-compatible metrics endpoint."""
        lines = [
            "# HELP vibe_trading_api_up API process liveness.",
            "# TYPE vibe_trading_api_up gauge",
            "vibe_trading_api_up 1",
        ]
        try:
            from src.knowledge import KnowledgeBase

            stats = KnowledgeBase().stats()
            lines.extend([
                "# HELP vibe_trading_knowledge_documents Local legacy knowledge documents.",
                "# TYPE vibe_trading_knowledge_documents gauge",
                f"vibe_trading_knowledge_documents {int(stats.get('document_count', 0))}",
                "# HELP vibe_trading_knowledge_chunks Local legacy knowledge chunks.",
                "# TYPE vibe_trading_knowledge_chunks gauge",
                f"vibe_trading_knowledge_chunks {int(stats.get('chunk_count', 0))}",
            ])
        except Exception:
            lines.append("vibe_trading_knowledge_documents 0")
            lines.append("vibe_trading_knowledge_chunks 0")
        try:
            from src.commercial.store import CommercialStore

            store = CommercialStore()
            metrics = store.commercial_metrics()
            lines.extend([
                "# HELP vibe_trading_commercial_organizations Commercial organizations.",
                "# TYPE vibe_trading_commercial_organizations gauge",
                f"vibe_trading_commercial_organizations {metrics['organizations']}",
                "# HELP vibe_trading_commercial_knowledge_bases Commercial knowledge bases.",
                "# TYPE vibe_trading_commercial_knowledge_bases gauge",
                f"vibe_trading_commercial_knowledge_bases {metrics['knowledge_bases']}",
                "# HELP vibe_trading_commercial_ingestion_jobs Commercial RAG ingestion jobs.",
                "# TYPE vibe_trading_commercial_ingestion_jobs gauge",
                f"vibe_trading_commercial_ingestion_jobs {metrics['ingestion_jobs']}",
                "# HELP vibe_trading_commercial_ingestion_jobs_failed Failed commercial RAG ingestion jobs.",
                "# TYPE vibe_trading_commercial_ingestion_jobs_failed gauge",
                f"vibe_trading_commercial_ingestion_jobs_failed {metrics['ingestion_jobs_failed']}",
                "# HELP vibe_trading_commercial_model_calls Commercial model call records.",
                "# TYPE vibe_trading_commercial_model_calls counter",
                f"vibe_trading_commercial_model_calls {metrics['model_calls']}",
                "# HELP vibe_trading_commercial_knowledge_retrievals Commercial knowledge retrieval records.",
                "# TYPE vibe_trading_commercial_knowledge_retrievals counter",
                f"vibe_trading_commercial_knowledge_retrievals {metrics['retrievals']}",
                "# HELP vibe_trading_commercial_tool_calls Commercial tool call audit records.",
                "# TYPE vibe_trading_commercial_tool_calls counter",
                f"vibe_trading_commercial_tool_calls {metrics['tool_calls']}",
                "# HELP vibe_trading_commercial_tool_call_errors Commercial failed tool call audit records.",
                "# TYPE vibe_trading_commercial_tool_call_errors counter",
                f"vibe_trading_commercial_tool_call_errors {metrics['tool_call_errors']}",
            ])
        except Exception:
            lines.append("vibe_trading_commercial_organizations 0")
            lines.append("vibe_trading_commercial_knowledge_bases 0")
            lines.append("vibe_trading_commercial_ingestion_jobs 0")
            lines.append("vibe_trading_commercial_ingestion_jobs_failed 0")
            lines.append("vibe_trading_commercial_model_calls 0")
            lines.append("vibe_trading_commercial_knowledge_retrievals 0")
            lines.append("vibe_trading_commercial_tool_calls 0")
            lines.append("vibe_trading_commercial_tool_call_errors 0")
        return "\n".join(lines) + "\n"

    @app.get("/correlation", dependencies=[Depends(_require_commercial_writer_or_auth)])
    async def get_correlation_matrix(
        codes: str = Query(..., description="Comma-separated asset codes, e.g. BTC-USDT,ETH-USDT,SPY"),
        days: int = Query(90, description="Lookback window in days", ge=7, le=365),
        method: str = Query("pearson", description="Correlation method: pearson or spearman"),
    ):
        """Compute cross-asset correlation matrix from daily returns.

        Fetches price data for each code via available data loaders,
        computes pairwise correlation of daily returns over the lookback window.
        """
        from backtest.correlation import compute_correlation_matrix

        code_list = [c.strip() for c in codes.split(",") if c.strip()]
        if len(code_list) < 2:
            raise HTTPException(status_code=400, detail="At least 2 asset codes required")
        if len(code_list) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 assets per request")
        if method not in ("pearson", "spearman"):
            raise HTTPException(status_code=400, detail="method must be 'pearson' or 'spearman'")

        try:
            result = compute_correlation_matrix(codes=code_list, days=days, method=method)
            return result
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Correlation computation failed: {exc}")

    @app.post("/system/shutdown", dependencies=[Depends(_require_platform_admin_or_auth)])
    async def shutdown_local_api(
        background_tasks: BackgroundTasks,
        request: Request,
        cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
    ):
        """Shut down the local API server after explicit local authorization."""
        _require_shutdown_authorization(request=request, cred=cred)
        client_host = request.client.host if request.client else ""
        if client_host not in {"127.0.0.1", "::1", "localhost"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Local access only")

        background_tasks.add_task(_get_terminate_process())
        return {
            "status": "shutting-down",
            "service": "Hyper Trading Agent API",
            "timestamp": datetime.now().isoformat(),
        }

    @app.get("/skills")
    async def list_skills():
        """List registered skills (name and description)."""
        from src.agent.skills import SkillsLoader

        loader = SkillsLoader()
        return [
            {
                "name": s.name,
                "description": s.description,
            }
            for s in loader.skills
        ]

    @app.get("/api")
    async def api_info():
        """Service metadata."""
        return {
            "service": "Hyper Trading Agent API",
            "version": _app_version,
            "docs": "/docs",
            "health": "/health",
        }
