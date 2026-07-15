"""PostgreSQL primary repository for tenant workspace ownership metadata."""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Mapping


POSTGRES_PRIMARY = "postgres-primary"
_DOMAIN_MARKER = "workspace-v1"


def primary_workspace_storage_enabled() -> bool:
    return os.getenv("HYPER_TRADING_COMMERCIAL_WORKSPACE_STORAGE", "").strip().lower() == POSTGRES_PRIMARY


def primary_workspace_dsn() -> str:
    return (
        os.getenv("HYPER_TRADING_COMMERCIAL_WORKSPACE_PG_DSN", "").strip()
        or os.getenv("HYPER_TRADING_COMMERCIAL_PG_DSN", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
    )


def _row(value: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return {
        str(key): item.isoformat() if isinstance(item, datetime) else item
        for key, item in dict(value).items()
    }


def _metadata(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return dict(parsed) if isinstance(parsed, dict) else {}


class PostgresWorkspaceRepository:
    """Durable tenant ownership records used to guard filesystem resources."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn.strip()
        if not self.dsn:
            raise RuntimeError("PostgreSQL workspace storage requires DATABASE_URL")

    @classmethod
    def from_environment(cls) -> "PostgresWorkspaceRepository | None":
        if not primary_workspace_storage_enabled():
            return None
        return cls(primary_workspace_dsn())

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:  # pragma: no cover - production dependency
            raise RuntimeError("PostgreSQL workspace storage requires psycopg") from exc
        return psycopg.connect(self.dsn, row_factory=dict_row)

    def ensure_available(self) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM commercial_repository_migrations LIMIT 1")
            cursor.execute("SELECT 1 FROM workspace_sessions LIMIT 1")
            cursor.execute("SELECT 1 FROM workspace_runs LIMIT 1")
            cursor.execute("SELECT 1 FROM workspace_artifacts LIMIT 1")
            cursor.execute("SELECT 1 FROM uploaded_files LIMIT 1")

    def needs_initial_sync(self) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM commercial_repository_migrations WHERE domain = %s", (_DOMAIN_MARKER,))
            return cursor.fetchone() is None

    def sync_from_sqlite(self, sqlite_connection: Any) -> None:
        sources = {
            "workspace_sessions": [dict(row) for row in sqlite_connection.execute("SELECT * FROM workspace_sessions").fetchall()],
            "workspace_runs": [dict(row) for row in sqlite_connection.execute("SELECT * FROM workspace_runs").fetchall()],
            "workspace_artifacts": [dict(row) for row in sqlite_connection.execute("SELECT * FROM workspace_artifacts").fetchall()],
            "uploaded_files": [dict(row) for row in sqlite_connection.execute("SELECT * FROM uploaded_files").fetchall()],
        }
        with self._connect() as connection, connection.cursor() as cursor:
            for item in sources["workspace_sessions"]:
                cursor.execute(
                    """
                    INSERT INTO workspace_sessions(session_id, organization_id, created_by_user_id, created_at)
                    VALUES (%s, %s, %s, %s) ON CONFLICT (session_id) DO NOTHING
                    """,
                    (item["session_id"], item["organization_id"], item["created_by_user_id"], item["created_at"]),
                )
            for item in sources["workspace_runs"]:
                cursor.execute(
                    """
                    INSERT INTO workspace_runs(run_id, organization_id, session_id, attempt_id, created_by_user_id, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (run_id) DO NOTHING
                    """,
                    (item["run_id"], item["organization_id"], item.get("session_id", ""), item.get("attempt_id", ""), item["created_by_user_id"], item["created_at"]),
                )
            for item in sources["workspace_artifacts"]:
                cursor.execute(
                    """
                    INSERT INTO workspace_artifacts(
                        artifact_type, artifact_id, organization_id, session_id, attempt_id, created_by_user_id,
                        storage_path, metadata_json, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    ON CONFLICT (artifact_type, artifact_id) DO NOTHING
                    """,
                    (
                        item["artifact_type"], item["artifact_id"], item["organization_id"], item.get("session_id", ""),
                        item.get("attempt_id", ""), item["created_by_user_id"], item.get("storage_path", ""),
                        item.get("metadata_json", "{}"), item["created_at"], item["updated_at"],
                    ),
                )
            for item in sources["uploaded_files"]:
                cursor.execute(
                    """
                    INSERT INTO uploaded_files(storage_key, organization_id, uploaded_by_user_id, original_filename, size_bytes, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (storage_key) DO NOTHING
                    """,
                    (item["storage_key"], item["organization_id"], item["uploaded_by_user_id"], item["original_filename"], item.get("size_bytes", 0), item["created_at"]),
                )
            cursor.execute(
                """
                INSERT INTO commercial_repository_migrations(domain, details_json)
                VALUES (%s, %s::jsonb) ON CONFLICT (domain) DO NOTHING
                """,
                (_DOMAIN_MARKER, json.dumps({"source": "sqlite", "tables": sorted(sources)})),
            )

    def bind_session(self, *, session_id: str, organization_id: str, user_id: str, now: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT organization_id FROM workspace_sessions WHERE session_id = %s", (session_id,))
            existing = _row(cursor.fetchone())
            if existing is not None and str(existing["organization_id"]) != organization_id:
                raise ValueError("session is already bound to another organization")
            cursor.execute(
                """
                INSERT INTO workspace_sessions(session_id, organization_id, created_by_user_id, created_at)
                VALUES (%s, %s, %s, %s) ON CONFLICT (session_id) DO NOTHING
                """,
                (session_id, organization_id, user_id, now),
            )

    def session_belongs_to_organization(self, organization_id: str, session_id: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM workspace_sessions WHERE session_id = %s AND organization_id = %s", (session_id, organization_id))
            return cursor.fetchone() is not None

    def list_session_ids(self, organization_id: str, limit: int) -> set[str]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT session_id FROM workspace_sessions WHERE organization_id = %s ORDER BY created_at DESC LIMIT %s",
                (organization_id, max(1, min(limit, 1000))),
            )
            rows = cursor.fetchall()
        return {str(row["session_id"]) for row in rows}

    def delete_session(self, organization_id: str, session_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM workspace_sessions WHERE session_id = %s AND organization_id = %s", (session_id, organization_id))

    def bind_run(self, *, run_id: str, organization_id: str, user_id: str, session_id: str, attempt_id: str, now: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT organization_id FROM workspace_runs WHERE run_id = %s", (run_id,))
            existing = _row(cursor.fetchone())
            if existing is not None and str(existing["organization_id"]) != organization_id:
                raise ValueError("run is already bound to another organization")
            cursor.execute(
                """
                INSERT INTO workspace_runs(run_id, organization_id, session_id, attempt_id, created_by_user_id, created_at)
                VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (run_id) DO NOTHING
                """,
                (run_id, organization_id, session_id, attempt_id, user_id, now),
            )

    def run_belongs_to_organization(self, organization_id: str, run_id: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM workspace_runs WHERE run_id = %s AND organization_id = %s", (run_id, organization_id))
            return cursor.fetchone() is not None

    def list_run_ids(self, organization_id: str, limit: int) -> set[str]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT run_id FROM workspace_runs WHERE organization_id = %s ORDER BY created_at DESC LIMIT %s",
                (organization_id, max(1, min(limit, 1000))),
            )
            rows = cursor.fetchall()
        return {str(row["run_id"]) for row in rows}

    def bind_artifact(
        self, *, artifact_type: str, artifact_id: str, organization_id: str, user_id: str,
        session_id: str, attempt_id: str, storage_path: str, metadata: dict[str, Any], now: str,
    ) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT organization_id FROM workspace_artifacts WHERE artifact_type = %s AND artifact_id = %s",
                (artifact_type, artifact_id),
            )
            existing = _row(cursor.fetchone())
            if existing is not None and str(existing["organization_id"]) != organization_id:
                raise ValueError("artifact is already bound to another organization")
            cursor.execute(
                """
                INSERT INTO workspace_artifacts(
                    artifact_type, artifact_id, organization_id, session_id, attempt_id, created_by_user_id,
                    storage_path, metadata_json, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                ON CONFLICT (artifact_type, artifact_id) DO UPDATE SET
                    session_id = EXCLUDED.session_id, attempt_id = EXCLUDED.attempt_id,
                    storage_path = EXCLUDED.storage_path, metadata_json = EXCLUDED.metadata_json,
                    updated_at = EXCLUDED.updated_at
                """,
                (artifact_type, artifact_id, organization_id, session_id, attempt_id, user_id, storage_path, json.dumps(metadata, ensure_ascii=False, default=str), now, now),
            )

    def artifact_belongs_to_organization(self, organization_id: str, artifact_type: str, artifact_id: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM workspace_artifacts WHERE artifact_type = %s AND artifact_id = %s AND organization_id = %s",
                (artifact_type, artifact_id, organization_id),
            )
            return cursor.fetchone() is not None

    def list_artifact_ids(self, organization_id: str, artifact_type: str, limit: int) -> set[str]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT artifact_id FROM workspace_artifacts
                WHERE organization_id = %s AND artifact_type = %s ORDER BY updated_at DESC LIMIT %s
                """,
                (organization_id, artifact_type, max(1, min(limit, 1000))),
            )
            rows = cursor.fetchall()
        return {str(row["artifact_id"]) for row in rows}

    def register_uploaded_file(
        self, *, storage_key: str, organization_id: str, user_id: str, original_filename: str, size_bytes: int, now: str,
    ) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO uploaded_files(storage_key, organization_id, uploaded_by_user_id, original_filename, size_bytes, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (storage_key) DO UPDATE SET
                    organization_id = EXCLUDED.organization_id, uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
                    original_filename = EXCLUDED.original_filename, size_bytes = EXCLUDED.size_bytes
                """,
                (storage_key, organization_id, user_id, original_filename[:500], max(0, int(size_bytes)), now),
            )

    def uploaded_file_belongs_to_organization(self, organization_id: str, storage_key: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM uploaded_files WHERE storage_key = %s AND organization_id = %s", (storage_key, organization_id))
            return cursor.fetchone() is not None

    def list_platform_artifacts(self, *, artifact_type: str, organization_id: str, limit: int) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if artifact_type.strip():
            clauses.append("a.artifact_type = %s")
            params.append(artifact_type.strip().lower())
        if organization_id.strip():
            clauses.append("a.organization_id = %s")
            params.append(organization_id.strip())
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT a.artifact_type, a.artifact_id, a.organization_id, a.session_id, a.attempt_id,
                       a.storage_path, a.metadata_json, a.created_at, a.updated_at,
                       o.name AS organization_name, u.email AS created_by_email
                FROM workspace_artifacts a
                LEFT JOIN organizations o ON o.id = a.organization_id
                LEFT JOIN users u ON u.id = a.created_by_user_id
                {where}
                ORDER BY a.updated_at DESC, a.created_at DESC LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            item = _row(row) or {}
            item["metadata"] = _metadata(item.pop("metadata_json", None))
            result.append(item)
        return result

    def status(self) -> dict[str, int]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM workspace_sessions) AS workspace_sessions,
                    (SELECT COUNT(*) FROM workspace_runs) AS workspace_runs,
                    (SELECT COUNT(*) FROM workspace_artifacts) AS workspace_artifacts,
                    (SELECT COUNT(*) FROM uploaded_files) AS uploaded_files
                """
            )
            row = _row(cursor.fetchone()) or {}
        return {key: int(value or 0) for key, value in row.items()}
