"""Swarm HTTP routes.

Mounted by ``agent/api_server.py`` via ``register_swarm_routes(app, ...)``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Awaitable, Callable

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_swarm_runtime = None


class SwarmAgentPayload(BaseModel):
    id: str = Field(..., min_length=1)
    role: str = ""
    system_prompt: str = ""
    tools: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    max_iterations: int = Field(25, ge=1, le=200)
    timeout_seconds: int = Field(300, ge=10, le=7200)
    model_name: str | None = None
    model_provider_id: str | None = None
    max_retries: int = Field(2, ge=0, le=10)


def _get_swarm_runtime():
    """Lazy-init SwarmRuntime singleton."""
    global _swarm_runtime
    if _swarm_runtime is not None:
        return _swarm_runtime
    from src.config import load_swarm_agent_config
    from src.swarm.store import SwarmStore
    from src.swarm.runtime import SwarmRuntime

    # Adjust path: this file is at agent/src/api/, so parent.parent.parent = agent/
    swarm_dir = Path(__file__).resolve().parent.parent.parent / ".swarm" / "runs"
    store = SwarmStore(base_dir=swarm_dir)
    # Boot-time / operator-trusted: REST API callers cannot influence the
    # config path. See docs/2026-05-25_swarm_mcp_tools_roadmap.md.
    agent_config = load_swarm_agent_config()
    _swarm_runtime = SwarmRuntime(store=store, agent_config=agent_config)
    return _swarm_runtime


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

AuthDep = Callable[..., Awaitable[Any] | Any]


def register_swarm_routes(
    app: FastAPI,
    require_auth: AuthDep | None = None,
    require_admin: AuthDep | None = None,
    require_event_stream_auth: AuthDep | None = None,
) -> None:
    """Mount the swarm routes onto ``app``.

    Resolves ``require_auth`` and ``require_event_stream_auth`` from the host
    ``api_server`` module via ``sys.modules`` when not passed explicitly.
    """
    import sys as _sys

    host = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
    if host is None:
        raise RuntimeError(
            "register_swarm_routes: api_server module not in sys.modules; "
            "ensure api_server is imported before calling this function"
        )

    if require_auth is None:
        require_auth = host.require_auth
    if require_admin is None:
        require_admin = host.require_commercial_admin_or_auth
    if require_event_stream_auth is None:
        require_event_stream_auth = host.require_event_stream_auth

    def _host_validate_path_param(value: str, kind: str) -> None:
        h = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
        h._validate_path_param(value, kind)

    def _host_shell_tools_enabled_for_request(request: Request) -> bool:
        h = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
        return h._shell_tools_enabled_for_request(request)

    def _commercial_swarm_context(request: Request):
        h = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
        if h is None or not h._env_flag_enabled("VIBE_TRADING_COMMERCIAL_MODE"):
            return None
        principal = h._commercial_principal_from_request(request)
        if principal is None:
            raise HTTPException(status_code=401, detail="Organization session required")
        from src.commercial.store import CommercialStore

        return CommercialStore(), principal

    def _require_workspace_swarm_run_access(request: Request) -> None:
        context = _commercial_swarm_context(request)
        if context is None:
            return
        run_id = str(request.path_params.get("run_id") or "")
        if run_id and not context[0].workspace_artifact_belongs_to_organization(context[1], "swarm_run", run_id):
            raise HTTPException(status_code=404, detail="Swarm run not found")

    def _bind_workspace_swarm_run(request: Request, runtime: Any, run: Any) -> None:
        context = _commercial_swarm_context(request)
        if context is None:
            return
        context[0].bind_workspace_artifact(
            context[1],
            "swarm_run",
            str(run.id),
            storage_path=str(runtime._store.run_dir(run.id)),
            metadata={"preset_name": str(run.preset_name or "")},
        )

    def _audit_agent_management(
        request: Request,
        action: str,
        preset_name: str,
        agent_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        h = _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")
        principal = h._commercial_principal_from_request(request) if h and hasattr(h, "_commercial_principal_from_request") else None
        if principal is None:
            return
        from src.commercial.store import CommercialStore

        CommercialStore().audit(
            principal,
            action,
            "swarm_agent",
            f"{preset_name}:{agent_id}",
            {"preset_name": preset_name, "agent_id": agent_id, **(metadata or {})},
        )

    def _resolve_model_provider_runtimes(request: Request, preset_name: str) -> dict[str, dict[str, Any]] | None:
        """Resolve organization model providers referenced by editable agents.

        The endpoint still supports local-only mode without a commercial login:
        in that case provider ids are ignored and each worker falls back to the
        stored model name or process-level LLM settings.
        """
        context = _commercial_swarm_context(request)
        if context is None:
            return None
        from src.commercial.store import CommercialStore
        from src.swarm.presets import list_preset_agents

        store, principal = context
        provider_ids = {
            str(agent.get("model_provider_id") or "").strip()
            for agent in list_preset_agents(preset_name, organization_id=principal.organization_id).get("agents", [])
        }
        provider_ids.discard("")
        runtimes: dict[str, dict[str, Any]] = {}
        for provider_id in provider_ids:
            try:
                runtime = store.resolve_model_provider_runtime(principal, provider_id)
            except KeyError as exc:
                raise HTTPException(
                    status_code=404,
                    detail=f"Agent model provider {exc.args[0]} not found in current organization",
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            if runtime:
                runtimes[provider_id] = runtime
        return runtimes or None

    # --- Routes ---

    @app.get("/swarm/presets")
    async def list_swarm_presets(request: Request):
        """List Swarm YAML presets."""
        from src.swarm.presets import list_presets

        context = _commercial_swarm_context(request)
        return list_presets(organization_id=context[1].organization_id if context is not None else None)

    @app.get("/swarm/presets/{preset_name}/agents", dependencies=[Depends(require_auth)])
    async def list_swarm_preset_agents(preset_name: str, request: Request):
        """List editable agents for a swarm preset."""
        _host_validate_path_param(preset_name, "preset_name")
        from src.swarm.presets import list_preset_agents

        try:
            context = _commercial_swarm_context(request)
            return list_preset_agents(preset_name, organization_id=context[1].organization_id if context is not None else None)
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/swarm/presets/{preset_name}/agents", dependencies=[Depends(require_admin)])
    async def create_swarm_preset_agent(preset_name: str, payload: SwarmAgentPayload, request: Request):
        """Create an editable agent definition for a swarm preset."""
        _host_validate_path_param(preset_name, "preset_name")
        from src.swarm.presets import save_preset_agent

        try:
            context = _commercial_swarm_context(request)
            result = save_preset_agent(
                preset_name,
                payload.model_dump(),
                create=True,
                organization_id=context[1].organization_id if context is not None else None,
            )
            _audit_agent_management(
                request,
                "swarm_agent.create",
                preset_name,
                payload.id,
                {"role": payload.role, "model_provider_id": payload.model_provider_id or ""},
            )
            return result
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.put("/swarm/presets/{preset_name}/agents/{agent_id}", dependencies=[Depends(require_admin)])
    async def update_swarm_preset_agent(preset_name: str, agent_id: str, payload: SwarmAgentPayload, request: Request):
        """Update an editable agent definition for a swarm preset."""
        _host_validate_path_param(preset_name, "preset_name")
        _host_validate_path_param(agent_id, "agent_id")
        from src.swarm.presets import save_preset_agent

        data = payload.model_dump()
        data["id"] = agent_id
        try:
            context = _commercial_swarm_context(request)
            result = save_preset_agent(
                preset_name,
                data,
                create=False,
                organization_id=context[1].organization_id if context is not None else None,
            )
            _audit_agent_management(
                request,
                "swarm_agent.update",
                preset_name,
                agent_id,
                {"role": payload.role, "model_provider_id": payload.model_provider_id or ""},
            )
            return result
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except KeyError as e:
            raise HTTPException(status_code=404, detail=f"Agent {e.args[0]} not found")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.delete("/swarm/presets/{preset_name}/agents/{agent_id}", dependencies=[Depends(require_admin)])
    async def delete_swarm_preset_agent(preset_name: str, agent_id: str, request: Request):
        """Delete an agent definition and dependent tasks from a swarm preset override."""
        _host_validate_path_param(preset_name, "preset_name")
        _host_validate_path_param(agent_id, "agent_id")
        from src.swarm.presets import delete_preset_agent

        try:
            context = _commercial_swarm_context(request)
            result = delete_preset_agent(
                preset_name,
                agent_id,
                organization_id=context[1].organization_id if context is not None else None,
            )
            _audit_agent_management(request, "swarm_agent.delete", preset_name, agent_id)
            return result
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/swarm/runs", dependencies=[Depends(require_auth)])
    async def create_swarm_run(payload: dict, http_request: Request):
        """Start a swarm run: body must include preset_name and user_vars."""
        runtime = _get_swarm_runtime()
        preset_name = payload.get("preset_name", "")
        user_vars = payload.get("user_vars", {})
        try:
            run = runtime.start_run(
                preset_name,
                user_vars,
                include_shell_tools=_host_shell_tools_enabled_for_request(http_request),
                model_provider_runtimes=_resolve_model_provider_runtimes(http_request, preset_name),
                preset_organization_id=(
                    _commercial_swarm_context(http_request)[1].organization_id
                    if _commercial_swarm_context(http_request) is not None
                    else None
                ),
            )
            try:
                _bind_workspace_swarm_run(http_request, runtime, run)
            except Exception as exc:
                runtime.cancel_run(run.id)
                raise HTTPException(status_code=500, detail="Unable to secure swarm run") from exc
            return {"id": run.id, "status": run.status.value, "preset_name": run.preset_name}
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/swarm/runs", dependencies=[Depends(require_auth)])
    async def list_swarm_runs(request: Request, limit: int = Query(20, ge=1, le=100)):
        """List swarm runs (newest first), reconciled."""
        runtime = _get_swarm_runtime()
        context = _commercial_swarm_context(request)
        owned_ids = context[0].list_workspace_artifact_ids(context[1], "swarm_run", limit=1000) if context is not None else None
        runs = runtime._store.list_runs(limit=1000 if owned_ids is not None else limit)
        if owned_ids is not None:
            runs = [run for run in runs if run.id in owned_ids][:limit]
        items = []
        for r in runs:
            # Reconcile each row: a zombie running run will be auto-finalized so
            # the dashboard never shows a "running" stuck row.
            reconciled = runtime._store.reconcile_run(r, write=True)
            items.append(
                {
                    "id": reconciled.id,
                    "preset_name": reconciled.preset_name,
                    "status": reconciled.status.value,
                    "is_stale": runtime._store.is_run_stale(reconciled),
                    "created_at": reconciled.created_at,
                    "completed_at": reconciled.completed_at,
                    "task_count": len(reconciled.tasks),
                    "completed_count": sum(
                        1 for t in reconciled.tasks if t.status.value == "completed"
                    ),
                }
            )
        return items

    @app.get("/swarm/runs/{run_id}", dependencies=[Depends(require_auth), Depends(_require_workspace_swarm_run_access)])
    async def get_swarm_run(run_id: str):
        """Swarm run detail including task statuses (reconciled)."""
        _host_validate_path_param(run_id, "run_id")
        runtime = _get_swarm_runtime()
        loaded = runtime._store.load_run(run_id)
        if not loaded:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        run = runtime._store.reconcile_run(loaded, write=True)

        return {
            "id": run.id,
            "preset_name": run.preset_name,
            "status": run.status.value,
            "is_stale": runtime._store.is_run_stale(run),
            "user_vars": run.user_vars,
            "agents": [a.model_dump() for a in run.agents],
            "tasks": [t.model_dump() for t in run.tasks],
            "created_at": run.created_at,
            "completed_at": run.completed_at,
            "final_report": run.final_report,
        }

    @app.get(
        "/swarm/runs/{run_id}/events",
        dependencies=[Depends(require_event_stream_auth), Depends(_require_workspace_swarm_run_access)],
    )
    async def swarm_run_events(
        run_id: str, request: Request, last_index: int = Query(0, ge=0)
    ):
        """SSE stream for a swarm run."""
        import asyncio

        _host_validate_path_param(run_id, "run_id")
        runtime = _get_swarm_runtime()

        async def event_stream():
            idx = last_index
            while True:
                if await request.is_disconnected():
                    break
                events = runtime._store.read_events(run_id, after_index=idx)
                for evt in events:
                    idx += 1
                    yield f"id: {idx}\nevent: {evt.type}\ndata: {json.dumps(evt.model_dump(), ensure_ascii=False)}\n\n"
                run = runtime._store.load_run(run_id)
                if run:
                    # Reconcile so a zombie running run can still close this SSE
                    # stream cleanly — without it, a dead host would keep the
                    # stream open forever and block the dashboard's "done" state.
                    reconciled = runtime._store.reconcile_run(run, write=True)
                    if reconciled.status.value in ("completed", "failed", "cancelled"):
                        yield f"event: done\ndata: {{\"status\": \"{reconciled.status.value}\"}}\n\n"
                        break
                await asyncio.sleep(2)

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @app.post("/swarm/runs/{run_id}/cancel", dependencies=[Depends(require_auth), Depends(_require_workspace_swarm_run_access)])
    async def cancel_swarm_run(run_id: str):
        """Cancel an active swarm run."""
        _host_validate_path_param(run_id, "run_id")
        runtime = _get_swarm_runtime()
        ok = runtime.cancel_run(run_id)
        if not ok:
            raise HTTPException(status_code=404, detail=f"No active run {run_id}")
        return {"status": "cancelled"}

    @app.post("/swarm/runs/{run_id}/retry", dependencies=[Depends(require_auth), Depends(_require_workspace_swarm_run_access)])
    async def retry_swarm_run(run_id: str, http_request: Request):
        """Retry a failed, stale, or cancelled swarm run.

        Creates a new run with the same preset and user_vars as the original.
        """
        _host_validate_path_param(run_id, "run_id")
        runtime = _get_swarm_runtime()
        loaded = runtime._store.load_run(run_id)
        if not loaded:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

        # Reconcile first so a stale "running" run whose host died gets demoted
        # before we gate on status; only a genuinely active run blocks retry.
        from src.swarm.models import RunStatus

        reconciled = runtime._store.reconcile_run(loaded, write=True)
        if reconciled.status == RunStatus.running:
            raise HTTPException(
                status_code=409, detail="Cannot retry a running run. Cancel it first."
            )

        try:
            new_run = runtime.start_run(
                reconciled.preset_name,
                reconciled.user_vars or {},
                include_shell_tools=_host_shell_tools_enabled_for_request(http_request),
                model_provider_runtimes=_resolve_model_provider_runtimes(http_request, reconciled.preset_name),
                preset_organization_id=(
                    _commercial_swarm_context(http_request)[1].organization_id
                    if _commercial_swarm_context(http_request) is not None
                    else None
                ),
            )
            try:
                _bind_workspace_swarm_run(http_request, runtime, new_run)
            except Exception as exc:
                runtime.cancel_run(new_run.id)
                raise HTTPException(status_code=500, detail="Unable to secure swarm run") from exc
            return {
                "id": new_run.id,
                "status": new_run.status.value,
                "preset_name": new_run.preset_name,
            }
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
