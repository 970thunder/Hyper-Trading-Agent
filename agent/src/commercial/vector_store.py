"""Runtime vector-storage adapters for commercial RAG.

SQLite remains the compatibility fallback for metadata and local development.
When production pgvector is configured, this module stores tenant-scoped chunk
vectors in PostgreSQL and queries them directly without exposing credentials to
the API surface.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import Any, Mapping, Protocol


SQLITE_VECTOR_STORAGE = "sqlite-fts-local"
PGVECTOR_STORAGE = "postgres-pgvector"
DEFAULT_PGVECTOR_DIMENSIONS = 1024


class VectorStoreAdapter(Protocol):
    """Runtime contract shared by local and pgvector vector storage."""

    name: str

    def status(self) -> dict[str, object]:
        """Return user-safe runtime status for settings and diagnostics."""

    def bootstrap_sql(self) -> str:
        """Return SQL required to initialize the storage backend."""

    def replace_document_chunks(
        self,
        *,
        organization_id: str,
        knowledge_base_id: str,
        document_id: str,
        chunks: list[Mapping[str, Any]],
    ) -> dict[str, Any]:
        """Replace all stored vectors for one document."""

    def delete_document(self, *, organization_id: str, knowledge_base_id: str, document_id: str) -> dict[str, Any]:
        """Remove vectors for one document."""

    def search(
        self,
        *,
        organization_id: str,
        knowledge_base_id: str,
        embedding: list[float],
        embedding_source: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Return cosine-ranked vectors in a tenant-scoped knowledge base."""


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


def _driver_available() -> bool:
    try:
        import psycopg  # noqa: F401
    except Exception:
        return False
    return True


def _vector_literal(values: list[float]) -> str:
    normalized: list[str] = []
    for value in values:
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("embedding contains a non-finite value")
        normalized.append(format(number, ".10g"))
    return "[" + ",".join(normalized) + "]"


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

    def replace_document_chunks(self, **_kwargs: Any) -> dict[str, Any]:
        return {"status": "skipped", "written": 0, "reason": "SQLite vector fallback is active"}

    def delete_document(self, **_kwargs: Any) -> dict[str, Any]:
        return {"status": "skipped", "deleted": 0, "reason": "SQLite vector fallback is active"}

    def search(self, **_kwargs: Any) -> list[dict[str, Any]]:
        return []


@dataclass(frozen=True)
class PgvectorVectorStoreAdapter:
    """PostgreSQL + pgvector storage adapter descriptor."""

    dsn: str
    dimensions: int = DEFAULT_PGVECTOR_DIMENSIONS
    configured: str = PGVECTOR_STORAGE
    name: str = PGVECTOR_STORAGE

    def status(self) -> dict[str, object]:
        driver_available = _driver_available()
        return {
            "active": self.name,
            "configured": self.configured,
            "available": driver_available,
            "pgvector_configured": bool(self.dsn),
            "dimensions": self.dimensions,
            "fallback_reason": "" if driver_available else "psycopg is not installed",
        }

    def bootstrap_sql(self) -> str:
        return f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS rag_vector_chunks (
    chunk_id text PRIMARY KEY,
    organization_id text NOT NULL,
    knowledge_base_id text NOT NULL,
    document_id text NOT NULL,
    title text NOT NULL DEFAULT '',
    source_uri text NOT NULL DEFAULT '',
    text text NOT NULL,
    embedding vector NOT NULL,
    embedding_source text NOT NULL DEFAULT '',
    embedding_dimensions integer NOT NULL,
    metadata_json jsonb NOT NULL DEFAULT '{{}}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rag_vector_chunks_scope
    ON rag_vector_chunks (organization_id, knowledge_base_id, document_id, updated_at DESC);
""".strip()

    def _connect(self):
        import psycopg

        return psycopg.connect(self.dsn, autocommit=True)

    def _available_result(self, *, operation: str) -> dict[str, Any] | None:
        if _driver_available():
            return None
        return {"status": "skipped", "written": 0, "deleted": 0, "reason": f"psycopg is not installed for {operation}"}

    def replace_document_chunks(
        self,
        *,
        organization_id: str,
        knowledge_base_id: str,
        document_id: str,
        chunks: list[Mapping[str, Any]],
    ) -> dict[str, Any]:
        unavailable = self._available_result(operation="pgvector write")
        if unavailable is not None:
            return unavailable
        accepted: list[tuple[Any, ...]] = []
        skipped = 0
        for chunk in chunks:
            embedding = list(chunk.get("embedding") or [])
            if len(embedding) != self.dimensions:
                skipped += 1
                continue
            accepted.append(
                (
                    str(chunk.get("chunk_id") or ""),
                    organization_id,
                    knowledge_base_id,
                    document_id,
                    str(chunk.get("title") or ""),
                    str(chunk.get("source_uri") or ""),
                    str(chunk.get("text") or ""),
                    _vector_literal([float(value) for value in embedding]),
                    str(chunk.get("embedding_source") or ""),
                    self.dimensions,
                    json.dumps(dict(chunk.get("metadata") or {}), ensure_ascii=False),
                )
            )
        try:
            with self._connect() as conn, conn.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM rag_vector_chunks WHERE organization_id = %s AND knowledge_base_id = %s AND document_id = %s",
                    (organization_id, knowledge_base_id, document_id),
                )
                if accepted:
                    cursor.executemany(
                        """
                        INSERT INTO rag_vector_chunks(
                            chunk_id, organization_id, knowledge_base_id, document_id, title, source_uri,
                            text, embedding, embedding_source, embedding_dimensions, metadata_json, created_at, updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector, %s, %s, %s::jsonb, now(), now())
                        ON CONFLICT (chunk_id) DO UPDATE SET
                            organization_id = EXCLUDED.organization_id,
                            knowledge_base_id = EXCLUDED.knowledge_base_id,
                            document_id = EXCLUDED.document_id,
                            title = EXCLUDED.title,
                            source_uri = EXCLUDED.source_uri,
                            text = EXCLUDED.text,
                            embedding = EXCLUDED.embedding,
                            embedding_source = EXCLUDED.embedding_source,
                            embedding_dimensions = EXCLUDED.embedding_dimensions,
                            metadata_json = EXCLUDED.metadata_json,
                            updated_at = now()
                        """,
                        accepted,
                    )
        except Exception as exc:  # noqa: BLE001 - SQLite remains the durable fallback
            return {"status": "failed", "written": 0, "skipped": skipped, "reason": f"pgvector write failed: {type(exc).__name__}"}
        reason = "" if not skipped else f"{skipped} chunks did not match configured dimension {self.dimensions}"
        return {"status": "stored", "written": len(accepted), "skipped": skipped, "reason": reason}

    def delete_document(self, *, organization_id: str, knowledge_base_id: str, document_id: str) -> dict[str, Any]:
        unavailable = self._available_result(operation="pgvector delete")
        if unavailable is not None:
            return unavailable
        try:
            with self._connect() as conn, conn.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM rag_vector_chunks WHERE organization_id = %s AND knowledge_base_id = %s AND document_id = %s",
                    (organization_id, knowledge_base_id, document_id),
                )
                deleted = max(0, int(cursor.rowcount or 0))
        except Exception as exc:  # noqa: BLE001 - deletion should not block SQLite cleanup
            return {"status": "failed", "deleted": 0, "reason": f"pgvector delete failed: {type(exc).__name__}"}
        return {"status": "deleted", "deleted": deleted, "reason": ""}

    def search(
        self,
        *,
        organization_id: str,
        knowledge_base_id: str,
        embedding: list[float],
        embedding_source: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        if not _driver_available() or len(embedding) != self.dimensions:
            return []
        try:
            vector = _vector_literal([float(value) for value in embedding])
            dimension = self.dimensions
            with self._connect() as conn, conn.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT chunk_id, document_id, title, source_uri, text, metadata_json,
                           1 - ((embedding::vector({dimension})) <=> %s::vector({dimension})) AS score
                    FROM rag_vector_chunks
                    WHERE organization_id = %s AND knowledge_base_id = %s
                      AND embedding_source = %s AND embedding_dimensions = %s
                    ORDER BY (embedding::vector({dimension})) <=> %s::vector({dimension})
                    LIMIT %s
                    """,
                    (vector, organization_id, knowledge_base_id, embedding_source, self.dimensions, vector, max(1, min(limit, 100))),
                )
                rows = cursor.fetchall()
        except Exception:
            return []
        results: list[dict[str, Any]] = []
        for row in rows:
            metadata = row[5]
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except json.JSONDecodeError:
                    metadata = {}
            results.append(
                {
                    "chunk_id": str(row[0]),
                    "document_id": str(row[1]),
                    "title": str(row[2]),
                    "source_uri": str(row[3]),
                    "text": str(row[4]),
                    "metadata": metadata if isinstance(metadata, dict) else {},
                    "score": max(0.0, float(row[6] or 0.0)),
                }
            )
        return results


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
