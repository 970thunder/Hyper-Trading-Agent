"""Vector storage adapters for commercial RAG.

The local commercial MVP still writes chunks to SQLite + FTS. This module
creates the runtime boundary needed for the production pgvector path so status,
bootstrap SQL, and future read/write methods live behind one adapter contract.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol


SQLITE_VECTOR_STORAGE = "sqlite-fts-local"
PGVECTOR_STORAGE = "postgres-pgvector"
DEFAULT_PGVECTOR_DIMENSIONS = 1536


class VectorStoreAdapter(Protocol):
    """Runtime contract shared by local and pgvector vector storage."""

    name: str

    def status(self) -> dict[str, object]:
        """Return user-safe runtime status for settings and diagnostics."""

    def bootstrap_sql(self) -> str:
        """Return SQL required to initialize the storage backend."""


def _configured_storage() -> str:
    return (
        os.getenv("HYPER_TRADING_VECTOR_STORAGE", "")
        or os.getenv("VIBE_TRADING_VECTOR_STORAGE", "")
        or SQLITE_VECTOR_STORAGE
    ).strip() or SQLITE_VECTOR_STORAGE


def _pgvector_dsn() -> str:
    return (
        os.getenv("HYPER_TRADING_PGVECTOR_DSN", "")
        or os.getenv("DATABASE_URL", "")
    ).strip()


def _pgvector_dimensions() -> int:
    raw = os.getenv("HYPER_TRADING_PGVECTOR_DIMENSIONS", "").strip()
    if not raw:
        return DEFAULT_PGVECTOR_DIMENSIONS
    try:
        return max(8, int(raw))
    except ValueError:
        return DEFAULT_PGVECTOR_DIMENSIONS


@dataclass(frozen=True)
class SQLiteFtsVectorStoreAdapter:
    """Local SQLite/FTS vector fallback used for development and tests."""

    configured: str = SQLITE_VECTOR_STORAGE
    fallback_reason: str = ""
    name: str = SQLITE_VECTOR_STORAGE

    def status(self) -> dict[str, object]:
        return {
            "active": self.name,
            "configured": self.configured,
            "available": True,
            "pgvector_configured": bool(_pgvector_dsn()),
            "dimensions": 0,
            "fallback_reason": self.fallback_reason,
        }

    def bootstrap_sql(self) -> str:
        return ""


@dataclass(frozen=True)
class PgvectorVectorStoreAdapter:
    """PostgreSQL + pgvector storage adapter descriptor."""

    dsn: str
    dimensions: int = DEFAULT_PGVECTOR_DIMENSIONS
    configured: str = PGVECTOR_STORAGE
    name: str = PGVECTOR_STORAGE

    def status(self) -> dict[str, object]:
        return {
            "active": self.name,
            "configured": self.configured,
            "available": True,
            "pgvector_configured": bool(self.dsn),
            "dimensions": self.dimensions,
            "fallback_reason": "",
        }

    def bootstrap_sql(self) -> str:
        return f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE knowledge_chunks
    ADD COLUMN IF NOT EXISTS embedding vector({self.dimensions});

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_vector
    ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_text_trgm
    ON knowledge_chunks USING gin (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_scope
    ON knowledge_chunks (organization_id, knowledge_base_id, document_id);
""".strip()


def build_vector_store_adapter() -> VectorStoreAdapter:
    """Select the active vector storage adapter from environment config."""
    configured = _configured_storage()
    if configured == PGVECTOR_STORAGE:
        dsn = _pgvector_dsn()
        if dsn:
            return PgvectorVectorStoreAdapter(dsn=dsn, dimensions=_pgvector_dimensions())
        return SQLiteFtsVectorStoreAdapter(
            configured=configured,
            fallback_reason="Postgres pgvector DSN is not configured",
        )
    return SQLiteFtsVectorStoreAdapter(configured=configured)
