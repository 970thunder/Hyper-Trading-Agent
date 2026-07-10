"""Commercial platform HTTP routes: auth, orgs, models, RAG, audit, usage."""

from __future__ import annotations

import sys as _sys
import json
import os
from typing import Any

import httpx
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from pydantic import BaseModel, Field

from src.commercial.store import CommercialStore, Principal, embedding_backend_status as get_embedding_backend_status
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


class KnowledgeDocumentCreateRequest(BaseModel):
    path: str
    title: str = ""


class KnowledgeUrlCreateRequest(BaseModel):
    url: str
    title: str = ""


class KnowledgeSearchRequest(BaseModel):
    query: str
    limit: int = Field(5, ge=1, le=20)


def _host():
    return _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")


def _store() -> CommercialStore:
    return CommercialStore()


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


def _read_document_text(path_value: str) -> tuple[str, str]:
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

    @app.get("/knowledge-bases/{knowledge_base_id}/documents")
    async def list_knowledge_documents(knowledge_base_id: str, principal: Principal = Depends(_principal_from_cookie)):
        try:
            return _store().list_knowledge_documents(principal, knowledge_base_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/documents")
    async def add_knowledge_document(
        knowledge_base_id: str,
        payload: KnowledgeDocumentCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
    ):
        text, source_uri, metadata = _read_document_text(payload.path)
        try:
            return _store().add_knowledge_document(
                principal,
                knowledge_base_id,
                title=payload.title or source_uri.rsplit("\\", 1)[-1].rsplit("/", 1)[-1],
                source_uri=source_uri,
                source_type="file",
                text=text,
                metadata={"path": payload.path, **metadata},
            )
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="knowledge base not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/knowledge-bases/{knowledge_base_id}/urls")
    async def add_knowledge_url(
        knowledge_base_id: str,
        payload: KnowledgeUrlCreateRequest,
        principal: Principal = Depends(_require_role("owner", "admin", "member")),
    ):
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

    @app.get("/audit-logs")
    async def audit_logs(limit: int = 100, principal: Principal = Depends(_require_role("owner", "admin"))):
        return _store().list_audit_logs(principal, limit=limit)

    @app.get("/usage/model-calls")
    async def model_usage(limit: int = 100, principal: Principal = Depends(_require_role("owner", "admin"))):
        return _store().list_usage(principal, limit=limit)
