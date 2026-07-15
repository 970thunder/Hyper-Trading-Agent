"""PostgreSQL primary repository for commercial governance records.

Identity is already PostgreSQL-primary. This bounded repository moves the
governance data that must survive API/worker restarts and support the global
platform console: model providers, usage, quota alerts, tool policy overrides,
and audit records. SQLite remains available only for local development and for
domains that have not completed their own repository handoff yet.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Mapping


POSTGRES_PRIMARY = "postgres-primary"
_DOMAIN_MARKER = "governance-v1"


def primary_governance_storage_enabled() -> bool:
    return os.getenv("HYPER_TRADING_COMMERCIAL_GOVERNANCE_STORAGE", "").strip().lower() == POSTGRES_PRIMARY


def primary_governance_dsn() -> str:
    return (
        os.getenv("HYPER_TRADING_COMMERCIAL_GOVERNANCE_PG_DSN", "").strip()
        or os.getenv("HYPER_TRADING_COMMERCIAL_PG_DSN", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
    )


def _plain(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


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


class PostgresGovernanceRepository:
    """Production-primary governance persistence with explicit migration handoff."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn.strip()
        if not self.dsn:
            raise RuntimeError("PostgreSQL governance storage requires DATABASE_URL")

    @classmethod
    def from_environment(cls) -> "PostgresGovernanceRepository | None":
        if not primary_governance_storage_enabled():
            return None
        return cls(primary_governance_dsn())

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:  # pragma: no cover - production dependency
            raise RuntimeError("PostgreSQL governance storage requires psycopg") from exc
        return psycopg.connect(self.dsn, row_factory=dict_row)

    def ensure_available(self) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM commercial_repository_migrations LIMIT 1")
            cursor.execute("SELECT 1 FROM model_providers LIMIT 1")

    def needs_initial_sync(self) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM commercial_repository_migrations WHERE domain = %s", (_DOMAIN_MARKER,))
            return cursor.fetchone() is None

    def sync_from_sqlite(self, sqlite_connection: Any) -> None:
        """Copy the compatibility domain once without overwriting live Postgres data."""
        sources = {
            "model_providers": [dict(row) for row in sqlite_connection.execute("SELECT * FROM model_providers").fetchall()],
            "model_call_usage": [dict(row) for row in sqlite_connection.execute("SELECT * FROM model_call_usage").fetchall()],
            "organization_usage_policies": [dict(row) for row in sqlite_connection.execute("SELECT * FROM organization_usage_policies").fetchall()],
            "audit_logs": [dict(row) for row in sqlite_connection.execute("SELECT * FROM audit_logs").fetchall()],
            "tool_policies": [dict(row) for row in sqlite_connection.execute("SELECT * FROM tool_policies").fetchall()],
            "feedback_events": [dict(row) for row in sqlite_connection.execute("SELECT * FROM feedback_events").fetchall()],
            "usage_alert_events": [dict(row) for row in sqlite_connection.execute("SELECT * FROM usage_alert_events").fetchall()],
        }
        with self._connect() as connection, connection.cursor() as cursor:
            for item in sources["model_providers"]:
                cursor.execute(
                    """
                    INSERT INTO model_providers(
                        id, organization_id, provider, model, base_url, api_key_ciphertext, api_key_fingerprint,
                        temperature, timeout_seconds, max_retries, input_price_per_million,
                        output_price_per_million, enabled, is_default, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item["provider"], item["model"], item["base_url"],
                        item.get("api_key_ciphertext", ""), item.get("api_key_fingerprint", ""),
                        item.get("temperature", 0), item.get("timeout_seconds", 120), item.get("max_retries", 2),
                        item.get("input_price_per_million", 0), item.get("output_price_per_million", 0),
                        bool(item.get("enabled", 1)), bool(item.get("is_default", 0)), item["created_at"], item["updated_at"],
                    ),
                )
            for item in sources["organization_usage_policies"]:
                cursor.execute(
                    """
                    INSERT INTO organization_usage_policies(
                        organization_id, monthly_token_soft_limit, monthly_token_hard_limit,
                        monthly_cost_soft_limit, monthly_cost_hard_limit, updated_by_user_id, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (organization_id) DO NOTHING
                    """,
                    (
                        item["organization_id"], item.get("monthly_token_soft_limit", 0), item.get("monthly_token_hard_limit", 0),
                        item.get("monthly_cost_soft_limit", 0), item.get("monthly_cost_hard_limit", 0),
                        item.get("updated_by_user_id", ""), item["created_at"], item["updated_at"],
                    ),
                )
            for item in sources["tool_policies"]:
                cursor.execute(
                    """
                    INSERT INTO tool_policies(organization_id, tool_name, risk_level, permission_scope, requires_approval, enabled, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (organization_id, tool_name) DO NOTHING
                    """,
                    (item["organization_id"], item["tool_name"], item["risk_level"], item["permission_scope"], bool(item.get("requires_approval", 0)), bool(item.get("enabled", 1)), item["updated_at"]),
                )
            for item in sources["model_call_usage"]:
                cursor.execute(
                    """
                    INSERT INTO model_call_usage(
                        id, organization_id, provider_id, provider, model, prompt_tokens, completion_tokens,
                        total_tokens, latency_ms, estimated_cost, session_id, attempt_id, run_id, metadata_json, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (
                        item["id"], item["organization_id"], item.get("provider_id") or None, item["provider"], item["model"],
                        item.get("prompt_tokens", 0), item.get("completion_tokens", 0), item.get("total_tokens", 0),
                        item.get("latency_ms", 0), item.get("estimated_cost", 0), item.get("session_id", ""),
                        item.get("attempt_id", ""), item.get("run_id", ""), item.get("metadata_json", "{}"), item["created_at"],
                    ),
                )
            for item in sources["audit_logs"]:
                if not item.get("organization_id"):
                    continue
                cursor.execute(
                    """
                    INSERT INTO audit_logs(id, organization_id, user_id, action, target_type, target_id, metadata_json, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (item["id"], item["organization_id"], item.get("user_id") or None, item["action"], item.get("target_type", ""), item.get("target_id", ""), item.get("metadata_json", "{}"), item["created_at"]),
                )
            for item in sources["feedback_events"]:
                cursor.execute(
                    """
                    INSERT INTO feedback_events(
                        id, organization_id, user_id, target_type, target_id, session_id, attempt_id, run_id,
                        rating, comment, tags_json, metadata_json, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (item["id"], item["organization_id"], item["user_id"], item["target_type"], item["target_id"], item.get("session_id", ""), item.get("attempt_id", ""), item.get("run_id", ""), item["rating"], item.get("comment", ""), item.get("tags_json", "[]"), item.get("metadata_json", "{}"), item["created_at"]),
                )
            for item in sources["usage_alert_events"]:
                cursor.execute(
                    """
                    INSERT INTO usage_alert_events(
                        id, organization_id, period_start, alert_type, status, metadata_json,
                        created_at, acknowledged_at, acknowledged_by_user_id
                    ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, NULLIF(%s, ''), NULLIF(%s, ''))
                    ON CONFLICT (organization_id, period_start, alert_type) DO NOTHING
                    """,
                    (item["id"], item["organization_id"], item["period_start"], item["alert_type"], item.get("status", "open"), item.get("metadata_json", "{}"), item["created_at"], item.get("acknowledged_at", ""), item.get("acknowledged_by_user_id", "")),
                )
            cursor.execute(
                """
                INSERT INTO commercial_repository_migrations(domain, details_json)
                VALUES (%s, %s::jsonb)
                ON CONFLICT (domain) DO NOTHING
                """,
                (_DOMAIN_MARKER, json.dumps({"source": "sqlite", "tables": sorted(sources)})),
            )

    def audit(self, *, audit_id: str, organization_id: str, user_id: str, action: str, target_type: str, target_id: str, metadata: dict[str, Any], created_at: str) -> None:
        if not organization_id:
            return
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO audit_logs(id, organization_id, user_id, action, target_type, target_id, metadata_json, created_at)
                VALUES (%s, %s, NULLIF(%s, ''), %s, %s, %s, %s::jsonb, %s)
                """,
                (audit_id, organization_id, user_id, action, target_type, target_id, json.dumps(metadata, ensure_ascii=False), created_at),
            )

    def list_audit_logs(self, *, organization_id: str, limit: int, action: str = "", target_type: str = "", user_id: str = "", date_from: str = "", date_to: str = "") -> list[dict[str, Any]]:
        where = ["organization_id = %s"]
        params: list[Any] = [organization_id]
        if action:
            where.append("action ILIKE %s")
            params.append(f"%{action}%")
        if target_type:
            where.append("target_type = %s")
            params.append(target_type)
        if user_id:
            where.append("user_id = %s")
            params.append(user_id)
        if date_from:
            where.append("created_at >= %s")
            params.append(date_from)
        if date_to:
            where.append("created_at <= %s")
            params.append(date_to)
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT id, action, target_type, target_id, metadata_json, user_id, created_at
                FROM audit_logs WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        return [(_row(row) or {}) | {"metadata": _json((_row(row) or {}).get("metadata_json"), {})} for row in rows]

    def list_tool_policy_overrides(self, organization_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT tool_name, risk_level, permission_scope, requires_approval, enabled, updated_at FROM tool_policies WHERE organization_id = %s", (organization_id,))
            rows = cursor.fetchall()
        return [_row(row) or {} for row in rows]

    def upsert_tool_policy(self, *, organization_id: str, tool_name: str, risk_level: str, permission_scope: str, requires_approval: bool, enabled: bool, updated_at: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO tool_policies(organization_id, tool_name, risk_level, permission_scope, requires_approval, enabled, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (organization_id, tool_name) DO UPDATE SET
                    risk_level = EXCLUDED.risk_level, permission_scope = EXCLUDED.permission_scope,
                    requires_approval = EXCLUDED.requires_approval, enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at
                """,
                (organization_id, tool_name, risk_level, permission_scope, requires_approval, enabled, updated_at),
            )

    def list_model_providers(self, organization_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, provider, model, base_url, api_key_fingerprint, temperature, timeout_seconds,
                       max_retries, input_price_per_million, output_price_per_million,
                       enabled, is_default, created_at, updated_at
                FROM model_providers WHERE organization_id = %s
                ORDER BY is_default DESC, updated_at DESC
                """,
                (organization_id,),
            )
            rows = cursor.fetchall()
        providers: list[dict[str, Any]] = []
        for raw in rows:
            item = _row(raw) or {}
            item["enabled"] = bool(item.get("enabled"))
            item["is_default"] = bool(item.get("is_default"))
            item["api_key_configured"] = bool(item.get("api_key_fingerprint"))
            providers.append(item)
        return providers

    def create_model_provider(
        self,
        *,
        provider_id: str,
        organization_id: str,
        provider: str,
        model: str,
        base_url: str,
        api_key_ciphertext: str,
        api_key_fingerprint: str,
        temperature: float,
        timeout_seconds: int,
        max_retries: int,
        input_price_per_million: float,
        output_price_per_million: float,
        enabled: bool,
        is_default: bool,
        now: str,
    ) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            if is_default:
                cursor.execute("UPDATE model_providers SET is_default = false WHERE organization_id = %s", (organization_id,))
            cursor.execute(
                """
                INSERT INTO model_providers(
                    id, organization_id, provider, model, base_url, api_key_ciphertext, api_key_fingerprint,
                    temperature, timeout_seconds, max_retries, input_price_per_million,
                    output_price_per_million, enabled, is_default, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    provider_id, organization_id, provider, model, base_url, api_key_ciphertext, api_key_fingerprint,
                    temperature, timeout_seconds, max_retries, input_price_per_million,
                    output_price_per_million, enabled, is_default, now, now,
                ),
            )

    def update_model_provider(self, *, organization_id: str, provider_id: str, updates: dict[str, Any]) -> bool:
        allowed = {
            "provider", "model", "base_url", "api_key_ciphertext", "api_key_fingerprint", "temperature",
            "timeout_seconds", "max_retries", "input_price_per_million", "output_price_per_million",
            "enabled", "is_default", "updated_at",
        }
        selected = {key: value for key, value in updates.items() if key in allowed}
        if not selected:
            return False
        with self._connect() as connection, connection.cursor() as cursor:
            if bool(selected.get("is_default")):
                cursor.execute("UPDATE model_providers SET is_default = false WHERE organization_id = %s", (organization_id,))
            assignments = ", ".join(f"{key} = %s" for key in selected)
            cursor.execute(
                f"UPDATE model_providers SET {assignments} WHERE id = %s AND organization_id = %s",
                (*selected.values(), provider_id, organization_id),
            )
            return bool(cursor.rowcount)

    def set_default_model_provider(self, *, organization_id: str, provider_id: str, updated_at: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("UPDATE model_providers SET is_default = false WHERE organization_id = %s", (organization_id,))
            cursor.execute(
                "UPDATE model_providers SET is_default = true, updated_at = %s WHERE id = %s AND organization_id = %s AND enabled = true",
                (updated_at, provider_id, organization_id),
            )
            return bool(cursor.rowcount)

    def delete_model_provider(self, *, organization_id: str, provider_id: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM model_providers WHERE id = %s AND organization_id = %s", (provider_id, organization_id))
            return bool(cursor.rowcount)

    def get_model_provider_secret(self, organization_id: str, provider_id: str) -> str | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT api_key_ciphertext FROM model_providers WHERE id = %s AND organization_id = %s", (provider_id, organization_id))
            row = _row(cursor.fetchone())
        return None if row is None else str(row.get("api_key_ciphertext") or "")

    def model_provider_pricing(self, organization_id: str, provider_id: str) -> tuple[float, float] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT input_price_per_million, output_price_per_million FROM model_providers WHERE id = %s AND organization_id = %s", (provider_id, organization_id))
            row = _row(cursor.fetchone())
        if row is None:
            return None
        return max(0.0, float(row.get("input_price_per_million") or 0)), max(0.0, float(row.get("output_price_per_million") or 0))

    def get_usage_policy(self, organization_id: str) -> dict[str, Any] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT organization_id, monthly_token_soft_limit, monthly_token_hard_limit, monthly_cost_soft_limit, monthly_cost_hard_limit, updated_by_user_id, created_at, updated_at FROM organization_usage_policies WHERE organization_id = %s", (organization_id,))
            return _row(cursor.fetchone())

    def upsert_usage_policy(self, *, organization_id: str, token_soft: int, token_hard: int, cost_soft: float, cost_hard: float, updated_by_user_id: str, now: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO organization_usage_policies(organization_id, monthly_token_soft_limit, monthly_token_hard_limit, monthly_cost_soft_limit, monthly_cost_hard_limit, updated_by_user_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (organization_id) DO UPDATE SET
                    monthly_token_soft_limit = EXCLUDED.monthly_token_soft_limit,
                    monthly_token_hard_limit = EXCLUDED.monthly_token_hard_limit,
                    monthly_cost_soft_limit = EXCLUDED.monthly_cost_soft_limit,
                    monthly_cost_hard_limit = EXCLUDED.monthly_cost_hard_limit,
                    updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = EXCLUDED.updated_at
                """,
                (organization_id, token_soft, token_hard, cost_soft, cost_hard, updated_by_user_id, now, now),
            )

    def usage_totals(self, organization_id: str, period_start: str) -> dict[str, Any]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS calls, COALESCE(SUM(total_tokens), 0) AS total_tokens,
                       COALESCE(SUM(estimated_cost), 0) AS estimated_cost, COALESCE(AVG(latency_ms), 0) AS average_latency_ms
                FROM model_call_usage WHERE organization_id = %s AND created_at >= %s
                """,
                (organization_id, period_start),
            )
            return _row(cursor.fetchone()) or {}

    def list_usage(self, organization_id: str, limit: int) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms,
                       estimated_cost, session_id, attempt_id, run_id, metadata_json, created_at
                FROM model_call_usage WHERE organization_id = %s ORDER BY created_at DESC LIMIT %s
                """,
                (organization_id, max(1, min(limit, 500))),
            )
            rows = cursor.fetchall()
        return [(_row(row) or {}) | {"metadata": _json((_row(row) or {}).get("metadata_json"), {})} for row in rows]

    def record_model_usage(self, *, usage_id: str, organization_id: str, provider_id: str, provider: str, model: str, prompt_tokens: int, completion_tokens: int, total_tokens: int, latency_ms: int, estimated_cost: float, session_id: str, attempt_id: str, run_id: str, metadata: dict[str, Any], created_at: str) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO model_call_usage(id, organization_id, provider_id, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, estimated_cost, session_id, attempt_id, run_id, metadata_json, created_at)
                VALUES (%s, %s, NULLIF(%s, ''), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                """,
                (usage_id, organization_id, provider_id, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, estimated_cost, session_id, attempt_id, run_id, json.dumps(metadata, ensure_ascii=False), created_at),
            )

    def record_feedback(self, event: dict[str, Any]) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO feedback_events(
                    id, organization_id, user_id, target_type, target_id, session_id, attempt_id, run_id,
                    rating, comment, tags_json, metadata_json, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)
                """,
                (
                    event["id"], event["organization_id"], event["user_id"], event["target_type"], event["target_id"],
                    event.get("session_id", ""), event.get("attempt_id", ""), event.get("run_id", ""), event["rating"],
                    event.get("comment", ""), json.dumps(event.get("tags") or [], ensure_ascii=False),
                    json.dumps(event.get("metadata") or {}, ensure_ascii=False), event["created_at"],
                ),
            )

    def list_feedback(self, *, organization_id: str, limit: int, target_type: str = "", target_id: str = "") -> list[dict[str, Any]]:
        where = ["organization_id = %s"]
        params: list[Any] = [organization_id]
        if target_type:
            where.append("target_type = %s")
            params.append(target_type)
        if target_id:
            where.append("target_id = %s")
            params.append(target_id)
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT id, organization_id, user_id, target_type, target_id, session_id, attempt_id, run_id,
                       rating, comment, tags_json, metadata_json, created_at
                FROM feedback_events WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = _row(row) or {}
            items.append(item | {"tags": _json(item.get("tags_json"), []), "metadata": _json(item.get("metadata_json"), {})})
        return items

    def list_usage_alerts(self, organization_id: str, limit: int, include_acknowledged: bool) -> list[dict[str, Any]]:
        where = ["organization_id = %s"]
        params: list[Any] = [organization_id]
        if not include_acknowledged:
            where.append("status = 'open'")
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT id, organization_id, period_start, alert_type, status, metadata_json, created_at,
                       COALESCE(acknowledged_at::text, '') AS acknowledged_at, COALESCE(acknowledged_by_user_id, '') AS acknowledged_by_user_id
                FROM usage_alert_events WHERE {' AND '.join(where)}
                ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        return [(_row(row) or {}) | {"metadata": _json((_row(row) or {}).get("metadata_json"), {})} for row in rows]

    def create_usage_alert(self, *, alert_id: str, organization_id: str, period_start: str, alert_type: str, metadata: dict[str, Any], created_at: str) -> bool:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO usage_alert_events(id, organization_id, period_start, alert_type, status, metadata_json, created_at)
                VALUES (%s, %s, %s, %s, 'open', %s::jsonb, %s)
                ON CONFLICT (organization_id, period_start, alert_type) DO NOTHING
                """,
                (alert_id, organization_id, period_start, alert_type, json.dumps(metadata, ensure_ascii=False), created_at),
            )
            return bool(cursor.rowcount)

    def acknowledge_usage_alert(self, *, alert_id: str, organization_id: str, user_id: str, now: str) -> tuple[dict[str, Any], bool] | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE usage_alert_events
                SET status = 'acknowledged', acknowledged_at = %s, acknowledged_by_user_id = %s
                WHERE id = %s AND organization_id = %s AND status = 'open'
                RETURNING id, organization_id, period_start, alert_type, status, metadata_json, created_at,
                          COALESCE(acknowledged_at::text, '') AS acknowledged_at, COALESCE(acknowledged_by_user_id, '') AS acknowledged_by_user_id
                """,
                (now, user_id, alert_id, organization_id),
            )
            updated = cursor.fetchone()
            if updated is not None:
                result = _row(updated) or {}
                return result | {"metadata": _json(result.get("metadata_json"), {})}, True
            cursor.execute(
                """
                SELECT id, organization_id, period_start, alert_type, status, metadata_json, created_at,
                       COALESCE(acknowledged_at::text, '') AS acknowledged_at, COALESCE(acknowledged_by_user_id, '') AS acknowledged_by_user_id
                FROM usage_alert_events WHERE id = %s AND organization_id = %s
                """,
                (alert_id, organization_id),
            )
            row = _row(cursor.fetchone())
        if row is None:
            return None
        return row | {"metadata": _json(row.get("metadata_json"), {})}, False

    def list_platform_usage(self, period_start: str, limit: int) -> list[dict[str, Any]]:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT o.id AS organization_id, o.name AS organization_name, o.is_active AS organization_active,
                       COUNT(u.id) AS calls, COALESCE(SUM(u.total_tokens), 0) AS total_tokens,
                       COALESCE(SUM(u.estimated_cost), 0) AS estimated_cost,
                       COALESCE(AVG(u.latency_ms), 0) AS average_latency_ms,
                       COALESCE(p.monthly_token_soft_limit, 0) AS monthly_token_soft_limit,
                       COALESCE(p.monthly_token_hard_limit, 0) AS monthly_token_hard_limit,
                       COALESCE(p.monthly_cost_soft_limit, 0) AS monthly_cost_soft_limit,
                       COALESCE(p.monthly_cost_hard_limit, 0) AS monthly_cost_hard_limit,
                       (SELECT COUNT(*) FROM model_providers mp WHERE mp.organization_id = o.id) AS model_provider_count
                FROM organizations o
                LEFT JOIN model_call_usage u ON u.organization_id = o.id AND u.created_at >= %s
                LEFT JOIN organization_usage_policies p ON p.organization_id = o.id
                GROUP BY o.id, p.organization_id
                ORDER BY estimated_cost DESC, total_tokens DESC, o.name ASC
                LIMIT %s
                """,
                (period_start, max(1, min(limit, 500))),
            )
            rows = cursor.fetchall()
        return [_row(row) or {} for row in rows]

    def list_platform_audit_logs(self, query: str, limit: int) -> list[dict[str, Any]]:
        where = ""
        params: list[Any] = []
        if query.strip():
            where = "WHERE (a.action ILIKE %s OR a.target_type ILIKE %s OR a.target_id ILIKE %s OR u.email ILIKE %s)"
            term = f"%{query.strip()}%"
            params.extend([term, term, term, term])
        params.append(max(1, min(limit, 500)))
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT a.id, a.organization_id, a.user_id, a.action, a.target_type, a.target_id,
                       a.metadata_json, a.created_at, u.email AS actor_email, o.name AS organization_name
                FROM audit_logs a
                LEFT JOIN users u ON u.id = a.user_id
                LEFT JOIN organizations o ON o.id = a.organization_id
                {where}
                ORDER BY a.created_at DESC LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = _row(row) or {}
            items.append(item | {"metadata": _json(item.get("metadata_json"), {})})
        return items
