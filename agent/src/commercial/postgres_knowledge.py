"""PostgreSQL primary repository for the commercial knowledge lifecycle.

The repository keeps tenant-scoped knowledge-base metadata, documents, chunk
text, ingestion jobs, and retrieval logs in PostgreSQL.  Vector payloads stay
in the existing ``rag_vector_chunks`` adapter so embeddings with different
dimensions can coexist without coupling the lifecycle tables to one model.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Mapping


POSTGRES_PRIMARY = "postgres-primary"
_DOMAIN_MARKER = "knowledge-v1"
_UNSET = object()


def primary_knowledge_storage_enabled() -> bool:
    return os.getenv("HYPER_TRADING_COMMERCIAL_KNOWLEDGE_STORAGE", "").strip().lower() == POSTGRES_PRIMARY


def primary_knowledge_dsn() -> str:
    return (
        os.getenv("HYPER_TRADING_COMMERCIAL_KNOWLEDGE_PG_DSN", "").strip()
        or os.getenv("HYPER_TRADING_COMMERCIAL_PG_DSN", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
    )


def _plain(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _row(value: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return {str(key): _plain(item) for key, item in dict(value).items()}


def _json(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not value:
        return fallback
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback
    return parsed if isinstance(parsed, type(fallback)) else fallback


class PostgresKnowledgeRepository:
    """Production-primary persistence for tenant knowledge records."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn.strip()
        if not self.dsn:
            raise RuntimeError("PostgreSQL knowledge storage requires DATABASE_URL")

    @classmethod
    def from_environment(cls) -> "PostgresKnowledgeRepository | None":
        if not primary_knowledge_storage_enabled():
            return None
        return cls(primary_knowledge_dsn())

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:  # pragma: no cover - production dependency
            raise RuntimeError("PostgreSQL knowledge storage requires psycopg") from exc
        return psycopg.connect(self.dsn, row_factory=dict_row)

    def ensure_available(self) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM commercial_repository_migrations LIMIT 1")
            cursor.execute("SELECT 1 FROM knowledge_bases LIMIT 1")
            cursor.execute("SELECT 1 FROM knowledge_documents LIMIT 1")
            cursor.execute("SELECT 1 FROM knowledge_chunks LIMIT 1")
            cursor.execute("SELECT 1 FROM knowledge_ingestion_jobs LIMIT 1")
            cursor.execute("SELECT 1 FROM knowledge_evaluation_datasets LIMIT 1")
            cursor.execute("SELECT 1 FROM knowledge_evaluation_cases LIMIT 1")
            cursor.execute("SELECT 1 FROM knowledge_evaluation_runs LIMIT 1")

    def needs_initial_sync(self) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM commercial_repository_migrations WHERE domain = %s", (_DOMAIN_MARKER,))
            return cursor.fetchone() is None

    def sync_from_sqlite(self, sqlite_connection: Any) -> None:
        """Import the compatibility knowledge domain once, preserving IDs."""
        sources = {
            "knowledge_bases": [dict(row) for row in sqlite_connection.execute("SELECT * FROM knowledge_bases").fetchall()],
            "knowledge_documents": [dict(row) for row in sqlite_connection.execute("SELECT * FROM knowledge_documents").fetchall()],
            "knowledge_chunks": [dict(row) for row in sqlite_connection.execute("SELECT * FROM knowledge_chunks").fetchall()],
            "knowledge_ingestion_jobs": [dict(row) for row in sqlite_connection.execute("SELECT * FROM knowledge_ingestion_jobs").fetchall()],
            "knowledge_retrieval_logs": [dict(row) for row in sqlite_connection.execute("SELECT * FROM knowledge_retrieval_logs").fetchall()],
            "knowledge_evaluation_datasets": [dict(row) for row in sqlite_connection.execute("SELECT * FROM knowledge_evaluation_datasets").fetchall()],
            "knowledge_evaluation_cases": [dict(row) for row in sqlite_connection.execute("SELECT * FROM knowledge_evaluation_cases").fetchall()],
            "knowledge_evaluation_runs": [dict(row) for row in sqlite_connection.execute("SELECT * FROM knowledge_evaluation_runs").fetchall()],
        }
        with self._connect() as connection, connection.cursor() as cursor:
            for item in sources["knowledge_bases"]:
                cursor.execute(
                    """
                    INSERT INTO knowledge_bases(id, organization_id, name, description, config_json, access_json, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item["name"], item.get("description", ""),
                        item.get("config_json", "{}"), item.get("access_json", "{}"), item["created_at"], item["updated_at"],
                    ),
                )
            for item in sources["knowledge_documents"]:
                cursor.execute(
                    """
                    INSERT INTO knowledge_documents(
                        id, organization_id, knowledge_base_id, title, source_uri, source_type, source_hash,
                        status, chunk_count, metadata_json, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item["knowledge_base_id"], item["title"],
                        item["source_uri"], item["source_type"], item["source_hash"], item["status"],
                        item.get("chunk_count", 0), item.get("metadata_json", "{}"), item["created_at"], item["updated_at"],
                    ),
                )
            for item in sources["knowledge_chunks"]:
                cursor.execute(
                    """
                    INSERT INTO knowledge_chunks(
                        id, organization_id, knowledge_base_id, document_id, chunk_index, text, metadata_json, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item["knowledge_base_id"], item["document_id"],
                        item["chunk_index"], item["text"], item.get("metadata_json", "{}"), item["created_at"],
                    ),
                )
            for item in sources["knowledge_ingestion_jobs"]:
                document_id = str(item.get("document_id") or "") or None
                cursor.execute(
                    """
                    INSERT INTO knowledge_ingestion_jobs(
                        id, organization_id, knowledge_base_id, document_id, status, progress, error,
                        metadata_json, created_at, updated_at, started_at, completed_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, NULLIF(%s, '')::timestamptz, NULLIF(%s, '')::timestamptz)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item["knowledge_base_id"], document_id,
                        item["status"], item.get("progress", 0), item.get("error", ""), item.get("metadata_json", "{}"),
                        item["created_at"], item["updated_at"], item.get("started_at", ""), item.get("completed_at", ""),
                    ),
                )
            for item in sources["knowledge_retrieval_logs"]:
                cursor.execute(
                    """
                    INSERT INTO knowledge_retrieval_logs(id, organization_id, user_id, knowledge_base_id, query, result_count, created_at)
                    VALUES (%s, %s, NULLIF(%s, ''), NULLIF(%s, ''), %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item.get("user_id", ""),
                        item.get("knowledge_base_id", ""), item["query"], item.get("result_count", 0), item["created_at"],
                    ),
                )
            for item in sources["knowledge_evaluation_datasets"]:
                cursor.execute(
                    """
                    INSERT INTO knowledge_evaluation_datasets(
                        id, organization_id, knowledge_base_id, name, description, created_by_user_id, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item["knowledge_base_id"], item["name"],
                        item.get("description", ""), item["created_by_user_id"], item["created_at"], item["updated_at"],
                    ),
                )
            for item in sources["knowledge_evaluation_cases"]:
                cursor.execute(
                    """
                    INSERT INTO knowledge_evaluation_cases(
                        id, dataset_id, query, expected_document_ids_json, expected_chunk_ids_json, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["dataset_id"], item["query"],
                        item.get("expected_document_ids_json", "[]"), item.get("expected_chunk_ids_json", "[]"),
                        item["created_at"], item["updated_at"],
                    ),
                )
            for item in sources["knowledge_evaluation_runs"]:
                cursor.execute(
                    """
                    INSERT INTO knowledge_evaluation_runs(
                        id, organization_id, knowledge_base_id, dataset_id, created_by_user_id, top_k,
                        config_json, summary_json, results_json, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item["knowledge_base_id"], item["dataset_id"],
                        item["created_by_user_id"], item["top_k"], item.get("config_json", "{}"),
                        item.get("summary_json", "{}"), item.get("results_json", "[]"), item["created_at"],
                    ),
                )
            cursor.execute(
                """
                INSERT INTO commercial_repository_migrations(domain, details_json)
                VALUES (%s, %s::jsonb)
                ON CONFLICT (domain) DO NOTHING
                """,
                (_DOMAIN_MARKER, json.dumps({"source": "sqlite", "tables": sorted(sources)})),
            )

    # --- knowledge bases ---

    def list_knowledge_bases(self, organization_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, description, config_json, access_json, created_at, updated_at
                FROM knowledge_bases WHERE organization_id = %s ORDER BY updated_at DESC
                """,
                (organization_id,),
            )
            rows = cursor.fetchall()
        return [self._knowledge_base(row) for row in rows]

    def get_knowledge_base(self, organization_id: str, knowledge_base_id: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, description, config_json, access_json, created_at, updated_at
                FROM knowledge_bases WHERE id = %s AND organization_id = %s
                """,
                (knowledge_base_id, organization_id),
            )
            row = cursor.fetchone()
        return self._knowledge_base(row) if row is not None else None

    def create_knowledge_base(
        self, *, knowledge_base_id: str, organization_id: str, name: str, description: str,
        config: dict[str, Any], access: dict[str, Any], now: str,
    ) -> dict[str, Any]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO knowledge_bases(id, organization_id, name, description, config_json, access_json, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
                """,
                (knowledge_base_id, organization_id, name, description, json.dumps(config, ensure_ascii=False), json.dumps(access, ensure_ascii=False), now, now),
            )
        return self.get_knowledge_base(organization_id, knowledge_base_id) or {}

    def update_knowledge_base(
        self, *, organization_id: str, knowledge_base_id: str, name: str, description: str,
        config: dict[str, Any], access: dict[str, Any], now: str,
    ) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE knowledge_bases SET name = %s, description = %s, config_json = %s::jsonb,
                    access_json = %s::jsonb, updated_at = %s
                WHERE id = %s AND organization_id = %s
                """,
                (name, description, json.dumps(config, ensure_ascii=False), json.dumps(access, ensure_ascii=False), now, knowledge_base_id, organization_id),
            )
            return bool(cursor.rowcount)

    # --- ingestion jobs ---

    def create_job(
        self, *, job_id: str, organization_id: str, knowledge_base_id: str, document_id: str | None,
        status: str, progress: int, error: str, metadata: dict[str, Any], now: str,
    ) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO knowledge_ingestion_jobs(
                    id, organization_id, knowledge_base_id, document_id, status, progress, error,
                    metadata_json, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                """,
                (job_id, organization_id, knowledge_base_id, document_id, status, max(0, min(100, progress)), error[:2000], json.dumps(metadata, ensure_ascii=False), now, now),
            )

    def update_job(
        self, *, organization_id: str, knowledge_base_id: str, job_id: str,
        status: str | None = None, progress: int | None = None, error: str | None = None,
        metadata: dict[str, Any] | None = None, document_id: str | None | object = _UNSET,
        now: str, mark_started: bool = False, mark_completed: bool = False,
    ) -> bool:
        assignments: list[str] = ["updated_at = %s"]
        params: list[Any] = [now]
        if status is not None:
            assignments.append("status = %s")
            params.append(status)
        if progress is not None:
            assignments.append("progress = %s")
            params.append(max(0, min(100, int(progress))))
        if error is not None:
            assignments.append("error = %s")
            params.append(error[:2000])
        if metadata is not None:
            assignments.append("metadata_json = %s::jsonb")
            params.append(json.dumps(metadata, ensure_ascii=False))
        if document_id is not _UNSET:
            assignments.append("document_id = %s")
            params.append(document_id)
        if mark_started:
            assignments.append("started_at = COALESCE(started_at, %s::timestamptz)")
            params.append(now)
        if mark_completed:
            assignments.append("completed_at = %s::timestamptz")
            params.append(now)
        params.extend([job_id, organization_id, knowledge_base_id])
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"UPDATE knowledge_ingestion_jobs SET {', '.join(assignments)} WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s",
                tuple(params),
            )
            return bool(cursor.rowcount)

    def get_job(self, organization_id: str, knowledge_base_id: str, job_id: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, knowledge_base_id, COALESCE(document_id, '') AS document_id, status, progress, error,
                       metadata_json, created_at, updated_at, COALESCE(started_at::text, '') AS started_at,
                       COALESCE(completed_at::text, '') AS completed_at
                FROM knowledge_ingestion_jobs
                WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s
                """,
                (job_id, organization_id, knowledge_base_id),
            )
            row = cursor.fetchone()
        return self._job(row) if row is not None else None

    def list_jobs(self, organization_id: str, knowledge_base_id: str, limit: int) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, knowledge_base_id, COALESCE(document_id, '') AS document_id, status, progress, error,
                       metadata_json, created_at, updated_at, COALESCE(started_at::text, '') AS started_at,
                       COALESCE(completed_at::text, '') AS completed_at
                FROM knowledge_ingestion_jobs
                WHERE organization_id = %s AND knowledge_base_id = %s
                ORDER BY updated_at DESC LIMIT %s
                """,
                (organization_id, knowledge_base_id, max(1, min(limit, 200))),
            )
            rows = cursor.fetchall()
        return [self._job(row) for row in rows]

    # --- documents and chunks ---

    def replace_document_contents(
        self, *, organization_id: str, knowledge_base_id: str, document_id: str, job_id: str,
        title: str, source_uri: str, source_type: str, source_hash: str, document_metadata: dict[str, Any],
        chunks: list[dict[str, Any]], job_metadata: dict[str, Any], now: str,
    ) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO knowledge_documents(
                    id, organization_id, knowledge_base_id, title, source_uri, source_type, source_hash,
                    status, chunk_count, metadata_json, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'indexing', 0, %s::jsonb, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title, source_uri = EXCLUDED.source_uri, source_type = EXCLUDED.source_type,
                    source_hash = EXCLUDED.source_hash, status = 'indexing', chunk_count = 0,
                    metadata_json = EXCLUDED.metadata_json, updated_at = EXCLUDED.updated_at
                """,
                (document_id, organization_id, knowledge_base_id, title, source_uri, source_type, source_hash, json.dumps(document_metadata, ensure_ascii=False), now, now),
            )
            cursor.execute(
                "DELETE FROM knowledge_chunks WHERE organization_id = %s AND knowledge_base_id = %s AND document_id = %s",
                (organization_id, knowledge_base_id, document_id),
            )
            if chunks:
                cursor.executemany(
                    """
                    INSERT INTO knowledge_chunks(
                        id, organization_id, knowledge_base_id, document_id, chunk_index, text, metadata_json, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    """,
                    [
                        (
                            item["id"], organization_id, knowledge_base_id, document_id, item["chunk_index"],
                            item["text"], json.dumps(item.get("metadata") or {}, ensure_ascii=False), now,
                        )
                        for item in chunks
                    ],
                )
            cursor.execute(
                """
                UPDATE knowledge_documents SET status = 'ready', chunk_count = %s, updated_at = %s
                WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s
                """,
                (len(chunks), now, document_id, organization_id, knowledge_base_id),
            )
            cursor.execute(
                """
                UPDATE knowledge_ingestion_jobs
                SET document_id = %s, status = 'completed', progress = 100, error = '', metadata_json = %s::jsonb,
                    started_at = COALESCE(started_at, %s::timestamptz), completed_at = %s::timestamptz, updated_at = %s
                WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s
                """,
                (document_id, json.dumps(job_metadata, ensure_ascii=False), now, now, now, job_id, organization_id, knowledge_base_id),
            )
            cursor.execute(
                "UPDATE knowledge_bases SET updated_at = %s WHERE id = %s AND organization_id = %s",
                (now, knowledge_base_id, organization_id),
            )

    def document_for_reindex(self, organization_id: str, knowledge_base_id: str, document_id: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, title, source_uri, source_type, source_hash, metadata_json, created_at, updated_at
                FROM knowledge_documents
                WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s
                """,
                (document_id, organization_id, knowledge_base_id),
            )
            document = _row(cursor.fetchone())
            if document is None:
                return None
            cursor.execute(
                """
                SELECT text FROM knowledge_chunks
                WHERE organization_id = %s AND knowledge_base_id = %s AND document_id = %s
                ORDER BY chunk_index
                """,
                (organization_id, knowledge_base_id, document_id),
            )
            chunks = cursor.fetchall()
        document["metadata"] = _json(document.pop("metadata_json", None), {})
        document["text"] = "\n\n".join(str(row["text"]) for row in chunks)
        return document

    def list_documents(self, organization_id: str, knowledge_base_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT d.id, d.title, d.source_uri, d.source_type, d.status, d.chunk_count, d.metadata_json,
                       d.created_at, d.updated_at, j.id AS ingestion_job_id, j.status AS ingestion_status,
                       j.progress AS ingestion_progress, j.error AS ingestion_error,
                       COALESCE(j.started_at::text, '') AS ingestion_started_at,
                       COALESCE(j.completed_at::text, '') AS ingestion_completed_at
                FROM knowledge_documents d
                LEFT JOIN LATERAL (
                    SELECT id, status, progress, error, started_at, completed_at
                    FROM knowledge_ingestion_jobs
                    WHERE document_id = d.id AND organization_id = d.organization_id
                    ORDER BY updated_at DESC LIMIT 1
                ) j ON TRUE
                WHERE d.organization_id = %s AND d.knowledge_base_id = %s
                ORDER BY d.updated_at DESC
                """,
                (organization_id, knowledge_base_id),
            )
            rows = cursor.fetchall()
        documents: list[dict[str, Any]] = []
        for row in rows:
            item = _row(row) or {}
            item["metadata"] = _json(item.pop("metadata_json", None), {})
            documents.append(item)
        return documents

    def list_chunks(self, organization_id: str, knowledge_base_id: str, document_id: str, limit: int, offset: int) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, chunk_index, text, metadata_json, created_at
                FROM knowledge_chunks
                WHERE organization_id = %s AND knowledge_base_id = %s AND document_id = %s
                ORDER BY chunk_index LIMIT %s OFFSET %s
                """,
                (organization_id, knowledge_base_id, document_id, max(1, min(limit, 500)), max(0, offset)),
            )
            rows = cursor.fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            item = _row(row) or {}
            metadata = _json(item.pop("metadata_json", None), {})
            text = str(item.get("text") or "")
            result.append({
                **item,
                "character_count": len(text),
                "embedding_dimensions": int(metadata.get("embedding_dimensions") or 0),
                "embedding_source": str(metadata.get("embedding_source") or "unknown"),
                "embedding_fallback": bool(metadata.get("embedding_fallback", False)),
                "metadata": metadata,
            })
        return result

    def document_vectorization(self, organization_id: str, knowledge_base_id: str, document_id: str) -> dict[str, int]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS total_chunks,
                       COUNT(*) FILTER (WHERE COALESCE(metadata_json->>'embedding_dimensions', '') <> '') AS embedded_chunks
                FROM knowledge_chunks
                WHERE organization_id = %s AND knowledge_base_id = %s AND document_id = %s
                """,
                (organization_id, knowledge_base_id, document_id),
            )
            row = _row(cursor.fetchone()) or {}
        return {"total_chunks": int(row.get("total_chunks") or 0), "embedded_chunks": int(row.get("embedded_chunks") or 0)}

    def update_document_metadata(
        self,
        *,
        organization_id: str,
        knowledge_base_id: str,
        document_id: str,
        metadata: dict[str, Any],
        now: str,
    ) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE knowledge_documents SET metadata_json = %s::jsonb, updated_at = %s
                WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s
                """,
                (json.dumps(metadata, ensure_ascii=False), now, document_id, organization_id, knowledge_base_id),
            )
            return bool(cursor.rowcount)

    def delete_document(self, organization_id: str, knowledge_base_id: str, document_id: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM knowledge_documents WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s",
                (document_id, organization_id, knowledge_base_id),
            )
            return bool(cursor.rowcount)

    # --- retrieval evaluation datasets ---

    def list_evaluation_datasets(self, organization_id: str, knowledge_base_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT d.id, d.knowledge_base_id, d.name, d.description, d.created_at, d.updated_at,
                       COUNT(DISTINCT c.id) AS case_count,
                       MAX(r.created_at)::text AS latest_run_at
                FROM knowledge_evaluation_datasets d
                LEFT JOIN knowledge_evaluation_cases c ON c.dataset_id = d.id
                LEFT JOIN knowledge_evaluation_runs r ON r.dataset_id = d.id
                WHERE d.organization_id = %s AND d.knowledge_base_id = %s
                GROUP BY d.id
                ORDER BY d.updated_at DESC
                """,
                (organization_id, knowledge_base_id),
            )
            rows = cursor.fetchall()
        return [self._evaluation_dataset(row) for row in rows]

    def get_evaluation_dataset(self, organization_id: str, knowledge_base_id: str, dataset_id: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT d.id, d.knowledge_base_id, d.name, d.description, d.created_at, d.updated_at,
                       COUNT(DISTINCT c.id) AS case_count,
                       MAX(r.created_at)::text AS latest_run_at
                FROM knowledge_evaluation_datasets d
                LEFT JOIN knowledge_evaluation_cases c ON c.dataset_id = d.id
                LEFT JOIN knowledge_evaluation_runs r ON r.dataset_id = d.id
                WHERE d.id = %s AND d.organization_id = %s AND d.knowledge_base_id = %s
                GROUP BY d.id
                """,
                (dataset_id, organization_id, knowledge_base_id),
            )
            row = cursor.fetchone()
        return self._evaluation_dataset(row) if row is not None else None

    def create_evaluation_dataset(
        self,
        *,
        dataset_id: str,
        organization_id: str,
        knowledge_base_id: str,
        name: str,
        description: str,
        created_by_user_id: str,
        now: str,
    ) -> dict[str, Any]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO knowledge_evaluation_datasets(
                    id, organization_id, knowledge_base_id, name, description, created_by_user_id, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (dataset_id, organization_id, knowledge_base_id, name, description, created_by_user_id, now, now),
            )
        return self.get_evaluation_dataset(organization_id, knowledge_base_id, dataset_id) or {}

    def update_evaluation_dataset(
        self,
        *,
        organization_id: str,
        knowledge_base_id: str,
        dataset_id: str,
        name: str,
        description: str,
        now: str,
    ) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE knowledge_evaluation_datasets
                SET name = %s, description = %s, updated_at = %s
                WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s
                """,
                (name, description, now, dataset_id, organization_id, knowledge_base_id),
            )
            return bool(cursor.rowcount)

    def delete_evaluation_dataset(self, organization_id: str, knowledge_base_id: str, dataset_id: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM knowledge_evaluation_datasets WHERE id = %s AND organization_id = %s AND knowledge_base_id = %s",
                (dataset_id, organization_id, knowledge_base_id),
            )
            return bool(cursor.rowcount)

    def list_evaluation_cases(self, organization_id: str, knowledge_base_id: str, dataset_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT c.id, c.query, c.expected_document_ids_json, c.expected_chunk_ids_json, c.created_at, c.updated_at
                FROM knowledge_evaluation_cases c
                JOIN knowledge_evaluation_datasets d ON d.id = c.dataset_id
                WHERE c.dataset_id = %s AND d.organization_id = %s AND d.knowledge_base_id = %s
                ORDER BY c.created_at ASC
                """,
                (dataset_id, organization_id, knowledge_base_id),
            )
            rows = cursor.fetchall()
        return [self._evaluation_case(row) for row in rows]

    def evaluation_target_ids(
        self,
        organization_id: str,
        knowledge_base_id: str,
        document_ids: list[str],
        chunk_ids: list[str],
    ) -> tuple[set[str], set[str]]:
        matched_documents: set[str] = set()
        matched_chunks: set[str] = set()
        with self._connect() as connection, connection.cursor() as cursor:
            if document_ids:
                cursor.execute(
                    """
                    SELECT id FROM knowledge_documents
                    WHERE organization_id = %s AND knowledge_base_id = %s AND id = ANY(%s)
                    """,
                    (organization_id, knowledge_base_id, document_ids),
                )
                matched_documents = {str(row["id"]) for row in cursor.fetchall()}
            if chunk_ids:
                cursor.execute(
                    """
                    SELECT id FROM knowledge_chunks
                    WHERE organization_id = %s AND knowledge_base_id = %s AND id = ANY(%s)
                    """,
                    (organization_id, knowledge_base_id, chunk_ids),
                )
                matched_chunks = {str(row["id"]) for row in cursor.fetchall()}
        return matched_documents, matched_chunks

    def create_evaluation_case(
        self,
        *,
        case_id: str,
        dataset_id: str,
        query: str,
        expected_document_ids: list[str],
        expected_chunk_ids: list[str],
        now: str,
    ) -> dict[str, Any]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO knowledge_evaluation_cases(
                    id, dataset_id, query, expected_document_ids_json, expected_chunk_ids_json, created_at, updated_at
                ) VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
                """,
                (case_id, dataset_id, query, json.dumps(expected_document_ids), json.dumps(expected_chunk_ids), now, now),
            )
        return {
            "id": case_id,
            "query": query,
            "expected_document_ids": expected_document_ids,
            "expected_chunk_ids": expected_chunk_ids,
            "created_at": now,
            "updated_at": now,
        }

    def update_evaluation_case(
        self,
        *,
        organization_id: str,
        knowledge_base_id: str,
        dataset_id: str,
        case_id: str,
        query: str,
        expected_document_ids: list[str],
        expected_chunk_ids: list[str],
        now: str,
    ) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE knowledge_evaluation_cases c
                SET query = %s, expected_document_ids_json = %s::jsonb, expected_chunk_ids_json = %s::jsonb, updated_at = %s
                FROM knowledge_evaluation_datasets d
                WHERE c.id = %s AND c.dataset_id = %s AND d.id = c.dataset_id
                  AND d.organization_id = %s AND d.knowledge_base_id = %s
                """,
                (
                    query, json.dumps(expected_document_ids), json.dumps(expected_chunk_ids), now,
                    case_id, dataset_id, organization_id, knowledge_base_id,
                ),
            )
            return bool(cursor.rowcount)

    def delete_evaluation_case(
        self, organization_id: str, knowledge_base_id: str, dataset_id: str, case_id: str
    ) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM knowledge_evaluation_cases c
                USING knowledge_evaluation_datasets d
                WHERE c.id = %s AND c.dataset_id = %s AND d.id = c.dataset_id
                  AND d.organization_id = %s AND d.knowledge_base_id = %s
                """,
                (case_id, dataset_id, organization_id, knowledge_base_id),
            )
            return bool(cursor.rowcount)

    def create_evaluation_run(
        self,
        *,
        run_id: str,
        organization_id: str,
        knowledge_base_id: str,
        dataset_id: str,
        created_by_user_id: str,
        top_k: int,
        config: dict[str, Any],
        summary: dict[str, Any],
        results: list[dict[str, Any]],
        now: str,
    ) -> dict[str, Any]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO knowledge_evaluation_runs(
                    id, organization_id, knowledge_base_id, dataset_id, created_by_user_id, top_k,
                    config_json, summary_json, results_json, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s)
                """,
                (
                    run_id, organization_id, knowledge_base_id, dataset_id, created_by_user_id, top_k,
                    json.dumps(config, ensure_ascii=False), json.dumps(summary, ensure_ascii=False),
                    json.dumps(results, ensure_ascii=False), now,
                ),
            )
        return {
            "id": run_id,
            "dataset_id": dataset_id,
            "top_k": top_k,
            "config": config,
            "summary": summary,
            "results": results,
            "created_at": now,
        }

    def list_evaluation_runs(self, organization_id: str, knowledge_base_id: str, dataset_id: str, limit: int) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, dataset_id, top_k, config_json, summary_json, results_json, created_at
                FROM knowledge_evaluation_runs
                WHERE organization_id = %s AND knowledge_base_id = %s AND dataset_id = %s
                ORDER BY created_at DESC LIMIT %s
                """,
                (organization_id, knowledge_base_id, dataset_id, max(1, min(limit, 100))),
            )
            rows = cursor.fetchall()
        return [self._evaluation_run(row) for row in rows]

    # --- retrieval ---

    def lexical_search(self, organization_id: str, knowledge_base_id: str, query: str, limit: int) -> list[dict[str, Any]]:
        if not query.strip():
            return []
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT c.id AS chunk_id, c.document_id, d.title, d.source_uri, c.text,
                       ts_rank_cd(to_tsvector('simple', c.text), plainto_tsquery('simple', %s)) AS score
                FROM knowledge_chunks c
                JOIN knowledge_documents d ON d.id = c.document_id
                WHERE c.organization_id = %s AND c.knowledge_base_id = %s
                  AND to_tsvector('simple', c.text) @@ plainto_tsquery('simple', %s)
                ORDER BY score DESC, c.chunk_index ASC LIMIT %s
                """,
                (query, organization_id, knowledge_base_id, query, max(1, min(limit, 100))),
            )
            rows = cursor.fetchall()
        return [_row(row) or {} for row in rows]

    def log_retrieval(self, *, retrieval_id: str, organization_id: str, user_id: str, knowledge_base_id: str, query: str, result_count: int, now: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO knowledge_retrieval_logs(id, organization_id, user_id, knowledge_base_id, query, result_count, created_at)
                VALUES (%s, %s, NULLIF(%s, ''), %s, %s, %s, %s)
                """,
                (retrieval_id, organization_id, user_id, knowledge_base_id, query, max(0, result_count), now),
            )

    # --- platform administration ---

    def status(self) -> dict[str, int]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM knowledge_bases) AS knowledge_bases,
                    (SELECT COUNT(*) FROM knowledge_documents) AS knowledge_documents,
                    (SELECT COUNT(*) FROM knowledge_chunks) AS knowledge_chunks,
                    (SELECT COUNT(*) FROM knowledge_ingestion_jobs) AS ingestion_jobs,
                    (SELECT COUNT(*) FROM knowledge_ingestion_jobs WHERE status IN ('pending', 'running')) AS ingestion_jobs_active,
                    (SELECT COUNT(*) FROM knowledge_ingestion_jobs WHERE status = 'failed') AS ingestion_jobs_failed,
                    (SELECT COUNT(*) FROM knowledge_retrieval_logs) AS retrievals
                """
            )
            row = _row(cursor.fetchone()) or {}
        return {key: int(value or 0) for key, value in row.items()}

    def list_platform_knowledge_bases(self, query: str, limit: int) -> list[dict[str, Any]]:
        clauses = []
        params: list[Any] = []
        if query.strip():
            clauses.append("(kb.name ILIKE %s OR o.name ILIKE %s)")
            term = f"%{query.strip()}%"
            params.extend([term, term])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT kb.id, kb.organization_id, kb.name, kb.description, kb.created_at, kb.updated_at,
                       o.name AS organization_name, o.is_active AS organization_active,
                       COUNT(DISTINCT d.id) AS document_count, COALESCE(SUM(d.chunk_count), 0) AS chunk_count,
                       COUNT(DISTINCT j.id) AS ingestion_job_count,
                       COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'failed') AS failed_job_count
                FROM knowledge_bases kb
                JOIN organizations o ON o.id = kb.organization_id
                LEFT JOIN knowledge_documents d ON d.knowledge_base_id = kb.id
                LEFT JOIN knowledge_ingestion_jobs j ON j.knowledge_base_id = kb.id
                {where}
                GROUP BY kb.id, o.id
                ORDER BY kb.updated_at DESC LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        return [_row(row) or {} for row in rows]

    def list_platform_ingestion_jobs(self, job_status: str, limit: int) -> list[dict[str, Any]]:
        where = ""
        params: list[Any] = []
        if job_status.strip():
            where = "WHERE j.status = %s"
            params.append(job_status.strip().lower())
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT j.id, j.organization_id, j.knowledge_base_id, COALESCE(j.document_id, '') AS document_id,
                       j.status, j.progress, j.error, j.created_at, j.updated_at,
                       COALESCE(j.started_at::text, '') AS started_at, COALESCE(j.completed_at::text, '') AS completed_at,
                       o.name AS organization_name, kb.name AS knowledge_base_name, d.title AS document_title
                FROM knowledge_ingestion_jobs j
                LEFT JOIN organizations o ON o.id = j.organization_id
                LEFT JOIN knowledge_bases kb ON kb.id = j.knowledge_base_id
                LEFT JOIN knowledge_documents d ON d.id = j.document_id
                {where}
                ORDER BY j.updated_at DESC LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        return [_row(row) or {} for row in rows]

    def get_platform_ingestion_job(self, job_id: str) -> dict[str, Any] | None:
        """Load a job's tenant context for a Platform Admin action."""
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, organization_id, knowledge_base_id, COALESCE(document_id, '') AS document_id,
                       status, progress, error, metadata_json, created_at, updated_at,
                       COALESCE(started_at::text, '') AS started_at, COALESCE(completed_at::text, '') AS completed_at
                FROM knowledge_ingestion_jobs
                WHERE id = %s
                """,
                (job_id,),
            )
            row = cursor.fetchone()
        return self._job(row) if row is not None else None

    def delete_platform_knowledge_base(self, knowledge_base_id: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT organization_id, name FROM knowledge_bases WHERE id = %s", (knowledge_base_id,))
            row = _row(cursor.fetchone())
            if row is None:
                return None
            cursor.execute("SELECT id FROM knowledge_documents WHERE knowledge_base_id = %s", (knowledge_base_id,))
            document_ids = [str(item["id"]) for item in cursor.fetchall()]
            cursor.execute("DELETE FROM knowledge_bases WHERE id = %s", (knowledge_base_id,))
        return row | {"document_ids": document_ids}

    @staticmethod
    def _knowledge_base(row: Mapping[str, Any]) -> dict[str, Any]:
        # Keep the JSON columns in the same shape as the SQLite compatibility
        # repository; ``CommercialStore`` owns config and ACL normalization.
        return _row(row) or {}

    @staticmethod
    def _job(row: Mapping[str, Any]) -> dict[str, Any]:
        item = _row(row) or {}
        item["metadata"] = _json(item.pop("metadata_json", None), {})
        return item

    @staticmethod
    def _evaluation_dataset(row: Mapping[str, Any]) -> dict[str, Any]:
        item = _row(row) or {}
        item["case_count"] = int(item.get("case_count") or 0)
        item["latest_run_at"] = str(item.get("latest_run_at") or "")
        return item

    @staticmethod
    def _evaluation_case(row: Mapping[str, Any]) -> dict[str, Any]:
        item = _row(row) or {}
        item["expected_document_ids"] = [str(value) for value in _json(item.pop("expected_document_ids_json", None), [])]
        item["expected_chunk_ids"] = [str(value) for value in _json(item.pop("expected_chunk_ids_json", None), [])]
        return item

    @staticmethod
    def _evaluation_run(row: Mapping[str, Any]) -> dict[str, Any]:
        item = _row(row) or {}
        item["top_k"] = int(item.get("top_k") or 0)
        item["config"] = _json(item.pop("config_json", None), {})
        item["summary"] = _json(item.pop("summary_json", None), {})
        item["results"] = _json(item.pop("results_json", None), [])
        return item
