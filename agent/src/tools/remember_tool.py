"""Remember tool: LLM-initiated persistent memory operations (save / recall / forget)."""

from __future__ import annotations

import json
from typing import Any

from src.agent.tools import BaseTool
from src.memory.persistent import MEMORY_TYPES, PersistentMemory
from src.memory.policy import MemoryPolicy


class RememberTool(BaseTool):
    """Save, recall, or forget cross-session memories.

    Memories persist to ~/.vibe-trading/memory/ and survive across sessions.
    """

    name = "remember"
    description = (
        "Persistent cross-session memory. "
        "save: store user preferences, strategy insights, or project context. "
        "recall: search past memories by keyword. "
        "forget: remove a memory by title."
    )
    is_readonly = False
    parameters = {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["save", "recall", "forget"],
                "description": "save | recall | forget",
            },
            "title": {
                "type": "string",
                "description": "Memory title (for save/forget)",
            },
            "content": {
                "type": "string",
                "description": "Memory content (for save)",
            },
            "memory_type": {
                "type": "string",
                "enum": ["user", "feedback", "project", "reference"],
                "description": "Memory category (default: project)",
            },
            "query": {
                "type": "string",
                "description": "Search query (for recall)",
            },
        },
        "required": ["action"],
    }
    repeatable = True

    def __init__(self, memory: PersistentMemory | None = None, policy: MemoryPolicy | None = None) -> None:
        """Initialize RememberTool.

        Args:
            memory: PersistentMemory instance (auto-created if omitted).
            policy: MemoryPolicy instance (default policy if omitted).
        """
        self._memory = memory or PersistentMemory()
        self._policy = policy or MemoryPolicy()

    def execute(self, **kwargs: Any) -> str:
        """Execute a memory action.

        Args:
            **kwargs: Must include action; other params depend on action.

        Returns:
            JSON result string.
        """
        action = kwargs.get("action", "save")

        if action == "save":
            return self._save(kwargs)
        if action == "recall":
            return self._recall(kwargs)
        if action == "forget":
            return self._forget(kwargs)
        return json.dumps({"status": "error", "error": f"Unknown action: {action}"})

    def _save(self, kwargs: dict) -> str:
        title = kwargs.get("title", "")
        content = kwargs.get("content", "")
        if not title or not content:
            return json.dumps({"status": "error", "error": "title and content required"})
        memory_type = kwargs.get("memory_type", "project")
        if memory_type not in MEMORY_TYPES:
            allowed = ", ".join(MEMORY_TYPES)
            return json.dumps({"status": "error", "error": f"memory_type must be one of: {allowed}"})
        allowed, reason = self._policy.validate_write(title, content, memory_type)
        if not allowed:
            return json.dumps({"status": "blocked", "error": reason})
        try:
            path = self._memory.add(title, content, memory_type, description=title)
        except ValueError as exc:
            return json.dumps({"status": "error", "error": str(exc)})
        return json.dumps({"status": "ok", "message": f"Saved: {title}", "path": str(path)})

    def _recall(self, kwargs: dict) -> str:
        query = kwargs.get("query", "")
        if not query:
            return json.dumps({"status": "error", "error": "query required"})
        memory_type = kwargs.get("memory_type")
        recall_types = self._policy.filter_recall_types({memory_type} if memory_type else None)
        entries = self._memory.find_relevant(query, memory_types=recall_types)
        results = [
            {"title": e.title, "type": e.memory_type, "content": e.body[:2000]}
            for e in entries
        ]
        return json.dumps({"status": "ok", "count": len(results), "memories": results}, ensure_ascii=False)

    def _forget(self, kwargs: dict) -> str:
        title = kwargs.get("title", "")
        if not title:
            return json.dumps({"status": "error", "error": "title required"})
        removed = self._memory.remove(title)
        msg = f"Removed: {title}" if removed else f"Not found: {title}"
        return json.dumps({"status": "ok" if removed else "not_found", "message": msg})
