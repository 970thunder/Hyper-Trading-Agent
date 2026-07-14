"""Commercial platform persistence.

The first commercial slice intentionally uses sqlite for local development and
tests while mirroring the tables planned for Postgres/pgvector. Production
deployments get the canonical Postgres schema under ``migrations/``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_DB_PATH = Path.home() / ".vibe-trading" / "commercial" / "commercial.db"
SESSION_TTL_DAYS = 14
ROLES = {"owner", "admin", "member", "viewer"}
JOB_STATUSES = {"pending", "running", "completed", "failed", "cancelled"}
TOOL_RISK_LEVELS = {"low", "medium", "high", "critical"}
EMBEDDING_DIMENSIONS = int(os.getenv("VIBE_TRADING_LOCAL_EMBEDDING_DIMENSIONS", "64"))
_TOKEN_RE = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)
KNOWLEDGE_RETRIEVAL_MODES = {"hybrid", "vector", "keyword"}
DEFAULT_KNOWLEDGE_CONFIG: dict[str, Any] = {
    "chunk_size": 1400,
    "chunk_overlap": 180,
    "retrieval_mode": "hybrid",
    "top_k": 8,
}
DEFAULT_KNOWLEDGE_ACCESS: dict[str, list[str]] = {
    "read_roles": ["owner", "admin", "member", "viewer"],
    "write_roles": ["owner", "admin", "member"],
}


@dataclass(frozen=True)
class Principal:
    user_id: str
    organization_id: str
    email: str
    role: str
    is_platform_admin: bool = False


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def db_path() -> Path:
    raw = os.getenv("VIBE_TRADING_COMMERCIAL_DB", "").strip()
    return Path(raw).expanduser() if raw else DEFAULT_DB_PATH


def _platform_admin_bootstrap_emails() -> set[str]:
    """Return the explicit platform-administrator bootstrap allowlist.

    This intentionally lives outside organization roles.  Deployments can set
    ``HYPER_TRADING_PLATFORM_ADMIN_EMAILS`` to a comma-separated list during
    provisioning; the addresses are only granted after a corresponding user
    account exists.
    """
    raw = os.getenv("HYPER_TRADING_PLATFORM_ADMIN_EMAILS", "")
    return {
        item.strip().lower()
        for item in raw.split(",")
        if item.strip() and "@" in item
    }


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


def _clamp_progress(value: int | float | None) -> int:
    try:
        return max(0, min(100, int(value or 0)))
    except (TypeError, ValueError):
        return 0


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return dict(parsed) if isinstance(parsed, dict) else {}


_SENSITIVE_METADATA_KEY_RE = re.compile(r"(?:api[_-]?key|authorization|cookie|password|secret|token)", re.IGNORECASE)


def _redact_metadata(value: Any) -> Any:
    """Return operational metadata without credentials or session material."""
    if isinstance(value, dict):
        return {
            str(key): "[redacted]" if _SENSITIVE_METADATA_KEY_RE.search(str(key)) else _redact_metadata(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_metadata(item) for item in value]
    return value


def _normalize_knowledge_config(
    value: dict[str, Any] | None,
    *,
    base: dict[str, Any] | None = None,
) -> dict[str, Any]:
    merged = {**DEFAULT_KNOWLEDGE_CONFIG, **(base or {}), **(value or {})}
    try:
        chunk_size = max(300, min(8000, int(merged.get("chunk_size") or 1400)))
        chunk_overlap = max(0, int(merged.get("chunk_overlap") or 0))
        top_k = max(1, min(20, int(merged.get("top_k") or 8)))
    except (TypeError, ValueError) as exc:
        raise ValueError("knowledge configuration contains invalid numeric values") from exc
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk overlap must be smaller than chunk size")
    retrieval_mode = str(merged.get("retrieval_mode") or "hybrid").strip().lower()
    if retrieval_mode not in KNOWLEDGE_RETRIEVAL_MODES:
        raise ValueError("retrieval mode must be hybrid, vector, or keyword")
    return {
        "chunk_size": chunk_size,
        "chunk_overlap": chunk_overlap,
        "retrieval_mode": retrieval_mode,
        "top_k": top_k,
    }


def _normalize_knowledge_access(
    value: dict[str, Any] | None,
    *,
    base: dict[str, Any] | None = None,
) -> dict[str, list[str]]:
    merged = {**DEFAULT_KNOWLEDGE_ACCESS, **(base or {}), **(value or {})}
    normalized: dict[str, list[str]] = {}
    for field in ("read_roles", "write_roles"):
        raw = merged.get(field)
        if not isinstance(raw, list):
            raise ValueError(f"{field} must be a role list")
        roles = [str(role).strip().lower() for role in raw]
        invalid = [role for role in roles if role not in ROLES]
        if invalid:
            raise ValueError(f"invalid knowledge access role: {invalid[0]}")
        normalized[field] = [role for role in ("owner", "admin", "member", "viewer") if role in set(roles)]
    if "owner" not in normalized["read_roles"]:
        normalized["read_roles"].insert(0, "owner")
    if "owner" not in normalized["write_roles"]:
        normalized["write_roles"].insert(0, "owner")
    normalized["read_roles"] = [
        role
        for role in ("owner", "admin", "member", "viewer")
        if role in set(normalized["read_roles"] + normalized["write_roles"])
    ]
    return normalized


def _knowledge_base_payload(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    item["config"] = _normalize_knowledge_config(_json_object(item.pop("config_json", None)))
    item["access"] = _normalize_knowledge_access(_json_object(item.pop("access_json", None)))
    return item


def _summarize_value(value: Any, limit: int = 500) -> str:
    try:
        if isinstance(value, str):
            text = value
        else:
            text = json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        text = str(value)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def default_tool_policy(tool_name: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return conservative default policy for a tool."""
    meta = metadata or {}
    name = tool_name.lower()
    readonly = bool(meta.get("is_readonly", True))
    risk = str(meta.get("risk_level") or "").lower()
    if risk not in TOOL_RISK_LEVELS:
        risk = "low" if readonly else "medium"
    if any(part in name for part in ("bash", "shell", "write_file", "edit_file", "live", "order", "trade")):
        risk = "high"
    if any(part in name for part in ("halt", "mandate", "broker", "connector")) and not readonly:
        risk = "high"
    requires_approval = bool(meta.get("requires_approval", False)) or risk in {"high", "critical"}
    enabled = bool(meta.get("enabled_by_default", True))
    if risk in {"high", "critical"}:
        enabled = False
    scope = str(meta.get("permission_scope") or ("tool:read" if readonly else "tool:write"))
    return {
        "tool_name": tool_name,
        "description": str(meta.get("description") or ""),
        "is_readonly": readonly,
        "risk_level": risk,
        "permission_scope": scope,
        "requires_approval": requires_approval,
        "enabled": enabled,
    }


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 210_000)
    return "pbkdf2_sha256$210000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algo, rounds, salt_b64, digest_b64 = encoded.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _secret_fingerprint(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:16]


def _local_embedding(text: str, dimensions: int = EMBEDDING_DIMENSIONS) -> list[float]:
    """Create a deterministic local embedding for offline hybrid retrieval.

    This is a lightweight fallback, not a semantic model. Production deployments
    should replace it with provider embeddings stored in pgvector.
    """
    vector = [0.0] * max(8, dimensions)
    tokens = [token.lower() for token in _TOKEN_RE.findall(text or "") if token.strip()]
    for token in tokens[:4096]:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:4], "big") % len(vector)
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[bucket] += sign
    norm = math.sqrt(sum(value * value for value in vector))
    if norm <= 0:
        return vector
    return [round(value / norm, 6) for value in vector]


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    size = min(len(a), len(b))
    return float(sum(a[i] * b[i] for i in range(size)))


def _embedding_provider_env(provider: str) -> tuple[str | None, str | None]:
    normalized = provider.strip().lower().replace("_", "-")
    return {
        "siliconflow": ("SILICONFLOW_API_KEY", "SILICONFLOW_BASE_URL"),
        "openai": ("OPENAI_API_KEY", "OPENAI_BASE_URL"),
        "openrouter": ("OPENROUTER_API_KEY", "OPENROUTER_BASE_URL"),
        "deepseek": ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"),
        "dashscope": ("DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL"),
        "qwen": ("DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL"),
    }.get(normalized, (None, None))


def _default_embedding_model(provider: str) -> str:
    normalized = provider.strip().lower().replace("_", "-")
    if normalized == "openai":
        return "text-embedding-3-small"
    if normalized == "dashscope" or normalized == "qwen":
        return "text-embedding-v3"
    return "BAAI/bge-m3"


def _embedding_config() -> dict[str, Any]:
    try:
        from src.providers.llm import _ensure_dotenv

        _ensure_dotenv()
    except Exception:
        pass
    provider = (
        os.getenv("VIBE_TRADING_EMBEDDING_PROVIDER", "").strip()
        or os.getenv("LANGCHAIN_PROVIDER", "").strip()
        or "siliconflow"
    ).lower()
    key_env, base_env = _embedding_provider_env(provider)
    api_key = (
        os.getenv("VIBE_TRADING_EMBEDDING_API_KEY", "").strip()
        or os.getenv(key_env or "", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )
    base_url = (
        os.getenv("VIBE_TRADING_EMBEDDING_BASE_URL", "").strip()
        or os.getenv(base_env or "", "").strip()
        or os.getenv("OPENAI_BASE_URL", "").strip()
        or os.getenv("OPENAI_API_BASE", "").strip()
    )
    model = os.getenv("VIBE_TRADING_EMBEDDING_MODEL", "").strip() or _default_embedding_model(provider)
    disabled = os.getenv("VIBE_TRADING_EMBEDDING_DISABLED", "").strip().lower() in {"1", "true", "yes", "on"}
    return {
        "provider": provider,
        "model": model,
        "base_url": base_url,
        "api_key_configured": bool(api_key),
        "available": bool(api_key and base_url and not disabled),
        "disabled": disabled,
        "_api_key": api_key,
    }


def embedding_backend_status() -> dict[str, Any]:
    from src.commercial.vector_store import build_vector_store_adapter

    cfg = _embedding_config()
    vector_status = build_vector_store_adapter().status()
    return {
        "primary": {
            "provider": cfg["provider"],
            "model": cfg["model"],
            "available": cfg["available"],
            "api_key_configured": cfg["api_key_configured"],
            "base_url_configured": bool(cfg["base_url"]),
            "disabled": cfg["disabled"],
        },
        "fallback": {
            "provider": "local",
            "model": f"hashing-{EMBEDDING_DIMENSIONS}",
            "available": True,
        },
        "storage": "sqlite-fts-local",
        "target_storage": "postgres-pgvector",
        "vector_storage": vector_status | {"pgvector_available": vector_status["active"] == "postgres-pgvector"},
    }


def _embedding_endpoint(base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    if base.endswith("/embeddings"):
        return base
    if base.endswith("/v1"):
        return f"{base}/embeddings"
    return f"{base}/v1/embeddings"


def _provider_embedding(text: str) -> tuple[list[float], str]:
    cfg = _embedding_config()
    if not cfg["available"]:
        raise RuntimeError("embedding provider is not configured")
    try:
        import httpx

        response = httpx.post(
            _embedding_endpoint(str(cfg["base_url"])),
            headers={"Authorization": f"Bearer {cfg['_api_key']}"},
            json={"model": cfg["model"], "input": text[:12000], "encoding_format": "float"},
            timeout=float(os.getenv("VIBE_TRADING_EMBEDDING_TIMEOUT_SECONDS", "20")),
        )
        response.raise_for_status()
        payload = response.json()
        embedding = payload.get("data", [{}])[0].get("embedding")
        if not isinstance(embedding, list) or not embedding:
            raise RuntimeError("embedding response did not include a vector")
        return [float(value) for value in embedding], f"{cfg['provider']}:{cfg['model']}"
    except Exception as exc:  # noqa: BLE001 - caller deliberately falls back
        raise RuntimeError(f"embedding provider failed: {type(exc).__name__}") from exc


def _embedding_for_text(text: str) -> tuple[list[float], dict[str, Any]]:
    try:
        vector, source = _provider_embedding(text)
        return vector, {
            "embedding_source": source,
            "embedding_provider": source.split(":", 1)[0],
            "embedding_model": source.split(":", 1)[1] if ":" in source else "",
            "embedding_dimensions": len(vector),
            "embedding_fallback": False,
        }
    except RuntimeError as exc:
        vector = _local_embedding(text)
        return vector, {
            "embedding_source": f"local:hashing-{len(vector)}",
            "embedding_provider": "local",
            "embedding_model": f"hashing-{len(vector)}",
            "embedding_dimensions": len(vector),
            "embedding_fallback": True,
            "embedding_error": str(exc),
        }


def _secret_key() -> bytes:
    raw = os.getenv("VIBE_TRADING_SECRET_KEY", "").strip()
    if raw:
        return raw.encode("utf-8")
    seed = str(db_path().resolve()).encode("utf-8")
    digest = hashlib.sha256(seed).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(secret: str) -> str:
    if not secret:
        return ""
    try:
        from cryptography.fernet import Fernet

        return Fernet(_secret_key()).encrypt(secret.encode("utf-8")).decode("utf-8")
    except Exception:
        return "plain:" + base64.b64encode(secret.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    if ciphertext.startswith("plain:"):
        return base64.b64decode(ciphertext.removeprefix("plain:")).decode("utf-8")
    try:
        from cryptography.fernet import Fernet

        return Fernet(_secret_key()).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""


class CommercialStore:
    """Organization-scoped commercial tables and helpers."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = (path or db_path()).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS organizations (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS memberships (
                    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer')),
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (organization_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workspace_sessions (
                    session_id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_sessions_organization
                    ON workspace_sessions(organization_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS workspace_runs (
                    run_id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    session_id TEXT NOT NULL DEFAULT '',
                    attempt_id TEXT NOT NULL DEFAULT '',
                    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_runs_organization
                    ON workspace_runs(organization_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS workspace_artifacts (
                    artifact_type TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    session_id TEXT NOT NULL DEFAULT '',
                    attempt_id TEXT NOT NULL DEFAULT '',
                    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    storage_path TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (artifact_type, artifact_id)
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_organization
                    ON workspace_artifacts(organization_id, artifact_type, updated_at DESC);
                CREATE TABLE IF NOT EXISTS uploaded_files (
                    storage_key TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    uploaded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    original_filename TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_uploaded_files_organization
                    ON uploaded_files(organization_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS platform_admins (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    created_by_user_id TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    user_id TEXT,
                    action TEXT NOT NULL,
                    target_type TEXT NOT NULL DEFAULT '',
                    target_id TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_providers (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    api_key_ciphertext TEXT NOT NULL DEFAULT '',
                    api_key_fingerprint TEXT NOT NULL DEFAULT '',
                    temperature REAL NOT NULL DEFAULT 0,
                    timeout_seconds INTEGER NOT NULL DEFAULT 120,
                    max_retries INTEGER NOT NULL DEFAULT 2,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    is_default INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_call_usage (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    provider_id TEXT,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt_tokens INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens INTEGER NOT NULL DEFAULT 0,
                    latency_ms INTEGER NOT NULL DEFAULT 0,
                    estimated_cost REAL NOT NULL DEFAULT 0,
                    session_id TEXT NOT NULL DEFAULT '',
                    attempt_id TEXT NOT NULL DEFAULT '',
                    run_id TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_bases (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    config_json TEXT NOT NULL DEFAULT '{}',
                    access_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_documents (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    source_uri TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_hash TEXT NOT NULL,
                    status TEXT NOT NULL,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_chunks (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    knowledge_base_id TEXT NOT NULL,
                    document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
                    chunk_index INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    embedding_json TEXT NOT NULL DEFAULT '[]',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
                    chunk_id UNINDEXED,
                    organization_id UNINDEXED,
                    knowledge_base_id UNINDEXED,
                    document_id UNINDEXED,
                    title,
                    text,
                    tokenize='unicode61'
                );
                CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    knowledge_base_id TEXT NOT NULL,
                    document_id TEXT,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    error TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT NOT NULL DEFAULT '',
                    completed_at TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS knowledge_retrieval_logs (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    user_id TEXT,
                    knowledge_base_id TEXT,
                    query TEXT NOT NULL,
                    result_count INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS feedback_events (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '',
                    attempt_id TEXT NOT NULL DEFAULT '',
                    run_id TEXT NOT NULL DEFAULT '',
                    rating INTEGER NOT NULL,
                    comment TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tool_policies (
                    organization_id TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    risk_level TEXT NOT NULL,
                    permission_scope TEXT NOT NULL,
                    requires_approval INTEGER NOT NULL DEFAULT 0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (organization_id, tool_name)
                );
                """
            )
            existing_chunk_columns = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(knowledge_chunks)").fetchall()
            }
            if "embedding_json" not in existing_chunk_columns:
                conn.execute("ALTER TABLE knowledge_chunks ADD COLUMN embedding_json TEXT NOT NULL DEFAULT '[]'")
            if "metadata_json" not in existing_chunk_columns:
                conn.execute("ALTER TABLE knowledge_chunks ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'")
            existing_usage_columns = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(model_call_usage)").fetchall()
            }
            for column_name in ("session_id", "attempt_id", "run_id"):
                if column_name not in existing_usage_columns:
                    conn.execute(f"ALTER TABLE model_call_usage ADD COLUMN {column_name} TEXT NOT NULL DEFAULT ''")
            if "metadata_json" not in existing_usage_columns:
                conn.execute("ALTER TABLE model_call_usage ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'")
            existing_job_columns = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(knowledge_ingestion_jobs)").fetchall()
            }
            if "progress" not in existing_job_columns:
                conn.execute("ALTER TABLE knowledge_ingestion_jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
            if "started_at" not in existing_job_columns:
                conn.execute("ALTER TABLE knowledge_ingestion_jobs ADD COLUMN started_at TEXT NOT NULL DEFAULT ''")
            if "completed_at" not in existing_job_columns:
                conn.execute("ALTER TABLE knowledge_ingestion_jobs ADD COLUMN completed_at TEXT NOT NULL DEFAULT ''")
            if "metadata_json" not in existing_job_columns:
                conn.execute("ALTER TABLE knowledge_ingestion_jobs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'")
            existing_knowledge_base_columns = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(knowledge_bases)").fetchall()
            }
            if "config_json" not in existing_knowledge_base_columns:
                conn.execute("ALTER TABLE knowledge_bases ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'")
            if "access_json" not in existing_knowledge_base_columns:
                conn.execute("ALTER TABLE knowledge_bases ADD COLUMN access_json TEXT NOT NULL DEFAULT '{}'")
            existing_user_columns = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(users)").fetchall()
            }
            if "is_active" not in existing_user_columns:
                conn.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
            existing_organization_columns = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(organizations)").fetchall()
            }
            if "is_active" not in existing_organization_columns:
                conn.execute("ALTER TABLE organizations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")

    # --- auth / orgs ---

    def _sync_platform_admin_bootstrap(self, user_id: str, email: str) -> None:
        """Persist a configured bootstrap administrator for an existing user."""
        if email.strip().lower() not in _platform_admin_bootstrap_emails():
            return
        with self._connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO platform_admins(user_id, created_at, created_by_user_id) VALUES (?, ?, ?)",
                (user_id, utcnow(), "bootstrap"),
            )

    def _is_platform_admin(self, user_id: str, email: str = "") -> bool:
        self._sync_platform_admin_bootstrap(user_id, email)
        with self._connect() as conn:
            row = conn.execute("SELECT 1 FROM platform_admins WHERE user_id = ?", (user_id,)).fetchone()
        return row is not None

    def is_platform_admin(self, principal: Principal) -> bool:
        return bool(principal.is_platform_admin or self._is_platform_admin(principal.user_id, principal.email))

    def register_owner(self, *, email: str, password: str, organization_name: str, display_name: str = "") -> tuple[Principal, str]:
        email = email.strip().lower()
        if not email or "@" not in email:
            raise ValueError("valid email is required")
        if len(password) < 8:
            raise ValueError("password must be at least 8 characters")
        now = utcnow()
        org_id = _new_id("org")
        user_id = _new_id("usr")
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO organizations(id, name, created_at) VALUES (?, ?, ?)",
                (org_id, organization_name.strip() or "Default Organization", now),
            )
            conn.execute(
                "INSERT INTO users(id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email, _hash_password(password), display_name.strip(), now),
            )
            conn.execute(
                "INSERT INTO memberships(organization_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
                (org_id, user_id, now),
            )
        self._sync_platform_admin_bootstrap(user_id, email)
        principal = Principal(
            user_id=user_id,
            organization_id=org_id,
            email=email,
            role="owner",
            is_platform_admin=self._is_platform_admin(user_id, email),
        )
        token = self.create_session(principal)
        self.audit(principal, "auth.register", "organization", org_id, {"email": email})
        return principal, token

    def login(self, *, email: str, password: str) -> tuple[Principal, str]:
        email = email.strip().lower()
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT u.id AS user_id, u.email, u.password_hash, u.is_active AS user_active,
                       m.organization_id, m.role, o.is_active AS organization_active
                FROM users u
                JOIN memberships m ON m.user_id = u.id
                JOIN organizations o ON o.id = m.organization_id
                WHERE u.email = ?
                ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END
                LIMIT 1
                """,
                (email,),
            ).fetchone()
        if row is None or not _verify_password(password, str(row["password_hash"])):
            raise ValueError("invalid email or password")
        if not bool(row["user_active"]) or not bool(row["organization_active"]):
            raise ValueError("account or organization is inactive")
        principal = Principal(
            user_id=str(row["user_id"]),
            organization_id=str(row["organization_id"]),
            email=str(row["email"]),
            role=str(row["role"]),
            is_platform_admin=self._is_platform_admin(str(row["user_id"]), str(row["email"])),
        )
        token = self.create_session(principal)
        self.audit(principal, "auth.login", "user", principal.user_id, {})
        return principal, token

    def create_session(self, principal: Principal) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = _secret_fingerprint(token)
        expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO auth_sessions(token_hash, user_id, organization_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
                (token_hash, principal.user_id, principal.organization_id, expires, utcnow()),
            )
        return token

    def principal_from_token(self, token: str) -> Principal | None:
        if not token:
            return None
        token_hash = _secret_fingerprint(token)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT u.id AS user_id, u.email, u.is_active AS user_active,
                       m.organization_id, m.role, o.is_active AS organization_active, s.expires_at
                FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                JOIN memberships m ON m.organization_id = s.organization_id AND m.user_id = s.user_id
                JOIN organizations o ON o.id = m.organization_id
                WHERE s.token_hash = ?
                """,
                (token_hash,),
            ).fetchone()
        if row is None or str(row["expires_at"]) < utcnow() or not bool(row["user_active"]) or not bool(row["organization_active"]):
            return None
        return Principal(
            str(row["user_id"]),
            str(row["organization_id"]),
            str(row["email"]),
            str(row["role"]),
            self._is_platform_admin(str(row["user_id"]), str(row["email"])),
        )

    def logout(self, token: str) -> None:
        if token:
            with self._connect() as conn:
                conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_secret_fingerprint(token),))

    def current_organization(self, principal: Principal) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute("SELECT id, name, created_at FROM organizations WHERE id = ?", (principal.organization_id,)).fetchone()
        return dict(row) if row else {}

    def list_user_organizations(self, principal: Principal) -> list[dict[str, Any]]:
        """List active organization memberships available to the signed-in user."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT o.id, o.name, o.is_active, o.created_at, m.role, m.created_at AS membership_created_at
                FROM memberships m
                JOIN organizations o ON o.id = m.organization_id
                WHERE m.user_id = ? AND o.is_active = 1
                ORDER BY CASE m.organization_id WHEN ? THEN 0 ELSE 1 END, o.name COLLATE NOCASE ASC
                """,
                (principal.user_id, principal.organization_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def switch_organization(self, principal: Principal, organization_id: str) -> Principal:
        """Create a new principal for an active membership in another organization."""
        target = str(organization_id or "").strip()
        if not target:
            raise ValueError("organization_id is required")
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT m.organization_id, m.role, o.is_active AS organization_active, u.is_active AS user_active
                FROM memberships m
                JOIN organizations o ON o.id = m.organization_id
                JOIN users u ON u.id = m.user_id
                WHERE m.user_id = ? AND m.organization_id = ?
                """,
                (principal.user_id, target),
            ).fetchone()
        if row is None:
            raise KeyError(target)
        if not bool(row["organization_active"]):
            raise ValueError("organization is inactive")
        if not bool(row["user_active"]):
            raise ValueError("account is inactive")
        next_principal = Principal(
            user_id=principal.user_id,
            organization_id=str(row["organization_id"]),
            email=principal.email,
            role=str(row["role"]),
            is_platform_admin=self._is_platform_admin(principal.user_id, principal.email),
        )
        self.audit(next_principal, "organization.switch", "organization", target, {"from_organization_id": principal.organization_id})
        return next_principal

    # --- workspace resource ownership ---

    def bind_workspace_session(self, principal: Principal, session_id: str) -> None:
        if not session_id:
            raise ValueError("session id is required")
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT organization_id FROM workspace_sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if existing is not None and str(existing["organization_id"]) != principal.organization_id:
                raise ValueError("session is already bound to another organization")
            conn.execute(
                "INSERT OR IGNORE INTO workspace_sessions(session_id, organization_id, created_by_user_id, created_at) VALUES (?, ?, ?, ?)",
                (session_id, principal.organization_id, principal.user_id, utcnow()),
            )
        self.audit(principal, "workspace.session.create", "session", session_id, {})

    def session_belongs_to_organization(self, principal: Principal, session_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM workspace_sessions WHERE session_id = ? AND organization_id = ?",
                (session_id, principal.organization_id),
            ).fetchone()
        return row is not None

    def list_workspace_session_ids(self, principal: Principal, limit: int = 200) -> set[str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT session_id FROM workspace_sessions WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?",
                (principal.organization_id, max(1, min(limit, 1000))),
            ).fetchall()
        return {str(row["session_id"]) for row in rows}

    def delete_workspace_session(self, principal: Principal, session_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM workspace_sessions WHERE session_id = ? AND organization_id = ?",
                (session_id, principal.organization_id),
            )
        self.audit(principal, "workspace.session.delete", "session", session_id, {})

    def bind_workspace_run(
        self,
        principal: Principal,
        run_id: str,
        *,
        session_id: str = "",
        attempt_id: str = "",
    ) -> None:
        if not run_id:
            raise ValueError("run id is required")
        with self._connect() as conn:
            existing = conn.execute("SELECT organization_id FROM workspace_runs WHERE run_id = ?", (run_id,)).fetchone()
            if existing is not None and str(existing["organization_id"]) != principal.organization_id:
                raise ValueError("run is already bound to another organization")
            conn.execute(
                "INSERT OR IGNORE INTO workspace_runs(run_id, organization_id, session_id, attempt_id, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, principal.organization_id, session_id, attempt_id, principal.user_id, utcnow()),
            )
        self.audit(principal, "workspace.run.create", "run", run_id, {"session_id": session_id, "attempt_id": attempt_id})

    def run_belongs_to_organization(self, principal: Principal, run_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM workspace_runs WHERE run_id = ? AND organization_id = ?",
                (run_id, principal.organization_id),
            ).fetchone()
        return row is not None

    def list_workspace_run_ids(self, principal: Principal, limit: int = 200) -> set[str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT run_id FROM workspace_runs WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?",
                (principal.organization_id, max(1, min(limit, 1000))),
            ).fetchall()
        return {str(row["run_id"]) for row in rows}

    def bind_workspace_artifact(
        self,
        principal: Principal,
        artifact_type: str,
        artifact_id: str,
        *,
        session_id: str = "",
        attempt_id: str = "",
        storage_path: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Bind a generated workspace artifact to its tenant exactly once."""
        normalized_type = str(artifact_type or "").strip().lower()
        normalized_id = str(artifact_id or "").strip()
        if not re.fullmatch(r"[a-z0-9_.-]{1,80}", normalized_type) or not normalized_id:
            raise ValueError("artifact identity is invalid")
        now = utcnow()
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False, default=str)
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT organization_id FROM workspace_artifacts WHERE artifact_type = ? AND artifact_id = ?",
                (normalized_type, normalized_id),
            ).fetchone()
            if existing is not None and str(existing["organization_id"]) != principal.organization_id:
                raise ValueError("artifact is already bound to another organization")
            conn.execute(
                """
                INSERT INTO workspace_artifacts(
                    artifact_type, artifact_id, organization_id, session_id, attempt_id,
                    created_by_user_id, storage_path, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(artifact_type, artifact_id) DO UPDATE SET
                    session_id = excluded.session_id,
                    attempt_id = excluded.attempt_id,
                    storage_path = excluded.storage_path,
                    metadata_json = excluded.metadata_json,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized_type,
                    normalized_id,
                    principal.organization_id,
                    session_id,
                    attempt_id,
                    principal.user_id,
                    storage_path,
                    metadata_json,
                    now,
                    now,
                ),
            )
        self.audit(
            principal,
            "workspace.artifact.upsert",
            normalized_type,
            normalized_id,
            {"session_id": session_id, "attempt_id": attempt_id, "storage_path": storage_path},
        )

    def workspace_artifact_belongs_to_organization(
        self,
        principal: Principal,
        artifact_type: str,
        artifact_id: str,
    ) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT 1 FROM workspace_artifacts
                WHERE artifact_type = ? AND artifact_id = ? AND organization_id = ?
                """,
                (str(artifact_type or "").strip().lower(), str(artifact_id or "").strip(), principal.organization_id),
            ).fetchone()
        return row is not None

    def list_workspace_artifact_ids(
        self,
        principal: Principal,
        artifact_type: str,
        *,
        limit: int = 200,
    ) -> set[str]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT artifact_id FROM workspace_artifacts
                WHERE organization_id = ? AND artifact_type = ?
                ORDER BY updated_at DESC LIMIT ?
                """,
                (principal.organization_id, str(artifact_type or "").strip().lower(), max(1, min(limit, 1000))),
            ).fetchall()
        return {str(row["artifact_id"]) for row in rows}

    def register_uploaded_file(
        self,
        principal: Principal,
        storage_key: str,
        *,
        original_filename: str,
        size_bytes: int,
    ) -> None:
        if not storage_key.startswith("uploads/"):
            raise ValueError("upload storage key is invalid")
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO uploaded_files(storage_key, organization_id, uploaded_by_user_id, original_filename, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    storage_key,
                    principal.organization_id,
                    principal.user_id,
                    original_filename[:500],
                    max(0, int(size_bytes)),
                    utcnow(),
                ),
            )
        self.audit(principal, "workspace.upload.create", "upload", storage_key, {"size_bytes": max(0, int(size_bytes))})

    def uploaded_file_belongs_to_organization(self, principal: Principal, storage_key: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM uploaded_files WHERE storage_key = ? AND organization_id = ?",
                (storage_key, principal.organization_id),
            ).fetchone()
        return row is not None

    def list_organization_members(self, principal: Principal) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT u.id AS user_id, u.email, u.display_name, m.role, m.created_at
                FROM memberships m
                JOIN users u ON u.id = m.user_id
                WHERE m.organization_id = ?
                ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                         u.email ASC
                """,
                (principal.organization_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_organization_member(self, principal: Principal, payload: dict[str, Any]) -> dict[str, Any]:
        email = str(payload.get("email") or "").strip().lower()
        password = str(payload.get("password") or "")
        display_name = str(payload.get("display_name") or "").strip()
        role = str(payload.get("role") or "member").strip().lower()
        if not email or "@" not in email:
            raise ValueError("valid email is required")
        if len(password) < 8:
            raise ValueError("password must be at least 8 characters")
        if role not in ROLES:
            raise ValueError("invalid role")
        now = utcnow()
        user_id = _new_id("usr")
        with self._connect() as conn:
            existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing is None:
                conn.execute(
                    "INSERT INTO users(id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, email, _hash_password(password), display_name, now),
                )
            else:
                user_id = str(existing["id"])
                membership = conn.execute(
                    "SELECT 1 FROM memberships WHERE organization_id = ? AND user_id = ?",
                    (principal.organization_id, user_id),
                ).fetchone()
                if membership is not None:
                    raise ValueError("member already exists")
            conn.execute(
                "INSERT INTO memberships(organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
                (principal.organization_id, user_id, role, now),
            )
        self.audit(principal, "organization.member.create", "user", user_id, {"email": email, "role": role})
        return self._get_organization_member(principal, user_id)

    def update_organization_member_role(self, principal: Principal, user_id: str, role: str) -> dict[str, Any]:
        role = role.strip().lower()
        if role not in ROLES:
            raise ValueError("invalid role")
        current = self._get_organization_member(principal, user_id)
        if current["role"] == "owner" and role != "owner" and self._owner_count(principal.organization_id) <= 1:
            raise ValueError("organization must keep at least one owner")
        with self._connect() as conn:
            cursor = conn.execute(
                "UPDATE memberships SET role = ? WHERE organization_id = ? AND user_id = ?",
                (role, principal.organization_id, user_id),
            )
            if cursor.rowcount == 0:
                raise KeyError(user_id)
        self.audit(principal, "organization.member.update", "user", user_id, {"role": role, "previous_role": current["role"]})
        return self._get_organization_member(principal, user_id)

    def delete_organization_member(self, principal: Principal, user_id: str) -> None:
        current = self._get_organization_member(principal, user_id)
        if user_id == principal.user_id:
            raise ValueError("owner cannot remove their own membership")
        if current["role"] == "owner" and self._owner_count(principal.organization_id) <= 1:
            raise ValueError("organization must keep at least one owner")
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM memberships WHERE organization_id = ? AND user_id = ?",
                (principal.organization_id, user_id),
            )
            if cursor.rowcount == 0:
                raise KeyError(user_id)
            conn.execute(
                "DELETE FROM auth_sessions WHERE organization_id = ? AND user_id = ?",
                (principal.organization_id, user_id),
            )
        self.audit(principal, "organization.member.delete", "user", user_id, {"role": current["role"], "email": current["email"]})

    def _get_organization_member(self, principal: Principal, user_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT u.id AS user_id, u.email, u.display_name, m.role, m.created_at
                FROM memberships m
                JOIN users u ON u.id = m.user_id
                WHERE m.organization_id = ? AND m.user_id = ?
                """,
                (principal.organization_id, user_id),
            ).fetchone()
        if row is None:
            raise KeyError(user_id)
        return dict(row)

    def _owner_count(self, organization_id: str) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS count FROM memberships WHERE organization_id = ? AND role = 'owner'",
                (organization_id,),
            ).fetchone()
        return int(row["count"] if row else 0)

    # --- audit / usage ---

    def audit(self, principal: Principal | None, action: str, target_type: str = "", target_id: str = "", metadata: dict[str, Any] | None = None) -> None:
        organization_id = principal.organization_id if principal else ""
        user_id = principal.user_id if principal else ""
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO audit_logs(id, organization_id, user_id, action, target_type, target_id, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (_new_id("aud"), organization_id, user_id, action, target_type, target_id, json.dumps(metadata or {}, ensure_ascii=False), utcnow()),
            )

    def list_audit_logs(
        self,
        principal: Principal,
        limit: int = 100,
        *,
        action: str = "",
        target_type: str = "",
        user_id: str = "",
        date_from: str = "",
        date_to: str = "",
    ) -> list[dict[str, Any]]:
        where = ["organization_id = ?"]
        params: list[Any] = [principal.organization_id]
        if action:
            where.append("action LIKE ?")
            params.append(f"%{action}%")
        if target_type:
            where.append("target_type = ?")
            params.append(target_type)
        if user_id:
            where.append("user_id = ?")
            params.append(user_id)
        if date_from:
            where.append("created_at >= ?")
            params.append(date_from)
        if date_to:
            where.append("created_at <= ?")
            params.append(date_to)
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT id, action, target_type, target_id, metadata_json, user_id, created_at
                FROM audit_logs
                WHERE {" AND ".join(where)}
                ORDER BY created_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [dict(row) | {"metadata": json.loads(row["metadata_json"] or "{}")} for row in rows]

    def record_tool_audit(
        self,
        principal: Principal,
        *,
        tool_name: str,
        risk_level: str,
        status: str,
        elapsed_ms: int = 0,
        session_id: str = "",
        attempt_id: str = "",
        run_id: str = "",
        call_id: str = "",
        input_summary: Any = "",
        output_summary: Any = "",
        error: str = "",
    ) -> None:
        self.audit(
            principal,
            "tool.call",
            "tool",
            tool_name,
            {
                "tool_name": tool_name,
                "risk_level": risk_level,
                "status": status,
                "elapsed_ms": max(0, int(elapsed_ms or 0)),
                "session_id": session_id,
                "attempt_id": attempt_id,
                "run_id": run_id,
                "call_id": call_id,
                "input_summary": _summarize_value(input_summary),
                "output_summary": _summarize_value(output_summary),
                "error": _summarize_value(error, 300),
            },
        )

    def list_tool_policies(self, principal: Principal, tool_metadata: list[dict[str, Any]]) -> list[dict[str, Any]]:
        defaults = {str(item.get("tool_name") or ""): default_tool_policy(str(item.get("tool_name") or ""), item) for item in tool_metadata}
        defaults = {name: policy for name, policy in defaults.items() if name}
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT tool_name, risk_level, permission_scope, requires_approval, enabled, updated_at
                FROM tool_policies
                WHERE organization_id = ?
                """,
                (principal.organization_id,),
            ).fetchall()
        overrides = {str(row["tool_name"]): dict(row) for row in rows}
        merged: list[dict[str, Any]] = []
        for name in sorted(defaults):
            item = defaults[name] | {"organization_id": principal.organization_id, "source": "default", "updated_at": ""}
            override = overrides.get(name)
            if override:
                item.update(
                    {
                        "risk_level": str(override["risk_level"]),
                        "permission_scope": str(override["permission_scope"]),
                        "requires_approval": bool(override["requires_approval"]),
                        "enabled": bool(override["enabled"]),
                        "updated_at": str(override["updated_at"]),
                        "source": "organization",
                    }
                )
            merged.append(item)
        return merged

    def update_tool_policy(self, principal: Principal, tool_name: str, payload: dict[str, Any], tool_metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        tool_name = tool_name.strip()
        if not tool_name:
            raise ValueError("tool_name is required")
        current = default_tool_policy(tool_name, tool_metadata or {})
        risk_level = str(payload.get("risk_level", current["risk_level"]) or current["risk_level"]).lower()
        if risk_level not in TOOL_RISK_LEVELS:
            raise ValueError("invalid risk_level")
        permission_scope = str(payload.get("permission_scope", current["permission_scope"]) or current["permission_scope"]).strip()
        requires_approval = bool(payload.get("requires_approval", current["requires_approval"]))
        enabled = bool(payload.get("enabled", current["enabled"]))
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO tool_policies(organization_id, tool_name, risk_level, permission_scope, requires_approval, enabled, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(organization_id, tool_name) DO UPDATE SET
                    risk_level = excluded.risk_level,
                    permission_scope = excluded.permission_scope,
                    requires_approval = excluded.requires_approval,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
                """,
                (principal.organization_id, tool_name, risk_level, permission_scope, int(requires_approval), int(enabled), now),
            )
        self.audit(principal, "tool_policy.update", "tool", tool_name, {"risk_level": risk_level, "enabled": enabled, "requires_approval": requires_approval})
        return current | {
            "organization_id": principal.organization_id,
            "risk_level": risk_level,
            "permission_scope": permission_scope,
            "requires_approval": requires_approval,
            "enabled": enabled,
            "updated_at": now,
            "source": "organization",
        }

    def get_effective_tool_policy(self, principal: Principal, tool_name: str, tool_metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        default = default_tool_policy(tool_name, tool_metadata or {})
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT tool_name, risk_level, permission_scope, requires_approval, enabled, updated_at
                FROM tool_policies
                WHERE organization_id = ? AND tool_name = ?
                """,
                (principal.organization_id, tool_name),
            ).fetchone()
        if row is None:
            return default | {"organization_id": principal.organization_id, "source": "default", "updated_at": ""}
        return default | {
            "organization_id": principal.organization_id,
            "risk_level": str(row["risk_level"]),
            "permission_scope": str(row["permission_scope"]),
            "requires_approval": bool(row["requires_approval"]),
            "enabled": bool(row["enabled"]),
            "updated_at": str(row["updated_at"]),
            "source": "organization",
        }

    def list_usage(self, principal: Principal, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, provider, model, prompt_tokens, completion_tokens, total_tokens,
                       latency_ms, estimated_cost, session_id, attempt_id, run_id, metadata_json, created_at
                FROM model_call_usage
                WHERE organization_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (principal.organization_id, max(1, min(limit, 500))),
            ).fetchall()
        return [dict(row) | {"metadata": json.loads(row["metadata_json"] or "{}")} for row in rows]

    def record_model_usage(
        self,
        principal: Principal,
        *,
        provider: str,
        model: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        latency_ms: int = 0,
        estimated_cost: float = 0.0,
        provider_id: str = "",
        session_id: str = "",
        attempt_id: str = "",
        run_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        total = max(0, int(total_tokens or 0))
        prompt = max(0, int(prompt_tokens or 0))
        completion = max(0, int(completion_tokens or 0))
        if total <= 0 and (prompt or completion):
            total = prompt + completion
        usage_id = _new_id("use")
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO model_call_usage(
                    id, organization_id, provider_id, provider, model,
                    prompt_tokens, completion_tokens, total_tokens, latency_ms,
                    estimated_cost, session_id, attempt_id, run_id, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    usage_id,
                    principal.organization_id,
                    provider_id,
                    provider,
                    model,
                    prompt,
                    completion,
                    total,
                    max(0, int(latency_ms or 0)),
                    float(estimated_cost or 0.0),
                    session_id,
                    attempt_id,
                    run_id,
                    json.dumps(metadata or {}, ensure_ascii=False),
                    now,
                ),
            )
        self.audit(
            principal,
            "model_call.record",
            "model_usage",
            usage_id,
            {"provider": provider, "model": model, "tokens": total, "run_id": run_id},
        )
        return {
            "id": usage_id,
            "provider": provider,
            "model": model,
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": total,
            "latency_ms": max(0, int(latency_ms or 0)),
            "estimated_cost": float(estimated_cost or 0.0),
            "session_id": session_id,
            "attempt_id": attempt_id,
            "run_id": run_id,
            "metadata": metadata or {},
            "created_at": now,
        }

    def record_llm_usage_summary(
        self,
        principal: Principal,
        summary: dict[str, Any],
        *,
        provider_id: str = "",
        session_id: str = "",
        attempt_id: str = "",
        run_id: str = "",
    ) -> dict[str, Any] | None:
        totals = summary.get("totals") if isinstance(summary, dict) else None
        if not isinstance(totals, dict):
            return None
        total_tokens = int(totals.get("total_tokens") or 0)
        if total_tokens <= 0:
            return None
        return self.record_model_usage(
            principal,
            provider=str(summary.get("provider") or "unknown"),
            model=str(summary.get("model") or "unknown"),
            prompt_tokens=int(totals.get("input_tokens") or 0),
            completion_tokens=int(totals.get("output_tokens") or 0),
            total_tokens=total_tokens,
            provider_id=provider_id,
            session_id=session_id,
            attempt_id=attempt_id,
            run_id=run_id,
            metadata={"source": "agent_loop", "calls": int(totals.get("calls") or 0)},
        )

    def record_feedback(self, principal: Principal, payload: dict[str, Any]) -> dict[str, Any]:
        """Persist a user feedback event for an answer, run, tool step, or report."""
        try:
            rating = int(payload.get("rating"))
        except (TypeError, ValueError):
            raise ValueError("rating must be one of -1, 0, 1") from None
        if rating not in {-1, 0, 1}:
            raise ValueError("rating must be one of -1, 0, 1")

        target_type = _summarize_value(payload.get("target_type") or "", limit=64)
        target_id = _summarize_value(payload.get("target_id") or "", limit=128)
        if not target_type or not target_id:
            raise ValueError("target_type and target_id are required")

        raw_tags = payload.get("tags") or []
        if not isinstance(raw_tags, list):
            raw_tags = []
        tags = [
            _summarize_value(tag, limit=48)
            for tag in raw_tags[:10]
            if _summarize_value(tag, limit=48)
        ]
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        feedback_id = _new_id("fb")
        now = utcnow()
        event = {
            "id": feedback_id,
            "organization_id": principal.organization_id,
            "user_id": principal.user_id,
            "target_type": target_type,
            "target_id": target_id,
            "session_id": _summarize_value(payload.get("session_id") or "", limit=128),
            "attempt_id": _summarize_value(payload.get("attempt_id") or "", limit=128),
            "run_id": _summarize_value(payload.get("run_id") or "", limit=128),
            "rating": rating,
            "comment": _summarize_value(payload.get("comment") or "", limit=2000),
            "tags": tags,
            "metadata": metadata,
            "created_at": now,
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO feedback_events(
                    id, organization_id, user_id, target_type, target_id,
                    session_id, attempt_id, run_id, rating, comment,
                    tags_json, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feedback_id,
                    principal.organization_id,
                    principal.user_id,
                    target_type,
                    target_id,
                    event["session_id"],
                    event["attempt_id"],
                    event["run_id"],
                    rating,
                    event["comment"],
                    json.dumps(tags, ensure_ascii=False),
                    json.dumps(metadata, ensure_ascii=False),
                    now,
                ),
            )
        self.audit(
            principal,
            "feedback.create",
            target_type,
            target_id,
            {"feedback_id": feedback_id, "rating": rating, "tags": tags, "run_id": event["run_id"]},
        )
        return event

    def list_feedback(
        self,
        principal: Principal,
        *,
        limit: int = 100,
        target_type: str = "",
        target_id: str = "",
    ) -> list[dict[str, Any]]:
        where = ["organization_id = ?"]
        params: list[Any] = [principal.organization_id]
        if target_type:
            where.append("target_type = ?")
            params.append(target_type)
        if target_id:
            where.append("target_id = ?")
            params.append(target_id)
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT id, organization_id, user_id, target_type, target_id,
                       session_id, attempt_id, run_id, rating, comment,
                       tags_json, metadata_json, created_at
                FROM feedback_events
                WHERE {' AND '.join(where)}
                ORDER BY created_at DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        feedback: list[dict[str, Any]] = []
        for row in rows:
            try:
                tags = json.loads(row["tags_json"] or "[]")
            except json.JSONDecodeError:
                tags = []
            try:
                metadata = json.loads(row["metadata_json"] or "{}")
            except json.JSONDecodeError:
                metadata = {}
            feedback.append(dict(row) | {"tags": tags, "metadata": metadata})
        return feedback

    # --- model providers ---

    def list_model_providers(self, principal: Principal) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, provider, model, base_url, api_key_fingerprint, temperature, timeout_seconds, max_retries, enabled, is_default, created_at, updated_at
                FROM model_providers
                WHERE organization_id = ?
                ORDER BY is_default DESC, updated_at DESC
                """,
                (principal.organization_id,),
            ).fetchall()
        return [dict(row) | {"api_key_configured": bool(row["api_key_fingerprint"])} for row in rows]

    def create_model_provider(self, principal: Principal, payload: dict[str, Any]) -> dict[str, Any]:
        now = utcnow()
        provider_id = _new_id("llm")
        api_key = str(payload.get("api_key") or "")
        is_default = 1 if payload.get("is_default") else 0
        with self._connect() as conn:
            if is_default:
                conn.execute("UPDATE model_providers SET is_default = 0 WHERE organization_id = ?", (principal.organization_id,))
            conn.execute(
                """
                INSERT INTO model_providers(
                    id, organization_id, provider, model, base_url, api_key_ciphertext, api_key_fingerprint,
                    temperature, timeout_seconds, max_retries, enabled, is_default, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    provider_id,
                    principal.organization_id,
                    str(payload.get("provider") or "").strip(),
                    str(payload.get("model") or "").strip(),
                    str(payload.get("base_url") or "").strip(),
                    encrypt_secret(api_key),
                    _secret_fingerprint(api_key) if api_key else "",
                    float(payload.get("temperature") or 0),
                    int(payload.get("timeout_seconds") or 120),
                    int(payload.get("max_retries") or 2),
                    1 if payload.get("enabled", True) else 0,
                    is_default,
                    now,
                    now,
                ),
            )
        self.audit(principal, "model_provider.create", "model_provider", provider_id, {"provider": payload.get("provider"), "model": payload.get("model")})
        return self.get_model_provider(principal, provider_id)

    def update_model_provider(self, principal: Principal, provider_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_model_provider(principal, provider_id)
        updates: dict[str, Any] = {}
        for key in ("provider", "model", "base_url"):
            if key in payload and str(payload.get(key) or "").strip():
                updates[key] = str(payload.get(key) or "").strip()
        for key in ("temperature",):
            if key in payload and payload.get(key) is not None:
                updates[key] = float(payload[key])
        for key in ("timeout_seconds", "max_retries"):
            if key in payload and payload.get(key) is not None:
                updates[key] = int(payload[key])
        for key in ("enabled", "is_default"):
            if key in payload and payload.get(key) is not None:
                updates[key] = 1 if payload[key] else 0

        api_key = str(payload.get("api_key") or "")
        clear_api_key = bool(payload.get("clear_api_key"))
        if api_key:
            updates["api_key_ciphertext"] = encrypt_secret(api_key)
            updates["api_key_fingerprint"] = _secret_fingerprint(api_key)
        elif clear_api_key:
            updates["api_key_ciphertext"] = ""
            updates["api_key_fingerprint"] = ""

        if not updates:
            return current

        updates["updated_at"] = utcnow()
        with self._connect() as conn:
            if updates.get("is_default") == 1:
                conn.execute(
                    "UPDATE model_providers SET is_default = 0 WHERE organization_id = ?",
                    (principal.organization_id,),
                )
            assignments = ", ".join(f"{key} = ?" for key in updates)
            conn.execute(
                f"UPDATE model_providers SET {assignments} WHERE id = ? AND organization_id = ?",
                (*updates.values(), provider_id, principal.organization_id),
            )
        self.audit(
            principal,
            "model_provider.update",
            "model_provider",
            provider_id,
            {"provider": payload.get("provider") or current.get("provider"), "model": payload.get("model") or current.get("model")},
        )
        return self.get_model_provider(principal, provider_id)

    def set_default_model_provider(self, principal: Principal, provider_id: str) -> dict[str, Any]:
        provider = self.get_model_provider(principal, provider_id)
        if not bool(provider.get("enabled")):
            raise ValueError("disabled model provider cannot be default")
        now = utcnow()
        with self._connect() as conn:
            conn.execute("UPDATE model_providers SET is_default = 0 WHERE organization_id = ?", (principal.organization_id,))
            conn.execute(
                "UPDATE model_providers SET is_default = 1, updated_at = ? WHERE id = ? AND organization_id = ?",
                (now, provider_id, principal.organization_id),
            )
        self.audit(principal, "model_provider.default", "model_provider", provider_id, {"model": provider.get("model")})
        return self.get_model_provider(principal, provider_id)

    def delete_model_provider(self, principal: Principal, provider_id: str) -> None:
        provider = self.get_model_provider(principal, provider_id)
        if bool(provider.get("is_default")):
            raise ValueError("default model provider cannot be deleted")
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM model_providers WHERE id = ? AND organization_id = ?",
                (provider_id, principal.organization_id),
            )
        self.audit(principal, "model_provider.delete", "model_provider", provider_id, {"model": provider.get("model")})

    def get_model_provider(self, principal: Principal, provider_id: str) -> dict[str, Any]:
        providers = [p for p in self.list_model_providers(principal) if p["id"] == provider_id]
        if not providers:
            raise KeyError(provider_id)
        return providers[0]

    def get_default_model_provider(self, principal: Principal) -> dict[str, Any] | None:
        providers = [p for p in self.list_model_providers(principal) if bool(p.get("enabled"))]
        if not providers:
            return None
        return next((p for p in providers if bool(p.get("is_default"))), providers[0])

    def get_model_provider_secret(self, principal: Principal, provider_id: str) -> str:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT api_key_ciphertext
                FROM model_providers
                WHERE id = ? AND organization_id = ?
                """,
                (provider_id, principal.organization_id),
            ).fetchone()
        if row is None:
            raise KeyError(provider_id)
        return decrypt_secret(str(row["api_key_ciphertext"] or ""))

    def resolve_model_provider_runtime(
        self,
        principal: Principal,
        provider_id: str | None = None,
    ) -> dict[str, Any] | None:
        provider = self.get_model_provider(principal, provider_id) if provider_id else self.get_default_model_provider(principal)
        if provider is None:
            return None
        if not bool(provider.get("enabled")):
            raise ValueError("model provider is disabled")
        secret = self.get_model_provider_secret(principal, str(provider["id"]))
        return {
            "provider_id": provider["id"],
            "provider": provider["provider"],
            "model": provider["model"],
            "base_url": provider["base_url"],
            "api_key": secret,
            "temperature": provider["temperature"],
            "timeout_seconds": provider["timeout_seconds"],
            "max_retries": provider["max_retries"],
            "is_default": bool(provider.get("is_default")),
        }

    # --- knowledge base ---

    def list_knowledge_bases(self, principal: Principal) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, name, description, config_json, access_json, created_at, updated_at
                FROM knowledge_bases
                WHERE organization_id = ?
                ORDER BY updated_at DESC
                """,
                (principal.organization_id,),
            ).fetchall()
        items = [_knowledge_base_payload(row) for row in rows]
        return [item for item in items if principal.role in item["access"]["read_roles"]]

    def create_knowledge_base(self, principal: Principal, name: str, description: str = "") -> dict[str, Any]:
        now = utcnow()
        kb_id = _new_id("kb")
        config = _normalize_knowledge_config(None)
        access = _normalize_knowledge_access(None)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO knowledge_bases(
                    id, organization_id, name, description, config_json, access_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    kb_id,
                    principal.organization_id,
                    name.strip() or "Knowledge Base",
                    description.strip(),
                    json.dumps(config, ensure_ascii=False),
                    json.dumps(access, ensure_ascii=False),
                    now,
                    now,
                ),
            )
        self.audit(principal, "knowledge_base.create", "knowledge_base", kb_id, {"name": name})
        return {
            "id": kb_id,
            "name": name.strip() or "Knowledge Base",
            "description": description.strip(),
            "config": config,
            "access": access,
            "created_at": now,
            "updated_at": now,
        }

    def get_knowledge_base(self, principal: Principal, kb_id: str, *, write: bool = False) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, name, description, config_json, access_json, created_at, updated_at
                FROM knowledge_bases
                WHERE id = ? AND organization_id = ?
                """,
                (kb_id, principal.organization_id),
            ).fetchone()
        if row is None:
            raise KeyError(kb_id)
        item = _knowledge_base_payload(row)
        allowed_roles = item["access"]["write_roles" if write else "read_roles"]
        if principal.role not in allowed_roles:
            raise KeyError(kb_id)
        return item

    def _ensure_kb(self, principal: Principal, kb_id: str, *, write: bool = False) -> dict[str, Any]:
        return self.get_knowledge_base(principal, kb_id, write=write)

    def update_knowledge_base(
        self,
        principal: Principal,
        kb_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        current = self._ensure_kb(principal, kb_id)
        name = str(payload.get("name") if payload.get("name") is not None else current["name"]).strip()
        description = str(
            payload.get("description") if payload.get("description") is not None else current["description"]
        ).strip()
        if not name:
            raise ValueError("knowledge base name is required")
        config = _normalize_knowledge_config(
            payload.get("config") if isinstance(payload.get("config"), dict) else None,
            base=current["config"],
        )
        access = _normalize_knowledge_access(
            payload.get("access") if isinstance(payload.get("access"), dict) else None,
            base=current["access"],
        )
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE knowledge_bases
                SET name = ?, description = ?, config_json = ?, access_json = ?, updated_at = ?
                WHERE id = ? AND organization_id = ?
                """,
                (
                    name,
                    description,
                    json.dumps(config, ensure_ascii=False),
                    json.dumps(access, ensure_ascii=False),
                    now,
                    kb_id,
                    principal.organization_id,
                ),
            )
        self.audit(
            principal,
            "knowledge_base.update",
            "knowledge_base",
            kb_id,
            {"config": config, "access": access},
        )
        return self.get_knowledge_base(principal, kb_id)

    def add_knowledge_document(
        self,
        principal: Principal,
        kb_id: str,
        *,
        title: str,
        source_uri: str,
        source_type: str,
        text: str,
        metadata: dict[str, Any] | None = None,
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
        ingestion_job_id: str = "",
    ) -> dict[str, Any]:
        from src.knowledge.store import _chunk_text, _normalize_text

        knowledge_base = self._ensure_kb(principal, kb_id, write=True)
        config_override: dict[str, Any] = {}
        if chunk_size is not None:
            config_override["chunk_size"] = chunk_size
        if chunk_overlap is not None:
            config_override["chunk_overlap"] = chunk_overlap
        ingestion_config = _normalize_knowledge_config(config_override, base=knowledge_base["config"])
        existing_job: dict[str, Any] | None = None
        if ingestion_job_id:
            existing_job = self.get_ingestion_job(principal, kb_id, ingestion_job_id)
            if str(existing_job.get("status") or "") not in {"pending", "running", "failed"}:
                raise ValueError("ingestion job is not executable")
        doc_id = str((existing_job or {}).get("document_id") or "") or _new_id("doc")
        job_id = str((existing_job or {}).get("id") or "") or _new_id("job")
        now = utcnow()
        job_metadata = {
            **((existing_job or {}).get("metadata") or {}),
            "stage": "queued",
            "source_type": source_type,
            "chunk_size": ingestion_config["chunk_size"],
            "chunk_overlap": ingestion_config["chunk_overlap"],
        }
        with self._connect() as conn:
            if existing_job is None:
                conn.execute(
                    """
                    INSERT INTO knowledge_ingestion_jobs(
                        id, organization_id, knowledge_base_id, document_id, status,
                        progress, metadata_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)
                    """,
                    (
                        job_id,
                        principal.organization_id,
                        kb_id,
                        doc_id,
                        json.dumps(job_metadata, ensure_ascii=False),
                        now,
                        now,
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE knowledge_ingestion_jobs
                    SET document_id = ?, status = 'running', progress = 2, error = '',
                        metadata_json = ?, started_at = COALESCE(NULLIF(started_at, ''), ?),
                        completed_at = '', updated_at = ?
                    WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?
                    """,
                    (
                        doc_id,
                        json.dumps({**job_metadata, "stage": "parsing"}, ensure_ascii=False),
                        now,
                        now,
                        job_id,
                        principal.organization_id,
                        kb_id,
                    ),
                )
        try:
            normalized = _normalize_text(text)
            if not normalized:
                raise ValueError("document text is empty")
            chunks = _chunk_text(
                normalized,
                chunk_chars=ingestion_config["chunk_size"],
                overlap=ingestion_config["chunk_overlap"],
            )
            source_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
            document_metadata = {
                **(metadata or {}),
                "chunk_size": ingestion_config["chunk_size"],
                "chunk_overlap": ingestion_config["chunk_overlap"],
                "retrieval_mode": ingestion_config["retrieval_mode"],
            }
            with self._connect() as conn:
                started_at = utcnow()
                conn.execute(
                    """
                    UPDATE knowledge_ingestion_jobs
                    SET status = 'running', progress = 5, metadata_json = ?, started_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        json.dumps({**job_metadata, "stage": "chunking"}, ensure_ascii=False),
                        started_at,
                        started_at,
                        job_id,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO knowledge_documents(id, organization_id, knowledge_base_id, title, source_uri, source_type, source_hash, status, chunk_count, metadata_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'indexing', 0, ?, ?, ?)
                    """,
                    (
                        doc_id,
                        principal.organization_id,
                        kb_id,
                        title,
                        source_uri,
                        source_type,
                        source_hash,
                        json.dumps(document_metadata, ensure_ascii=False),
                        now,
                        now,
                    ),
                )
                conn.execute(
                    "UPDATE knowledge_ingestion_jobs SET progress = 25, metadata_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps({**job_metadata, "stage": "embedding"}, ensure_ascii=False), utcnow(), job_id),
                )
                self._replace_document_chunks(conn, principal, kb_id, doc_id, title, source_type, chunks, job_id=job_id)
                conn.execute(
                    "UPDATE knowledge_ingestion_jobs SET progress = 96, metadata_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps({**job_metadata, "stage": "indexing"}, ensure_ascii=False), utcnow(), job_id),
                )
                completed_at = utcnow()
                conn.execute(
                    "UPDATE knowledge_documents SET status = 'ready', chunk_count = ?, updated_at = ? WHERE id = ?",
                    (len(chunks), completed_at, doc_id),
                )
                conn.execute(
                    """
                    UPDATE knowledge_ingestion_jobs
                    SET status = 'completed', progress = 100, error = '', metadata_json = ?, completed_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        json.dumps({**job_metadata, "stage": "completed"}, ensure_ascii=False),
                        completed_at,
                        completed_at,
                        job_id,
                    ),
                )
                conn.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (completed_at, kb_id))
        except Exception as exc:
            failed_at = utcnow()
            with self._connect() as conn:
                conn.execute(
                    "UPDATE knowledge_ingestion_jobs SET status = 'failed', progress = 100, error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                    (str(exc), failed_at, failed_at, job_id),
                )
                conn.execute(
                    "UPDATE knowledge_documents SET status = 'failed', updated_at = ? WHERE id = ? AND organization_id = ?",
                    (failed_at, doc_id, principal.organization_id),
                )
            raise
        self.audit(principal, "knowledge_document.ingest", "knowledge_document", doc_id, {"knowledge_base_id": kb_id, "source_type": source_type, "job_id": job_id})
        return self.get_knowledge_document(principal, kb_id, doc_id) | {"ingestion_job_id": job_id}

    def create_pending_url_ingestion_job(
        self,
        principal: Principal,
        kb_id: str,
        *,
        url: str,
        title: str = "",
        runtime_job_id: str = "",
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
    ) -> dict[str, Any]:
        knowledge_base = self._ensure_kb(principal, kb_id, write=True)
        overrides: dict[str, Any] = {}
        if chunk_size is not None:
            overrides["chunk_size"] = chunk_size
        if chunk_overlap is not None:
            overrides["chunk_overlap"] = chunk_overlap
        ingestion_config = _normalize_knowledge_config(overrides, base=knowledge_base["config"])
        now = utcnow()
        job_id = _new_id("job")
        metadata = {
            "stage": "queued",
            "url": url,
            "title": title,
            "source_type": "url",
            "runtime_job_id": runtime_job_id,
            "chunk_size": ingestion_config["chunk_size"],
            "chunk_overlap": ingestion_config["chunk_overlap"],
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO knowledge_ingestion_jobs(
                    id, organization_id, knowledge_base_id, document_id, status,
                    progress, error, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, '', 'pending', 0, '', ?, ?, ?)
                """,
                (job_id, principal.organization_id, kb_id, json.dumps(metadata, ensure_ascii=False), now, now),
            )
        self.audit(
            principal,
            "knowledge_url.queue",
            "knowledge_ingestion_job",
            job_id,
            {"knowledge_base_id": kb_id, "url": url, "runtime_job_id": runtime_job_id},
        )
        return self.get_ingestion_job(principal, kb_id, job_id)

    def create_pending_file_ingestion_job(
        self,
        principal: Principal,
        kb_id: str,
        *,
        path: str,
        title: str = "",
        runtime_job_id: str = "",
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
    ) -> dict[str, Any]:
        knowledge_base = self._ensure_kb(principal, kb_id, write=True)
        overrides: dict[str, Any] = {}
        if chunk_size is not None:
            overrides["chunk_size"] = chunk_size
        if chunk_overlap is not None:
            overrides["chunk_overlap"] = chunk_overlap
        ingestion_config = _normalize_knowledge_config(overrides, base=knowledge_base["config"])
        now = utcnow()
        job_id = _new_id("job")
        metadata = {
            "stage": "queued",
            "path": path,
            "title": title,
            "source_type": "file",
            "runtime_job_id": runtime_job_id,
            "chunk_size": ingestion_config["chunk_size"],
            "chunk_overlap": ingestion_config["chunk_overlap"],
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO knowledge_ingestion_jobs(
                    id, organization_id, knowledge_base_id, document_id, status,
                    progress, error, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, '', 'pending', 0, '', ?, ?, ?)
                """,
                (job_id, principal.organization_id, kb_id, json.dumps(metadata, ensure_ascii=False), now, now),
            )
        self.audit(
            principal,
            "knowledge_file.queue",
            "knowledge_ingestion_job",
            job_id,
            {"knowledge_base_id": kb_id, "path": path, "runtime_job_id": runtime_job_id},
        )
        return self.get_ingestion_job(principal, kb_id, job_id)

    def attach_ingestion_runtime_job(
        self,
        principal: Principal,
        kb_id: str,
        job_id: str,
        runtime_job_id: str,
    ) -> dict[str, Any]:
        self._ensure_kb(principal, kb_id, write=True)
        job = self.get_ingestion_job(principal, kb_id, job_id)
        metadata = {**(job.get("metadata") or {}), "runtime_job_id": runtime_job_id}
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                "UPDATE knowledge_ingestion_jobs SET metadata_json = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?",
                (json.dumps(metadata, ensure_ascii=False), now, job_id, principal.organization_id, kb_id),
            )
        return self.get_ingestion_job(principal, kb_id, job_id)

    def start_ingestion_job(
        self,
        principal: Principal,
        kb_id: str,
        job_id: str,
        *,
        stage: str,
        progress: int,
    ) -> dict[str, Any]:
        self._ensure_kb(principal, kb_id, write=True)
        job = self.get_ingestion_job(principal, kb_id, job_id)
        if str(job.get("status") or "") == "cancelled":
            raise ValueError("ingestion job was cancelled")
        metadata = {**(job.get("metadata") or {}), "stage": stage}
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE knowledge_ingestion_jobs
                SET status = 'running', progress = ?, error = '', metadata_json = ?,
                    started_at = COALESCE(NULLIF(started_at, ''), ?), completed_at = '', updated_at = ?
                WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?
                """,
                (
                    _clamp_progress(progress),
                    json.dumps(metadata, ensure_ascii=False),
                    now,
                    now,
                    job_id,
                    principal.organization_id,
                    kb_id,
                ),
            )
        return self.get_ingestion_job(principal, kb_id, job_id)

    def fail_ingestion_job(
        self,
        principal: Principal,
        kb_id: str,
        job_id: str,
        error: str,
    ) -> dict[str, Any]:
        self._ensure_kb(principal, kb_id, write=True)
        job = self.get_ingestion_job(principal, kb_id, job_id)
        metadata = {**(job.get("metadata") or {}), "stage": "failed"}
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE knowledge_ingestion_jobs
                SET status = 'failed', error = ?, metadata_json = ?, completed_at = ?, updated_at = ?
                WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?
                """,
                (error[:2000], json.dumps(metadata, ensure_ascii=False), now, now, job_id, principal.organization_id, kb_id),
            )
        return self.get_ingestion_job(principal, kb_id, job_id)

    def _replace_document_chunks(
        self,
        conn: sqlite3.Connection,
        principal: Principal,
        kb_id: str,
        doc_id: str,
        title: str,
        source_type: str,
        chunks: list[str],
        *,
        job_id: str = "",
    ) -> None:
        conn.execute("DELETE FROM knowledge_chunks_fts WHERE document_id = ?", (doc_id,))
        conn.execute("DELETE FROM knowledge_chunks WHERE document_id = ?", (doc_id,))
        total = max(1, len(chunks))
        for index, chunk in enumerate(chunks):
            chunk_id = _new_id("chk")
            embedding, embedding_metadata = _embedding_for_text(chunk)
            chunk_metadata = {"source_type": source_type, **embedding_metadata}
            embedding_json = json.dumps(embedding, separators=(",", ":"))
            conn.execute(
                """
                INSERT INTO knowledge_chunks(id, organization_id, knowledge_base_id, document_id, chunk_index, text, embedding_json, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk_id,
                    principal.organization_id,
                    kb_id,
                    doc_id,
                    index,
                    chunk,
                    embedding_json,
                    json.dumps(chunk_metadata, ensure_ascii=False),
                    utcnow(),
                ),
            )
            conn.execute(
                "INSERT INTO knowledge_chunks_fts(chunk_id, organization_id, knowledge_base_id, document_id, title, text) VALUES (?, ?, ?, ?, ?, ?)",
                (chunk_id, principal.organization_id, kb_id, doc_id, title, chunk),
            )
            if job_id and (index == len(chunks) - 1 or index % 4 == 0):
                progress = 10 + int(((index + 1) / total) * 85)
                conn.execute(
                    "UPDATE knowledge_ingestion_jobs SET progress = ?, updated_at = ? WHERE id = ?",
                    (_clamp_progress(progress), utcnow(), job_id),
                )

    def reindex_knowledge_document(self, principal: Principal, kb_id: str, doc_id: str) -> dict[str, Any]:
        from src.knowledge.store import _chunk_text, _normalize_text

        knowledge_base = self._ensure_kb(principal, kb_id, write=True)
        ingestion_config = _normalize_knowledge_config(None, base=knowledge_base["config"])
        now = utcnow()
        job_id = _new_id("job")
        with self._connect() as conn:
            doc = conn.execute(
                """
                SELECT id, title, source_type, metadata_json
                FROM knowledge_documents
                WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?
                """,
                (doc_id, principal.organization_id, kb_id),
            ).fetchone()
            if doc is None:
                raise KeyError(doc_id)
            chunk_rows = conn.execute(
                """
                SELECT text FROM knowledge_chunks
                WHERE document_id = ? AND organization_id = ? AND knowledge_base_id = ?
                ORDER BY chunk_index
                """,
                (doc_id, principal.organization_id, kb_id),
            ).fetchall()
            original_text = "\n\n".join(str(row["text"]) for row in chunk_rows)
            conn.execute(
                """
                INSERT INTO knowledge_ingestion_jobs(
                    id, organization_id, knowledge_base_id, document_id, status,
                    progress, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)
                """,
                (
                    job_id,
                    principal.organization_id,
                    kb_id,
                    doc_id,
                    json.dumps(
                        {
                            "stage": "queued",
                            "source_type": str(doc["source_type"]),
                            "chunk_size": ingestion_config["chunk_size"],
                            "chunk_overlap": ingestion_config["chunk_overlap"],
                        },
                        ensure_ascii=False,
                    ),
                    now,
                    now,
                ),
            )
        try:
            normalized = _normalize_text(original_text)
            if not normalized:
                raise ValueError("document text is empty")
            chunks = _chunk_text(
                normalized,
                chunk_chars=ingestion_config["chunk_size"],
                overlap=ingestion_config["chunk_overlap"],
            )
            started_at = utcnow()
            with self._connect() as conn:
                conn.execute(
                    "UPDATE knowledge_ingestion_jobs SET status = 'running', progress = 5, started_at = ?, updated_at = ? WHERE id = ?",
                    (started_at, started_at, job_id),
                )
                self._replace_document_chunks(conn, principal, kb_id, doc_id, str(doc["title"]), str(doc["source_type"]), chunks, job_id=job_id)
                completed_at = utcnow()
                conn.execute(
                    "UPDATE knowledge_documents SET status = 'ready', chunk_count = ?, source_hash = ?, updated_at = ? WHERE id = ?",
                    (len(chunks), hashlib.sha256(normalized.encode("utf-8")).hexdigest(), completed_at, doc_id),
                )
                document_metadata = _json_object(doc["metadata_json"])
                document_metadata.update(
                    {
                        "chunk_size": ingestion_config["chunk_size"],
                        "chunk_overlap": ingestion_config["chunk_overlap"],
                        "retrieval_mode": ingestion_config["retrieval_mode"],
                    }
                )
                conn.execute(
                    "UPDATE knowledge_documents SET metadata_json = ? WHERE id = ?",
                    (json.dumps(document_metadata, ensure_ascii=False), doc_id),
                )
                conn.execute(
                    "UPDATE knowledge_ingestion_jobs SET status = 'completed', progress = 100, error = '', completed_at = ?, updated_at = ? WHERE id = ?",
                    (completed_at, completed_at, job_id),
                )
                conn.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (completed_at, kb_id))
        except Exception as exc:
            failed_at = utcnow()
            with self._connect() as conn:
                conn.execute(
                    "UPDATE knowledge_documents SET status = 'failed', updated_at = ? WHERE id = ? AND organization_id = ?",
                    (failed_at, doc_id, principal.organization_id),
                )
                conn.execute(
                    "UPDATE knowledge_ingestion_jobs SET status = 'failed', progress = 100, error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                    (str(exc), failed_at, failed_at, job_id),
                )
            raise
        self.audit(principal, "knowledge_document.reindex", "knowledge_document", doc_id, {"knowledge_base_id": kb_id, "job_id": job_id})
        return self.get_knowledge_document(principal, kb_id, doc_id) | {"ingestion_job_id": job_id}

    def list_knowledge_documents(self, principal: Principal, kb_id: str) -> list[dict[str, Any]]:
        self._ensure_kb(principal, kb_id)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    d.id, d.title, d.source_uri, d.source_type, d.status,
                    d.chunk_count, d.metadata_json, d.created_at, d.updated_at,
                    j.id AS ingestion_job_id,
                    j.status AS ingestion_status,
                    j.progress AS ingestion_progress,
                    j.error AS ingestion_error,
                    j.started_at AS ingestion_started_at,
                    j.completed_at AS ingestion_completed_at
                FROM knowledge_documents d
                LEFT JOIN knowledge_ingestion_jobs j ON j.id = (
                    SELECT id FROM knowledge_ingestion_jobs
                    WHERE document_id = d.id AND organization_id = d.organization_id
                    ORDER BY updated_at DESC
                    LIMIT 1
                )
                WHERE d.organization_id = ? AND d.knowledge_base_id = ?
                ORDER BY d.updated_at DESC
                """,
                (principal.organization_id, kb_id),
            ).fetchall()
        documents: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["metadata"] = _json_object(item.pop("metadata_json", None))
            documents.append(item)
        return documents

    def get_knowledge_document(self, principal: Principal, kb_id: str, doc_id: str) -> dict[str, Any]:
        docs = [doc for doc in self.list_knowledge_documents(principal, kb_id) if doc["id"] == doc_id]
        if not docs:
            raise KeyError(doc_id)
        return docs[0]

    def list_knowledge_document_chunks(
        self,
        principal: Principal,
        kb_id: str,
        doc_id: str,
        *,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        self._ensure_kb(principal, kb_id)
        self.get_knowledge_document(principal, kb_id, doc_id)
        capped_limit = max(1, min(int(limit), 500))
        capped_offset = max(0, int(offset))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, chunk_index, text, embedding_json, metadata_json, created_at
                FROM knowledge_chunks
                WHERE organization_id = ? AND knowledge_base_id = ? AND document_id = ?
                ORDER BY chunk_index
                LIMIT ? OFFSET ?
                """,
                (principal.organization_id, kb_id, doc_id, capped_limit, capped_offset),
            ).fetchall()
        chunks: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            metadata = _json_object(item.pop("metadata_json", None))
            try:
                embedding = json.loads(str(item.pop("embedding_json") or "[]"))
            except (TypeError, ValueError, json.JSONDecodeError):
                embedding = []
            text = str(item.get("text") or "")
            chunks.append(
                {
                    **item,
                    "character_count": len(text),
                    "embedding_dimensions": len(embedding) if isinstance(embedding, list) else 0,
                    "embedding_source": str(metadata.get("embedding_source") or "unknown"),
                    "embedding_fallback": bool(metadata.get("embedding_fallback", False)),
                    "metadata": metadata,
                }
            )
        return chunks

    def get_knowledge_document_detail(
        self,
        principal: Principal,
        kb_id: str,
        doc_id: str,
    ) -> dict[str, Any]:
        document = self.get_knowledge_document(principal, kb_id, doc_id)
        with self._connect() as conn:
            vector_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total_chunks,
                    SUM(CASE WHEN embedding_json IS NOT NULL AND embedding_json NOT IN ('', '[]') THEN 1 ELSE 0 END) AS embedded_chunks
                FROM knowledge_chunks
                WHERE organization_id = ? AND knowledge_base_id = ? AND document_id = ?
                """,
                (principal.organization_id, kb_id, doc_id),
            ).fetchone()
        history = [
            job
            for job in self.list_ingestion_jobs(principal, kb_id, limit=200)
            if str(job.get("document_id") or "") == doc_id
        ]
        total_chunks = int(vector_row["total_chunks"] or 0) if vector_row else 0
        embedded_chunks = int(vector_row["embedded_chunks"] or 0) if vector_row else 0
        vector_progress = round((embedded_chunks / total_chunks) * 100) if total_chunks else 0
        return {
            **document,
            "vectorization": {
                "status": "completed" if total_chunks > 0 and embedded_chunks == total_chunks else "pending",
                "progress": vector_progress,
                "embedded_chunks": embedded_chunks,
                "total_chunks": total_chunks,
            },
            "ingestion_history": history,
        }

    def delete_knowledge_document(self, principal: Principal, kb_id: str, doc_id: str) -> None:
        self._ensure_kb(principal, kb_id, write=True)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM knowledge_documents WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?",
                (doc_id, principal.organization_id, kb_id),
            ).fetchone()
            if row is None:
                raise KeyError(doc_id)
            conn.execute("DELETE FROM knowledge_chunks_fts WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM knowledge_chunks WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM knowledge_ingestion_jobs WHERE document_id = ? AND organization_id = ?", (doc_id, principal.organization_id))
            conn.execute("DELETE FROM knowledge_documents WHERE id = ?", (doc_id,))
        self.audit(principal, "knowledge_document.delete", "knowledge_document", doc_id, {"knowledge_base_id": kb_id})

    def search_knowledge(self, principal: Principal, kb_id: str, query: str, limit: int | None = None) -> list[dict[str, Any]]:
        from src.knowledge.store import _fts_query

        knowledge_base = self._ensure_kb(principal, kb_id)
        retrieval_mode = str(knowledge_base["config"].get("retrieval_mode") or "hybrid")
        configured_limit = int(knowledge_base["config"].get("top_k") or 8)
        capped = max(1, min(int(limit if limit is not None else configured_limit), 20))
        query_embedding: list[float] = []
        query_embedding_source = ""
        if retrieval_mode != "keyword":
            query_embedding, query_embedding_metadata = _embedding_for_text(query)
            query_embedding_source = str(query_embedding_metadata.get("embedding_source") or "")
        with self._connect() as conn:
            fts_rows: list[Any] = []
            if retrieval_mode != "vector":
                try:
                    fts_rows = conn.execute(
                        """
                        SELECT chunk_id, document_id, title, text, bm25(knowledge_chunks_fts) AS rank
                        FROM knowledge_chunks_fts
                        WHERE knowledge_chunks_fts MATCH ?
                          AND organization_id = ?
                          AND knowledge_base_id = ?
                        ORDER BY rank
                        LIMIT ?
                        """,
                        (_fts_query(query), principal.organization_id, kb_id, capped * 2),
                    ).fetchall()
                except sqlite3.Error:
                    fts_rows = []
            vector_rows: list[Any] = []
            if retrieval_mode != "keyword":
                vector_rows = conn.execute(
                    """
                    SELECT c.id AS chunk_id, c.document_id, d.title, d.source_uri, c.text, c.embedding_json, c.metadata_json
                    FROM knowledge_chunks c
                    JOIN knowledge_documents d ON d.id = c.document_id
                    WHERE c.organization_id = ? AND c.knowledge_base_id = ?
                    """,
                    (principal.organization_id, kb_id),
                ).fetchall()
            doc_map = {
                str(row["id"]): {"source_uri": str(row["source_uri"])}
                for row in conn.execute(
                    "SELECT id, source_uri FROM knowledge_documents WHERE organization_id = ? AND knowledge_base_id = ?",
                    (principal.organization_id, kb_id),
                ).fetchall()
            }
            scored: dict[str, dict[str, Any]] = {}
            for row in fts_rows:
                lexical_score = 1.0 / (1.0 + max(0.0, float(row["rank"])))
                scored[str(row["chunk_id"])] = {
                    "document_id": str(row["document_id"]),
                    "chunk_id": str(row["chunk_id"]),
                    "title": str(row["title"]),
                    "source_uri": doc_map.get(str(row["document_id"]), {}).get("source_uri", ""),
                    "score": lexical_score * (0.65 if retrieval_mode == "hybrid" else 1.0),
                    "text": str(row["text"]),
                }
            for row in vector_rows:
                try:
                    embedding = json.loads(row["embedding_json"] or "[]")
                except json.JSONDecodeError:
                    embedding = []
                try:
                    metadata = json.loads(row["metadata_json"] or "{}")
                except json.JSONDecodeError:
                    metadata = {}
                chunk_embedding_source = str(metadata.get("embedding_source") or "local")
                same_embedding_space = (
                    chunk_embedding_source == query_embedding_source
                    or (chunk_embedding_source.startswith("local:") and query_embedding_source.startswith("local:"))
                )
                vector_score = max(0.0, _cosine(query_embedding, embedding)) if same_embedding_space else 0.0
                if vector_score <= 0 and scored.get(str(row["chunk_id"])) is None:
                    continue
                item = scored.setdefault(
                    str(row["chunk_id"]),
                    {
                        "document_id": str(row["document_id"]),
                        "chunk_id": str(row["chunk_id"]),
                        "title": str(row["title"]),
                        "source_uri": str(row["source_uri"]),
                        "score": 0.0,
                        "text": str(row["text"]),
                    },
                )
                item["score"] = float(item["score"]) + vector_score * (0.35 if retrieval_mode == "hybrid" else 1.0)
            rows = sorted(scored.values(), key=lambda item: float(item["score"]), reverse=True)[:capped]
            conn.execute(
                "INSERT INTO knowledge_retrieval_logs(id, organization_id, user_id, knowledge_base_id, query, result_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (_new_id("ret"), principal.organization_id, principal.user_id, kb_id, query, len(rows), utcnow()),
            )
            if rows:
                conn.execute(
                    """
                    INSERT INTO audit_logs(id, organization_id, user_id, action, target_type, target_id, metadata_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _new_id("aud"),
                        principal.organization_id,
                        principal.user_id,
                        "knowledge.search",
                        "knowledge_base",
                        kb_id,
                        json.dumps(
                            {
                                "query": query[:200],
                                "result_count": len(rows),
                                "embedding_source": query_embedding_source,
                                "retrieval_mode": retrieval_mode,
                            },
                            ensure_ascii=False,
                        ),
                        utcnow(),
                    ),
                )
        results: list[dict[str, Any]] = []
        for row in rows:
            source_uri = str(row.get("source_uri") or "")
            results.append(
                {
                    "document_id": row["document_id"],
                    "chunk_id": row["chunk_id"],
                    "title": row["title"],
                    "source_uri": source_uri,
                    "score": round(float(row["score"]), 6),
                    "text": row["text"],
                    "citation": f"{row['title']} ({source_uri})",
                }
            )
        return results

    def get_ingestion_job(self, principal: Principal, kb_id: str, job_id: str) -> dict[str, Any]:
        self._ensure_kb(principal, kb_id)
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, knowledge_base_id, document_id, status, progress, error, metadata_json, created_at, updated_at, started_at, completed_at
                FROM knowledge_ingestion_jobs
                WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?
                """,
                (job_id, principal.organization_id, kb_id),
            ).fetchone()
        if row is None:
            raise KeyError(job_id)
        item = dict(row)
        try:
            item["metadata"] = json.loads(str(item.pop("metadata_json") or "{}"))
        except json.JSONDecodeError:
            item["metadata"] = {}
        return item

    def list_ingestion_jobs(self, principal: Principal, kb_id: str, limit: int = 50) -> list[dict[str, Any]]:
        self._ensure_kb(principal, kb_id)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, knowledge_base_id, document_id, status, progress, error, metadata_json, created_at, updated_at, started_at, completed_at
                FROM knowledge_ingestion_jobs
                WHERE organization_id = ? AND knowledge_base_id = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (principal.organization_id, kb_id, max(1, min(limit, 200))),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            try:
                item["metadata"] = json.loads(str(item.pop("metadata_json") or "{}"))
            except json.JSONDecodeError:
                item["metadata"] = {}
            items.append(item)
        return items

    def retry_ingestion_job(self, principal: Principal, kb_id: str, job_id: str) -> dict[str, Any]:
        self._ensure_kb(principal, kb_id, write=True)
        job = self.get_ingestion_job(principal, kb_id, job_id)
        doc_id = str(job.get("document_id") or "")
        if not doc_id:
            raise ValueError("job has no document to retry")
        return self.reindex_knowledge_document(principal, kb_id, doc_id)

    def reset_ingestion_job_for_retry(self, principal: Principal, kb_id: str, job_id: str) -> dict[str, Any]:
        self._ensure_kb(principal, kb_id, write=True)
        job = self.get_ingestion_job(principal, kb_id, job_id)
        if str(job.get("status") or "") != "failed":
            raise ValueError("only failed jobs can be retried")
        metadata = {**(job.get("metadata") or {}), "stage": "queued", "runtime_job_id": ""}
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE knowledge_ingestion_jobs
                SET status = 'pending', progress = 0, error = '', metadata_json = ?,
                    started_at = '', completed_at = '', updated_at = ?
                WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?
                """,
                (json.dumps(metadata, ensure_ascii=False), now, job_id, principal.organization_id, kb_id),
            )
        self.audit(
            principal,
            "knowledge_ingestion.retry",
            "knowledge_ingestion_job",
            job_id,
            {"knowledge_base_id": kb_id},
        )
        return self.get_ingestion_job(principal, kb_id, job_id)

    def cancel_ingestion_job(self, principal: Principal, kb_id: str, job_id: str) -> dict[str, Any]:
        self._ensure_kb(principal, kb_id, write=True)
        job = self.get_ingestion_job(principal, kb_id, job_id)
        if str(job.get("status")) not in {"pending", "running"}:
            raise ValueError("only pending or running jobs can be cancelled")
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                "UPDATE knowledge_ingestion_jobs SET status = 'cancelled', progress = ?, completed_at = ?, updated_at = ? WHERE id = ? AND organization_id = ?",
                (_clamp_progress(job.get("progress")), now, now, job_id, principal.organization_id),
            )
        self.audit(principal, "knowledge_ingestion.cancel", "knowledge_ingestion_job", job_id, {"knowledge_base_id": kb_id})
        return self.get_ingestion_job(principal, kb_id, job_id)

    # --- platform administration ---

    def platform_summary(self) -> dict[str, Any]:
        """Return non-secret, cross-tenant operational counts for platform admins."""
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM users) AS users,
                    (SELECT COUNT(*) FROM users WHERE is_active = 1) AS active_users,
                    (SELECT COUNT(*) FROM organizations) AS organizations,
                    (SELECT COUNT(*) FROM organizations WHERE is_active = 1) AS active_organizations,
                    (SELECT COUNT(*) FROM platform_admins) AS platform_admins,
                    (SELECT COUNT(*) FROM knowledge_bases) AS knowledge_bases,
                    (SELECT COUNT(*) FROM knowledge_documents) AS knowledge_documents,
                    (SELECT COUNT(*) FROM knowledge_chunks) AS knowledge_chunks,
                    (SELECT COUNT(*) FROM knowledge_ingestion_jobs) AS ingestion_jobs,
                    (SELECT COUNT(*) FROM knowledge_ingestion_jobs WHERE status IN ('pending', 'running')) AS ingestion_jobs_active,
                    (SELECT COUNT(*) FROM knowledge_ingestion_jobs WHERE status = 'failed') AS ingestion_jobs_failed,
                    (SELECT COUNT(*) FROM model_call_usage) AS model_calls,
                    (SELECT COUNT(*) FROM audit_logs) AS audit_events,
                    (SELECT COUNT(*) FROM workspace_sessions) AS workspace_sessions,
                    (SELECT COUNT(*) FROM workspace_runs) AS workspace_runs,
                    (SELECT COUNT(*) FROM workspace_artifacts) AS workspace_artifacts
                """
            ).fetchone()
        payload = {str(key): int(row[key] or 0) for key in row.keys()}
        try:
            payload["commercial_db_bytes"] = int(self.path.stat().st_size)
        except OSError:
            payload["commercial_db_bytes"] = 0
        payload["commercial_db_path"] = str(self.path)
        return payload

    def platform_database_status(self) -> dict[str, Any]:
        """Return non-secret SQLite repository health for platform operations."""
        with self._connect() as conn:
            page_count = int(conn.execute("PRAGMA page_count").fetchone()[0] or 0)
            page_size = int(conn.execute("PRAGMA page_size").fetchone()[0] or 0)
            free_pages = int(conn.execute("PRAGMA freelist_count").fetchone()[0] or 0)
            journal_mode = str(conn.execute("PRAGMA journal_mode").fetchone()[0] or "")
            table_counts = {
                "users": int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] or 0),
                "organizations": int(conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0] or 0),
                "knowledge_bases": int(conn.execute("SELECT COUNT(*) FROM knowledge_bases").fetchone()[0] or 0),
                "knowledge_documents": int(conn.execute("SELECT COUNT(*) FROM knowledge_documents").fetchone()[0] or 0),
                "knowledge_chunks": int(conn.execute("SELECT COUNT(*) FROM knowledge_chunks").fetchone()[0] or 0),
                "workspace_artifacts": int(conn.execute("SELECT COUNT(*) FROM workspace_artifacts").fetchone()[0] or 0),
                "audit_logs": int(conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0] or 0),
            }
        try:
            file_bytes = int(self.path.stat().st_size)
        except OSError:
            file_bytes = page_count * page_size
        return {
            "engine": "sqlite",
            "file_bytes": file_bytes,
            "page_count": page_count,
            "page_size": page_size,
            "free_pages": free_pages,
            "journal_mode": journal_mode,
            "table_counts": table_counts,
            "postgres_configured": bool(os.getenv("DATABASE_URL", "").strip()),
        }

    def list_platform_workspace_artifacts(
        self,
        *,
        artifact_type: str = "",
        organization_id: str = "",
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """List tenant-bound generated resources for platform-level support work."""
        clauses: list[str] = []
        params: list[Any] = []
        if artifact_type.strip():
            clauses.append("a.artifact_type = ?")
            params.append(artifact_type.strip().lower())
        if organization_id.strip():
            clauses.append("a.organization_id = ?")
            params.append(organization_id.strip())
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT a.artifact_type, a.artifact_id, a.organization_id, a.session_id, a.attempt_id,
                       a.storage_path, a.metadata_json, a.created_at, a.updated_at,
                       o.name AS organization_name, u.email AS created_by_email
                FROM workspace_artifacts a
                LEFT JOIN organizations o ON o.id = a.organization_id
                LEFT JOIN users u ON u.id = a.created_by_user_id
                {where}
                ORDER BY a.updated_at DESC, a.created_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["metadata"] = _redact_metadata(_json_object(item.pop("metadata_json", "{}")))
            items.append(item)
        return items

    def run_platform_maintenance(self, actor: Principal, action: str) -> dict[str, Any]:
        """Run an explicitly allowlisted maintenance action and audit it."""
        normalized = str(action or "").strip().lower()
        if normalized not in {"expire_sessions", "sqlite_checkpoint", "sqlite_vacuum"}:
            raise ValueError("unsupported maintenance action")

        details: dict[str, Any] = {"action": normalized}
        if normalized == "expire_sessions":
            with self._connect() as conn:
                cursor = conn.execute("DELETE FROM auth_sessions WHERE expires_at < ?", (utcnow(),))
            details["records_affected"] = max(0, int(cursor.rowcount or 0))
        elif normalized == "sqlite_checkpoint":
            with self._connect() as conn:
                row = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            details["checkpoint"] = [int(value or 0) for value in row] if row is not None else []
        else:
            conn = self._connect()
            try:
                conn.execute("VACUUM")
            finally:
                conn.close()
            details["records_affected"] = 0

        details["database"] = self.platform_database_status()
        self.audit(actor, "platform.maintenance.run", "database", normalized, details)
        return details

    def list_platform_users(self, *, query: str = "", limit: int = 100) -> list[dict[str, Any]]:
        filters = []
        params: list[Any] = []
        if query.strip():
            filters.append("(LOWER(u.email) LIKE ? OR LOWER(u.display_name) LIKE ?)")
            term = f"%{query.strip().lower()}%"
            params.extend([term, term])
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT u.id AS user_id, u.email, u.display_name, u.is_active, u.created_at,
                       COUNT(m.organization_id) AS organization_count,
                       GROUP_CONCAT(o.name, ' | ') AS organization_names,
                       CASE WHEN pa.user_id IS NULL THEN 0 ELSE 1 END AS is_platform_admin
                FROM users u
                LEFT JOIN memberships m ON m.user_id = u.id
                LEFT JOIN organizations o ON o.id = m.organization_id
                LEFT JOIN platform_admins pa ON pa.user_id = u.id
                {where}
                GROUP BY u.id
                ORDER BY u.created_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_platform_organizations(self, *, query: str = "", limit: int = 100) -> list[dict[str, Any]]:
        filters = []
        params: list[Any] = []
        if query.strip():
            filters.append("LOWER(o.name) LIKE ?")
            params.append(f"%{query.strip().lower()}%")
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(
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
                GROUP BY o.id
                ORDER BY o.created_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_platform_knowledge_bases(self, *, query: str = "", limit: int = 100) -> list[dict[str, Any]]:
        filters = []
        params: list[Any] = []
        if query.strip():
            filters.append("(LOWER(kb.name) LIKE ? OR LOWER(o.name) LIKE ?)")
            term = f"%{query.strip().lower()}%"
            params.extend([term, term])
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT kb.id, kb.organization_id, kb.name, kb.description, kb.created_at, kb.updated_at,
                       o.name AS organization_name, o.is_active AS organization_active,
                       COUNT(DISTINCT d.id) AS document_count,
                       COALESCE(SUM(d.chunk_count), 0) AS chunk_count,
                       COUNT(DISTINCT j.id) AS ingestion_job_count,
                       SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS failed_job_count
                FROM knowledge_bases kb
                JOIN organizations o ON o.id = kb.organization_id
                LEFT JOIN knowledge_documents d ON d.knowledge_base_id = kb.id
                LEFT JOIN knowledge_ingestion_jobs j ON j.knowledge_base_id = kb.id
                {where}
                GROUP BY kb.id
                ORDER BY kb.updated_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_platform_ingestion_jobs(self, *, job_status: str = "", limit: int = 100) -> list[dict[str, Any]]:
        params: list[Any] = []
        where = ""
        if job_status.strip():
            where = "WHERE j.status = ?"
            params.append(job_status.strip().lower())
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT j.id, j.organization_id, j.knowledge_base_id, j.document_id, j.status, j.progress,
                       j.error, j.created_at, j.updated_at, j.started_at, j.completed_at,
                       o.name AS organization_name, kb.name AS knowledge_base_name, d.title AS document_title
                FROM knowledge_ingestion_jobs j
                LEFT JOIN organizations o ON o.id = j.organization_id
                LEFT JOIN knowledge_bases kb ON kb.id = j.knowledge_base_id
                LEFT JOIN knowledge_documents d ON d.id = j.document_id
                {where}
                ORDER BY j.updated_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_platform_audit_logs(self, *, query: str = "", limit: int = 100) -> list[dict[str, Any]]:
        filters = []
        params: list[Any] = []
        if query.strip():
            filters.append("(a.action LIKE ? OR a.target_type LIKE ? OR a.target_id LIKE ? OR u.email LIKE ?)")
            term = f"%{query.strip()}%"
            params.extend([term, term, term, term])
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        params.append(max(1, min(limit, 500)))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT a.id, a.organization_id, a.user_id, a.action, a.target_type, a.target_id,
                       a.metadata_json, a.created_at, u.email AS actor_email, o.name AS organization_name
                FROM audit_logs a
                LEFT JOIN users u ON u.id = a.user_id
                LEFT JOIN organizations o ON o.id = a.organization_id
                {where}
                ORDER BY a.created_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        return [dict(row) | {"metadata": _json_object(row["metadata_json"])} for row in rows]

    def update_platform_user(self, actor: Principal, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        fields: list[str] = []
        params: list[Any] = []
        if "display_name" in payload:
            fields.append("display_name = ?")
            params.append(str(payload.get("display_name") or "").strip()[:200])
        if "is_active" in payload:
            is_active = bool(payload["is_active"])
            if not is_active and user_id == actor.user_id:
                raise ValueError("platform administrator cannot deactivate their own account")
            fields.append("is_active = ?")
            params.append(1 if is_active else 0)
        if not fields:
            raise ValueError("no user changes supplied")
        params.append(user_id)
        with self._connect() as conn:
            cursor = conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", tuple(params))
            if cursor.rowcount == 0:
                raise KeyError(user_id)
            if "is_active" in payload and not bool(payload["is_active"]):
                conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
        self.audit(actor, "platform.user.update", "user", user_id, {"changes": {key: payload[key] for key in payload if key != "password"}})
        return next((user for user in self.list_platform_users(limit=500) if user["user_id"] == user_id), {})

    def update_platform_organization(self, actor: Principal, organization_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        fields: list[str] = []
        params: list[Any] = []
        if "name" in payload:
            name = str(payload.get("name") or "").strip()[:200]
            if not name:
                raise ValueError("organization name is required")
            fields.append("name = ?")
            params.append(name)
        if "is_active" in payload:
            fields.append("is_active = ?")
            params.append(1 if bool(payload["is_active"]) else 0)
        if not fields:
            raise ValueError("no organization changes supplied")
        params.append(organization_id)
        with self._connect() as conn:
            cursor = conn.execute(f"UPDATE organizations SET {', '.join(fields)} WHERE id = ?", tuple(params))
            if cursor.rowcount == 0:
                raise KeyError(organization_id)
            if "is_active" in payload and not bool(payload["is_active"]):
                conn.execute("DELETE FROM auth_sessions WHERE organization_id = ?", (organization_id,))
        self.audit(actor, "platform.organization.update", "organization", organization_id, {"changes": payload})
        return next((org for org in self.list_platform_organizations(limit=500) if org["id"] == organization_id), {})

    def set_platform_admin(self, actor: Principal, user_id: str, *, enabled: bool) -> dict[str, Any]:
        with self._connect() as conn:
            user = conn.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()
            if user is None:
                raise KeyError(user_id)
            if not enabled and str(user["email"]).lower() in _platform_admin_bootstrap_emails():
                raise ValueError("bootstrap platform administrator cannot be revoked while configured")
            if not enabled and user_id == actor.user_id:
                raise ValueError("platform administrator cannot revoke their own access")
            if enabled:
                conn.execute(
                    "INSERT OR IGNORE INTO platform_admins(user_id, created_at, created_by_user_id) VALUES (?, ?, ?)",
                    (user_id, utcnow(), actor.user_id),
                )
            else:
                count = conn.execute("SELECT COUNT(*) AS count FROM platform_admins").fetchone()
                if int(count["count"] or 0) <= 1:
                    raise ValueError("at least one platform administrator is required")
                conn.execute("DELETE FROM platform_admins WHERE user_id = ?", (user_id,))
        self.audit(actor, "platform.admin.update", "user", user_id, {"enabled": enabled})
        return next((user for user in self.list_platform_users(limit=500) if user["user_id"] == user_id), {})

    def delete_platform_knowledge_base(self, actor: Principal, knowledge_base_id: str) -> None:
        with self._connect() as conn:
            row = conn.execute("SELECT organization_id, name FROM knowledge_bases WHERE id = ?", (knowledge_base_id,)).fetchone()
            if row is None:
                raise KeyError(knowledge_base_id)
            conn.execute("DELETE FROM knowledge_chunks_fts WHERE knowledge_base_id = ?", (knowledge_base_id,))
            conn.execute("DELETE FROM knowledge_retrieval_logs WHERE knowledge_base_id = ?", (knowledge_base_id,))
            conn.execute("DELETE FROM knowledge_ingestion_jobs WHERE knowledge_base_id = ?", (knowledge_base_id,))
            conn.execute("DELETE FROM knowledge_bases WHERE id = ?", (knowledge_base_id,))
        self.audit(actor, "platform.knowledge_base.delete", "knowledge_base", knowledge_base_id, {
            "organization_id": str(row["organization_id"]),
            "name": str(row["name"]),
        })

    def commercial_metrics(self) -> dict[str, int]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM organizations) AS organizations,
                    (SELECT COUNT(*) FROM knowledge_bases) AS knowledge_bases,
                    (SELECT COUNT(*) FROM knowledge_ingestion_jobs) AS ingestion_jobs,
                    (SELECT COUNT(*) FROM knowledge_ingestion_jobs WHERE status = 'failed') AS ingestion_jobs_failed,
                    (SELECT COUNT(*) FROM model_call_usage) AS model_calls,
                    (SELECT COUNT(*) FROM feedback_events) AS feedback_events,
                    (SELECT COUNT(*) FROM feedback_events WHERE rating < 0) AS negative_feedback_events,
                    (SELECT COUNT(*) FROM knowledge_retrieval_logs) AS retrievals,
                    (SELECT COUNT(*) FROM audit_logs WHERE action = 'tool.call') AS tool_calls,
                    (SELECT COUNT(*) FROM audit_logs WHERE action = 'tool.call' AND metadata_json LIKE '%\"status\": \"error\"%') AS tool_call_errors
                """
            ).fetchone()
        return {str(key): int(row[key] or 0) for key in row.keys()}
