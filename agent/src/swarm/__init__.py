"""Swarm multi-agent system — package entry point."""

from __future__ import annotations

from src.swarm.models import (
    RunStatus,
    SwarmAgentSpec,
    SwarmEvent,
    SwarmRun,
    SwarmTask,
    TaskStatus,
    WorkerResult,
)
from src.swarm.presets import build_run_from_preset, inspect_preset, list_presets, load_preset


def __getattr__(name: str):
    if name == "SwarmRuntime":
        from src.swarm.runtime import SwarmRuntime

        return SwarmRuntime
    if name == "SwarmStore":
        from src.swarm.store import SwarmStore

        return SwarmStore
    if name == "run_worker":
        from src.swarm.worker import run_worker

        return run_worker
    raise AttributeError(f"module 'src.swarm' has no attribute {name!r}")

__all__ = [
    "RunStatus",
    "SwarmAgentSpec",
    "SwarmEvent",
    "SwarmRun",
    "SwarmRuntime",
    "SwarmStore",
    "SwarmTask",
    "TaskStatus",
    "WorkerResult",
    "build_run_from_preset",
    "inspect_preset",
    "list_presets",
    "load_preset",
    "run_worker",
]
