"""PostgreSQL primary repository for commercial identity and authorization.

The commercial platform is being migrated in bounded domains.  Identity data
must move first because it is the security boundary for every tenant resource.
This repository owns organizations, users, memberships, browser sessions, and
platform-administrator grants when ``HYPER_TRADING_COMMERCIAL_IDENTITY_STORAGE``
is set to ``postgres-primary``.  The existing SQLite store is mirrored during
the staged migration so non-migrated domains retain backward compatibility.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Mapping


POSTGRES_PRIMARY = "postgres-primary"


def primary_identity_storage_enabled() -> bool:
    """Return whether the deployment explicitly selects PostgreSQL identity."""
    configured = os.getenv("HYPER_TRADING_COMMERCIAL_IDENTITY_STORAGE", "").strip().lower()
    return configured == POSTGRES_PRIMARY


def primary_identity_dsn() -> str:
    """Return the dedicated identity DSN, falling back to the application DSN."""
    return (
        os.getenv("HYPER_TRADING_COMMERCIAL_PG_DSN", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
    )


def _plain_row(row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    normalized: dict[str, Any] = {}
    for key, value in dict(row).items():
        normalized[str(key)] = value.isoformat() if isinstance(value, datetime) else value
    return normalized


class PostgresIdentityRepository:
    """Tenant identity and session repository backed by PostgreSQL.

    The caller controls when this repository is active.  It intentionally
    raises on database failure: falling back to a local identity store in a
    declared production-primary deployment would silently weaken the boundary.
    """

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn.strip()
        if not self.dsn:
            raise RuntimeError("PostgreSQL identity storage requires DATABASE_URL")

    @classmethod
    def from_environment(cls) -> "PostgresIdentityRepository | None":
        if not primary_identity_storage_enabled():
            return None
        return cls(primary_identity_dsn())

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:  # pragma: no cover - production dependency
            raise RuntimeError("PostgreSQL identity storage requires psycopg") from exc
        return psycopg.connect(self.dsn, row_factory=dict_row)

    def ensure_available(self) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM organizations LIMIT 1")

    def needs_initial_sync(self) -> bool:
        """Return true only when an upgraded PostgreSQL database is empty."""
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM organizations LIMIT 1")
            return cursor.fetchone() is None

    def sync_from_sqlite(self, sqlite_connection: Any) -> None:
        """Mirror existing identity records before PostgreSQL becomes primary.

        The operation is idempotent and only covers the identity domain.  It is
        deliberately invoked synchronously by the application so an upgraded
        deployment can keep existing browser sessions and users without a
        manual one-off script.
        """
        sources = {
            "organizations": [dict(row) for row in sqlite_connection.execute(
                "SELECT id, name, is_active, created_at FROM organizations"
            ).fetchall()],
            "users": [dict(row) for row in sqlite_connection.execute(
                "SELECT id, email, password_hash, display_name, is_active, created_at FROM users"
            ).fetchall()],
            "memberships": [dict(row) for row in sqlite_connection.execute(
                "SELECT organization_id, user_id, role, created_at FROM memberships"
            ).fetchall()],
            "platform_admins": [dict(row) for row in sqlite_connection.execute(
                "SELECT user_id, created_at, created_by_user_id FROM platform_admins"
            ).fetchall()],
            "auth_sessions": [dict(row) for row in sqlite_connection.execute(
                "SELECT token_hash, user_id, organization_id, expires_at, created_at FROM auth_sessions"
            ).fetchall()],
        }
        with self._connect() as connection, connection.cursor() as cursor:
            for row in sources["organizations"]:
                cursor.execute(
                    """
                    INSERT INTO organizations(id, name, is_active, created_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        is_active = EXCLUDED.is_active
                    """,
                    (row["id"], row["name"], bool(row["is_active"]), row["created_at"]),
                )
            for row in sources["users"]:
                cursor.execute(
                    """
                    INSERT INTO users(id, email, password_hash, display_name, is_active, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        email = EXCLUDED.email,
                        password_hash = EXCLUDED.password_hash,
                        display_name = EXCLUDED.display_name,
                        is_active = EXCLUDED.is_active
                    """,
                    (
                        row["id"], row["email"], row["password_hash"], row["display_name"],
                        bool(row["is_active"]), row["created_at"],
                    ),
                )
            for row in sources["memberships"]:
                cursor.execute(
                    """
                    INSERT INTO memberships(organization_id, user_id, role, created_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
                    """,
                    (row["organization_id"], row["user_id"], row["role"], row["created_at"]),
                )
            for row in sources["platform_admins"]:
                cursor.execute(
                    """
                    INSERT INTO platform_admins(user_id, created_at, created_by_user_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id) DO NOTHING
                    """,
                    (row["user_id"], row["created_at"], row["created_by_user_id"]),
                )
            for row in sources["auth_sessions"]:
                cursor.execute(
                    """
                    INSERT INTO auth_sessions(token_hash, user_id, organization_id, expires_at, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (token_hash) DO UPDATE SET
                        user_id = EXCLUDED.user_id,
                        organization_id = EXCLUDED.organization_id,
                        expires_at = EXCLUDED.expires_at
                    """,
                    (
                        row["token_hash"], row["user_id"], row["organization_id"],
                        row["expires_at"], row["created_at"],
                    ),
                )

    def login_candidate(self, email: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT u.id AS user_id, u.email, u.password_hash, u.is_active AS user_active,
                       m.organization_id, m.role, o.is_active AS organization_active
                FROM users u
                JOIN memberships m ON m.user_id = u.id
                JOIN organizations o ON o.id = m.organization_id
                WHERE u.email = %s
                ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END
                LIMIT 1
                """,
                (email,),
            )
            return _plain_row(cursor.fetchone())

    def create_session(
        self,
        *,
        token_hash: str,
        user_id: str,
        organization_id: str,
        expires_at: str,
        created_at: str,
    ) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO auth_sessions(token_hash, user_id, organization_id, expires_at, created_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (token_hash) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    organization_id = EXCLUDED.organization_id,
                    expires_at = EXCLUDED.expires_at
                """,
                (token_hash, user_id, organization_id, expires_at, created_at),
            )

    def principal_from_token(self, token_hash: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT u.id AS user_id, u.email,
                       m.organization_id, m.role,
                       EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id) AS is_platform_admin
                FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                JOIN memberships m ON m.organization_id = s.organization_id AND m.user_id = s.user_id
                JOIN organizations o ON o.id = m.organization_id
                WHERE s.token_hash = %s
                  AND s.expires_at > now()
                  AND u.is_active = true
                  AND o.is_active = true
                """,
                (token_hash,),
            )
            return _plain_row(cursor.fetchone())

    def delete_session(self, token_hash: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM auth_sessions WHERE token_hash = %s", (token_hash,))

    def delete_sessions_for_member(self, *, organization_id: str, user_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM auth_sessions WHERE organization_id = %s AND user_id = %s",
                (organization_id, user_id),
            )

    def delete_sessions_for_user(self, user_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM auth_sessions WHERE user_id = %s", (user_id,))

    def delete_sessions_for_organization(self, organization_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM auth_sessions WHERE organization_id = %s", (organization_id,))

    def delete_membership(self, *, organization_id: str, user_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM memberships WHERE organization_id = %s AND user_id = %s",
                (organization_id, user_id),
            )
            cursor.execute(
                "DELETE FROM auth_sessions WHERE organization_id = %s AND user_id = %s",
                (organization_id, user_id),
            )

    def is_platform_admin(self, user_id: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM platform_admins WHERE user_id = %s", (user_id,))
            return cursor.fetchone() is not None

    def upsert_platform_admin(self, *, user_id: str, created_at: str, created_by_user_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO platform_admins(user_id, created_at, created_by_user_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_id, created_at, created_by_user_id),
            )

    def delete_platform_admin(self, user_id: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM platform_admins WHERE user_id = %s", (user_id,))

    def current_organization(self, organization_id: str) -> dict[str, Any]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id, name, created_at FROM organizations WHERE id = %s", (organization_id,))
            return _plain_row(cursor.fetchone()) or {}

    def list_user_organizations(self, *, user_id: str, current_organization_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT o.id, o.name, o.is_active, o.created_at, m.role, m.created_at AS membership_created_at
                FROM memberships m
                JOIN organizations o ON o.id = m.organization_id
                WHERE m.user_id = %s AND o.is_active = true
                ORDER BY CASE m.organization_id WHEN %s THEN 0 ELSE 1 END, lower(o.name) ASC
                """,
                (user_id, current_organization_id),
            )
            return [_plain_row(row) or {} for row in cursor.fetchall()]

    def membership(self, *, user_id: str, organization_id: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT m.organization_id, m.role, o.is_active AS organization_active, u.is_active AS user_active
                FROM memberships m
                JOIN organizations o ON o.id = m.organization_id
                JOIN users u ON u.id = m.user_id
                WHERE m.user_id = %s AND m.organization_id = %s
                """,
                (user_id, organization_id),
            )
            return _plain_row(cursor.fetchone())

    def expire_sessions(self) -> int:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM auth_sessions WHERE expires_at < now()")
            return max(0, int(cursor.rowcount or 0))

    def status(self) -> dict[str, Any]:
        """Return non-secret primary identity storage status for operators."""
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    (SELECT count(*) FROM organizations) AS organizations,
                    (SELECT count(*) FROM organizations WHERE is_active = true) AS active_organizations,
                    (SELECT count(*) FROM users) AS users,
                    (SELECT count(*) FROM users WHERE is_active = true) AS active_users,
                    (SELECT count(*) FROM memberships) AS memberships,
                    (SELECT count(*) FROM auth_sessions) AS auth_sessions,
                    (SELECT count(*) FROM platform_admins) AS platform_admins
                """
            )
            row = _plain_row(cursor.fetchone()) or {}
        return {key: int(value or 0) for key, value in row.items()}

    def database_status(self) -> dict[str, Any]:
        """Return non-secret PostgreSQL health and core table counts."""
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    current_database() AS database_name,
                    current_setting('server_version') AS server_version,
                    pg_database_size(current_database()) AS database_bytes,
                    (SELECT count(*) FROM users) AS users,
                    (SELECT count(*) FROM organizations) AS organizations,
                    (SELECT count(*) FROM knowledge_bases) AS knowledge_bases,
                    (SELECT count(*) FROM knowledge_documents) AS knowledge_documents,
                    (SELECT count(*) FROM knowledge_chunks) AS knowledge_chunks,
                    (SELECT count(*) FROM workspace_artifacts) AS workspace_artifacts,
                    (SELECT count(*) FROM audit_logs) AS audit_logs
                """
            )
            row = _plain_row(cursor.fetchone()) or {}
        counts = {
            key: int(row.get(key) or 0)
            for key in (
                "users",
                "organizations",
                "knowledge_bases",
                "knowledge_documents",
                "knowledge_chunks",
                "workspace_artifacts",
                "audit_logs",
            )
        }
        return {
            "engine": "postgresql",
            "database_name": str(row.get("database_name") or ""),
            "server_version": str(row.get("server_version") or ""),
            "database_bytes": int(row.get("database_bytes") or 0),
            "table_counts": counts,
        }

    def list_platform_users(self, *, query: str = "", limit: int = 100) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if query.strip():
            clauses.append("(u.email ILIKE %s OR u.display_name ILIKE %s)")
            term = f"%{query.strip()}%"
            params.extend([term, term])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT u.id AS user_id, u.email, u.display_name, u.is_active, u.created_at,
                       COUNT(DISTINCT m.organization_id) AS organization_count,
                       COALESCE(string_agg(DISTINCT o.name, ' | '), '') AS organization_names,
                       EXISTS(SELECT 1 FROM platform_admins pa WHERE pa.user_id = u.id) AS is_platform_admin
                FROM users u
                LEFT JOIN memberships m ON m.user_id = u.id
                LEFT JOIN organizations o ON o.id = m.organization_id
                {where}
                GROUP BY u.id, u.email, u.display_name, u.is_active, u.created_at
                ORDER BY u.created_at DESC
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        return [_plain_row(row) or {} for row in rows]

    def list_platform_organizations(self, *, query: str = "", limit: int = 100) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if query.strip():
            clauses.append("o.name ILIKE %s")
            params.append(f"%{query.strip()}%")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT o.id, o.name, o.is_active, o.created_at,
                       COUNT(DISTINCT m.user_id) AS member_count,
                       COUNT(DISTINCT kb.id) AS knowledge_base_count,
                       COUNT(DISTINCT mp.id) AS model_provider_count
                FROM organizations o
                LEFT JOIN memberships m ON m.organization_id = o.id
                LEFT JOIN knowledge_bases kb ON kb.organization_id = o.id
                LEFT JOIN model_providers mp ON mp.organization_id = o.id
                {where}
                GROUP BY o.id, o.name, o.is_active, o.created_at
                ORDER BY o.created_at DESC
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        return [_plain_row(row) or {} for row in rows]
