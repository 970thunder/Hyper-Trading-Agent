"""Policy controls for persistent memory writes and recall."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

from src.memory.persistent import MEMORY_TYPES


_DEFAULT_SENSITIVE_PATTERNS = (
    r"\bsk-[A-Za-z0-9_-]{12,}\b",
    r"\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S+",
    r"\bAKIA[0-9A-Z]{16}\b",
    r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
)


@dataclass(frozen=True)
class MemoryPolicy:
    """Runtime policy for what the agent may persist and recall.

    The default is intentionally conservative: auto-recall is enabled for
    non-sensitive operational memory, but writes containing keys, tokens,
    passwords, or private keys are blocked before they reach disk.
    """

    auto_recall_enabled: bool = True
    writable_types: frozenset[str] = field(default_factory=lambda: frozenset(MEMORY_TYPES))
    recall_types: frozenset[str] = field(default_factory=lambda: frozenset(MEMORY_TYPES))
    block_sensitive_writes: bool = True
    sensitive_patterns: tuple[str, ...] = _DEFAULT_SENSITIVE_PATTERNS

    def can_write_type(self, memory_type: str) -> bool:
        """Return whether this memory type may be written."""
        return memory_type in self.writable_types

    def can_recall_type(self, memory_type: str) -> bool:
        """Return whether this memory type may be recalled."""
        return memory_type in self.recall_types

    def validate_write(self, title: str, content: str, memory_type: str) -> tuple[bool, str | None]:
        """Validate a proposed memory write.

        Returns:
            ``(True, None)`` when the write is allowed, otherwise
            ``(False, reason)`` with a user-safe explanation.
        """
        if not self.can_write_type(memory_type):
            return False, f"memory type '{memory_type}' is not allowed by policy"
        if self.block_sensitive_writes and self.contains_sensitive_content(f"{title}\n{content}"):
            return False, "sensitive content blocked by memory policy"
        return True, None

    def filter_recall_types(self, memory_types: Iterable[str] | None = None) -> set[str]:
        """Return recall types allowed by policy and an optional caller filter."""
        requested = set(memory_types) if memory_types is not None else set(self.recall_types)
        return {memory_type for memory_type in requested if self.can_recall_type(memory_type)}

    def contains_sensitive_content(self, text: str) -> bool:
        """Detect common secret-bearing content that should not be remembered."""
        return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in self.sensitive_patterns)
