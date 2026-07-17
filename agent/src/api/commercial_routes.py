"""Commercial platform HTTP routes: auth, orgs, models, RAG, audit, usage."""

from __future__ import annotations

import sys as _sys
import json
import os
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from src.commercial.store import CommercialStore, Principal, embedding_backend_status as get_embedding_backend_status
from src.memory.persistent import PersistentMemory, commercial_memory_directory
from src.memory.policy import MemoryPolicy
from src.runtime_jobs.backend import REDIS_POSTGRES_RUNTIME_BACKEND, _redis_client_from_url, _redis_url, build_runtime_job_backend
from src.storage import ObjectStorageError, build_object_storage, object_storage_status
from src.tools.doc_reader_tool import read_document
from src.tools.path_utils import safe_document_path
from src.tools.web_reader_tool import WebReaderTool


SESSION_COOKIE = "vibe_session"


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    organization_name: str = "Default Organization"
    display_name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class PrincipalResponse(BaseModel):
    user_id: str
    organization_id: str
    email: str
    role: str
    is_platform_admin: bool = False


class ModelProviderCreateRequest(BaseModel):
    provider: str
    model: str
    base_url: str
    api_key: str = ""
    temperature: float = 0.0
    timeout_seconds: int = 120
    max_retries: int = 2
    input_price_per_million: float = Field(0.0, ge=0)
    output_price_per_million: float = Field(0.0, ge=0)
    enabled: bool = True
    is_default: bool = False


class ModelProviderUpdateRequest(BaseModel):
    provider: str | None = None
    model: str | None = None
    base_url: str | None = None
    api_key: str = ""
    clear_api_key: bool = False
    temperature: float | None = None
    timeout_seconds: int | None = None
    max_retries: int | None = None
    input_price_per_million: float | None = Field(None, ge=0)
    output_price_per_million: float | None = Field(None, ge=0)
    enabled: bool | None = None
    is_default: bool | None = None


class KnowledgeBaseCreateRequest(BaseModel):
    name: str
    description: str = ""


class KnowledgeBaseConfigPatch(BaseModel):
    chunk_size: int | None = Field(None, ge=300, le=8000)
    chunk_overlap: int | None = Field(None, ge=0, le=7999)
    retrieval_mode: str | None = None
    top_k: int | None = Field(None, ge=1, le=20)
    rerank_enabled: bool | None = None
    rerank_candidate_limit: int | None = Field(None, ge=1, le=50)


class KnowledgeBaseAccessPatch(BaseModel):
    read_roles: list[str] | None = None
    write_roles: list[str] | None = None


class KnowledgeBaseUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    config: KnowledgeBaseConfigPatch | None = None
    access: KnowledgeBaseAccessPatch | None = None


class KnowledgeDocumentCreateRequest(BaseModel):
    path: str
    title: str = ""
    chunk_size: int | None = Field(None, ge=300, le=8000)
    chunk_overlap: int | None = Field(None, ge=0, le=7999)


class KnowledgeUrlCreateRequest(BaseModel):
    url: str
    title: str = ""
    chunk_size: int | None = Field(None, ge=300, le=8000)
    chunk_overlap: int | None = Field(None, ge=0, le=7999)


class KnowledgeSearchRequest(BaseModel):
    query: str
    limit: int | None = Field(None, ge=1, le=20)


class KnowledgeEvaluationDatasetCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    description: str = Field("", max_length=2000)


class KnowledgeEvaluationDatasetUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=160)
    description: str | None = Field(None, max_length=2000)


class KnowledgeEvaluationCaseCreateRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    expected_document_ids: list[str] = Field(default_factory=list, max_length=20)
    expected_chunk_ids: list[str] = Field(default_factory=list, max_length=20)


class KnowledgeEvaluationCaseUpdateRequest(BaseModel):
    query: str | None = Field(None, min_length=1, max_length=2000)
    expected_document_ids: list[str] | None = Field(None, max_length=20)
    expected_chunk_ids: list[str] | None = Field(None, max_length=20)


class KnowledgeEvaluationRunRequest(BaseModel):
    top_k: int | None = Field(None, ge=1, le=20)


class OrganizationMemberCreateRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    display_name: str = ""
    role: str = "member"


class OrganizationMemberUpdateRequest(BaseModel):
    role: str


class OrganizationSwitchRequest(BaseModel):
    organization_id: str


class PlatformUserUpdateRequest(BaseModel):
    display_name: str | None = Field(None, max_length=200)
    is_active: bool | None = None


class PlatformOrganizationUpdateRequest(BaseModel):
    name: str | None = Field(None, max_length=200)
    is_active: bool | None = None


class PlatformMaintenanceRequest(BaseModel):
    action: str
    confirmed: bool = False


class ToolPolicyUpdateRequest(BaseModel):
    risk_level: str | None = None
    permission_scope: str | None = None
    requires_approval: bool | None = None
    enabled: bool | None = None


class UsagePolicyUpdateRequest(BaseModel):
    monthly_token_soft_limit: int | None = Field(None, ge=0)
    monthly_token_hard_limit: int | None = Field(None, ge=0)
    monthly_cost_soft_limit: float | None = Field(None, ge=0)
    monthly_cost_hard_limit: float | None = Field(None, ge=0)


class FeedbackCreateRequest(BaseModel):
    target_type: str
    target_id: str
    session_id: str = ""
    attempt_id: str = ""
    run_id: str = ""
    rating: int
    comment: str = ""
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PersistentMemoryCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=180)
    content: str = Field(..., min_length=1, max_length=8000)
    memory_type: str = Field("user", max_length=32)
    description: str = Field("", max_length=320)


class PersistentMemoryPurgeRequest(BaseModel):
    older_than_days: int = Field(..., ge=1, le=3650)


def _host():
    return _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")


def _store() -> CommercialStore:
    return CommercialStore()


def _persistent_memory(principal: Principal) -> PersistentMemory:
    """Resolve the caller's tenant- and user-scoped persistent memory only."""
    return PersistentMemory(memory_dir=commercial_memory_directory(principal.organization_id, principal.user_id))


def _memory_payload(entry: Any, *, include_body: bool = False) -> dict[str, Any]:
    payload = {
        "id": entry.path.stem,
        "title": entry.title,
        "description": entry.description,
        "memory_type": entry.memory_type,
        "modified_at": entry.modified_at,
    }
    if include_body:
        payload["content"] = entry.body
    return payload


def _runtime_redis_client():
    redis_url = _redis_url()
    return _redis_client_from_url(redis_url) if redis_url else None


_PLATFORM_SENSITIVE_METADATA_KEYWORDS = ("api_key", "authorization", "cookie", "password", "secret", "token")


def _cache_tokens(metadata: dict[str, Any]) -> int:
    """Normalize provider-specific cache token fields for audit totals."""
    usage = metadata.get("usage") if isinstance(metadata.get("usage"), dict) else {}
    input_details = usage.get("input_tokens_details") if isinstance(usage.get("input_tokens_details"), dict) else {}
    values = (
        metadata.get("cached_tokens"),
        metadata.get("cache_tokens"),
        metadata.get("cache_read_tokens"),
        usage.get("cached_tokens"),
        input_details.get("cached_tokens"),
    )
    for value in values:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            continue
    return 0


def _sanitize_platform_metadata(value: Any) -> Any:
    """Preserve operational context while keeping runtime payload secrets out of the API."""
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            normalized = str(key).lower().replace("-", "_")
            if any(keyword in normalized for keyword in _PLATFORM_SENSITIVE_METADATA_KEYWORDS):
                sanitized[str(key)] = "[redacted]"
            elif normalized == "payload":
                sanitized[str(key)] = {"available": bool(item)}
            else:
                sanitized[str(key)] = _sanitize_platform_metadata(item)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_platform_metadata(item) for item in value]
    return value


def _directory_size(path: Path) -> int:
    total = 0
    try:
        for candidate in path.rglob("*"):
            if candidate.is_file():
                try:
                    total += candidate.stat().st_size
                except OSError:
                    continue
    except OSError:
        return total
    return total


def _platform_runtime_jobs(store: CommercialStore, *, limit: int = 200) -> list[dict[str, Any]]:
    """Join durable job envelopes with tenant-bound artifact ownership."""
    try:
        from src.runtime_jobs.store import DurableRuntimeJobStore

        durable_jobs = DurableRuntimeJobStore().list_jobs(limit=limit)
    except Exception:
        durable_jobs = []
    artifacts = store.list_platform_workspace_artifacts(artifact_type="runtime_job", limit=limit)
    artifact_by_id = {str(item["artifact_id"]): item for item in artifacts}
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for job in durable_jobs:
        job_id = str(job.get("job_id") or "")
        artifact = artifact_by_id.get(job_id)
        if artifact is None:
            continue
        seen.add(job_id)
        rows.append(
            {
                "job_id": job_id,
                "kind": str(job.get("kind") or ""),
                "source": str(job.get("source") or ""),
                "title": str(job.get("title") or job_id),
                "status": str(job.get("status") or "unknown"),
                "progress": int(job.get("progress") or 0),
                "error": str(job.get("error") or ""),
                "retryable": bool(job.get("retryable")),
                "cancelable": bool(job.get("cancelable")),
                "retry_count": int(job.get("retry_count") or 0),
                "created_at": str(job.get("created_at") or artifact.get("created_at") or ""),
                "updated_at": str(job.get("updated_at") or artifact.get("updated_at") or ""),
                "organization_id": str(artifact.get("organization_id") or ""),
                "organization_name": str(artifact.get("organization_name") or ""),
                "created_by_email": str(artifact.get("created_by_email") or ""),
                "metadata": _sanitize_platform_metadata(job.get("metadata") or artifact.get("metadata") or {}),
            }
        )
    for artifact in artifacts:
        job_id = str(artifact.get("artifact_id") or "")
        if not job_id or job_id in seen:
            continue
        rows.append(
            {
                "job_id": job_id,
                "kind": str((artifact.get("metadata") or {}).get("kind") or "unknown"),
                "source": "",
                "title": job_id,
                "status": "unavailable",
                "progress": 0,
                "error": "",
                "retryable": False,
                "cancelable": False,
                "retry_count": 0,
                "created_at": str(artifact.get("created_at") or ""),
                "updated_at": str(artifact.get("updated_at") or ""),
                "organization_id": str(artifact.get("organization_id") or ""),
                "organization_name": str(artifact.get("organization_name") or ""),
                "created_by_email": str(artifact.get("created_by_email") or ""),
                "metadata": _sanitize_platform_metadata(artifact.get("metadata") or {}),
            }
        )
    return sorted(rows, key=lambda item: str(item.get("updated_at") or ""), reverse=True)[:limit]


def _platform_operations(store: CommercialStore) -> dict[str, Any]:
    """Build a non-secret platform health snapshot for the global console."""
    from src.runtime_jobs.backend import build_runtime_job_backend
    from src.runtime_jobs.store import DurableRuntimeJobStore

    agent_root = Path(__file__).resolve().parents[2]
    runtime_store = DurableRuntimeJobStore()
    try:
        runtime_db_bytes = int(runtime_store.path.stat().st_size)
    except OSError:
        runtime_db_bytes = 0
    return {
        "database": store.platform_database_status(),
        "runtime": {
            **build_runtime_job_backend(redis_client=_runtime_redis_client()).status(),
            "durable_job_db_bytes": runtime_db_bytes,
        },
        "storage": {
            "uploads_bytes": _directory_size(agent_root / "uploads"),
            "runs_bytes": _directory_size(agent_root / "runs"),
            "sessions_bytes": _directory_size(agent_root / "sessions"),
        },
    }


def _retry_ingestion_job(
    store: CommercialStore,
    principal: Principal,
    knowledge_base_id: str,
    job_id: str,
) -> tuple[dict[str, Any], bool]:
    """Retry an ingestion job and report whether work was queued.

    Both organization administrators and platform administrators use this
    function. The supplied principal remains organization-scoped, so all
    storage mutations retain their tenant condition while the caller records
    its own audit event separately.
    """
    job = store.get_ingestion_job(principal, knowledge_base_id, job_id)
    if job.get("document_id"):
        return store.retry_ingestion_job(principal, knowledge_base_id, job_id), False

    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    source_type = str(metadata.get("source_type") or "")
    if source_type not in {"url", "file"}:
        raise ValueError("ingestion source cannot be retried")
    backend = build_runtime_job_backend(redis_client=_runtime_redis_client())
    if backend.status().get("configured") != REDIS_POSTGRES_RUNTIME_BACKEND or backend.name != REDIS_POSTGRES_RUNTIME_BACKEND:
        raise ValueError("background worker is required to retry this ingestion")

    retried = store.reset_ingestion_job_for_retry(principal, knowledge_base_id, job_id)
    source_value = str(metadata.get("url") if source_type == "url" else metadata.get("path") or "")
    if not source_value:
        raise ValueError("ingestion source is missing")
    runtime_payload = {
        "principal": principal.__dict__,
        "knowledge_base_id": knowledge_base_id,
        "ingestion_job_id": job_id,
        "title": str(metadata.get("title") or ""),
        "chunk_size": metadata.get("chunk_size"),
        "chunk_overlap": metadata.get("chunk_overlap"),
        "url" if source_type == "url" else "path": source_value,
    }
    try:
        runtime_job = backend.enqueue(
            kind=f"knowledge_{source_type}_ingest",
            source="rag",
            title=f"Knowledge {source_type} retry {metadata.get('title') or source_value}",
            payload=runtime_payload,
            metadata={"knowledge_base_id": knowledge_base_id, "ingestion_job_id": job_id},
        )
        retried = store.attach_ingestion_runtime_job(
            principal,
            knowledge_base_id,
            job_id,
            str(runtime_job["job_id"]),
        )
    except Exception as exc:
        store.fail_ingestion_job(principal, knowledge_base_id, job_id, str(exc))
        raise RuntimeError("failed to queue ingestion retry") from exc
    return retried, True


def _principal_from_cookie(vibe_session: str | None = Cookie(default=None)) -> Principal:
    principal = _store().principal_from_token(vibe_session or "")
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return principal


def _require_role(*allowed: str):
    allowed_set = set(allowed)

    def dependency(principal: Principal = Depends(_principal_from_cookie)) -> Principal:
        if principal.role not in allowed_set:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return principal

    return dependency


def _require_platform_admin(principal: Principal = Depends(_principal_from_cookie)) -> Principal:
    if not _store().is_platform_admin(principal):
        # Do not expose system metadata to organization administrators.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Platform administrator access required")
    return principal


def _principal_payload(principal: Principal) -> dict[str, Any]:
    return {
        "user_id": principal.user_id,
        "organization_id": principal.organization_id,
        "email": principal.email,
        "role": principal.role,
        "is_platform_admin": principal.is_platform_admin,
    }


def _set_cookie(response: Response, token: str) -> None:
    secure = os.getenv("VIBE_TRADING_COOKIE_SECURE", "").strip().lower() in {"1", "true", "yes", "on"}
    samesite = os.getenv("VIBE_TRADING_COOKIE_SAMESITE", "lax").strip().lower()
    if samesite not in {"lax", "strict", "none"}:
        samesite = "lax"
    cookie_domain = os.getenv("VIBE_TRADING_COOKIE_DOMAIN", "").strip() or None
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite=samesite,
        secure=secure,
        domain=cookie_domain,
        max_age=14 * 24 * 3600,
    )


def _read_document_text(path_value: str) -> tuple[str, str, dict[str, Any]]:
    path = safe_document_path(path_value)
    normalized_key = path_value.replace("\\", "/").lstrip("./")
    if (not path.exists() or not path.is_file()) and normalized_key.startswith("uploads/"):
        try:
            build_object_storage().materialize_file(normalized_key, path)
        except ObjectStorageError:
            pass
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"file not found: {path_value}")
    parsed = json.loads(read_document(str(path)))
    if parsed.get("status") != "ok":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=parsed.get("error", "failed to read document"))
    text = str(parsed.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="document produced no readable text")
    metadata = {key: value for key, value in parsed.items() if key not in {"status", "text"}}
    return text, normalized_key if normalized_key.startswith("uploads/") else str(path), metadata


def _require_owned_upload(principal: Principal, path_value: str) -> None:
    """Keep commercial file ingestion inside the caller's tenant boundary."""
    normalized = path_value.replace("\\", "/").lstrip("./")
    parts = normalized.split("/")
    if len(parts) >= 3 and parts[0] == "uploads" and parts[1].startswith("org_"):
        if _store().uploaded_file_belongs_to_organization(principal, normalized):
            return
        # Match the resource-not-found behavior used for other tenant records.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="file not found")

    # A commercial user must not turn the server-side path feature into an
    # oracle for shared uploads, runs, or configured import roots. Platform
    # administrators retain this controlled support/import capability.
    if _store().is_platform_admin(principal):
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="file not found")


def register_commercial_routes(app: FastAPI) -> None:
    """Mount commercial platform routes."""
    if _host() is None:
        raise RuntimeError("register_commercial_routes: api_server module not in sys.modules")

    @app.get("/auth/status")
    async def auth_status():
        return {
            "commercial_mode": os.getenv("VIBE_TRADING_COMMERCIAL_MODE", "").strip().lower()
            in {"1", "true", "yes", "on"}
        }

    @app.post("/auth/register", response_model=PrincipalResponse)
    async def register(payload: RegisterRequest, response: Response):
        host = _host()
        if host is not None and not host.commercial_self_registration_enabled():
            # Do not expose a separate anonymous provisioning path in a
            # commercial deployment. Bootstrap and organization management own
            # account creation instead.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
        try:
            principal, token = _store().register_owner(
                email=payload.email,
                password=payload.password,
                organization_name=payload.organization_name,
                display_name=payload.display_name,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="user or organization already exists") from exc
        _set_cookie(response, token)
        return _principal_payload(principal)

    @app.post("/auth/login", response_model=PrincipalResponse)
    async def login(payload: LoginRequest, response: Response):
        try:
            principal, token = _store().login(email=payload.email, password=payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        _set_cookie(response, token)
        return _principal_payload(principal)

    @app.post("/auth/logout")
    async def logout(response: Response, vibe_session: str | None = Cookie(default=None)):
        _store().logout(vibe_session or "")
        response.delete_cookie(SESSION_COOKIE)
        return {"status": "ok"}

    @app.get("/auth/me", response_model=PrincipalResponse)
    async def me(principal: Principal = Depends(_principal_from_cookie)):
        return _principal_payload(principal)

    @app.get("/organizations/current")
    async def current_organization(principal: Principal = Depends(_principal_from_cookie)):
        return _store().current_organization(principal)

    @app.get("/organizations")
    async def available_organizations(principal: Principal = Depends(_principal_from_cookie)):
        return _store().list_user_organizations(principal)

    @app.post("/organizations/switch", response_model=PrincipalResponse)
    async def switch_organization(
        payload: OrganizationSwitchRequest,
        response: Response,
        vibe_session: str | None = Cookie(default=None),
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            next_principal = _store().switch_organization(principal, payload.organization_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        _store().logout(vibe_session or "")
        _set_cookie(response, _store().create_session(next_principal))
        return _principal_payload(next_principal)

    @app.get("/organizations/current/members")
    async def list_organization_members(principal: Principal = Depends(_require_role("owner", "admin"))):
        return _store().list_organization_members(principal)

    @app.post("/organizations/current/members")
    async def create_organization_member(
        payload: OrganizationMemberCreateRequest,
        principal: Principal = Depends(_require_role("owner")),
    ):
        try:
            return _store().create_organization_member(principal, payload.model_dump())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.patch("/organizations/current/members/{user_id}")
    async def update_organization_member(
        user_id: str,
        payload: OrganizationMemberUpdateRequest,
        principal: Principal = Depends(_require_role("owner")),
    ):
        try:
            return _store().update_organization_member_role(principal, user_id, payload.role)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="member not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.delete("/organizations/current/members/{user_id}")
    async def delete_organization_member(user_id: str, principal: Principal = Depends(_require_role("owner"))):
        try:
            _store().delete_organization_member(principal, user_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="member not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return {"status": "deleted", "user_id": user_id}

    @app.get("/models/providers")
    async def list_model_providers(principal: Principal = Depends(_principal_from_cookie)):
        return _store().list_model_providers(principal)

    @app.get("/models/catalog")
    async def list_model_catalog(principal: Principal = Depends(_principal_from_cookie)):
        """Return provider/model presets without disclosing process settings."""
        del principal
        from src.api.settings_routes import LLM_PROVIDERS

        return [provider.model_dump() for provider in LLM_PROVIDERS]

    @app.post("/models/providers")
    async def create_model_provider(
        payload: ModelProviderCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        return _store().create_model_provider(principal, payload.model_dump())

    @app.patch("/models/providers/{provider_id}")
    async def update_model_provider(
        provider_id: str,
        payload: ModelProviderUpdateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().update_model_provider(
                principal,
                provider_id,
                payload.model_dump(exclude_unset=True),
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model provider not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/models/providers/{provider_id}/default")
    async def set_default_model_provider(
        provider_id: str,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().set_default_model_provider(principal, provider_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model provider not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.delete("/models/providers/{provider_id}")
    async def delete_model_provider(provider_id: str, principal: Principal = Depends(_require_role("owner", "admin"))):
        try:
            _store().delete_model_provider(principal, provider_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model provider not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return {"status": "deleted", "provider_id": provider_id}

    @app.post("/models/providers/{provider_id}/test")
    async def test_model_provider(provider_id: str, principal: Principal = Depends(_require_role("owner", "admin"))):
        try:
            runtime = _store().resolve_model_provider_runtime(principal, provider_id)
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model provider not found") from exc

        if runtime is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model provider not found")

        started_at = time.perf_counter()
        endpoint = str(runtime["base_url"]).rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {runtime['api_key']}"} if runtime["api_key"] else {}
        payload = {
            "model": runtime["model"],
            "messages": [{"role": "user", "content": "Hello"}],
            "temperature": 0,
            "max_tokens": 64,
        }
        try:
            timeout_seconds = max(5, min(int(runtime["timeout_seconds"]), 30))
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                response = await client.post(endpoint, headers=headers, json=payload)
            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            response.raise_for_status()
            body = response.json()
            choices = body.get("choices") if isinstance(body, dict) else []
            message = choices[0].get("message") if isinstance(choices, list) and choices else {}
            content = message.get("content") if isinstance(message, dict) else ""
            text = str(content or "").strip()
            return {
                "status": "ok",
                "reachable": True,
                "provider_id": provider_id,
                "prompt": "Hello",
                "response": text[:2000],
                "elapsed_ms": elapsed_ms,
                "model": runtime["model"],
            }
        except Exception as exc:
            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            return {
                "status": "error",
                "reachable": False,
                "provider_id": provider_id,
                "prompt": "Hello",
                "response": "",
                "elapsed_ms": elapsed_ms,
                "model": runtime["model"],
                "error": str(exc)[:500],
            }

    @app.get("/knowledge-bases")
    async def list_knowledge_bases(principal: Principal = Depends(_principal_from_cookie)):
        return _store().list_knowledge_bases(principal)

    @app.get("/knowledge-bases/status")
    async def knowledge_backend_status(principal: Principal = Depends(_principal_from_cookie)):
        status_payload = get_embedding_backend_status()
        status_payload["organization_id"] = principal.organization_id
        status_payload["object_storage"] = object_storage_status()
        return status_payload

    @app.post("/knowledge-bases")
    async def create_knowledge_base(
        payload: KnowledgeBaseCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        return _store().create_knowledge_base(principal, payload.name, payload.description)

    @app.patch("/knowledge-bases/{knowledge_base_id}")
    async def update_knowledge_base(
        knowledge_base_id: str,
        payload: KnowledgeBaseUpdateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().update_knowledge_base(
                principal,
                knowledge_base_id,
                payload.model_dump(exclude_none=True),
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/knowledge-bases/{knowledge_base_id}/documents")
    async def list_knowledge_documents(knowledge_base_id: str, principal: Principal = Depends(_principal_from_cookie)):
        try:
            return _store().list_knowledge_documents(principal, knowledge_base_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/documents")
    async def add_knowledge_document(
        response: Response,
        knowledge_base_id: str,
        payload: KnowledgeDocumentCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
    ):
        if principal.role == "member" and (payload.chunk_size is not None or payload.chunk_overlap is not None):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Member role must use knowledge-base chunking defaults",
            )
        _require_owned_upload(principal, payload.path)
        normalized_upload_key = payload.path.replace("\\", "/").lstrip("./")
        object_key = normalized_upload_key if normalized_upload_key.startswith("uploads/") else ""
        backend = build_runtime_job_backend(redis_client=_runtime_redis_client())
        if backend.status().get("configured") == REDIS_POSTGRES_RUNTIME_BACKEND and backend.name == REDIS_POSTGRES_RUNTIME_BACKEND:
            try:
                source_path = safe_document_path(payload.path)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
            if not source_path.exists() or not source_path.is_file():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"file not found: {payload.path}")
            try:
                queued = _store().create_pending_file_ingestion_job(
                    principal,
                    knowledge_base_id,
                    path=str(source_path),
                    title=payload.title or source_path.name,
                    chunk_size=payload.chunk_size,
                    chunk_overlap=payload.chunk_overlap,
                )
            except KeyError as exc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc
            try:
                runtime_job = backend.enqueue(
                    kind="knowledge_file_ingest",
                    source="rag",
                    title=f"Knowledge file ingestion {payload.title or source_path.name}",
                    payload={
                        "principal": principal.__dict__,
                        "knowledge_base_id": knowledge_base_id,
                        "ingestion_job_id": queued["id"],
                        "path": str(source_path),
                        "object_key": object_key,
                        "title": payload.title or source_path.name,
                        "chunk_size": payload.chunk_size,
                        "chunk_overlap": payload.chunk_overlap,
                    },
                    metadata={"knowledge_base_id": knowledge_base_id, "path": str(source_path), "ingestion_job_id": queued["id"]},
                )
                queued = _store().attach_ingestion_runtime_job(
                    principal,
                    knowledge_base_id,
                    queued["id"],
                    str(runtime_job["job_id"]),
                )
            except Exception as exc:
                _store().fail_ingestion_job(principal, knowledge_base_id, queued["id"], str(exc))
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="failed to queue ingestion job") from exc
            response.status_code = status.HTTP_202_ACCEPTED
            return queued

        try:
            text, source_uri, metadata = _read_document_text(payload.path)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        try:
            return _store().add_knowledge_document(
                principal,
                knowledge_base_id,
                title=payload.title or source_uri.rsplit("\\", 1)[-1].rsplit("/", 1)[-1],
                source_uri=source_uri,
                source_type="file",
                text=text,
                metadata={"path": payload.path, **metadata},
                chunk_size=payload.chunk_size,
                chunk_overlap=payload.chunk_overlap,
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/urls")
    async def add_knowledge_url(
        response: Response,
        knowledge_base_id: str,
        payload: KnowledgeUrlCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        backend = build_runtime_job_backend(redis_client=_runtime_redis_client())
        if backend.status().get("configured") == REDIS_POSTGRES_RUNTIME_BACKEND and backend.name == REDIS_POSTGRES_RUNTIME_BACKEND:
            try:
                queued = _store().create_pending_url_ingestion_job(
                    principal,
                    knowledge_base_id,
                    url=payload.url,
                    title=payload.title,
                    chunk_size=payload.chunk_size,
                    chunk_overlap=payload.chunk_overlap,
                )
            except KeyError as exc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc
            try:
                runtime_job = backend.enqueue(
                    kind="knowledge_url_ingest",
                    source="rag",
                    title=f"Knowledge URL ingestion {payload.title or payload.url}",
                    payload={
                        "principal": principal.__dict__,
                        "knowledge_base_id": knowledge_base_id,
                        "ingestion_job_id": queued["id"],
                        "url": payload.url,
                        "title": payload.title,
                        "chunk_size": payload.chunk_size,
                        "chunk_overlap": payload.chunk_overlap,
                    },
                    metadata={"knowledge_base_id": knowledge_base_id, "url": payload.url, "ingestion_job_id": queued["id"]},
                )
                queued = _store().attach_ingestion_runtime_job(
                    principal,
                    knowledge_base_id,
                    queued["id"],
                    str(runtime_job["job_id"]),
                )
            except Exception as exc:
                _store().fail_ingestion_job(principal, knowledge_base_id, queued["id"], str(exc))
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="failed to queue ingestion job") from exc
            response.status_code = status.HTTP_202_ACCEPTED
            return queued

        reader = WebReaderTool()
        raw = reader.execute(url=payload.url)
        import json

        parsed: dict[str, Any] = json.loads(raw)
        if parsed.get("status") != "ok":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=parsed.get("error", "failed to read URL"))
        try:
            return _store().add_knowledge_document(
                principal,
                knowledge_base_id,
                title=payload.title or parsed.get("title") or payload.url,
                source_uri=payload.url,
                source_type="url",
                text=str(parsed.get("content") or parsed.get("text") or ""),
                metadata={"url": payload.url},
                chunk_size=payload.chunk_size,
                chunk_overlap=payload.chunk_overlap,
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.delete("/knowledge-bases/{knowledge_base_id}/documents/{document_id}")
    async def delete_knowledge_document(
        knowledge_base_id: str,
        document_id: str,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            _store().delete_knowledge_document(principal, knowledge_base_id, document_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge document not found") from exc
        return {"status": "ok"}

    @app.get("/knowledge-bases/{knowledge_base_id}/documents/{document_id}")
    async def get_knowledge_document_detail(
        knowledge_base_id: str,
        document_id: str,
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            return _store().get_knowledge_document_detail(principal, knowledge_base_id, document_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge document not found") from exc

    @app.get("/knowledge-bases/{knowledge_base_id}/documents/{document_id}/chunks")
    async def list_knowledge_document_chunks(
        knowledge_base_id: str,
        document_id: str,
        limit: int = Query(200, ge=1, le=500),
        offset: int = Query(0, ge=0),
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            items = _store().list_knowledge_document_chunks(
                principal,
                knowledge_base_id,
                document_id,
                limit=limit,
                offset=offset,
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge document not found") from exc
        return {"items": items, "count": len(items), "limit": limit, "offset": offset}

    @app.post("/knowledge-bases/{knowledge_base_id}/documents/{document_id}/reindex")
    async def reindex_knowledge_document(
        knowledge_base_id: str,
        document_id: str,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().reindex_knowledge_document(principal, knowledge_base_id, document_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge document not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/search")
    async def search_knowledge(
        knowledge_base_id: str,
        payload: KnowledgeSearchRequest,
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            results = _store().search_knowledge(principal, knowledge_base_id, payload.query, payload.limit)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc
        return {"status": "ok", "query": payload.query, "count": len(results), "results": results}

    @app.get("/knowledge-bases/{knowledge_base_id}/evaluation-datasets")
    async def list_knowledge_evaluation_datasets(
        knowledge_base_id: str,
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            return _store().list_knowledge_evaluation_datasets(principal, knowledge_base_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/evaluation-datasets", status_code=status.HTTP_201_CREATED)
    async def create_knowledge_evaluation_dataset(
        knowledge_base_id: str,
        payload: KnowledgeEvaluationDatasetCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().create_knowledge_evaluation_dataset(
                principal,
                knowledge_base_id,
                name=payload.name,
                description=payload.description,
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.patch("/knowledge-bases/{knowledge_base_id}/evaluation-datasets/{dataset_id}")
    async def update_knowledge_evaluation_dataset(
        knowledge_base_id: str,
        dataset_id: str,
        payload: KnowledgeEvaluationDatasetUpdateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().update_knowledge_evaluation_dataset(
                principal,
                knowledge_base_id,
                dataset_id,
                name=payload.name,
                description=payload.description,
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evaluation dataset not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.delete("/knowledge-bases/{knowledge_base_id}/evaluation-datasets/{dataset_id}")
    async def delete_knowledge_evaluation_dataset(
        knowledge_base_id: str,
        dataset_id: str,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            _store().delete_knowledge_evaluation_dataset(principal, knowledge_base_id, dataset_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evaluation dataset not found") from exc
        return {"status": "ok"}

    @app.get("/knowledge-bases/{knowledge_base_id}/evaluation-datasets/{dataset_id}/cases")
    async def list_knowledge_evaluation_cases(
        knowledge_base_id: str,
        dataset_id: str,
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            return _store().list_knowledge_evaluation_cases(principal, knowledge_base_id, dataset_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evaluation dataset not found") from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/evaluation-datasets/{dataset_id}/cases", status_code=status.HTTP_201_CREATED)
    async def create_knowledge_evaluation_case(
        knowledge_base_id: str,
        dataset_id: str,
        payload: KnowledgeEvaluationCaseCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().create_knowledge_evaluation_case(
                principal,
                knowledge_base_id,
                dataset_id,
                query=payload.query,
                expected_document_ids=payload.expected_document_ids,
                expected_chunk_ids=payload.expected_chunk_ids,
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evaluation dataset not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.patch("/knowledge-bases/{knowledge_base_id}/evaluation-datasets/{dataset_id}/cases/{case_id}")
    async def update_knowledge_evaluation_case(
        knowledge_base_id: str,
        dataset_id: str,
        case_id: str,
        payload: KnowledgeEvaluationCaseUpdateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().update_knowledge_evaluation_case(
                principal,
                knowledge_base_id,
                dataset_id,
                case_id,
                query=payload.query,
                expected_document_ids=payload.expected_document_ids,
                expected_chunk_ids=payload.expected_chunk_ids,
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evaluation case not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.delete("/knowledge-bases/{knowledge_base_id}/evaluation-datasets/{dataset_id}/cases/{case_id}")
    async def delete_knowledge_evaluation_case(
        knowledge_base_id: str,
        dataset_id: str,
        case_id: str,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            _store().delete_knowledge_evaluation_case(principal, knowledge_base_id, dataset_id, case_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evaluation case not found") from exc
        return {"status": "ok"}

    @app.post("/knowledge-bases/{knowledge_base_id}/evaluation-datasets/{dataset_id}/runs")
    async def run_knowledge_evaluation_dataset(
        knowledge_base_id: str,
        dataset_id: str,
        payload: KnowledgeEvaluationRunRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().run_knowledge_evaluation_dataset(
                principal,
                knowledge_base_id,
                dataset_id,
                top_k=payload.top_k,
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evaluation dataset not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/knowledge-bases/{knowledge_base_id}/evaluation-datasets/{dataset_id}/runs")
    async def list_knowledge_evaluation_runs(
        knowledge_base_id: str,
        dataset_id: str,
        limit: int = Query(20, ge=1, le=100),
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            return _store().list_knowledge_evaluation_runs(principal, knowledge_base_id, dataset_id, limit)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="evaluation dataset not found") from exc

    @app.get("/knowledge-bases/{knowledge_base_id}/ingestion-jobs/{job_id}")
    async def get_ingestion_job(
        knowledge_base_id: str,
        job_id: str,
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            return _store().get_ingestion_job(principal, knowledge_base_id, job_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ingestion job not found") from exc

    @app.get("/knowledge-bases/{knowledge_base_id}/ingestion-jobs")
    async def list_ingestion_jobs(
        knowledge_base_id: str,
        limit: int = 50,
        principal: Principal = Depends(_principal_from_cookie),
    ):
        try:
            return _store().list_ingestion_jobs(principal, knowledge_base_id, limit=limit)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/ingestion-jobs/{job_id}/retry")
    async def retry_ingestion_job(
        response: Response,
        knowledge_base_id: str,
        job_id: str,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            store = _store()
            retried, queued = _retry_ingestion_job(store, principal, knowledge_base_id, job_id)
            if queued:
                response.status_code = status.HTTP_202_ACCEPTED
            return retried
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ingestion job not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/ingestion-jobs/{job_id}/cancel")
    async def cancel_ingestion_job(
        knowledge_base_id: str,
        job_id: str,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().cancel_ingestion_job(principal, knowledge_base_id, job_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ingestion job not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    def _tool_metadata() -> list[dict[str, Any]]:
        from src.tools import build_registry

        return build_registry(include_shell_tools=True).get_governance_metadata()

    @app.get("/tools/policies")
    async def list_tool_policies(principal: Principal = Depends(_require_role("owner", "admin"))):
        return _store().list_tool_policies(principal, _tool_metadata())

    @app.patch("/tools/policies/{tool_name}")
    async def update_tool_policy(
        tool_name: str,
        payload: ToolPolicyUpdateRequest,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        metadata = {str(item.get("tool_name")): item for item in _tool_metadata()}
        try:
            return _store().update_tool_policy(
                principal,
                tool_name,
                payload.model_dump(exclude_none=True),
                metadata.get(tool_name),
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/audit-logs")
    async def audit_logs(
        limit: int = 100,
        type: str = "",
        actor: str = "",
        resource: str = "",
        from_: str = Query("", alias="from"),
        to: str = "",
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        return _store().list_audit_logs(
            principal,
            limit=limit,
            action=type,
            user_id=actor,
            target_type=resource,
            date_from=from_,
            date_to=to,
        )

    @app.get("/admin/audit/conversations")
    async def admin_conversation_audit(
        limit: int = Query(200, ge=1, le=500),
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        """Return the full, organization-scoped conversation audit ledger.

        The ordinary session endpoints intentionally apply workspace access on
        each request.  The admin console needs a single authoritative view of
        all organization conversations, including the owner, archived message
        content, model usage, cache metrics, and related audit events.
        """
        host = _host()
        service = host._get_session_service() if host is not None and hasattr(host, "_get_session_service") else None
        if service is None:
            raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Session runtime not enabled")

        store = _store()
        ownership = store.list_workspace_sessions(principal, limit=limit)
        members = {str(member["user_id"]): member for member in store.list_organization_members(principal)}
        usage = store.list_usage(principal, limit=500)
        logs = store.list_audit_logs(principal, limit=500)
        usage_by_session: dict[str, list[dict[str, Any]]] = {}
        for item in usage:
            usage_by_session.setdefault(str(item.get("session_id") or ""), []).append(item)
        logs_by_session: dict[str, list[dict[str, Any]]] = {}
        for item in logs:
            session_id = str(item.get("target_id") or "") if item.get("target_type") == "session" else str((item.get("metadata") or {}).get("session_id") or "")
            if session_id:
                logs_by_session.setdefault(session_id, []).append(item)

        conversations: list[dict[str, Any]] = []
        for binding in ownership:
            session_id = str(binding["session_id"])
            session = service.get_session(session_id)
            if session is None:
                # A deleted runtime record must stay visible as an audit trace.
                session_payload: dict[str, Any] = {
                    "session_id": session_id,
                    "title": "",
                    "status": "deleted",
                    "created_at": binding.get("created_at", ""),
                    "updated_at": binding.get("created_at", ""),
                    "last_attempt_id": None,
                }
                messages: list[dict[str, Any]] = []
            else:
                session_payload = {
                    "session_id": session.session_id,
                    "title": session.title,
                    "status": session.status.value,
                    "created_at": session.created_at,
                    "updated_at": session.updated_at,
                    "last_attempt_id": session.last_attempt_id,
                }
                messages = [
                    {
                        "message_id": message.message_id,
                        "session_id": message.session_id,
                        "role": message.role,
                        "content": message.content,
                        "created_at": message.created_at,
                        "linked_attempt_id": message.linked_attempt_id,
                        "metadata": message.metadata or {},
                    }
                    for message in service.get_messages(session_id, limit=1000)
                ]
            actor_id = str(binding.get("created_by_user_id") or "")
            actor = members.get(actor_id, {})
            session_usage = usage_by_session.get(session_id, [])
            cache_tokens = sum(_cache_tokens(item.get("metadata") or {}) for item in session_usage)
            conversations.append({
                "session": session_payload,
                "actor": {
                    "user_id": actor_id,
                    "display_name": actor.get("display_name") or "",
                    "email": actor.get("email") or "",
                },
                "messages": messages,
                "usage": session_usage,
                "events": logs_by_session.get(session_id, []),
                "metrics": {
                    "input_tokens": sum(int(item.get("prompt_tokens") or 0) for item in session_usage),
                    "output_tokens": sum(int(item.get("completion_tokens") or 0) for item in session_usage),
                    "total_tokens": sum(int(item.get("total_tokens") or 0) for item in session_usage),
                    "cache_tokens": cache_tokens,
                    "estimated_cost": sum(float(item.get("estimated_cost") or 0) for item in session_usage),
                },
            })
        return {"conversations": conversations, "events": logs}

    @app.get("/usage/model-calls")
    async def model_usage(limit: int = 100, principal: Principal = Depends(_require_role("owner", "admin"))):
        return _store().list_usage(principal, limit=limit)

    @app.get("/usage/summary")
    async def usage_summary(principal: Principal = Depends(_require_role("owner", "admin"))):
        return _store().usage_summary(principal)

    @app.get("/usage/timeseries")
    async def usage_timeseries(
        days: int = Query(30, ge=1, le=90),
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        return {"days": days, "series": _store().usage_timeseries(principal, days=days)}

    @app.get("/usage/alerts")
    async def usage_alerts(
        limit: int = 100,
        include_acknowledged: bool = False,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        return _store().list_usage_alerts(
            principal,
            limit=limit,
            include_acknowledged=include_acknowledged,
        )

    @app.post("/usage/alerts/{alert_id}/acknowledge")
    async def acknowledge_usage_alert(
        alert_id: str,
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        try:
            return _store().acknowledge_usage_alert(principal, alert_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="usage alert not found") from exc

    @app.get("/usage/policy")
    async def usage_policy(principal: Principal = Depends(_require_role("owner", "admin"))):
        return _store().get_usage_policy(principal)

    @app.put("/usage/policy")
    async def update_usage_policy(
        payload: UsagePolicyUpdateRequest,
        principal: Principal = Depends(_require_role("owner")),
    ):
        try:
            return _store().update_usage_policy(principal, payload.model_dump(exclude_none=True))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/feedback")
    async def create_feedback(
        payload: FeedbackCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
    ):
        try:
            return _store().record_feedback(principal, payload.model_dump())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/feedback")
    async def list_feedback(
        limit: int = 100,
        target_type: str = "",
        target_id: str = "",
        principal: Principal = Depends(_require_role("owner", "admin")),
    ):
        return _store().list_feedback(
            principal,
            limit=limit,
            target_type=target_type,
            target_id=target_id,
        )

    @app.get("/memory")
    async def list_persistent_memory(
        query: str = Query("", max_length=500),
        limit: int = Query(50, ge=1, le=200),
        principal: Principal = Depends(_require_role("owner", "admin", "member", "viewer")),
    ):
        memory = _persistent_memory(principal)
        entries = memory.find_relevant(query, max_results=limit) if query.strip() else memory.list_entries()[:limit]
        return [_memory_payload(entry) for entry in entries]

    @app.get("/memory/{memory_id}")
    async def get_persistent_memory(
        memory_id: str,
        principal: Principal = Depends(_require_role("owner", "admin", "member", "viewer")),
    ):
        entry = _persistent_memory(principal).find(memory_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="memory not found")
        return _memory_payload(entry, include_body=True)

    @app.post("/memory")
    async def create_persistent_memory(
        payload: PersistentMemoryCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
    ):
        policy = MemoryPolicy()
        allowed, reason = policy.validate_write(payload.title, payload.content, payload.memory_type)
        if not allowed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason or "memory write blocked")
        memory = _persistent_memory(principal)
        try:
            path = memory.add(payload.title, payload.content, payload.memory_type, description=payload.description)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        entry = memory.find(path.stem)
        if entry is None:  # pragma: no cover - protects a successful write from a transient read failure
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="memory write could not be read")
        _store().audit(principal, "memory.create", "persistent_memory", path.stem, {
            "memory_type": entry.memory_type,
            "content_length": len(entry.body),
        })
        return _memory_payload(entry, include_body=True)

    @app.delete("/memory/{memory_id}")
    async def delete_persistent_memory(
        memory_id: str,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
    ):
        memory = _persistent_memory(principal)
        entry = memory.find(memory_id)
        if entry is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="memory not found")
        if not memory.remove_entry(entry):
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="memory deletion failed")
        _store().audit(principal, "memory.delete", "persistent_memory", memory_id, {"memory_type": entry.memory_type})
        return {"status": "deleted", "memory_id": memory_id}

    @app.post("/memory/purge")
    async def purge_persistent_memory(
        payload: PersistentMemoryPurgeRequest,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
    ):
        memory = _persistent_memory(principal)
        cutoff = time.time() - payload.older_than_days * 24 * 60 * 60
        removed = [entry for entry in memory.list_entries() if entry.modified_at < cutoff and memory.remove_entry(entry)]
        _store().audit(principal, "memory.purge", "persistent_memory", "", {
            "older_than_days": payload.older_than_days,
            "removed_count": len(removed),
        })
        return {"status": "completed", "removed_count": len(removed), "older_than_days": payload.older_than_days}

    # Platform administration is intentionally separate from organization /admin.
    # All endpoints return operational metadata only and never provider secrets.
    @app.get("/platform-admin/summary")
    async def platform_summary(principal: Principal = Depends(_require_platform_admin)):
        store = _store()
        payload = store.platform_summary()
        runtime_jobs = _platform_runtime_jobs(store)
        payload["runtime_jobs"] = len(runtime_jobs)
        payload["runtime_jobs_active"] = sum(1 for job in runtime_jobs if job["status"] in {"queued", "pending", "running"})
        payload["runtime_jobs_failed"] = sum(1 for job in runtime_jobs if job["status"] in {"failed", "error"})
        payload["requested_by"] = principal.user_id
        return payload

    @app.get("/platform-admin/operations")
    async def platform_operations(principal: Principal = Depends(_require_platform_admin)):
        return _platform_operations(_store())

    @app.post("/platform-admin/maintenance")
    async def run_platform_maintenance(
        payload: PlatformMaintenanceRequest,
        principal: Principal = Depends(_require_platform_admin),
    ):
        if not payload.confirmed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="maintenance action requires confirmation")
        try:
            return _store().run_platform_maintenance(principal, payload.action)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/platform-admin/runtime-jobs")
    async def platform_runtime_jobs(
        limit: int = Query(100, ge=1, le=500),
        principal: Principal = Depends(_require_platform_admin),
    ):
        return _platform_runtime_jobs(_store(), limit=limit)

    @app.get("/platform-admin/workspace-artifacts")
    async def platform_workspace_artifacts(
        artifact_type: str = "",
        organization_id: str = "",
        limit: int = Query(100, ge=1, le=500),
        principal: Principal = Depends(_require_platform_admin),
    ):
        return _store().list_platform_workspace_artifacts(
            artifact_type=artifact_type,
            organization_id=organization_id,
            limit=limit,
        )

    @app.get("/platform-admin/users")
    async def platform_users(
        query: str = "",
        limit: int = Query(100, ge=1, le=500),
        principal: Principal = Depends(_require_platform_admin),
    ):
        return _store().list_platform_users(query=query, limit=limit)

    @app.patch("/platform-admin/users/{user_id}")
    async def update_platform_user(
        user_id: str,
        payload: PlatformUserUpdateRequest,
        principal: Principal = Depends(_require_platform_admin),
    ):
        try:
            return _store().update_platform_user(principal, user_id, payload.model_dump(exclude_none=True))
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/platform-admin/users/{user_id}/platform-admin")
    async def grant_platform_admin(user_id: str, principal: Principal = Depends(_require_platform_admin)):
        try:
            return _store().set_platform_admin(principal, user_id, enabled=True)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found") from exc

    @app.delete("/platform-admin/users/{user_id}/platform-admin")
    async def revoke_platform_admin(user_id: str, principal: Principal = Depends(_require_platform_admin)):
        try:
            return _store().set_platform_admin(principal, user_id, enabled=False)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/platform-admin/organizations")
    async def platform_organizations(
        query: str = "",
        limit: int = Query(100, ge=1, le=500),
        principal: Principal = Depends(_require_platform_admin),
    ):
        return _store().list_platform_organizations(query=query, limit=limit)

    @app.get("/platform-admin/usage")
    async def platform_usage(
        limit: int = Query(500, ge=1, le=500),
        principal: Principal = Depends(_require_platform_admin),
    ):
        del principal
        return _store().list_platform_usage(limit=limit)

    @app.get("/platform-admin/usage/timeseries")
    async def platform_usage_timeseries(
        days: int = Query(30, ge=1, le=90),
        principal: Principal = Depends(_require_platform_admin),
    ):
        del principal
        return {"days": days, "series": _store().platform_usage_timeseries(days=days)}

    @app.patch("/platform-admin/organizations/{organization_id}")
    async def update_platform_organization(
        organization_id: str,
        payload: PlatformOrganizationUpdateRequest,
        principal: Principal = Depends(_require_platform_admin),
    ):
        try:
            return _store().update_platform_organization(principal, organization_id, payload.model_dump(exclude_none=True))
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/platform-admin/knowledge-bases")
    async def platform_knowledge_bases(
        query: str = "",
        limit: int = Query(100, ge=1, le=500),
        principal: Principal = Depends(_require_platform_admin),
    ):
        return _store().list_platform_knowledge_bases(query=query, limit=limit)

    @app.delete("/platform-admin/knowledge-bases/{knowledge_base_id}")
    async def delete_platform_knowledge_base(
        knowledge_base_id: str,
        principal: Principal = Depends(_require_platform_admin),
    ):
        try:
            _store().delete_platform_knowledge_base(principal, knowledge_base_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found") from exc
        return {"status": "deleted", "knowledge_base_id": knowledge_base_id}

    @app.get("/platform-admin/ingestion-jobs")
    async def platform_ingestion_jobs(
        status_filter: str = Query("", alias="status"),
        limit: int = Query(100, ge=1, le=500),
        principal: Principal = Depends(_require_platform_admin),
    ):
        return _store().list_platform_ingestion_jobs(job_status=status_filter, limit=limit)

    @app.post("/platform-admin/ingestion-jobs/{job_id}/retry")
    async def retry_platform_ingestion_job(
        job_id: str,
        response: Response,
        principal: Principal = Depends(_require_platform_admin),
    ):
        store = _store()
        try:
            job = store.get_platform_ingestion_job(job_id)
            target_principal = Principal(
                user_id=principal.user_id,
                organization_id=str(job["organization_id"]),
                email=principal.email,
                role="owner",
                is_platform_admin=True,
            )
            retried, queued = _retry_ingestion_job(store, target_principal, str(job["knowledge_base_id"]), job_id)
            store.audit(principal, "platform.knowledge_ingestion.retry", "knowledge_ingestion_job", job_id, {
                "organization_id": target_principal.organization_id,
                "knowledge_base_id": str(job["knowledge_base_id"]),
            })
            if queued:
                response.status_code = status.HTTP_202_ACCEPTED
            return retried
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ingestion job not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    @app.post("/platform-admin/ingestion-jobs/{job_id}/cancel")
    async def cancel_platform_ingestion_job(
        job_id: str,
        principal: Principal = Depends(_require_platform_admin),
    ):
        store = _store()
        try:
            job = store.get_platform_ingestion_job(job_id)
            target_principal = Principal(
                user_id=principal.user_id,
                organization_id=str(job["organization_id"]),
                email=principal.email,
                role="owner",
                is_platform_admin=True,
            )
            cancelled = store.cancel_ingestion_job(target_principal, str(job["knowledge_base_id"]), job_id)
            store.audit(principal, "platform.knowledge_ingestion.cancel", "knowledge_ingestion_job", job_id, {
                "organization_id": target_principal.organization_id,
                "knowledge_base_id": str(job["knowledge_base_id"]),
            })
            return cancelled
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ingestion job not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.get("/platform-admin/audit-logs")
    async def platform_audit_logs(
        query: str = "",
        limit: int = Query(100, ge=1, le=500),
        principal: Principal = Depends(_require_platform_admin),
    ):
        return _store().list_platform_audit_logs(query=query, limit=limit)
