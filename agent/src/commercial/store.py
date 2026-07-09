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
import os
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


@dataclass(frozen=True)
class Principal:
    user_id: str
    organization_id: str
    email: str
    role: str


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def db_path() -> Path:
    raw = os.getenv("VIBE_TRADING_COMMERCIAL_DB", "").strip()
    return Path(raw).expanduser() if raw else DEFAULT_DB_PATH


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


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
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
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
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS knowledge_bases (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
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
                    error TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
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
                """
            )

    # --- auth / orgs ---

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
        principal = Principal(user_id=user_id, organization_id=org_id, email=email, role="owner")
        token = self.create_session(principal)
        self.audit(principal, "auth.register", "organization", org_id, {"email": email})
        return principal, token

    def login(self, *, email: str, password: str) -> tuple[Principal, str]:
        email = email.strip().lower()
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT u.id AS user_id, u.email, u.password_hash, m.organization_id, m.role
                FROM users u
                JOIN memberships m ON m.user_id = u.id
                WHERE u.email = ?
                ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END
                LIMIT 1
                """,
                (email,),
            ).fetchone()
        if row is None or not _verify_password(password, str(row["password_hash"])):
            raise ValueError("invalid email or password")
        principal = Principal(
            user_id=str(row["user_id"]),
            organization_id=str(row["organization_id"]),
            email=str(row["email"]),
            role=str(row["role"]),
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
                SELECT u.id AS user_id, u.email, m.organization_id, m.role, s.expires_at
                FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                JOIN memberships m ON m.organization_id = s.organization_id AND m.user_id = s.user_id
                WHERE s.token_hash = ?
                """,
                (token_hash,),
            ).fetchone()
        if row is None or str(row["expires_at"]) < utcnow():
            return None
        return Principal(str(row["user_id"]), str(row["organization_id"]), str(row["email"]), str(row["role"]))

    def logout(self, token: str) -> None:
        if token:
            with self._connect() as conn:
                conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_secret_fingerprint(token),))

    def current_organization(self, principal: Principal) -> dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute("SELECT id, name, created_at FROM organizations WHERE id = ?", (principal.organization_id,)).fetchone()
        return dict(row) if row else {}

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

    def list_audit_logs(self, principal: Principal, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, action, target_type, target_id, metadata_json, user_id, created_at
                FROM audit_logs
                WHERE organization_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (principal.organization_id, max(1, min(limit, 500))),
            ).fetchall()
        return [dict(row) | {"metadata": json.loads(row["metadata_json"] or "{}")} for row in rows]

    def list_usage(self, principal: Principal, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, estimated_cost, created_at
                FROM model_call_usage
                WHERE organization_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (principal.organization_id, max(1, min(limit, 500))),
            ).fetchall()
        return [dict(row) for row in rows]

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

    def get_model_provider(self, principal: Principal, provider_id: str) -> dict[str, Any]:
        providers = [p for p in self.list_model_providers(principal) if p["id"] == provider_id]
        if not providers:
            raise KeyError(provider_id)
        return providers[0]

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

    # --- knowledge base ---

    def list_knowledge_bases(self, principal: Principal) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, description, created_at, updated_at FROM knowledge_bases WHERE organization_id = ? ORDER BY updated_at DESC",
                (principal.organization_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_knowledge_base(self, principal: Principal, name: str, description: str = "") -> dict[str, Any]:
        now = utcnow()
        kb_id = _new_id("kb")
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO knowledge_bases(id, organization_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (kb_id, principal.organization_id, name.strip() or "Knowledge Base", description.strip(), now, now),
            )
        self.audit(principal, "knowledge_base.create", "knowledge_base", kb_id, {"name": name})
        return {"id": kb_id, "name": name.strip() or "Knowledge Base", "description": description.strip(), "created_at": now, "updated_at": now}

    def _ensure_kb(self, principal: Principal, kb_id: str) -> None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM knowledge_bases WHERE id = ? AND organization_id = ?",
                (kb_id, principal.organization_id),
            ).fetchone()
        if row is None:
            raise KeyError(kb_id)

    def add_knowledge_document(self, principal: Principal, kb_id: str, *, title: str, source_uri: str, source_type: str, text: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        from src.knowledge.store import _chunk_text, _normalize_text

        self._ensure_kb(principal, kb_id)
        normalized = _normalize_text(text)
        if not normalized:
            raise ValueError("document text is empty")
        chunks = _chunk_text(normalized)
        source_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        doc_id = _new_id("doc")
        job_id = _new_id("job")
        now = utcnow()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO knowledge_ingestion_jobs(id, organization_id, knowledge_base_id, document_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?)",
                (job_id, principal.organization_id, kb_id, doc_id, now, now),
            )
            conn.execute(
                """
                INSERT INTO knowledge_documents(id, organization_id, knowledge_base_id, title, source_uri, source_type, source_hash, status, chunk_count, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)
                """,
                (doc_id, principal.organization_id, kb_id, title, source_uri, source_type, source_hash, len(chunks), json.dumps(metadata or {}, ensure_ascii=False), now, now),
            )
            for index, chunk in enumerate(chunks):
                chunk_id = _new_id("chk")
                conn.execute(
                    """
                    INSERT INTO knowledge_chunks(id, organization_id, knowledge_base_id, document_id, chunk_index, text, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (chunk_id, principal.organization_id, kb_id, doc_id, index, chunk, now),
                )
                conn.execute(
                    "INSERT INTO knowledge_chunks_fts(chunk_id, organization_id, knowledge_base_id, document_id, title, text) VALUES (?, ?, ?, ?, ?, ?)",
                    (chunk_id, principal.organization_id, kb_id, doc_id, title, chunk),
                )
            conn.execute(
                "UPDATE knowledge_ingestion_jobs SET status = 'completed', updated_at = ? WHERE id = ?",
                (utcnow(), job_id),
            )
            conn.execute("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?", (utcnow(), kb_id))
        self.audit(principal, "knowledge_document.ingest", "knowledge_document", doc_id, {"knowledge_base_id": kb_id, "source_type": source_type})
        return self.get_knowledge_document(principal, kb_id, doc_id) | {"ingestion_job_id": job_id}

    def list_knowledge_documents(self, principal: Principal, kb_id: str) -> list[dict[str, Any]]:
        self._ensure_kb(principal, kb_id)
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, title, source_uri, source_type, status, chunk_count, created_at, updated_at
                FROM knowledge_documents
                WHERE organization_id = ? AND knowledge_base_id = ?
                ORDER BY updated_at DESC
                """,
                (principal.organization_id, kb_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_knowledge_document(self, principal: Principal, kb_id: str, doc_id: str) -> dict[str, Any]:
        docs = [doc for doc in self.list_knowledge_documents(principal, kb_id) if doc["id"] == doc_id]
        if not docs:
            raise KeyError(doc_id)
        return docs[0]

    def delete_knowledge_document(self, principal: Principal, kb_id: str, doc_id: str) -> None:
        self._ensure_kb(principal, kb_id)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id FROM knowledge_documents WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?",
                (doc_id, principal.organization_id, kb_id),
            ).fetchone()
            if row is None:
                raise KeyError(doc_id)
            conn.execute("DELETE FROM knowledge_chunks_fts WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM knowledge_documents WHERE id = ?", (doc_id,))
        self.audit(principal, "knowledge_document.delete", "knowledge_document", doc_id, {"knowledge_base_id": kb_id})

    def search_knowledge(self, principal: Principal, kb_id: str, query: str, limit: int = 5) -> list[dict[str, Any]]:
        from src.knowledge.store import _fts_query

        self._ensure_kb(principal, kb_id)
        capped = max(1, min(limit, 20))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT chunk_id, document_id, title, text, bm25(knowledge_chunks_fts) AS rank
                FROM knowledge_chunks_fts
                WHERE knowledge_chunks_fts MATCH ?
                  AND organization_id = ?
                  AND knowledge_base_id = ?
                ORDER BY rank
                LIMIT ?
                """,
                (_fts_query(query), principal.organization_id, kb_id, capped),
            ).fetchall()
            doc_map = {
                str(row["id"]): {"source_uri": str(row["source_uri"])}
                for row in conn.execute(
                    "SELECT id, source_uri FROM knowledge_documents WHERE organization_id = ? AND knowledge_base_id = ?",
                    (principal.organization_id, kb_id),
                ).fetchall()
            }
            conn.execute(
                "INSERT INTO knowledge_retrieval_logs(id, organization_id, user_id, knowledge_base_id, query, result_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (_new_id("ret"), principal.organization_id, principal.user_id, kb_id, query, len(rows), utcnow()),
            )
        results: list[dict[str, Any]] = []
        for row in rows:
            source_uri = doc_map.get(str(row["document_id"]), {}).get("source_uri", "")
            results.append(
                {
                    "document_id": row["document_id"],
                    "chunk_id": row["chunk_id"],
                    "title": row["title"],
                    "source_uri": source_uri,
                    "score": float(row["rank"]),
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
                SELECT id, knowledge_base_id, document_id, status, error, created_at, updated_at
                FROM knowledge_ingestion_jobs
                WHERE id = ? AND organization_id = ? AND knowledge_base_id = ?
                """,
                (job_id, principal.organization_id, kb_id),
            ).fetchone()
        if row is None:
            raise KeyError(job_id)
        return dict(row)
