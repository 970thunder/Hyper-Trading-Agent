"""Session lifecycle orchestration for message flow, attempt creation, and execution scheduling.

V5: Uses AgentLoop instead of the fixed pipeline behind the generate skill.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Optional

import httpx

from src.session.events import EventBus
from src.session.models import (
    Attempt,
    AttemptStatus,
    ApprovalRecord,
    Message,
    Session,
)
from src.session.search import get_shared_index
from src.session.store import SessionStore

if TYPE_CHECKING:
    from src.agent.loop import AgentLoop

# Dedicated thread pool limited to four concurrent agents to avoid exhausting the default executor.
_AGENT_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="agent")
_SESSION_TITLE_MAX_CHARS = 18
_CONVERSATION_RECALL_MAX = 3
_TITLE_TICKER_STOPWORDS = {"API", "CSV", "DOC", "EXCEL", "HTML", "IM", "LLM", "PDF", "RAG", "URL", "WORD"}
_DIRECT_CHAT_LIMIT = 180
_RESEARCH_OR_TOOL_MARKERS = (
    "backtest", "rag", "knowledge", "multi-agent", "swarm", "report", "research",
    "strategy", "factor", "alpha", "portfolio", "market", "stock", "ticker", "trade",
    "回测", "知识库", "文档", "文件", "研报", "研究", "策略", "量化", "因子", "组合",
    "行情", "股票", "估值", "投资", "交易", "资金", "风险", "工具", "数据", "检索",
)
_TICKER_PATTERN = re.compile(r"(?:\b[A-Z]{1,6}(?:\.[A-Z]{1,4})?\b|\b\d{6}\.(?:SZ|SH|BJ)\b)", re.IGNORECASE)


class SessionService:
    """Session lifecycle service.

    Attributes:
        store: Session persistence store.
        event_bus: SSE event bus.
        runs_dir: Root runs directory.
    """

    def __init__(
        self,
        store: SessionStore,
        event_bus: EventBus,
        runs_dir: Path,
    ) -> None:
        """Initialize the session service.

        Args:
            store: Session persistence store.
            event_bus: SSE event bus.
            runs_dir: Root runs directory.
        """
        self.store = store
        self.event_bus = event_bus
        self.runs_dir = runs_dir
        self._active_loops: Dict[str, "AgentLoop"] = {}
        self._pause_requested: set[str] = set()
        self._state_lock = threading.RLock()
        self._search_index = get_shared_index()
        self.store.recover_incomplete_attempts()

    def create_session(self, title: str = "", config: Optional[Dict[str, Any]] = None) -> Session:
        """Create a new session.

        Args:
            title: Session title.
            config: Session configuration.

        Returns:
            The newly created Session.
        """
        session = Session(title=title, config=config or {})
        self.store.create_session(session)
        self._search_index.index_session(session.session_id, title)
        self.event_bus.emit(session.session_id, "session.created", {"session_id": session.session_id, "title": title})
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        """Return a session by ID."""
        return self.store.get_session(session_id)

    def list_sessions(self, limit: int = 50) -> list[Session]:
        """List all sessions."""
        return self.store.list_sessions(limit)

    def delete_session(self, session_id: str) -> bool:
        """Delete a session."""
        self.event_bus.clear(session_id)
        return self.store.delete_session(session_id)

    async def send_message(
        self,
        session_id: str,
        content: str,
        role: str = "user",
        *,
        include_shell_tools: bool = False,
        commercial_principal: Dict[str, Any] | None = None,
        commercial_model_provider: Dict[str, Any] | None = None,
        execution_mode: str = "auto",
        schedule: bool = True,
    ) -> Dict[str, Any]:
        """Send a message to a session and trigger execution.

        Args:
            session_id: Session ID.
            content: Message content.
            role: Message role.
            include_shell_tools: Whether this attempt may use shell tools.

        Returns:
            Dictionary containing message_id and attempt_id.
        """
        session = self.store.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        message = Message(session_id=session_id, role=role, content=content)
        self.store.append_message(message)
        self._search_index.index_message(session_id, role, content)
        self.event_bus.emit(session_id, "message.received", {"message_id": message.message_id, "role": role, "content": content})

        if role != "user":
            return {"message_id": message.message_id}

        self._maybe_set_initial_title(session, content)

        resolved_mode = self._resolve_execution_mode(execution_mode, content)
        attempt = Attempt(
            session_id=session_id,
            parent_attempt_id=session.last_attempt_id,
            prompt=content,
            status=AttemptStatus.QUEUED,
            execution_mode=resolved_mode,
        )
        attempt.plan = self._initial_plan(resolved_mode)
        self.store.create_attempt(attempt)
        session.config["include_shell_tools"] = include_shell_tools
        if commercial_principal:
            session.config["commercial_principal"] = commercial_principal
        if commercial_model_provider:
            session.config["commercial_model_provider"] = {
                key: value for key, value in commercial_model_provider.items() if key != "api_key"
            }
        session.last_attempt_id = attempt.attempt_id
        session.updated_at = datetime.now().isoformat()
        self.store.update_session(session)
        self.event_bus.emit(session_id, "attempt.created", {
            "attempt_id": attempt.attempt_id,
            "prompt": content,
            "execution_mode": resolved_mode,
        })
        self.event_bus.emit(session_id, "plan.created", {
            "attempt_id": attempt.attempt_id,
            "execution_mode": resolved_mode,
            "steps": attempt.plan,
        })
        self._save_snapshot(attempt)

        if schedule:
            asyncio.create_task(
                self._run_attempt(
                    session,
                    attempt,
                    include_shell_tools=include_shell_tools,
                    commercial_model_provider=commercial_model_provider,
                )
            )
        return {
            "message_id": message.message_id,
            "attempt_id": attempt.attempt_id,
            "execution_mode": resolved_mode,
        }

    def run_queued_attempt(self, session_id: str, attempt_id: str) -> Dict[str, Any]:
        """Run a persisted queued attempt from a durable worker process."""
        session = self.store.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        attempt = self.store.get_attempt(session_id, attempt_id)
        if not attempt:
            raise ValueError("attempt not found")
        if attempt.status not in {AttemptStatus.QUEUED, AttemptStatus.PAUSED, AttemptStatus.BLOCKED}:
            raise ValueError(f"attempt cannot be run from status {attempt.status.value}")

        provider = self._resolve_resume_model_provider(session)

        async def _runner() -> None:
            await self._run_attempt(
                session,
                attempt,
                include_shell_tools=bool(session.config.get("include_shell_tools")),
                commercial_model_provider=provider,
            )

        asyncio.run(_runner())
        refreshed = self.store.get_attempt(session_id, attempt_id) or attempt
        return {
            "status": "completed" if refreshed.status == AttemptStatus.COMPLETED else refreshed.status.value,
            "attempt_status": refreshed.status.value,
            "session_id": session_id,
            "attempt_id": attempt_id,
            "run_dir": refreshed.run_dir or "",
            "error": refreshed.error or "",
        }

    @staticmethod
    def _resolve_execution_mode(requested: str, content: str) -> str:
        if requested in {"react", "plan_execute"}:
            return requested
        if SessionService._is_lightweight_chat(content):
            return "direct"
        complex_markers = (
            "backtest", "rag", "knowledge", "multi-agent", "swarm", "report",
            "回测", "知识库", "多智能体", "研究报告", "组合", "因子", "检索",
        )
        score = sum(1 for marker in complex_markers if marker in content.lower())
        return "plan_execute" if score >= 1 or len(content) >= 180 else "react"

    @staticmethod
    def _is_lightweight_chat(content: str) -> bool:
        """Route small conversational turns away from the tool-using agent loop."""
        normalized = " ".join(str(content or "").split())
        if not normalized or len(normalized) > _DIRECT_CHAT_LIMIT:
            return False
        lowered = normalized.lower()
        if _TICKER_PATTERN.search(normalized):
            return False
        return not any(marker in lowered for marker in _RESEARCH_OR_TOOL_MARKERS)

    @staticmethod
    def _initial_plan(mode: str) -> list[Dict[str, Any]]:
        now = datetime.now().isoformat()
        if mode == "direct":
            return []
        if mode == "react":
            return [{
                "step_id": "analysis",
                "title": "Analyze request and execute",
                "type": "agent",
                "status": "pending",
                "dependencies": [],
                "tool_names": [],
                "started_at": None,
                "completed_at": None,
                "elapsed_ms": None,
                "summary": "",
                "error": "",
                "created_at": now,
            }]
        return [
            {"step_id": "plan", "title": "Build research plan", "type": "planning", "status": "completed", "dependencies": [], "tool_names": [], "started_at": now, "completed_at": now, "elapsed_ms": 0, "summary": "Execution plan prepared", "error": "", "created_at": now},
            {"step_id": "execute", "title": "Execute research tools", "type": "execution", "status": "pending", "dependencies": ["plan"], "tool_names": [], "started_at": None, "completed_at": None, "elapsed_ms": None, "summary": "", "error": "", "created_at": now},
            {"step_id": "synthesize", "title": "Synthesize findings", "type": "synthesis", "status": "pending", "dependencies": ["execute"], "tool_names": [], "started_at": None, "completed_at": None, "elapsed_ms": None, "summary": "", "error": "", "created_at": now},
        ]

    def _maybe_set_initial_title(self, session: Session, content: str) -> None:
        """Set a short generated title from the first user message.

        The title generator is local and deterministic so starting a chat never
        depends on an extra model call. Manual titles are left untouched.
        """
        if session.title.strip():
            return
        title = generate_short_session_title(content)
        if not title:
            return
        session.title = title
        session.config["title_generated"] = True
        self._search_index.index_session(session.session_id, title)
        self.event_bus.emit(session.session_id, "session.updated", {"session_id": session.session_id, "title": title})

    def get_messages(self, session_id: str, limit: int = 100) -> list[Message]:
        """Return the message history."""
        return self.store.get_messages(session_id, limit)

    def recall_conversation_history(
        self,
        query: str,
        *,
        current_session_id: str = "",
        limit: int = _CONVERSATION_RECALL_MAX,
    ) -> list[Dict[str, Any]]:
        """Return relevant prior sessions for cross-session context recall."""
        cleaned = " ".join(str(query or "").split())
        if len(cleaned) < 3:
            return []
        safe_limit = max(1, min(int(limit or _CONVERSATION_RECALL_MAX), 10))
        matches = self._search_index.search(cleaned, max_sessions=safe_limit + 3)
        recalled: list[Dict[str, Any]] = []
        for match in matches:
            if current_session_id and match.session_id == current_session_id:
                continue
            recalled.append({
                **match.to_dict(),
                "citation": f"conversation:{match.session_id}",
            })
            if len(recalled) >= safe_limit:
                break
        return recalled

    def _conversation_history_recall_messages(
        self,
        query: str,
        *,
        current_session_id: str = "",
    ) -> list[Dict[str, Any]]:
        recalled = self.recall_conversation_history(
            query,
            current_session_id=current_session_id,
            limit=_CONVERSATION_RECALL_MAX,
        )
        if not recalled:
            return []
        lines = []
        for item in recalled:
            title = str(item.get("title") or "(untitled)")
            citation = str(item.get("citation") or "")
            snippet = str(item.get("snippet") or "").replace(">>>", "").replace("<<<", "")
            lines.append(f"- {title} [{citation}]: {snippet[:500]}")
        return [{
            "role": "system",
            "content": (
                "<conversation-history-recall>\n"
                + "\n".join(lines)
                + "\n</conversation-history-recall>\n"
                "Use these prior-session snippets only as context. Treat them as historical notes, "
                "cite the conversation id when relying on them, and verify current market facts with tools."
            ),
        }]

    def cancel_current(self, session_id: str) -> bool:
        """Cancel the currently running AgentLoop for a session.

        Args:
            session_id: Session ID.

        Returns:
            Whether cancellation succeeded. True means an active loop existed and received a cancel signal.
        """
        loop = self._active_loops.get(session_id)
        if loop is None:
            return False
        loop.cancel()
        return True

    def pause_attempt(self, session_id: str, attempt_id: str) -> Attempt:
        attempt = self._require_attempt(session_id, attempt_id)
        if attempt.status not in {AttemptStatus.RUNNING, AttemptStatus.PLANNING, AttemptStatus.QUEUED}:
            raise ValueError("attempt cannot be paused in its current state")
        self._pause_requested.add(attempt_id)
        self.cancel_current(session_id)
        attempt.status = AttemptStatus.PAUSED
        attempt.updated_at = datetime.now().isoformat()
        self._save_snapshot(attempt)
        self.event_bus.emit(session_id, "attempt.paused", {"attempt_id": attempt_id, "status": attempt.status.value})
        return attempt

    def resume_attempt(self, session_id: str, attempt_id: str) -> Attempt:
        attempt = self._require_attempt(session_id, attempt_id)
        if attempt.status not in {AttemptStatus.PAUSED, AttemptStatus.WAITING_APPROVAL, AttemptStatus.BLOCKED}:
            raise ValueError("attempt cannot be resumed in its current state")
        if attempt.status == AttemptStatus.WAITING_APPROVAL:
            pending = [item for item in self.store.list_approvals(status="pending") if item.attempt_id == attempt_id]
            if pending:
                raise ValueError("attempt still has a pending approval")
        session = self.store.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        attempt.status = AttemptStatus.QUEUED
        attempt.error = None
        attempt.updated_at = datetime.now().isoformat()
        self.store.update_attempt(attempt)
        self._pause_requested.discard(attempt_id)
        provider = self._resolve_resume_model_provider(session)
        asyncio.create_task(self._run_attempt(
            session,
            attempt,
            include_shell_tools=bool(session.config.get("include_shell_tools")),
            commercial_model_provider=provider,
        ))
        self.event_bus.emit(session_id, "attempt.resumed", {"attempt_id": attempt_id, "status": "queued"})
        return attempt

    def get_execution(self, session_id: str, attempt_id: str) -> Dict[str, Any]:
        attempt = self._require_attempt(session_id, attempt_id)
        approvals = [item.to_dict() for item in self.store.list_approvals() if item.attempt_id == attempt_id]
        return {
            "attempt_id": attempt.attempt_id,
            "session_id": attempt.session_id,
            "status": attempt.status.value,
            "execution_mode": attempt.execution_mode,
            "plan": attempt.plan,
            "current_step_id": attempt.current_step_id,
            "snapshot": self.store.load_snapshot(session_id, attempt_id),
            "approvals": approvals,
        }

    def resolve_approval(self, approval_id: str, *, approved: bool, principal: Dict[str, Any], note: str = "") -> ApprovalRecord:
        approval = self.store.get_approval(approval_id)
        if not approval or approval.organization_id != str(principal.get("organization_id") or ""):
            raise KeyError("approval not found")
        if approval.status != "pending":
            raise ValueError("approval is no longer pending")
        now = datetime.now(timezone.utc)
        if approval.expires_at and datetime.fromisoformat(approval.expires_at) <= now:
            approval.status = "expired"
        else:
            approval.status = "approved" if approved else "rejected"
        approval.resolved_at = now.isoformat()
        approval.resolved_by = str(principal.get("user_id") or "")
        approval.resolution_note = note[:500]
        self.store.update_approval(approval)
        attempt = self._require_attempt(approval.session_id, approval.attempt_id)
        if approval.status == "approved":
            if approval.tool_signature not in attempt.approved_tool_signatures:
                attempt.approved_tool_signatures.append(approval.tool_signature)
            attempt.status = AttemptStatus.PAUSED
        else:
            attempt.status = AttemptStatus.BLOCKED
            attempt.error = f"approval_{approval.status}"
        self._save_snapshot(attempt)
        self._audit_approval(principal, approval)
        self.event_bus.emit(approval.session_id, "approval.resolved", approval.to_dict())
        return approval

    def _require_attempt(self, session_id: str, attempt_id: str) -> Attempt:
        attempt = self.store.get_attempt(session_id, attempt_id)
        if not attempt:
            raise ValueError("attempt not found")
        return attempt

    def _save_snapshot(self, attempt: Attempt) -> None:
        attempt.updated_at = datetime.now().isoformat()
        snapshot = self.store.save_snapshot(attempt)
        self.event_bus.emit(attempt.session_id, "snapshot.saved", {
            "attempt_id": attempt.attempt_id,
            "status": attempt.status.value,
            "updated_at": snapshot["updated_at"],
        })

    @staticmethod
    def _audit_approval(principal_payload: Dict[str, Any], approval: ApprovalRecord) -> None:
        try:
            from src.commercial.store import CommercialStore, Principal
            principal = Principal(
                user_id=str(principal_payload["user_id"]),
                organization_id=str(principal_payload["organization_id"]),
                email=str(principal_payload.get("email") or ""),
                role=str(principal_payload.get("role") or "member"),
            )
            CommercialStore().audit(
                principal,
                f"approval.{approval.status}",
                "tool_approval",
                approval.approval_id,
                {"tool": approval.tool_name, "attempt_id": approval.attempt_id, "risk_level": approval.risk_level},
            )
        except Exception:
            return

    @staticmethod
    def _bind_commercial_run(session: Session, attempt: Attempt) -> None:
        if not attempt.run_dir:
            return
        principal_payload = session.config.get("commercial_principal") if isinstance(session.config, dict) else None
        if not isinstance(principal_payload, dict):
            return
        try:
            from src.commercial.store import CommercialStore, Principal

            principal = Principal(
                user_id=str(principal_payload["user_id"]),
                organization_id=str(principal_payload["organization_id"]),
                email=str(principal_payload.get("email") or ""),
                role=str(principal_payload.get("role") or "member"),
            )
            CommercialStore().bind_workspace_run(
                principal,
                Path(attempt.run_dir).name,
                session_id=session.session_id,
                attempt_id=attempt.attempt_id,
            )
        except Exception:
            logger.warning("Failed to bind commercial run ownership", exc_info=True)

    @staticmethod
    def _resolve_resume_model_provider(session: Session) -> Dict[str, Any] | None:
        principal_payload = session.config.get("commercial_principal")
        provider_payload = session.config.get("commercial_model_provider")
        if not isinstance(principal_payload, dict):
            return None
        try:
            from src.commercial.store import CommercialStore, Principal
            principal = Principal(
                user_id=str(principal_payload["user_id"]),
                organization_id=str(principal_payload["organization_id"]),
                email=str(principal_payload.get("email") or ""),
                role=str(principal_payload.get("role") or "member"),
            )
            return CommercialStore().resolve_model_provider_runtime(
                principal,
                str((provider_payload or {}).get("provider_id") or "") or None,
            )
        except Exception:
            return None

    async def _run_attempt(
        self,
        session: Session,
        attempt: Attempt,
        *,
        include_shell_tools: bool = False,
        commercial_model_provider: Dict[str, Any] | None = None,
    ) -> None:
        """Execute an Attempt in the background."""
        attempt.mark_running()
        if attempt.execution_mode == "plan_execute":
            attempt.status = AttemptStatus.PLANNING
        self.store.update_attempt(attempt)
        self.event_bus.emit(session.session_id, "attempt.started", {"attempt_id": attempt.attempt_id, "execution_mode": attempt.execution_mode})
        attempt.status = AttemptStatus.RUNNING
        if attempt.execution_mode != "direct":
            self._mark_plan_step(attempt, "execute" if attempt.execution_mode == "plan_execute" else "analysis", "running")

        try:
            messages = self.store.get_messages(session.session_id)
            if attempt.execution_mode == "direct":
                result = await self._run_lightweight_chat(
                    attempt,
                    messages=messages,
                    commercial_model_provider=commercial_model_provider,
                )
            else:
                result = await self._run_with_agent(
                    attempt,
                    messages=messages,
                    include_shell_tools=include_shell_tools,
                    session_config=dict(session.config),
                    commercial_model_provider=commercial_model_provider,
                )
            if result.get("status") == "waiting_approval":
                attempt.status = AttemptStatus.WAITING_APPROVAL
                attempt.run_dir = result.get("run_dir")
                self._bind_commercial_run(session, attempt)
                self._save_snapshot(attempt)
                return
            if result.get("status") == "success":
                attempt.mark_completed(summary=result.get("content", ""))
                if attempt.execution_mode != "direct":
                    self._mark_plan_step(attempt, "execute" if attempt.execution_mode == "plan_execute" else "analysis", "completed")
                if attempt.execution_mode == "plan_execute":
                    self._mark_plan_step(attempt, "synthesize", "completed", summary="Research result synthesized")
            elif result.get("status") == "cancelled":
                attempt.status = AttemptStatus.PAUSED if attempt.attempt_id in self._pause_requested else AttemptStatus.CANCELLED
                attempt.completed_at = datetime.now().isoformat()
                attempt.error = result.get("reason", "cancelled")
            else:
                attempt.mark_failed(error=result.get("reason", "unknown"))
                if attempt.execution_mode != "direct":
                    self._mark_plan_step(attempt, attempt.current_step_id or "execute", "failed", error=attempt.error or "")
            attempt.run_dir = result.get("run_dir")
            self._bind_commercial_run(session, attempt)

            self.store.update_attempt(attempt)
            reply_metadata = {}
            if attempt.run_dir:
                reply_metadata["run_id"] = Path(attempt.run_dir).name
            reply_metadata["status"] = attempt.status.value
            if attempt.metrics:
                reply_metadata["metrics"] = attempt.metrics

            reply = Message(
                session_id=session.session_id, role="assistant",
                content=self._format_result_message(attempt),
                linked_attempt_id=attempt.attempt_id,
                metadata=reply_metadata,
            )
            self.store.append_message(reply)
            self._search_index.index_message(session.session_id, "assistant", reply.content)
            self.event_bus.emit(
                session.session_id,
                "attempt.completed" if attempt.status == AttemptStatus.COMPLETED else ("attempt.paused" if attempt.status == AttemptStatus.PAUSED else "attempt.failed"),
                {"attempt_id": attempt.attempt_id, "status": attempt.status.value,
                 "summary": attempt.summary, "error": attempt.error, "run_dir": attempt.run_dir},
            )

        except Exception as exc:
            attempt.mark_failed(error=str(exc))
            self.store.update_attempt(attempt)
            self.event_bus.emit(session.session_id, "attempt.failed", {"attempt_id": attempt.attempt_id, "error": str(exc)})

    async def _run_lightweight_chat(
        self,
        attempt: Attempt,
        *,
        messages: list | None,
        commercial_model_provider: Dict[str, Any] | None,
    ) -> Dict[str, Any]:
        """Run a short conversational turn without agent instructions or tools."""
        history = self._convert_messages_to_history(messages or [])[-8:]
        request_messages = [*history, {"role": "user", "content": attempt.prompt}]
        provider = commercial_model_provider if isinstance(commercial_model_provider, dict) else None

        if not provider or not provider.get("api_key"):
            from src.providers.chat import ChatLLM, ProviderStreamError

            llm = ChatLLM()
            loop = asyncio.get_running_loop()
            try:
                def emit_delta(delta: str) -> None:
                    if delta:
                        self.event_bus.emit(
                            attempt.session_id,
                            "text_delta",
                            {"attempt_id": attempt.attempt_id, "delta": delta},
                        )

                response = await loop.run_in_executor(
                    _AGENT_EXECUTOR,
                    lambda: llm.stream_chat(request_messages, tools=None, on_text_chunk=emit_delta),
                )
            except ProviderStreamError as exc:
                return {"status": "error", "reason": exc.user_message, "run_dir": ""}
            return {"status": "success", "content": str(response.content or ""), "run_dir": ""}

        from src.providers.chat import _classify_provider_error

        endpoint = str(provider.get("base_url") or "").rstrip("/") + "/chat/completions"
        payload = {
            "model": str(provider.get("model") or ""),
            "messages": request_messages,
            "temperature": float(provider.get("temperature") or 0),
            "max_tokens": 512,
        }
        headers = {"Authorization": f"Bearer {provider['api_key']}"}
        timeout_seconds = max(5, min(int(provider.get("timeout_seconds") or 30), 60))
        try:
            payload["stream"] = True
            chunks: list[str] = []
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                async with client.stream("POST", endpoint, headers=headers, json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if not raw or raw == "[DONE]":
                            continue
                        try:
                            body = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        choices = body.get("choices") if isinstance(body, dict) else []
                        choice = choices[0] if isinstance(choices, list) and choices else {}
                        delta = choice.get("delta") if isinstance(choice, dict) else {}
                        content = delta.get("content") if isinstance(delta, dict) else ""
                        if isinstance(content, list):
                            content = "".join(
                                str(item.get("text") or "") for item in content if isinstance(item, dict)
                            )
                        text_delta = str(content or "")
                        if text_delta:
                            chunks.append(text_delta)
                            self.event_bus.emit(
                                attempt.session_id,
                                "text_delta",
                                {"attempt_id": attempt.attempt_id, "delta": text_delta},
                            )
            text = "".join(chunks).strip()
            if not text:
                return {"status": "error", "reason": "The model returned no response text.", "run_dir": ""}
            return {"status": "success", "content": text, "run_dir": ""}
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            return {
                "status": "error",
                "reason": _classify_provider_error(
                    str(provider.get("provider") or "openai"),
                    str(provider.get("model") or "(unset)"),
                    exc.response.status_code,
                    detail,
                ),
                "run_dir": "",
            }
        except Exception as exc:
            return {
                "status": "error",
                "reason": _classify_provider_error(
                    str(provider.get("provider") or "openai"),
                    str(provider.get("model") or "(unset)"),
                    None,
                    str(exc),
                ),
                "run_dir": "",
            }

    def _mark_plan_step(self, attempt: Attempt, step_id: str, status: str, *, summary: str = "", error: str = "") -> None:
        now = datetime.now().isoformat()
        with self._state_lock:
            step = next((item for item in attempt.plan if item.get("step_id") == step_id), None)
            if step is None:
                return
            if status == "running" and not step.get("started_at"):
                step["started_at"] = now
            if status in {"completed", "failed", "blocked"}:
                step["completed_at"] = now
                if step.get("started_at"):
                    try:
                        step["elapsed_ms"] = int((datetime.fromisoformat(now) - datetime.fromisoformat(step["started_at"])).total_seconds() * 1000)
                    except ValueError:
                        pass
            step["status"] = status
            if summary:
                step["summary"] = summary
            if error:
                step["error"] = error
            attempt.current_step_id = step_id
            self.store.update_attempt(attempt)
            self.event_bus.emit(attempt.session_id, f"step.{status}", {"attempt_id": attempt.attempt_id, "step": step})
            self.event_bus.emit(attempt.session_id, "plan.updated", {"attempt_id": attempt.attempt_id, "steps": attempt.plan})
            self._save_snapshot(attempt)

    async def _run_with_agent(
        self,
        attempt: Attempt,
        messages: list = None,
        *,
        include_shell_tools: bool = False,
        session_config: Optional[Dict[str, Any]] = None,
        commercial_model_provider: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """Execute an attempt with the V5 AgentLoop.

        Args:
            attempt: Current execution attempt.
            messages: Session message history.
            include_shell_tools: Whether the registry may include shell tools.
            session_config: Optional session-level config overrides. MCP server
                definitions under the ``mcpServers`` key are merged on top of
                the user config file via ``load_runtime_agent_config`` so each
                session can extend or override the global MCP server list.

        Returns:
            Result dictionary containing status, run_dir, run_id, metrics, and related fields.
        """
        from src.tools import build_registry
        from src.providers.chat import ChatLLM
        from src.agent.loop import AgentLoop
        from src.memory.persistent import PersistentMemory, commercial_memory_directory
        from src.config.loader import load_runtime_agent_config, sanitize_session_overrides

        model_provider = commercial_model_provider or (session_config or {}).get("commercial_model_provider")
        llm = ChatLLM(
            model_name=str(model_provider.get("model")) if isinstance(model_provider, dict) else None,
            provider=str(model_provider.get("provider")) if isinstance(model_provider, dict) else None,
            base_url=str(model_provider.get("base_url")) if isinstance(model_provider, dict) else None,
            api_key=(str(model_provider.get("api_key") or "") or None) if isinstance(model_provider, dict) else None,
            temperature=float(model_provider.get("temperature")) if isinstance(model_provider, dict) else None,
            timeout_seconds=int(model_provider.get("timeout_seconds")) if isinstance(model_provider, dict) else None,
            max_retries=int(model_provider.get("max_retries")) if isinstance(model_provider, dict) else None,
        )
        commercial_principal = (session_config or {}).get("commercial_principal")
        if isinstance(commercial_principal, dict):
            organization_id = str(commercial_principal.get("organization_id") or "").strip()
            user_id = str(commercial_principal.get("user_id") or "").strip()
            if organization_id and user_id:
                # Queue delay must not allow a task accepted earlier to bypass
                # an organization hard limit reached by concurrent work.
                from src.commercial.store import CommercialStore, Principal

                CommercialStore().assert_model_usage_available(Principal(
                    user_id=user_id,
                    organization_id=organization_id,
                    email=str(commercial_principal.get("email") or ""),
                    role=str(commercial_principal.get("role") or "member"),
                ))
                pm = PersistentMemory(memory_dir=commercial_memory_directory(organization_id, user_id))
            else:
                pm = PersistentMemory()
        else:
            pm = PersistentMemory()

        session_id = attempt.session_id
        attempt_id = attempt.attempt_id
        loop = asyncio.get_running_loop()

        safe_overrides = sanitize_session_overrides(session_config) if session_config else session_config
        agent_config = load_runtime_agent_config(overrides=safe_overrides)

        def event_callback(event_type: str, data: Dict[str, Any]) -> None:
            """Forward AgentLoop events to the SSE event bus."""
            data["attempt_id"] = attempt_id
            self.event_bus.emit(session_id, event_type, data)
            if event_type == "tool_call":
                step_id = f"tool-{data.get('call_id') or len(attempt.plan) + 1}"
                if not any(item.get("step_id") == step_id for item in attempt.plan):
                    now = datetime.now().isoformat()
                    attempt.plan.append({
                        "step_id": step_id,
                        "title": str(data.get("tool") or "Tool call"),
                        "type": "tool",
                        "status": "running",
                        "dependencies": [attempt.current_step_id] if attempt.current_step_id else [],
                        "tool_names": [str(data.get("tool") or "")],
                        "started_at": now,
                        "completed_at": None,
                        "elapsed_ms": None,
                        "summary": "",
                        "error": "",
                        "created_at": now,
                    })
                    attempt.current_step_id = step_id
                    self.store.update_attempt(attempt)
                    self.event_bus.emit(session_id, "step.started", {"attempt_id": attempt_id, "step": attempt.plan[-1]})
                    self._save_snapshot(attempt)
            elif event_type == "tool_result":
                call_id = str(data.get("call_id") or data.get("tool_call_id") or "")
                step_id = f"tool-{call_id}" if call_id else attempt.current_step_id or ""
                if step_id:
                    self._mark_plan_step(
                        attempt,
                        step_id,
                        "completed" if data.get("status") == "ok" else "failed",
                        summary=str(data.get("preview") or "")[:500],
                        error="" if data.get("status") == "ok" else str(data.get("preview") or "tool failed")[:500],
                    )

        def _mcp_collision_warn(msg: str) -> None:
            """Forward MCP server-name collision warnings to the operator event channel."""
            self.event_bus.emit(session_id, "mcp.warning", {"attempt_id": attempt_id, "message": msg})

        registry = await loop.run_in_executor(
            _AGENT_EXECUTOR,
            lambda: build_registry(
                persistent_memory=pm,
                include_shell_tools=include_shell_tools,
                agent_config=agent_config,
                session_id=session_id,
                event_callback=event_callback,
                warn_callback=_mcp_collision_warn,
                commercial_model_provider=model_provider if isinstance(model_provider, dict) else None,
                execution_context={
                    "session_id": session_id,
                    "attempt_id": attempt_id,
                    "commercial_principal": dict(session_config.get("commercial_principal") or {}),
                } if isinstance(session_config.get("commercial_principal"), dict) else {
                    "session_id": session_id,
                    "attempt_id": attempt_id,
                },
            ),
        )

        def approval_callback(payload: Dict[str, Any]) -> None:
            principal = session_config.get("commercial_principal") if isinstance(session_config, dict) else None
            principal = principal if isinstance(principal, dict) else {}
            requested = datetime.now(timezone.utc)
            approval = ApprovalRecord(
                session_id=session_id,
                attempt_id=attempt_id,
                organization_id=str(principal.get("organization_id") or "local"),
                user_id=str(principal.get("user_id") or "local"),
                step_id=attempt.current_step_id or "",
                tool_name=str(payload.get("tool") or ""),
                tool_signature=str(payload.get("tool_signature") or ""),
                risk_level=str(payload.get("risk_level") or "high"),
                input_summary=dict(payload.get("arguments") or {}),
                requested_at=requested.isoformat(),
                expires_at=(requested + timedelta(hours=24)).isoformat(),
            )
            self.store.create_approval(approval)
            payload["approval_id"] = approval.approval_id
            attempt.status = AttemptStatus.WAITING_APPROVAL
            self._save_snapshot(attempt)
            self.event_bus.emit(session_id, "approval.required", approval.to_dict())
            self._audit_approval(principal, approval)

        agent = AgentLoop(
            registry=registry,
            llm=llm,
            event_callback=event_callback,
            max_iterations=50,
            persistent_memory=pm,
            commercial_principal={
                **dict(session_config.get("commercial_principal") or {}),
                "session_id": session_id,
            } if isinstance(session_config.get("commercial_principal"), dict) else None,
            commercial_attempt_id=attempt_id,
            approved_tool_signatures=attempt.approved_tool_signatures,
            approval_callback=approval_callback,
        )
        self._active_loops[session_id] = agent

        # Build the message history context.
        history = self._convert_messages_to_history(messages) if messages else []
        history.extend(self._conversation_history_recall_messages(
            attempt.prompt,
            current_session_id=session_id,
        ))

        try:
            result = await loop.run_in_executor(
                _AGENT_EXECUTOR,
                lambda: agent.run(
                    user_message=attempt.prompt,
                    history=history,
                    session_id=session_id,
                ),
            )
        finally:
            self._active_loops.pop(session_id, None)

        # Load metrics from the run output when available.
        if result.get("run_dir"):
            run_dir = Path(result["run_dir"])
            metrics = self._load_metrics(run_dir)
            if metrics:
                result["metrics"] = metrics
            self._record_commercial_llm_usage(
                run_dir,
                session_config=session_config or {},
                session_id=session_id,
                attempt_id=attempt_id,
            )

        return result

    @staticmethod
    def _record_commercial_llm_usage(
        run_dir: Path,
        *,
        session_config: Dict[str, Any],
        session_id: str,
        attempt_id: str,
    ) -> None:
        principal_payload = session_config.get("commercial_principal")
        if not isinstance(principal_payload, dict):
            return
        usage_path = run_dir / "llm_usage.json"
        if not usage_path.exists():
            return
        try:
            import json

            from src.commercial.store import CommercialStore, Principal

            summary = json.loads(usage_path.read_text(encoding="utf-8"))
            principal = Principal(
                user_id=str(principal_payload["user_id"]),
                organization_id=str(principal_payload["organization_id"]),
                email=str(principal_payload.get("email") or ""),
                role=str(principal_payload.get("role") or "member"),
            )
            CommercialStore().record_llm_usage_summary(
                principal,
                summary,
                provider_id=str((session_config.get("commercial_model_provider") or {}).get("provider_id") or ""),
                session_id=session_id,
                attempt_id=attempt_id,
                run_id=run_dir.name,
            )
        except Exception:
            # Usage accounting should never fail the completed research run.
            return

    @staticmethod
    def _convert_messages_to_history(messages: list) -> list[Dict[str, Any]]:
        """Convert Session messages into OpenAI-format history.

        Keeps the readable ``[prev_run: {run_id}]`` marker instead of removing it
        completely, and trims by character budget instead of a hard six-message cap
        so the LLM can still see previous artifact paths and strategy content during
        iterative updates.

        Args:
            messages: Session message list without the current turn.

        Returns:
            OpenAI-format messages trimmed from the newest items within the token budget.
        """
        import re
        from pathlib import Path

        def _shorten_run_dir(match: re.Match) -> str:
            path_str = match.group(0).replace("Run directory:", "").strip()
            run_id = Path(path_str).name if path_str else ""
            return f"[prev_run: {run_id}]" if run_id else ""

        history = []
        for msg in messages[:-1]:
            role = msg.role if hasattr(msg, "role") else msg.get("role", "user")
            content = msg.content if hasattr(msg, "content") else msg.get("content", "")
            if not content.strip() or role not in ("user", "assistant"):
                continue
            content = re.sub(r"Run directory:\s*\S+", _shorten_run_dir, content).strip()
            if content:
                history.append({"role": role, "content": content})

        # Trim from the newest messages within a character budget of roughly 3000 tokens.
        MAX_HISTORY_CHARS = 12000
        total_chars = 0
        trimmed: list = []
        for msg in reversed(history):
            msg_len = len(msg.get("content", ""))
            if total_chars + msg_len > MAX_HISTORY_CHARS:
                break
            trimmed.append(msg)
            total_chars += msg_len
        return list(reversed(trimmed))

    @staticmethod
    def _load_metrics(run_dir: Path) -> Optional[Dict[str, Any]]:
        """Load metrics.csv from a run directory."""
        import csv
        metrics_path = run_dir / "artifacts" / "metrics.csv"
        if not metrics_path.exists():
            return None
        try:
            with open(metrics_path, "r", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
                if rows:
                    return {k: float(v) for k, v in rows[0].items() if v}
        except Exception:
            pass
        return None

    @staticmethod
    def _format_result_message(attempt: Attempt) -> str:
        """Format the final execution result message."""
        if attempt.status == AttemptStatus.COMPLETED:
            return attempt.summary or "Strategy execution completed."
        return f"Execution failed: {attempt.error or 'unknown error'}"


def generate_short_session_title(content: str, max_chars: int = _SESSION_TITLE_MAX_CHARS) -> str:
    """Generate a compact sidebar title from user input."""
    cleaned = _normalize_title_source(content)
    if not cleaned:
        return ""

    tickers = [
        item.upper()
        for item in re.findall(r"(?<!\d)\d{6}\.(?:SZ|SH|BJ)(?![A-Z0-9])|\b[A-Z]{1,6}(?:\.[A-Z]{1,4})?\b", cleaned, flags=re.IGNORECASE)
        if item.upper() not in _TITLE_TICKER_STOPWORDS
    ]
    if tickers:
        first = tickers[0]
        if len(tickers) > 1:
            return _clip_title(f"{first}等标的分析", max_chars)
        return _clip_title(f"{first}分析", max_chars)

    topic_rules = [
        (("回测", "backtest"), "策略回测"),
        (("量化", "策略", "因子", "alpha"), "量化策略研究"),
        (("研报", "财报", "估值", "基本面"), "基本面研究"),
        (("RAG", "知识库", "文档", "PDF"), "知识库问答"),
        (("模型", "provider", "LLM"), "模型配置"),
        (("IM", "通道", "Telegram", "Slack"), "IM通道配置"),
    ]
    lowered = cleaned.lower()
    for keywords, title in topic_rules:
        if any(str(keyword).lower() in lowered for keyword in keywords):
            return title

    sentence = re.split(r"[。！？!?；;\n\r]", cleaned, maxsplit=1)[0]
    sentence = re.sub(r"^(请帮我分析一下|请帮我做|请帮我|帮我分析一下|帮我做|分析一下|看一下|帮我|请|用|基于)\s*", "", sentence).strip()
    return _clip_title(sentence or cleaned, max_chars)


def _normalize_title_source(content: str) -> str:
    cleaned = content.strip()
    cleaned = re.sub(r"\[Uploaded file:[^\]]+\]", "文档", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[Swarm Team Mode\][\s\S]*?\n\n", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"```[\s\S]*?```", " ", cleaned)
    cleaned = re.sub(r"[#>*_`~]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" -:：,，")


def _clip_title(title: str, max_chars: int) -> str:
    compact = re.sub(r"\s+", " ", title).strip(" -:：,，")
    if len(compact) <= max_chars:
        return compact
    return compact[:max_chars].rstrip(" -:：,，")
