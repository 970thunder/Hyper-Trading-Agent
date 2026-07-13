"""Commercial platform HTTP routes: auth, orgs, models, RAG, audit, usage."""

from __future__ import annotations

import sys as _sys
import json
import os
from typing import Any

import httpx
from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from src.commercial.store import CommercialStore, Principal, embedding_backend_status as get_embedding_backend_status
from src.runtime_jobs.backend import REDIS_POSTGRES_RUNTIME_BACKEND, _redis_client_from_url, _redis_url, build_runtime_job_backend
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


class ModelProviderCreateRequest(BaseModel):
    provider: str
    model: str
    base_url: str
    api_key: str = ""
    temperature: float = 0.0
    timeout_seconds: int = 120
    max_retries: int = 2
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


class OrganizationMemberCreateRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    display_name: str = ""
    role: str = "member"


class OrganizationMemberUpdateRequest(BaseModel):
    role: str


class ToolPolicyUpdateRequest(BaseModel):
    risk_level: str | None = None
    permission_scope: str | None = None
    requires_approval: bool | None = None
    enabled: bool | None = None


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


def _host():
    return _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")


def _store() -> CommercialStore:
    return CommercialStore()


def _runtime_redis_client():
    redis_url = _redis_url()
    return _redis_client_from_url(redis_url) if redis_url else None


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


def _principal_payload(principal: Principal) -> dict[str, str]:
    return {
        "user_id": principal.user_id,
        "organization_id": principal.organization_id,
        "email": principal.email,
        "role": principal.role,
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
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"file not found: {path_value}")
    parsed = json.loads(read_document(str(path)))
    if parsed.get("status") != "ok":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=parsed.get("error", "failed to read document"))
    text = str(parsed.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="document produced no readable text")
    metadata = {key: value for key, value in parsed.items() if key not in {"status", "text"}}
    return text, str(path), metadata


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
            provider = _store().get_model_provider(principal, provider_id)
            api_key = _store().get_model_provider_secret(principal, provider_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="model provider not found") from exc
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(str(provider["base_url"]).rstrip("/") + "/models", headers=headers)
            reachable = resp.status_code in {200, 401, 403}
        except Exception:
            reachable = False
        return {"status": "ok" if reachable else "error", "reachable": reachable, "provider_id": provider_id}

    @app.get("/knowledge-bases")
    async def list_knowledge_bases(principal: Principal = Depends(_principal_from_cookie)):
        return _store().list_knowledge_bases(principal)

    @app.get("/knowledge-bases/status")
    async def knowledge_backend_status(principal: Principal = Depends(_principal_from_cookie)):
        status_payload = get_embedding_backend_status()
        status_payload["organization_id"] = principal.organization_id
        return status_payload

    @app.post("/knowledge-bases")
    async def create_knowledge_base(
        payload: KnowledgeBaseCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
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
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
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
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
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
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
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
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
    ):
        try:
            store = _store()
            job = store.get_ingestion_job(principal, knowledge_base_id, job_id)
            if job.get("document_id"):
                return store.retry_ingestion_job(principal, knowledge_base_id, job_id)

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
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="failed to queue ingestion retry") from exc
            response.status_code = status.HTTP_202_ACCEPTED
            return retried
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ingestion job not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/ingestion-jobs/{job_id}/cancel")
    async def cancel_ingestion_job(
        knowledge_base_id: str,
        job_id: str,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
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

    @app.get("/usage/model-calls")
    async def model_usage(limit: int = 100, principal: Principal = Depends(_require_role("owner", "admin"))):
        return _store().list_usage(principal, limit=limit)

    @app.post("/feedback")
    async def create_feedback(
        payload: FeedbackCreateRequest,
        principal: Principal = Depends(_principal_from_cookie),
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
