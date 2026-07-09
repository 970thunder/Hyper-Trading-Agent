"""Knowledge-base HTTP routes.

Mounted by ``agent/api_server.py`` via ``register_knowledge_routes(app)``.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from src.knowledge import KnowledgeBase
from src.tools.knowledge_tool import _read_text_file
from src.tools.path_utils import safe_document_path


class KnowledgeStatsResponse(BaseModel):
    status: str
    db_path: str
    document_count: int
    chunk_count: int


class KnowledgeDocumentResponse(BaseModel):
    id: str
    title: str
    source_path: str
    source_hash: str
    chunk_count: int
    created_at: str


class KnowledgeAddRequest(BaseModel):
    path: str = Field(..., min_length=1)
    title: Optional[str] = None


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    limit: int = Field(5, ge=1, le=20)


class KnowledgeSearchResultResponse(BaseModel):
    document_id: str
    title: str
    source_path: str
    chunk_index: int
    score: float
    text: str


class KnowledgeSearchResponse(BaseModel):
    status: str
    query: str
    count: int
    results: list[KnowledgeSearchResultResponse]


def _host():
    return _sys.modules.get("api_server") or _sys.modules.get("agent.api_server")


def _doc_payload(doc) -> KnowledgeDocumentResponse:
    return KnowledgeDocumentResponse(
        id=doc.id,
        title=doc.title,
        source_path=doc.source_path,
        source_hash=doc.source_hash,
        chunk_count=doc.chunk_count,
        created_at=doc.created_at,
    )


def register_knowledge_routes(app: FastAPI) -> None:
    """Mount knowledge-base routes."""
    host = _host()
    if host is None:
        raise RuntimeError("register_knowledge_routes: api_server module not in sys.modules")

    @app.get(
        "/knowledge/stats",
        response_model=KnowledgeStatsResponse,
        dependencies=[Depends(host.require_local_or_auth)],
    )
    async def get_knowledge_stats():
        return KnowledgeBase().stats()

    @app.get(
        "/knowledge/documents",
        response_model=list[KnowledgeDocumentResponse],
        dependencies=[Depends(host.require_local_or_auth)],
    )
    async def list_knowledge_documents(limit: int = 100):
        docs = KnowledgeBase().list_documents(limit=limit)
        return [_doc_payload(doc) for doc in docs]

    @app.post(
        "/knowledge/documents",
        response_model=KnowledgeDocumentResponse,
        dependencies=[Depends(host.require_settings_write_auth)],
    )
    async def add_knowledge_document(payload: KnowledgeAddRequest):
        try:
            path = safe_document_path(payload.path)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"file not found: {payload.path}")
        if Path(path).suffix.lower() not in {".txt", ".md", ".rst", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".htm", ".xml", ".py", ".js", ".ts", ".tsx"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Knowledge indexing currently accepts text-like files. Convert binary documents to text first.",
            )
        try:
            doc = KnowledgeBase().add_text(
                title=(payload.title or path.name),
                text=_read_text_file(path),
                source_path=str(path),
                metadata={"original_path": payload.path},
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return _doc_payload(doc)

    @app.post(
        "/knowledge/search",
        response_model=KnowledgeSearchResponse,
        dependencies=[Depends(host.require_local_or_auth)],
    )
    async def search_knowledge(payload: KnowledgeSearchRequest):
        results = KnowledgeBase().search(payload.query, limit=payload.limit)
        return KnowledgeSearchResponse(
            status="ok",
            query=payload.query,
            count=len(results),
            results=[
                KnowledgeSearchResultResponse(
                    document_id=item.document_id,
                    title=item.title,
                    source_path=item.source_path,
                    chunk_index=item.chunk_index,
                    score=item.score,
                    text=item.text,
                )
                for item in results
            ],
        )
