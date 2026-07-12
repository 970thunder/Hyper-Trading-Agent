from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.session.events import EventBus
from src.session.models import ApprovalRecord, Attempt, AttemptStatus, Session
from src.session.service import SessionService
from src.session.store import SessionStore


def build_service(tmp_path: Path) -> SessionService:
    return SessionService(
        store=SessionStore(tmp_path / "sessions"),
        event_bus=EventBus(),
        runs_dir=tmp_path / "runs",
    )


def test_execution_mode_auto_selects_plan_for_research_tasks(tmp_path: Path) -> None:
    service = build_service(tmp_path)
    assert service._resolve_execution_mode("auto", "请检索知识库并完成策略回测") == "plan_execute"
    assert service._resolve_execution_mode("auto", "解释夏普比率") == "react"
    assert service._resolve_execution_mode("react", "请完成复杂回测") == "react"


def test_snapshot_persists_plan_and_recovery_pauses_running_attempt(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions")
    session = store.create_session(Session(title="test"))
    attempt = Attempt(
        session_id=session.session_id,
        status=AttemptStatus.RUNNING,
        execution_mode="plan_execute",
        plan=[{"step_id": "execute", "status": "running"}],
    )
    store.create_attempt(attempt)
    store.save_snapshot(attempt)

    assert store.load_snapshot(session.session_id, attempt.attempt_id)["execution_mode"] == "plan_execute"
    assert store.recover_incomplete_attempts() == 1
    recovered = store.get_attempt(session.session_id, attempt.attempt_id)
    assert recovered is not None
    assert recovered.status == AttemptStatus.PAUSED
    assert recovered.error == "service_restarted"


def test_approval_resolution_is_organization_scoped_and_one_time(tmp_path: Path) -> None:
    service = build_service(tmp_path)
    session = service.store.create_session(Session(title="approval"))
    attempt = Attempt(session_id=session.session_id, status=AttemptStatus.WAITING_APPROVAL)
    service.store.create_attempt(attempt)
    approval = ApprovalRecord(
        session_id=session.session_id,
        attempt_id=attempt.attempt_id,
        organization_id="org-a",
        user_id="member-a",
        tool_name="write_file",
        tool_signature="signature-a",
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    )
    service.store.create_approval(approval)

    resolved = service.resolve_approval(
        approval.approval_id,
        approved=True,
        principal={"user_id": "owner-a", "organization_id": "org-a", "role": "owner"},
    )
    assert resolved.status == "approved"
    updated = service.store.get_attempt(session.session_id, attempt.attempt_id)
    assert updated is not None
    assert updated.status == AttemptStatus.PAUSED
    assert updated.approved_tool_signatures == ["signature-a"]

    try:
        service.resolve_approval(
            approval.approval_id,
            approved=True,
            principal={"user_id": "owner-b", "organization_id": "org-b", "role": "owner"},
        )
    except KeyError:
        pass
    else:
        raise AssertionError("cross-organization approval must not be visible")
